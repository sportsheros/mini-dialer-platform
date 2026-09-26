import request from 'supertest';
import { AppDataSource } from '../../src/db/data-source';
import {
  Agent,
  AgentStatus,
  Call,
  CallEvent,
  CallStatus,
  Lead,
  LeadStatus,
} from '../../src/entities';
import { getSummaryQueue } from '../../src/lib/queue';
import { agentPool } from '../../src/modules/agents/agentPool';
import { runDialerTick } from '../../src/workers/dialer';
import { createAvailableAgents, createCampaign, RecordingTelephony } from '../helpers/fixtures';
import { useIntegration } from '../helpers/integration';
import { sendWebhook } from '../helpers/webhook';

/** Creates `n` real calls through the dialer and returns their providerCallIds. */
async function dialCalls(n: number, maxAttempts = 3): Promise<string[]> {
  await createCampaign({ maxAttempts }, n);
  const telephony = new RecordingTelephony();
  while (telephony.dials.length < n) {
    await runDialerTick(telephony, { batchSize: 100, retryDelaySec: 0 });
  }
  return telephony.dials.map((d) => d.providerCallId);
}

const callRepo = () => AppDataSource.getRepository(Call);
const findCall = (providerCallId: string) => callRepo().findOneByOrFail({ providerCallId });

