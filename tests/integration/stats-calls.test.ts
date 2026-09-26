import { AppDataSource } from '../../src/db/data-source';
import { Call, CallEventType, Campaign, CampaignStatus } from '../../src/entities';
import { applyCallEvent } from '../../src/modules/calls/callLifecycle.service';
import { listCallsQuerySchema } from '../../src/modules/calls/calls.schema';
import { callsService } from '../../src/modules/calls/calls.service';
import { runDialerTick } from '../../src/workers/dialer';
import { createAvailableAgents, createCampaign, RecordingTelephony } from '../helpers/fixtures';
import { api, useIntegration } from '../helpers/integration';

const T0 = Date.now() - 10 * 60_000;
const at = (sec: number) => new Date(T0 + sec * 1000);

function event(providerCallId: string, type: CallEventType, occurredAt: Date) {
  return applyCallEvent({ eventId: `${providerCallId}:${type}`, providerCallId, type, occurredAt });
}

/**
 * 4 dialed calls: two answered + completed (30s and 60s), one no_answer, one still initiated.
 */
async function scenario(): Promise<{ campaign: Campaign; pids: string[]; agentIds: string[] }> {
  const campaign = await createCampaign({}, 4);
  const agents = await createAvailableAgents(2);
  const telephony = new RecordingTelephony();
  await runDialerTick(telephony, { batchSize: 10, retryDelaySec: 0 });
  const pids = telephony.dials.map((d) => d.providerCallId);

  await event(pids[0], CallEventType.Answered, at(0));
  await event(pids[0], CallEventType.Completed, at(30));
  await event(pids[1], CallEventType.Answered, at(0));
  await event(pids[1], CallEventType.Completed, at(60));
  await event(pids[2], CallEventType.NoAnswer, at(20));
  await AppDataSource.getRepository(Call).update({ providerCallId: pids[0] }, { qaScore: 80 });
  return { campaign, pids, agentIds: agents.map((a) => a.id) };
}

