import { AppDataSource } from '../../src/db/data-source';
import { Call, CallStatus, Campaign, CampaignStatus, Lead, LeadStatus } from '../../src/entities';
import { acquireDialSlots } from '../../src/workers/cpsLimiter';
import { runDialerTick } from '../../src/workers/dialer';
import { reapStuckWork } from '../../src/workers/reaper';
import { createCampaign, RecordingTelephony } from '../helpers/fixtures';
import { useIntegration } from '../helpers/integration';

const config = { batchSize: 10, retryDelaySec: 0 };

async function countLeads(campaignId: string, status: LeadStatus) {
  return AppDataSource.getRepository(Lead).countBy({ campaignId, status });
}

describe('Dialer worker', () => {
  useIntegration();

  it('two workers in parallel on 100 leads: each lead is dialed exactly once', async () => {
    const campaign = await createCampaign({ maxCps: 1000 }, 100);
    const workerA = new RecordingTelephony();
    const workerB = new RecordingTelephony();

    const worker = async (telephony: RecordingTelephony) => {
      for (let i = 0; i < 100; i++) {
        await runDialerTick(telephony, config);
        if ((await countLeads(campaign.id, LeadStatus.Pending)) === 0) return;
      }
    };
    await Promise.all([worker(workerA), worker(workerB)]);

    // Both workers did real work, and their batches never overlapped.
    expect(workerA.dials.length).toBeGreaterThan(0);
    expect(workerB.dials.length).toBeGreaterThan(0);
    const allPhones = [...workerA.dials, ...workerB.dials].map((d) => d.phone);
    expect(allPhones).toHaveLength(100);
    expect(new Set(allPhones).size).toBe(100);

    const calls = await AppDataSource.getRepository(Call).findBy({ campaignId: campaign.id });
    expect(calls).toHaveLength(100);
    expect(new Set(calls.map((c) => c.leadId)).size).toBe(100);

    const leads = await AppDataSource.getRepository(Lead).findBy({ campaignId: campaign.id });
    expect(leads.every((l) => l.status === LeadStatus.Dialing && l.attempts === 1)).toBe(true);
  });

  it('never exceeds maxCps per second, even with many concurrent workers', async () => {
    const campaign = await createCampaign({ maxCps: 3 }, 50);
    const telephony = new RecordingTelephony();

    await Promise.all(Array.from({ length: 8 }, () => runDialerTick(telephony, config)));

    // All 8 ticks ran within the same second or two; at most 3 per distinct second.
    const perSecond = new Map<number, number>();
    const calls = await AppDataSource.getRepository(Call).findBy({ campaignId: campaign.id });
    for (const c of calls) {
      const s = Math.floor(c.createdAt.getTime() / 1000);
      perSecond.set(s, (perSecond.get(s) ?? 0) + 1);
    }
    expect(calls.length).toBeGreaterThan(0);
    for (const n of perSecond.values()) expect(n).toBeLessThanOrEqual(3);
  });

  it('CPS limiter grants slots atomically across callers within one second', async () => {
    const now = Date.UTC(2030, 0, 1, 0, 0, 0);
    const grants = await Promise.all(
      Array.from({ length: 10 }, () => acquireDialSlots('cps-test', 5, 2, now)),
    );
    expect(grants.reduce((a, b) => a + b, 0)).toBe(5);
    // Next second has a fresh budget.
    expect(await acquireDialSlots('cps-test', 5, 2, now + 1000)).toBe(2);
  });

  it('re-checks DNC right before dialing', async () => {
    const campaign = await createCampaign({}, 2);
    const [first] = await AppDataSource.getRepository(Lead).find({
      where: { campaignId: campaign.id },
      order: { phone: 'ASC' },
    });
    // Insert straight into the table (bypassing the API that would also mark the lead).
    await AppDataSource.query(`INSERT INTO dnc_numbers (phone) VALUES ($1)`, [first.phone]);

    const telephony = new RecordingTelephony();
    await runDialerTick(telephony, config);

    expect(telephony.dials.map((d) => d.phone)).not.toContain(first.phone);
    const lead = await AppDataSource.getRepository(Lead).findOneByOrFail({ id: first.id });
    expect(lead.status).toBe(LeadStatus.Dnc);
    expect(lead.attempts).toBe(0);
  });

  it('does not dial paused campaigns and completes exhausted ones', async () => {
    const paused = await createCampaign({ status: CampaignStatus.Paused }, 5);
    const empty = await createCampaign({}, 0);
    const telephony = new RecordingTelephony();

    await runDialerTick(telephony, config);

    expect(telephony.dials).toHaveLength(0);
    expect(await countLeads(paused.id, LeadStatus.Pending)).toBe(5);
    const reloaded = await AppDataSource.getRepository(Campaign).findOneByOrFail({ id: empty.id });
    expect(reloaded.status).toBe(CampaignStatus.Completed);
  });

  it('a failed dial marks the call failed and returns the lead for retry', async () => {
    const campaign = await createCampaign({}, 1);
    const telephony = new RecordingTelephony(() => true);

    await runDialerTick(telephony, config);

    const [call] = await AppDataSource.getRepository(Call).findBy({ campaignId: campaign.id });
    expect(call.status).toBe(CallStatus.Failed);
    const [lead] = await AppDataSource.getRepository(Lead).findBy({ campaignId: campaign.id });
    expect(lead).toMatchObject({ status: LeadStatus.Pending, attempts: 1 });
  });

  it('marks leads failed once maxAttempts is used up', async () => {
    const campaign = await createCampaign({ maxAttempts: 2 }, 1);
    const telephony = new RecordingTelephony(() => true);

    for (let i = 0; i < 4; i++) await runDialerTick(telephony, config);

    expect(telephony.dials).toHaveLength(2);
    const [lead] = await AppDataSource.getRepository(Lead).findBy({ campaignId: campaign.id });
    expect(lead).toMatchObject({ status: LeadStatus.Failed, attempts: 2 });
  });

  it('reaper recovers calls/leads stuck after a worker crash', async () => {
    const campaign = await createCampaign({}, 2);
    await runDialerTick(new RecordingTelephony(), config);
    // Simulate: dialed 10 minutes ago and the provider never called back.
    await AppDataSource.query(
      `UPDATE calls SET "createdAt" = now() - interval '10 minutes' WHERE "campaignId" = $1`,
      [campaign.id],
    );

    const result = await reapStuckWork({ stuckDialingMinutes: 5, maxCallMinutes: 60 });
    expect(result.timedOutCalls).toBe(2);

    const calls = await AppDataSource.getRepository(Call).findBy({ campaignId: campaign.id });
    expect(calls.every((c) => c.status === CallStatus.Failed)).toBe(true);
    expect(await countLeads(campaign.id, LeadStatus.Pending)).toBe(2);

    // Idempotent: a second run (e.g. another worker's reaper) changes nothing.
    const again = await reapStuckWork({ stuckDialingMinutes: 5, maxCallMinutes: 60 });
    expect(again).toEqual({ timedOutCalls: 0, overlongCalls: 0, recoveredLeads: 0 });
  });

  it('reaper safety net resets dialing leads that have no active call', async () => {
    const campaign = await createCampaign({}, 1);
    await AppDataSource.query(
      `UPDATE leads SET status = 'dialing', attempts = 1,
         "lastAttemptAt" = now() - interval '10 minutes' WHERE "campaignId" = $1`,
      [campaign.id],
    );
    const result = await reapStuckWork({ stuckDialingMinutes: 5, maxCallMinutes: 60 });
    expect(result.recoveredLeads).toBe(1);
    expect(await countLeads(campaign.id, LeadStatus.Pending)).toBe(1);
  });
});
