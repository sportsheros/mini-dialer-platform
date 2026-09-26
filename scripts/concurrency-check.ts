/**
 * Concurrency check — prints a PASS/FAIL report for the system's core guarantees.
 *
 *   npm run concurrency:check
 *
 * Runs against the TEST environment (.env.test): it wipes that database and Redis DB so every
 * scenario starts from a known state, and it can never steal real agents from a dev system.
 * Exit code is non-zero if any check fails, so it can gate CI.
 */
import 'reflect-metadata';

// Must run before any module that loads config/env.ts (hence the dynamic imports below).
process.env.NODE_ENV = 'test';

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
  ms: number;
}

async function main(): Promise<void> {
  const { AppDataSource } = await import('../src/db/data-source');
  const { redis } = await import('../src/lib/redis');
  const { closeQueues } = await import('../src/lib/queue');
  const entities = await import('../src/entities');
  const { agentPool } = await import('../src/modules/agents/agentPool');
  const { applyCallEvent } = await import('../src/modules/calls/callLifecycle.service');
  const { leadsService } = await import('../src/modules/leads/leads.service');
  const { runDialerTick } = await import('../src/workers/dialer');
  const {
    Agent,
    AgentStatus,
    Call,
    CallEvent,
    CallEventType,
    CallStatus,
    Campaign,
    CampaignStatus,
  } = entities;

  type DialRequest = import('../src/providers/telephony').DialRequest;
  class Recorder {
    dials: DialRequest[] = [];
    async dial(r: DialRequest) {
      this.dials.push(r);
    }
    async close() {}
  }

  const reset = async () => {
    await AppDataSource.query(
      'TRUNCATE TABLE call_events, calls, leads, campaigns, agents, dnc_numbers CASCADE',
    );
    await redis.flushdb();
  };

  const campaignWithLeads = async (leads: number, maxCps = 1000) => {
    const repo = AppDataSource.getRepository(Campaign);
    const campaign = await repo.save(
      repo.create({ name: 'concurrency-check', status: CampaignStatus.Running, maxCps }),
    );
    await leadsService.upload(
      campaign.id,
      Array.from({ length: leads }, (_, i) => ({ phone: `+1415${3000000 + i}` })),
    );
    return campaign;
  };

  const dialAll = async (n: number) => {
    await campaignWithLeads(n);
    const rec = new Recorder();
    while (rec.dials.length < n) await runDialerTick(rec, { batchSize: 100, retryDelaySec: 0 });
    return rec.dials.map((d) => d.providerCallId);
  };

  const availableAgents = async (n: number) => {
    const repo = AppDataSource.getRepository(Agent);
    const agents = await repo.save(
      Array.from({ length: n }, (_, i) =>
        repo.create({
          name: `cc-${i}`,
          email: `cc-${i}@example.com`,
          status: AgentStatus.Available,
        }),
      ),
    );
    for (const a of agents) await agentPool.add(a.id);
    return agents;
  };

  const checks: Array<[string, () => Promise<{ passed: boolean; detail: string }>]> = [
    [
      'Webhook idempotency: same eventId x10 concurrently',
      async () => {
        const [pid] = await dialAll(1);
        await availableAgents(2);
        const outcomes = await Promise.all(
          Array.from({ length: 10 }, () =>
            applyCallEvent({
              eventId: 'cc-dup',
              providerCallId: pid,
              type: CallEventType.Answered,
              occurredAt: new Date(),
            }),
          ),
        );
        const processed = outcomes.filter((o) => o.status === 'processed').length;
        const events = await AppDataSource.getRepository(CallEvent).countBy({
          providerEventId: 'cc-dup',
        });
        const busy = await AppDataSource.getRepository(Agent).countBy({ status: AgentStatus.Busy });
        return {
          passed: processed === 1 && events === 1 && busy === 1,
          detail: `processed=${processed} (want 1), call_events=${events} (want 1), busy agents=${busy} (want 1)`,
        };
      },
    ],
    [
      'Agent routing: 50 concurrent answers, 5 agents',
      async () => {
        const pids = await dialAll(50);
        await availableAgents(5);
        await Promise.all(
          pids.map((pid, i) =>
            applyCallEvent({
              eventId: `cc-ans-${i}`,
              providerCallId: pid,
              type: CallEventType.Answered,
              occurredAt: new Date(),
            }),
          ),
        );
        const calls = await AppDataSource.getRepository(Call).find();
        const assigned = calls.filter((c) => c.agentId);
        const distinct = new Set(assigned.map((c) => c.agentId)).size;
        const abandoned = calls.filter((c) => c.status === CallStatus.Abandoned).length;
        const left = await agentPool.size();
        return {
          passed: assigned.length === 5 && distinct === 5 && abandoned === 45 && left === 0,
          detail: `assigned=${assigned.length} distinct agents=${distinct} abandoned=${abandoned} pool left=${left}`,
        };
      },
    ],
    [
      'Dialer: 2 workers in parallel, 100 leads',
      async () => {
        const campaign = await campaignWithLeads(100);
        const a = new Recorder();
        const b = new Recorder();
        const worker = async (rec: Recorder) => {
          for (let i = 0; i < 100 && a.dials.length + b.dials.length < 100; i++) {
            await runDialerTick(rec, { batchSize: 10, retryDelaySec: 0 });
          }
        };
        await Promise.all([worker(a), worker(b)]);
        const phones = [...a.dials, ...b.dials].map((d) => d.phone);
        const unique = new Set(phones).size;
        const calls = await AppDataSource.getRepository(Call).countBy({ campaignId: campaign.id });
        return {
          passed: phones.length === 100 && unique === 100 && calls === 100,
          detail: `dials=${phones.length} unique=${unique} calls=${calls} (worker A=${a.dials.length}, B=${b.dials.length})`,
        };
      },
    ],
    [
      'CPS limit: 8 concurrent ticks, maxCps=3',
      async () => {
        const campaign = await campaignWithLeads(50, 3);
        const rec = new Recorder();
        await Promise.all(
          Array.from({ length: 8 }, () => runDialerTick(rec, { batchSize: 10, retryDelaySec: 0 })),
        );
        const calls = await AppDataSource.getRepository(Call).findBy({ campaignId: campaign.id });
        const perSecond = new Map<number, number>();
        for (const c of calls) {
          const s = Math.floor(c.createdAt.getTime() / 1000);
          perSecond.set(s, (perSecond.get(s) ?? 0) + 1);
        }
        const max = Math.max(0, ...perSecond.values());
        return {
          passed: calls.length > 0 && max <= 3,
          detail: `dialed=${calls.length}, max calls in any second=${max} (limit 3)`,
        };
      },
    ],
  ];

  await AppDataSource.initialize();
  await AppDataSource.runMigrations();

  const results: CheckResult[] = [];
  for (const [name, run] of checks) {
    await reset();
    const started = Date.now();
    try {
      const { passed, detail } = await run();
      results.push({ name, passed, detail, ms: Date.now() - started });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      results.push({ name, passed: false, detail: `threw: ${detail}`, ms: Date.now() - started });
    }
  }
  await reset();

  const width = Math.max(...results.map((r) => r.name.length));
  console.log('\nConcurrency check report');
  console.log('='.repeat(width + 22));
  for (const r of results) {
    console.log(
      `${r.passed ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${String(r.ms).padStart(6)} ms`,
    );
    console.log(`      ${r.detail}`);
  }
  const failed = results.filter((r) => !r.passed).length;
  console.log('='.repeat(width + 22));
  console.log(failed === 0 ? `ALL ${results.length} CHECKS PASSED` : `${failed} CHECK(S) FAILED`);

  await closeQueues();
  await AppDataSource.destroy();
  await redis.quit();
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error('Concurrency check crashed:', err);
  process.exit(1);
});
