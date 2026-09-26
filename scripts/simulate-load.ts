/**
 * End-to-end load simulation over the public HTTP API.
 *
 * Prerequisites (separate terminals):
 *   npm run dev              # API (+ Socket.IO)
 *   npm run worker:dialer    # needs MOCK_TELEPHONY_WEBHOOK_URL set, so the mock provider calls back
 *   npm run worker:summary
 * Then:
 *   npm run simulate -- --leads 500 --agents 8 --cps 5
 *
 * The mock telephony provider (inside the dialer worker) sends signed webhooks back with random
 * outcomes and durations, ~10% duplicate deliveries and some out-of-order `ringing` events, so the
 * whole pipeline (claiming, CPS, idempotency, routing, compensation, summaries) is exercised.
 */
import { parseArgs } from 'node:util';
import { env } from '../src/config/env';

const { values: args } = parseArgs({
  options: {
    leads: { type: 'string', default: '500' },
    agents: { type: 'string', default: '8' },
    cps: { type: 'string', default: '5' },
    attempts: { type: 'string', default: '2' },
    timeout: { type: 'string', default: '900' },
    url: { type: 'string', default: `http://localhost:${env.PORT || 3000}` },
  },
});

const BASE = args.url;
const LEADS = Number(args.leads);
const AGENTS = Number(args.agents);

interface Envelope<T> {
  success: boolean;
  data: T;
  meta?: { total: number };
  error?: { code: string; message: string };
}

async function http<T>(method: string, path: string, body?: unknown): Promise<Envelope<T>> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-API-Key': env.API_KEY },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as Envelope<T>;
  if (!res.ok && res.status !== 409) {
    throw new Error(`${method} ${path} → ${res.status} ${json.error?.message ?? ''}`);
  }
  return json;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface AgentDto {
  id: string;
  email: string;
  status: string;
}

async function ensureAgents(): Promise<AgentDto[]> {
  const agents: AgentDto[] = [];
  for (let i = 1; i <= AGENTS; i++) {
    const email = `sim-agent-${i}@example.com`;
    const created = await http<AgentDto>('POST', '/api/agents', { name: `Sim Agent ${i}`, email });
    if (created.success) {
      agents.push(created.data);
    } else {
      // Already exists from a previous run → find it.
      const list = await http<AgentDto[]>('GET', '/api/agents?limit=100');
      const found = list.data.find((a) => a.email === email);
      if (found) agents.push(found);
    }
  }
  for (const a of agents) {
    if (a.status !== 'busy')
      await http('PATCH', `/api/agents/${a.id}/status`, { status: 'available' });
  }
  return agents;
}

interface Stats {
  totalLeads: number;
  leadsByStatus: Record<string, number>;
  totalCalls: number;
  callsInProgress: number;
  callsAnswered: number;
  callsByStatus: Record<string, number>;
  answerRate: number;
  avgDurationSec: number | null;
  avgQaScore: number | null;
}

async function main(): Promise<void> {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`API not reachable at ${BASE}. Start it with: npm run dev`);
    process.exit(1);
  }

  console.log(`Simulating ${LEADS} leads, ${AGENTS} agents, ${args.cps} CPS against ${BASE}\n`);
  const agents = await ensureAgents();
  console.log(`✓ ${agents.length} agents available`);

  // A few DNC numbers inside the lead range, to show they are never dialed.
  const phone = (i: number) => `+1555${String(1000000 + i).padStart(7, '0')}`;
  const dnc = await http<{ added: number }>('POST', '/api/dnc', {
    numbers: [3, 33, 333].map((i) => ({ phone: phone(i), reason: 'simulator' })),
  });
  console.log(`✓ DNC list seeded (${dnc.data.added} new)`);

  const campaign = await http<{ id: string }>('POST', '/api/campaigns', {
    name: `Simulation ${new Date().toISOString()}`,
    maxCps: Number(args.cps),
    maxAttempts: Number(args.attempts),
  });
  const campaignId = campaign.data.id;

  const leads = Array.from({ length: LEADS }, (_, i) => ({
    phone: phone(i),
    name: `Sim Lead ${i}`,
  }));
  // Deliberate junk: an in-payload duplicate and invalid numbers.
  leads.push({ phone: phone(0), name: 'dup' }, { phone: '12345', name: 'invalid' });
  const upload = await http<Record<string, number>>(
    'POST',
    `/api/campaigns/${campaignId}/leads`,
    leads,
  );
  console.log(`✓ Leads uploaded: ${JSON.stringify(upload.data)}`);

  await http('POST', `/api/campaigns/${campaignId}/start`);
  console.log(`✓ Campaign ${campaignId} started\n`);

  const started = Date.now();
  const deadline = started + Number(args.timeout) * 1000;
  let stats: Stats | undefined;
  while (Date.now() < deadline) {
    await sleep(3_000);
    stats = (await http<Stats>('GET', `/api/campaigns/${campaignId}/stats`)).data;
    const busy =
      (await http<AgentDto[]>('GET', '/api/agents?status=busy&limit=1')).meta?.total ?? 0;
    const l = stats.leadsByStatus;
    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(
      `[${String(elapsed).padStart(4)}s] leads pending=${l.pending} dialing=${l.dialing} ` +
        `completed=${l.completed} failed=${l.failed} dnc=${l.dnc} | calls=${stats.totalCalls} ` +
        `live=${stats.callsInProgress} answered=${stats.callsAnswered} ` +
        `rate=${(stats.answerRate * 100).toFixed(1)}% busyAgents=${busy} ` +
        `avgQA=${stats.avgQaScore ?? '-'}`,
    );
    const campaignNow = await http<{ status: string }>('GET', `/api/campaigns/${campaignId}`);
    if (campaignNow.data.status === 'completed' && stats.callsInProgress === 0) break;
  }

  if (!stats) return;
  console.log('\nFinal stats:');
  console.log(JSON.stringify(stats, null, 2));
  const unfinished = (stats.leadsByStatus.pending ?? 0) + (stats.leadsByStatus.dialing ?? 0);
  console.log(
    unfinished === 0
      ? '\n✓ Simulation complete. Open the dashboard (npm run web:dev) to browse call logs.'
      : `\n⚠ Timed out with ${unfinished} leads still pending/dialing.`,
  );
}

main().catch((err: unknown) => {
  console.error('Simulation failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