describe('POST /api/webhooks/call-events', () => {
  const ctx = useIntegration();

  describe('authentication & validation', () => {
    it('rejects a missing or wrong HMAC signature with 401', async () => {
      const [pid] = await dialCalls(1);
      const raw = JSON.stringify({
        eventId: 'e1',
        providerCallId: pid,
        type: 'ringing',
        timestamp: new Date().toISOString(),
      });
      const missing = await request(ctx.app())
        .post('/api/webhooks/call-events')
        .set('Content-Type', 'application/json')
        .send(raw);
      expect(missing.status).toBe(401);

      const wrong = await sendWebhook(
        ctx.app(),
        { providerCallId: pid, type: 'ringing' },
        'bad-secret',
      );
      expect(wrong.status).toBe(401);
      expect(await AppDataSource.getRepository(CallEvent).count()).toBe(0);
    });

    it('does not require the API key (HMAC replaces it) and validates the body', async () => {
      const res = await sendWebhook(ctx.app(), {
        providerCallId: 'x',
        type: 'exploded' as 'ringing',
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown providerCallId', async () => {
      const res = await sendWebhook(ctx.app(), { providerCallId: 'nope', type: 'ringing' });
      expect(res.status).toBe(404);
    });
  });

  describe('idempotency', () => {
    it('same eventId sent 10x concurrently → exactly 1 CallEvent, processed once', async () => {
      const [pid] = await dialCalls(1);
      await createAvailableAgents(2);

      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          sendWebhook(ctx.app(), {
            eventId: 'evt-answer-1',
            providerCallId: pid,
            type: 'answered',
          }),
        ),
      );

      expect(responses.every((r) => r.status === 200)).toBe(true);
      const statuses = responses.map((r) => r.body.data.status);
      expect(statuses.filter((s) => s === 'processed')).toHaveLength(1);
      expect(statuses.filter((s) => s === 'duplicate_ignored')).toHaveLength(9);

      expect(
        await AppDataSource.getRepository(CallEvent).countBy({ providerEventId: 'evt-answer-1' }),
      ).toBe(1);
      const call = await findCall(pid);
      expect(call.status).toBe(CallStatus.Answered);
      expect(call.version).toBe(2); // created (1) + exactly one state change
      // Processed once => exactly one of the two agents got claimed.
      expect(await agentPool.size()).toBe(1);
      expect(await AppDataSource.getRepository(Agent).countBy({ status: AgentStatus.Busy })).toBe(
        1,
      );
    });
  });

  describe('agent routing', () => {
    it('50 concurrent answered events with 5 agents → exactly 5 calls get distinct agents', async () => {
      const pids = await dialCalls(50);
      const agents = await createAvailableAgents(5);

      const responses = await Promise.all(
        pids.map((pid) => sendWebhook(ctx.app(), { providerCallId: pid, type: 'answered' })),
      );
      expect(responses.every((r) => r.status === 200)).toBe(true);

      const calls = await callRepo().find();
      const withAgent = calls.filter((c) => c.agentId !== null);
      expect(withAgent).toHaveLength(5);
      expect(new Set(withAgent.map((c) => c.agentId)).size).toBe(5);
      expect(withAgent.every((c) => c.status === CallStatus.Answered)).toBe(true);
      expect(calls.filter((c) => c.status === CallStatus.Abandoned)).toHaveLength(45);

      const busy = await AppDataSource.getRepository(Agent).findBy({ status: AgentStatus.Busy });
      expect(busy.map((a) => a.id).sort()).toEqual(agents.map((a) => a.id).sort());
      expect(await agentPool.size()).toBe(0);
    });

    it('completed releases the agent (DB + Redis), completes the lead, enqueues a summary', async () => {
      const [pid] = await dialCalls(1);
      const [agent] = await createAvailableAgents(1);
      const answeredAt = new Date(Date.now() - 42_000);

      await sendWebhook(ctx.app(), {
        providerCallId: pid,
        type: 'answered',
        timestamp: answeredAt.toISOString(),
      }).expect(200);
      expect(await agentPool.size()).toBe(0);

      const res = await sendWebhook(ctx.app(), { providerCallId: pid, type: 'completed' });
      expect(res.body.data).toMatchObject({ status: 'processed', callStatus: 'completed' });

      const call = await findCall(pid);
      expect(call.endedAt).not.toBeNull();
      expect(call.durationSec).toBeGreaterThanOrEqual(41);
      expect(call.durationSec).toBeLessThanOrEqual(44);

      const reloaded = await AppDataSource.getRepository(Agent).findOneByOrFail({ id: agent.id });
      expect(reloaded.status).toBe(AgentStatus.Available);
      expect(await agentPool.members()).toEqual([agent.id]);

      const lead = await AppDataSource.getRepository(Lead).findOneByOrFail({ id: call.leadId });
      expect(lead.status).toBe(LeadStatus.Completed);

      const job = await getSummaryQueue().getJob(call.id);
      expect(job?.data).toEqual({ callId: call.id });
    });

    it('compensates (SADD back) when the routing transaction fails after SPOP', async () => {
      const [pid] = await dialCalls(1);
      const [agent] = await createAvailableAgents(1);
      // Make the DB fail mid-transaction, right after the agent was popped and marked busy.
      await AppDataSource.query(`
        CREATE OR REPLACE FUNCTION test_fail_assign() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'simulated failure'; END $$ LANGUAGE plpgsql;
        CREATE TRIGGER test_fail_assign BEFORE UPDATE ON calls FOR EACH ROW
        WHEN (NEW."agentId" IS NOT NULL) EXECUTE FUNCTION test_fail_assign();
      `);
      try {
        const res = await sendWebhook(ctx.app(), {
          eventId: 'evt-comp',
          providerCallId: pid,
          type: 'answered',
        });
        expect(res.status).toBe(500);
      } finally {
        await AppDataSource.query(`DROP TRIGGER test_fail_assign ON calls;
          DROP FUNCTION test_fail_assign();`);
      }

      // Rolled back in DB, compensated in Redis: the agent is still routable.
      expect(await agentPool.members()).toEqual([agent.id]);
      const reloaded = await AppDataSource.getRepository(Agent).findOneByOrFail({ id: agent.id });
      expect(reloaded.status).toBe(AgentStatus.Available);
      expect((await findCall(pid)).status).toBe(CallStatus.Initiated);
      // The event row rolled back too, so the provider's retry is processed normally.
      const retry = await sendWebhook(ctx.app(), {
        eventId: 'evt-comp',
        providerCallId: pid,
        type: 'answered',
      });
      expect(retry.body.data).toMatchObject({ status: 'processed', agentId: agent.id });
    });

    it('skips a stale agent id in Redis (not available in DB) and never double-assigns', async () => {
      const [pid1, pid2] = await dialCalls(2);
      const [agent] = await createAvailableAgents(1);
      await sendWebhook(ctx.app(), { providerCallId: pid1, type: 'answered' }).expect(200);
      // Drift: the busy agent's id is (wrongly) back in the set.
      await agentPool.add(agent.id);

      const res = await sendWebhook(ctx.app(), { providerCallId: pid2, type: 'answered' });
      expect(res.body.data).toMatchObject({ status: 'processed', callStatus: 'abandoned' });
      expect((await findCall(pid1)).agentId).toBe(agent.id);
      expect((await findCall(pid2)).agentId).toBeNull();
      expect(await agentPool.size()).toBe(0); // stale id dropped, not re-added
    });
  });

  describe('state machine', () => {
    it('stores but ignores out-of-order events (ringing after answered)', async () => {
      const [pid] = await dialCalls(1);
      await createAvailableAgents(1);

      await sendWebhook(ctx.app(), { providerCallId: pid, type: 'answered' }).expect(200);
      const late = await sendWebhook(ctx.app(), {
        eventId: 'late-ringing',
        providerCallId: pid,
        type: 'ringing',
      });
      expect(late.status).toBe(200);
      expect(late.body.data).toMatchObject({ status: 'ignored', callStatus: 'answered' });

      const event = await AppDataSource.getRepository(CallEvent).findOneByOrFail({
        providerEventId: 'late-ringing',
      });
      expect(event.applied).toBe(false);
      expect(event.note).toContain('answered -> ringing');
      expect((await findCall(pid)).status).toBe(CallStatus.Answered);
    });

    it('ignores events after a terminal state', async () => {
      const [pid] = await dialCalls(1);
      await sendWebhook(ctx.app(), { providerCallId: pid, type: 'no_answer' }).expect(200);
      const res = await sendWebhook(ctx.app(), { providerCallId: pid, type: 'answered' });
      expect(res.body.data.status).toBe('ignored');
      expect(await agentPool.size()).toBe(0);
    });

    it('no_answer returns the lead to pending; exhausting attempts fails it', async () => {
      const [pid] = await dialCalls(1, 1);
      await sendWebhook(ctx.app(), { providerCallId: pid, type: 'ringing' }).expect(200);
      await sendWebhook(ctx.app(), { providerCallId: pid, type: 'no_answer' }).expect(200);

      const call = await findCall(pid);
      expect(call.status).toBe(CallStatus.NoAnswer);
      const lead = await AppDataSource.getRepository(Lead).findOneByOrFail({ id: call.leadId });
      expect(lead.status).toBe(LeadStatus.Failed); // maxAttempts = 1
    });

    it('answered with no free agent → abandoned, lead returned for retry', async () => {
      const [pid] = await dialCalls(1);
      const res = await sendWebhook(ctx.app(), { providerCallId: pid, type: 'answered' });
      expect(res.body.data.callStatus).toBe('abandoned');
      const call = await findCall(pid);
      const lead = await AppDataSource.getRepository(Lead).findOneByOrFail({ id: call.leadId });
      expect(lead.status).toBe(LeadStatus.Pending);
    });
  });
});