describe('Stats and calls API', () => {
  const ctx = useIntegration();

  describe('GET /api/campaigns/:id/stats', () => {
    it('computes stats and serves them cache-aside (MISS → HIT → invalidated on call end)', async () => {
      const { campaign, pids } = await scenario();

      const first = await api(ctx.app()).get(`/api/campaigns/${campaign.id}/stats`);
      expect(first.status).toBe(200);
      expect(first.headers['x-cache']).toBe('MISS');
      expect(first.body.data).toMatchObject({
        totalLeads: 4,
        totalCalls: 4,
        callsInProgress: 1,
        callsAnswered: 2,
        answerRate: 0.6667, // 2 answered / 3 finished
        avgDurationSec: 45,
        avgQaScore: 80,
        leadsByStatus: { completed: 2, pending: 1, dialing: 1 },
        callsByStatus: { completed: 2, no_answer: 1, initiated: 1 },
      });

      const second = await api(ctx.app()).get(`/api/campaigns/${campaign.id}/stats`);
      expect(second.headers['x-cache']).toBe('HIT');
      expect(second.body.data).toEqual(first.body.data);

      await event(pids[3], CallEventType.Failed, at(5));
      const third = await api(ctx.app()).get(`/api/campaigns/${campaign.id}/stats`);
      expect(third.headers['x-cache']).toBe('MISS');
      expect(third.body.data.callsInProgress).toBe(0);
    });

    it('returns 404 for an unknown campaign', async () => {
      await api(ctx.app())
        .get('/api/campaigns/7f1c1d2e-8a1b-4c3d-9e8f-0a1b2c3d4e5f/stats')
        .expect(404);
    });
  });

  describe('GET /api/calls', () => {
    it('filters by status list, agent and campaign; sorts newest first; paginates', async () => {
      const { campaign, agentIds } = await scenario();
      // Pause the first campaign, otherwise its no_answer lead (retry delay 0) is redialed below.
      await AppDataSource.getRepository(Campaign).update(campaign.id, {
        status: CampaignStatus.Paused,
      });
      const other = await createCampaign({ name: 'Other' }, 2);
      await runDialerTick(new RecordingTelephony(), { batchSize: 10, retryDelaySec: 0 });

      const all = await api(ctx.app()).get('/api/calls?limit=100');
      expect(all.body.meta.total).toBe(6);
      const created = all.body.data.map((c: Call) => new Date(c.createdAt).getTime());
      expect([...created].sort((a, b) => b - a)).toEqual(created);
      expect(all.body.data[0]).toHaveProperty('lead.phone');
      expect(all.body.data[0]).not.toHaveProperty('transcript');

      const live = await api(ctx.app()).get('/api/calls?status=initiated,ringing,answered');
      expect(live.body.meta.total).toBe(3); // 1 from scenario + 2 from `other`

      const byCampaign = await api(ctx.app()).get(`/api/calls?campaignId=${other.id}`);
      expect(byCampaign.body.meta.total).toBe(2);

      const byAgent = await api(ctx.app()).get(`/api/calls?agentId=${agentIds[0]}`);
      expect(byAgent.body.data.every((c: Call) => c.agentId === agentIds[0])).toBe(true);

      const page2 = await api(ctx.app()).get(`/api/calls?campaignId=${campaign.id}&limit=3&page=2`);
      expect(page2.body.meta).toEqual({ page: 2, limit: 3, total: 4 });
      expect(page2.body.data).toHaveLength(1);

      const future = new Date(Date.now() + 60_000).toISOString();
      const none = await api(ctx.app()).get(`/api/calls?from=${encodeURIComponent(future)}`);
      expect(none.body.meta.total).toBe(0);
    });

    it('rejects bad filters with 400', async () => {
      await api(ctx.app()).get('/api/calls?status=bogus').expect(400);
      await api(ctx.app()).get('/api/calls?limit=1000').expect(400);
      await api(ctx.app())
        .get('/api/calls?from=2030-01-02T00:00:00Z&to=2030-01-01T00:00:00Z')
        .expect(400);
    });

    it.each([
      [{ campaignId: '7f1c1d2e-8a1b-4c3d-9e8f-0a1b2c3d4e5f' }, 'IDX_calls_campaign_created'],
      [{ status: 'answered' }, 'IDX_calls_status_created'],
      [{ agentId: '7f1c1d2e-8a1b-4c3d-9e8f-0a1b2c3d4e5f' }, 'IDX_calls_agent'],
    ])('list query for %j can use %s', async (filters, indexName) => {
      const query = listCallsQuerySchema.parse(filters);
      const [sql, params] = callsService.buildListQuery(query).getQueryAndParameters();
      const plan = await AppDataSource.transaction(async (m) => {
        // Tables are tiny in tests, so force the planner to show which index it *can* use.
        await m.query('SET LOCAL enable_seqscan = off');
        return m.query(`EXPLAIN (FORMAT JSON) ${sql}`, params);
      });
      expect(JSON.stringify(plan)).toContain(indexName);
    });
  });

  describe('GET /api/calls/:id', () => {
    it('includes the event timeline, agent, lead and summary fields', async () => {
      const { pids } = await scenario();
      const call = await AppDataSource.getRepository(Call).findOneByOrFail({
        providerCallId: pids[0],
      });

      const res = await api(ctx.app()).get(`/api/calls/${call.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: call.id,
        status: 'completed',
        durationSec: 30,
        qaScore: 80,
        lead: { phone: expect.any(String) },
        agent: { name: expect.any(String) },
        campaign: { name: 'Test campaign' },
      });
      expect(res.body.data).toHaveProperty('summary');
      expect(res.body.data).toHaveProperty('transcript');
      expect(res.body.data.events.map((e: { type: string }) => e.type)).toEqual([
        'answered',
        'completed',
      ]);
    });

    it('404s for an unknown call and 400s for a malformed id', async () => {
      await api(ctx.app()).get('/api/calls/7f1c1d2e-8a1b-4c3d-9e8f-0a1b2c3d4e5f').expect(404);
      await api(ctx.app()).get('/api/calls/not-a-uuid').expect(400);
    });
  });
});
