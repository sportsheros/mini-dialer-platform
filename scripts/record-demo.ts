/**
 * Records a captioned walkthrough of the dashboard to demo/demo.webm.
 *
 * Prerequisites:
 *   docker compose --profile app up -d        # API :3000, dashboard :8080, workers
 *   npx playwright install chromium            # only if you don't use --channel msedge
 * Then:
 *   npm run demo:record                        # starts the simulator itself, then records
 *   npm run demo:record -- --no-simulate       # use a simulation you already started
 *   npm run demo:record -- --headed --channel chrome
 *
 * The flow: live dashboard → lead upload with edge cases → live calls & agents →
 * call logs → call detail (AI summary, QA, ignored out-of-order event) → abandoned calls.
 * It only uses the public UI/API; it never touches application code or the database directly.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { type Browser, chromium, type Locator, type Page } from 'playwright';
import { env } from '../src/config/env';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:8080' },
    api: { type: 'string', default: `http://localhost:${env.PORT || 3000}` },
    out: { type: 'string', default: 'demo/demo.webm' },
    channel: { type: 'string', default: process.platform === 'win32' ? 'msedge' : '' },
    headed: { type: 'boolean', default: false },
    simulate: { type: 'boolean', default: true },
    'no-simulate': { type: 'boolean', default: false },
    leads: { type: 'string', default: '300' },
    cps: { type: 'string', default: '4' },
  },
});

const APP = args.url.replace(/\/$/, '');
const API = args.api.replace(/\/$/, '');
const OUT = path.resolve(args.out);
const SIZE = { width: 1440, height: 900 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- API helpers (read-only except through the public endpoints) ----------

interface Envelope<T> {
  success: boolean;
  data: T;
  meta?: { total: number };
}
interface CampaignDto {
  id: string;
  name: string;
  status: string;
  createdAt: string;
}
interface CallDetailDto {
  id: string;
  summary: string | null;
  qaFlags: string[] | null;
  lead: { phone: string };
  agent: { name: string } | null;
  campaign: { name: string };
  events: { applied: boolean }[];
}

async function api<T>(p: string): Promise<Envelope<T>> {
  const res = await fetch(API + p, { headers: { 'X-API-Key': env.API_KEY } });
  if (!res.ok) throw new Error(`GET ${p} → ${res.status}`);
  return (await res.json()) as Envelope<T>;
}

async function waitFor<T>(label: string, fn: () => Promise<T | undefined>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== undefined) return value;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

// ---------- On-screen overlay (captions + highlight boxes) ----------
// Injected as a plain script string so this Node file needs no DOM typings.
const OVERLAY_SCRIPT = `
(() => {
  if (window.__demo) return;
  const css = document.createElement('style');
  css.textContent = \`
    #demo-caption { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
      max-width: 1100px; width: calc(100% - 80px); z-index: 2147483647; pointer-events: none;
      background: rgba(15, 23, 42, .92); color: #fff; border-radius: 14px; padding: 14px 22px;
      font: 500 19px/1.45 'Segoe UI', system-ui, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.35);
      transition: opacity .25s; }
    #demo-caption .step { display: inline-block; background: #e11d48; border-radius: 999px;
      padding: 2px 10px; margin-right: 10px; font-size: 14px; font-weight: 700; vertical-align: 2px; }
    #demo-caption .sub { display: block; font-size: 15.5px; color: #cbd5e1; margin-top: 4px; }
    .demo-box { position: fixed; z-index: 2147483646; pointer-events: none; border: 3px solid #e11d48;
      border-radius: 10px; box-shadow: 0 0 0 6px rgba(225,29,72,.18); transition: all .3s; }
  \`;
  document.head.appendChild(css);
  window.__demo = {
    caption(step, title, sub) {
      let el = document.getElementById('demo-caption');
      if (!el) { el = document.createElement('div'); el.id = 'demo-caption'; document.body.appendChild(el); }
      el.innerHTML = '<span class="step"></span><span class="title"></span><span class="sub"></span>';
      el.querySelector('.step').textContent = step;
      el.querySelector('.title').textContent = title;
      el.querySelector('.sub').textContent = sub || '';
      el.querySelector('.sub').style.display = sub ? 'block' : 'none';
    },
    mark(x, y, w, h) {
      const b = document.createElement('div');
      b.className = 'demo-box';
      const pad = 6;
      Object.assign(b.style, { left: (x - pad) + 'px', top: (y - pad) + 'px',
        width: (w + 2 * pad) + 'px', height: (h + 2 * pad) + 'px' });
      document.body.appendChild(b);
    },
    clear() { document.querySelectorAll('.demo-box').forEach((b) => b.remove()); },
  };
})();
`;

const TITLE_CARD = `<!doctype html><html><body style="margin:0;height:100vh;display:flex;
  align-items:center;justify-content:center;background:#121826;color:#fff;
  font-family:'Segoe UI',system-ui,sans-serif;text-align:center">
  <div><div style="font-size:54px;font-weight:800">☎ Mini Dialer</div>
  <div style="font-size:24px;color:#cbd5e1;margin-top:12px">AI-assisted outbound contact center — live demo</div>
  <div style="font-size:18px;color:#94a3b8;margin-top:28px">Postgres · Redis · BullMQ · Socket.IO · React</div></div>
</body></html>`;

let stepNo = 0;
const TOTAL_STEPS = 11;

async function caption(page: Page, title: string, sub = ''): Promise<void> {
  stepNo++;
  await page.evaluate(OVERLAY_SCRIPT);
  await page.evaluate(
    `window.__demo.clear(); window.__demo.caption(${JSON.stringify(`${stepNo}/${TOTAL_STEPS}`)}, ${JSON.stringify(title)}, ${JSON.stringify(sub)})`,
  );
}

/** Red box around each locator (scrolls the first one into view). */
async function highlight(page: Page, ...locators: Locator[]): Promise<void> {
  await page.evaluate(OVERLAY_SCRIPT);
  await page.evaluate('window.__demo.clear()');
  if (locators[0])
    await locators[0]
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => undefined);
  await sleep(300);
  for (const loc of locators) {
    const b = await loc.first().boundingBox();
    if (b) await page.evaluate(`window.__demo.mark(${b.x}, ${b.y}, ${b.width}, ${b.height})`);
  }
}

async function nav(page: Page, label: string): Promise<void> {
  await page.evaluate('window.__demo && window.__demo.clear()');
  await page.locator('.topbar nav a', { hasText: label }).click();
  await sleep(1200);
}

// ---------- Simulator ----------

function startSimulator(): ChildProcess {
  const log = path.resolve('demo/simulator.log');
  console.log(`Starting simulator (${args.leads} leads, ${args.cps} CPS); output → ${log}`);
  const child = spawn(
    'npm',
    ['run', 'simulate', '--', '--leads', args.leads, '--agents', '8', '--cps', args.cps],
    { shell: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const stream = createWriteStream(log);
  child.stdout?.pipe(stream);
  child.stderr?.pipe(stream);
  return child;
}

function stopProcessTree(child: ChildProcess): void {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else child.kill('SIGTERM');
}

// ---------- The walkthrough ----------

async function walkthrough(page: Page, startedAt: number): Promise<void> {
  // 0. Title card (hides the first seconds of loading spinners)
  await page.setContent(TITLE_CARD);
  await sleep(4000);

  // 1. Live dashboard with the simulation running
  await page.goto(`${APP}/#/`);
  await page.locator('.live-indicator.on').waitFor({ timeout: 20_000 });
  await page.locator('.stat-grid').first().waitFor({ timeout: 30_000 });
  await caption(
    page,
    'Mini Dialer — AI-assisted outbound contact center',
    'A simulated campaign is running: the dialer places calls, answered calls are routed to free agents in real time.',
  );
  await highlight(page, page.locator('.live-indicator'));
  await sleep(5000);

  // 2. Campaigns: the simulation campaign
  await nav(page, 'Campaigns');
  const simRow = page.locator('tr', { hasText: 'Simulation' }).first();
  await simRow.waitFor();
  await caption(
    page,
    'Campaigns: speed limit (CPS) and retry attempts per campaign',
    'The simulator created this campaign through the public API and started it.',
  );
  await highlight(page, simRow);
  await sleep(4500);

  // 3. Lead upload edge cases
  const create = page.locator('form.form', { hasText: 'New campaign' });
  const demoName = `Upload edge cases ${new Date(startedAt).toLocaleTimeString()}`;
  await create.locator('input').nth(0).fill(demoName);
  await create.locator('button').click();
  await page.locator('tr', { hasText: demoName }).waitFor();
  const upload = page.locator('form.form', { hasText: 'Upload leads' });
  await upload.locator('select').selectOption({ label: demoName });
  const csv = [
    'phone,name',
    '+14155550190,Ana Lopez',
    '+1 (415) 555-0191,Ben Ortiz    <- formatted, gets normalised',
    '+14155550190,Ana again      <- duplicate in the file',
    '4155550192,No country code   <- invalid',
    'not-a-number,Garbage         <- invalid',
    '+15551000003,Opted out       <- on the Do-Not-Call list',
  ]
    .map((line) => line.replace(/\s+<-.*$/, ''))
    .join('\n');
  await caption(
    page,
    'Lead upload edge cases',
    'Six rows: two valid (one needs normalising), a duplicate, two invalid numbers, and one number on the Do-Not-Call list.',
  );
  await highlight(page, upload.locator('textarea'));
  await upload.locator('textarea').pressSequentially(csv, { delay: 12 });
  await sleep(800);
  await upload.locator('button').click();
  await page.locator('.upload-result').waitFor();
  await caption(
    page,
    'One transaction, correct counts: 2 inserted · 1 duplicate · 1 DNC · 2 invalid',
    'Bad rows are counted, not fatal. Existing numbers are skipped by a unique constraint (ON CONFLICT DO NOTHING); DNC numbers are stored but never dialed.',
  );
  await highlight(page, page.locator('.upload-result'));
  await sleep(7000);

  // 4. Live calls + agents
  await nav(page, 'Live dashboard');
  await page
    .locator('.panel', { hasText: 'Live calls' })
    .locator('tbody tr')
    .first()
    .waitFor({ timeout: 30_000 });
  await caption(
    page,
    'Live: calls ringing and answered, agents turning busy',
    'Updates arrive over Socket.IO. Workers publish to Redis pub/sub and every API instance re-emits to its clients.',
  );
  await highlight(
    page,
    page.locator('.panel', { hasText: 'Live calls' }),
    page.locator('.dashboard-side .panel'),
  );
  await sleep(8000);
  await caption(
    page,
    'Campaign stats: answer rate, average duration, average QA score, abandoned calls',
    'Served cache-aside from Redis (30s TTL), invalidated whenever a call ends.',
  );
  await highlight(page, page.locator('.stat-grid').first());
  await sleep(6000);

  // 5. Call logs
  const target = await waitFor(
    'a summarised call that also has an ignored (out-of-order) event',
    async () => {
      const list = await api<{ id: string; qaScore: number | null }[]>(
        '/api/calls?status=completed&limit=50',
      );
      let fallback: CallDetailDto | undefined;
      for (const c of list.data) {
        if (c.qaScore === null) continue;
        const d = (await api<CallDetailDto>(`/api/calls/${c.id}`)).data;
        if (!d.summary || !d.agent) continue;
        if (d.events.some((e) => !e.applied)) return d;
        fallback = fallback ?? d;
      }
      return fallback;
    },
    120_000,
  );
  await nav(page, 'Call logs');
  await page.locator('tbody tr').first().waitFor();
  await caption(
    page,
    'Call logs: filter by status, agent, campaign and date',
    'One indexed query per filter combination; pagination is 20 per page, newest first.',
  );
  await highlight(page, page.locator('.filters'));
  const selects = page.locator('.filters select');
  await selects.nth(0).selectOption('completed');
  await sleep(700);
  if (target.agent) await selects.nth(1).selectOption({ label: target.agent.name });
  await sleep(700);
  await selects.nth(2).selectOption({ label: target.campaign.name });
  await sleep(2500);

  // 6. Call detail
  await page.locator('tbody tr', { hasText: target.lead.phone }).first().click();
  await page.locator('.drawer .qa').waitFor({ timeout: 15_000 });
  await caption(
    page,
    'After the call: transcript, AI summary and QA score (background BullMQ job)',
    'Mock STT and LLM fail 10% of the time on purpose; jobs retry with backoff and are idempotent (jobId = callId).',
  );
  await highlight(page, page.locator('.drawer .qa'));
  await sleep(6500);
  await caption(
    page,
    'Webhooks are idempotent and ordered by a state machine',
    'The greyed "ringing" row arrived after "answered". It is stored for audit but ignored, and duplicates never double-process.',
  );
  await highlight(page, page.locator('.drawer .timeline'));
  await sleep(7000);
  await page.keyboard.press('Escape');

  // 7. Abandoned calls
  await selects.nth(0).selectOption('abandoned');
  await selects.nth(1).selectOption('');
  await selects.nth(2).selectOption('');
  await sleep(1500);
  await caption(
    page,
    '"Abandoned" = the customer answered but no agent was free',
    'Agent claim is atomic: Redis SPOP plus a conditional DB update, so no agent ever gets two calls. The lead is retried later.',
  );
  await highlight(page, page.locator('tbody tr').first());
  await sleep(6500);

  // 8. Wrap-up
  await caption(
    page,
    'Built for correctness under concurrency',
    'SKIP LOCKED lead claiming · Redis CPS limit · idempotent webhooks · compensation · 97 tests + concurrency check: 4/4 PASS',
  );
  await nav(page, 'Live dashboard');
  await sleep(6000);
}

async function main(): Promise<void> {
  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`API not reachable at ${API}. Start it: docker compose --profile app up -d`);
  }
  const dashboard = await fetch(APP).catch(() => null);
  if (!dashboard?.ok) throw new Error(`Dashboard not reachable at ${APP}`);

  mkdirSync(path.dirname(OUT), { recursive: true });
  const videoDir = path.resolve(path.dirname(OUT), '.raw');
  const startedAt = Date.now();

  const useSimulator = args.simulate && !args['no-simulate'];
  const simulator = useSimulator ? startSimulator() : undefined;
  let browser: Browser | undefined;
  try {
    // Wait until a simulation campaign is running and calls are flowing.
    await waitFor(
      'a running "Simulation" campaign with live calls',
      async () => {
        const campaigns = (await api<CampaignDto[]>('/api/campaigns?limit=20')).data;
        const running = campaigns.find(
          (c) =>
            c.name.startsWith('Simulation') &&
            c.status === 'running' &&
            (!useSimulator || Date.parse(c.createdAt) >= startedAt - 5_000),
        );
        if (!running) return undefined;
        const live = await api<unknown[]>('/api/calls?status=answered&limit=1');
        return (live.meta?.total ?? 0) > 0 ? running : undefined;
      },
      120_000,
    );
    await sleep(8000); // let a few calls complete so stats and summaries exist

    browser = await chromium.launch({
      headless: !args.headed,
      ...(args.channel ? { channel: args.channel } : {}),
    });
    const context = await browser.newContext({
      viewport: SIZE,
      recordVideo: { dir: videoDir, size: SIZE },
    });
    const page = await context.newPage();
    console.log('Recording…');
    await walkthrough(page, startedAt);

    const video = page.video();
    await context.close(); // finalises the video file
    if (!video) throw new Error('No video was recorded');
    await video.saveAs(OUT);
    await video.delete();
    console.log(`Saved ${OUT}`);
  } finally {
    await browser?.close();
    rmSync(videoDir, { recursive: true, force: true });
    if (simulator) stopProcessTree(simulator);
  }
}

main().catch((err: unknown) => {
  console.error('Demo recording failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
