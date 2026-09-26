import { type ReactNode, useState } from 'react';

/*
 * Setup & user guide, rendered inside the dashboard (menu: Documentation).
 * Screenshots live in /public/guide and were captured from a freshly started copy of the app.
 */

interface Section {
  id: string;
  title: string;
  part: 'Setup' | 'Using the app' | 'Reference';
  body: ReactNode;
}

function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="docs-code">
      <button className="btn btn-small docs-copy" onClick={copy}>
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

function Output({ title, children }: { title: string; children: string }) {
  return (
    <div className="docs-terminal">
      <div className="docs-terminal-bar">
        <span />
        <span />
        <span />
        {title}
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function Shot({ src, caption }: { src: string; caption: ReactNode }) {
  return (
    <figure className="docs-figure">
      <a href={`/guide/${src}`} target="_blank" rel="noreferrer" title="Open full size">
        <img
          src={`/guide/${src}`}
          alt={typeof caption === 'string' ? caption : ''}
          loading="lazy"
        />
      </a>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

/** Same red numbered badge as in the screenshots, so captions and images match. */
function Num({ n }: { n: number }) {
  return <span className="docs-num">{n}</span>;
}

function Note({ kind = 'info', children }: { kind?: 'info' | 'warn'; children: ReactNode }) {
  return <div className={`docs-note docs-note-${kind}`}>{children}</div>;
}

const SECTIONS: Section[] = [
  {
    id: 'overview',
    title: 'What this application does',
    part: 'Setup',
    body: (
      <>
        <p>
          <strong>Mini Dialer</strong> is an outbound contact-center platform. Supervisors create
          campaigns and upload customer phone numbers (leads). The dialer calls them automatically.
          Answered calls are instantly connected to a free agent. After each call, an AI step writes
          a transcript, a summary and a quality (QA) score.
        </p>
        <Note>
          Phone calls, speech-to-text and the AI are <strong>simulated</strong> in this version: no
          real calls are made. They sit behind clean interfaces so real providers (FreeSWITCH,
          Twilio, Deepgram, an LLM) can be plugged in later.
        </Note>
        <p>This guide has two parts:</p>
        <ol>
          <li>
            <strong>Setup:</strong> install Docker and start the application (about 15 minutes).
          </li>
          <li>
            <strong>Using the app:</strong> a step-by-step walkthrough with screenshots.
          </li>
        </ol>
      </>
    ),
  },
  {
    id: 'requirements',
    title: 'Step 1 — What you need',
    part: 'Setup',
    body: (
      <>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Software</th>
              <th>Required?</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Docker Desktop</strong> (Windows / macOS) or Docker Engine (Linux)
              </td>
              <td>Yes</td>
              <td>Runs the whole application: database, API, workers and this dashboard</td>
            </tr>
            <tr>
              <td>Git</td>
              <td>Only if you received a repository link</td>
              <td>To download the code (not needed for a ZIP file)</td>
            </tr>
            <tr>
              <td>Node.js 20+</td>
              <td>Optional</td>
              <td>Only for the load simulator and automated tests</td>
            </tr>
          </tbody>
        </table>
        <p>
          You do <strong>not</strong> need to install PostgreSQL or Redis. They run inside Docker,
          and the database is created automatically. Recommended: 8 GB RAM, 5 GB free disk.
        </p>
      </>
    ),
  },
  {
    id: 'install-docker',
    title: 'Step 2 — Install Docker Desktop',
    part: 'Setup',
    body: (
      <>
        <h4>Windows 10 / 11</h4>
        <ol>
          <li>
            Download Docker Desktop from{' '}
            <a
              href="https://www.docker.com/products/docker-desktop/"
              target="_blank"
              rel="noreferrer"
            >
              docker.com/products/docker-desktop
            </a>
            .
          </li>
          <li>
            Run the installer and keep <strong>“Use WSL 2”</strong> ticked.
          </li>
          <li>
            <strong>Restart the computer</strong> when asked. Docker does not work until you
            restart.
          </li>
          <li>
            Open <strong>Docker Desktop</strong> from the Start menu, accept the terms, and wait
            until it shows <strong>“Engine running”</strong>.
          </li>
        </ol>
        <Note kind="warn">
          If Docker says WSL needs an update, open PowerShell <strong>as Administrator</strong>, run{' '}
          <code>wsl --update</code>, then restart Docker Desktop.
        </Note>
        <h4>macOS</h4>
        <p>
          Install Docker Desktop from the same link (choose Apple Silicon or Intel), open it, and
          wait for “Engine running”.
        </p>
        <h4>Linux</h4>
        <p>
          Install Docker Engine and the Compose plugin:{' '}
          <a href="https://docs.docker.com/engine/install/" target="_blank" rel="noreferrer">
            docs.docker.com/engine/install
          </a>
          .
        </p>
        <h4>Check that Docker works</h4>
        <p>Open a terminal (PowerShell on Windows) and run:</p>
        <Code>{'docker --version\ndocker compose version'}</Code>
        <Output title="Expected output (version numbers may differ)">
          {'Docker version 29.8.0, build 88096ef\nDocker Compose version v5.5.1'}
        </Output>
      </>
    ),
  },
  {
    id: 'get-code',
    title: 'Step 3 — Get the code',
    part: 'Setup',
    body: (
      <>
        <ul>
          <li>
            <strong>ZIP file:</strong> extract it, for example to{' '}
            <code>C:\mini-dialer-platform</code>.
          </li>
          <li>
            <strong>Git link:</strong>
            <Code>git clone &lt;repository-url&gt; mini-dialer-platform</Code>
          </li>
        </ul>
        <p>Then open a terminal inside that folder:</p>
        <Code>cd mini-dialer-platform</Code>
      </>
    ),
  },
  {
    id: 'settings',
    title: 'Step 4 — Create the settings file',
    part: 'Setup',
    body: (
      <>
        <p>
          The app reads its settings from a file named <code>.env</code>. Copy the included
          template; the defaults work as they are.
        </p>
        <p>Windows (PowerShell):</p>
        <Code>Copy-Item .env.example .env</Code>
        <p>macOS / Linux:</p>
        <Code>cp .env.example .env</Code>
      </>
    ),
  },
  {
    id: 'start',
    title: 'Step 5 — Start the application',
    part: 'Setup',
    body: (
      <>
        <p>Run this single command:</p>
        <Code>docker compose --profile app up -d --build</Code>
        <p>
          The first run takes <strong>3–5 minutes</strong> (it downloads and builds everything).
          Later starts take seconds.
        </p>
        <Note>
          <strong>The database is set up automatically.</strong> On first start Docker:
          <ol>
            <li>
              starts PostgreSQL 16 and creates the databases <code>mini_dialer</code> and{' '}
              <code>mini_dialer_test</code>;
            </li>
            <li>starts Redis 7;</li>
            <li>
              runs a one-time setup that creates all tables and loads sample data (5 agents, a “Demo
              Campaign” with 50 leads, 2 Do-Not-Call numbers);
            </li>
            <li>starts the API, the dialer, the AI-summary worker and this dashboard.</li>
          </ol>
          Your data is kept in Docker volumes, so it survives restarts and reboots.
        </Note>
        <Output title="End of the output (real run)">
          {[
            ' Image mini-dialer-backend Built',
            ' Image mini-dialer-web Built',
            ' Container dialer-postgres Healthy',
            ' Container dialer-redis Healthy',
            ' Container dialer-migrate Exited      <- database tables + sample data created',
            ' Container dialer-api Healthy',
            ' Container dialer-summary Started',
            ' Container dialer-web Started',
            ' Container dialer-worker Started',
          ].join('\n')}
        </Output>
      </>
    ),
  },
  {
    id: 'verify',
    title: 'Step 6 — Check everything is running',
    part: 'Setup',
    body: (
      <>
        <Code>docker compose --profile app ps -a</Code>
        <Output title="Expected output">
          {[
            'NAME              STATUS                      PORTS',
            'dialer-api        Up 18 seconds (healthy)     0.0.0.0:3000->3000/tcp',
            'dialer-migrate    Exited (0) 18 seconds ago',
            'dialer-postgres   Up 26 seconds (healthy)     0.0.0.0:5432->5432/tcp',
            'dialer-redis      Up 27 seconds (healthy)     0.0.0.0:6379->6379/tcp',
            'dialer-summary    Up 17 seconds               3000/tcp',
            'dialer-web        Up 12 seconds               0.0.0.0:8080->80/tcp',
            'dialer-worker     Up 12 seconds               3000/tcp',
          ].join('\n')}
        </Output>
        <ul>
          <li>
            Every container should be <strong>Up</strong>, and the API, database and Redis should
            say <strong>(healthy)</strong>.
          </li>
          <li>
            <code>dialer-migrate</code> showing <strong>Exited (0)</strong> is correct: it runs once
            to set up the database, then stops.
          </li>
          <li>
            If you changed ports in <code>.env</code> (see Troubleshooting), you will see your ports
            instead of 5432 / 6379.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'open',
    title: 'Step 7 — Open the application',
    part: 'Setup',
    body: (
      <>
        <table className="docs-table">
          <tbody>
            <tr>
              <td>
                <strong>Supervisor dashboard</strong>
              </td>
              <td>
                <a href="http://localhost:8080" target="_blank" rel="noreferrer">
                  http://localhost:8080
                </a>
              </td>
            </tr>
            <tr>
              <td>API health check</td>
              <td>
                <a href="http://localhost:3000/health" target="_blank" rel="noreferrer">
                  http://localhost:3000/health
                </a>{' '}
                (shows <code>"status":"ok"</code>)
              </td>
            </tr>
          </tbody>
        </table>
        <p>You are now ready to use the app. Continue with the walkthrough below.</p>
      </>
    ),
  },
  {
    id: 'agents',
    title: '1. Make agents available',
    part: 'Using the app',
    body: (
      <>
        <p>
          The <strong>Live dashboard</strong> opens first. Agents start as <em>offline</em>. Calls
          are only routed to agents who are <em>available</em>.
        </p>
        <Shot
          src="01-dashboard-first-open.png"
          caption={
            <>
              <Num n={1} /> The menu switches pages. <Num n={2} /> “Live” (green) means real-time
              updates are connected. <Num n={3} /> Click <b>Go available</b> for each agent.
            </>
          }
        />
        <Shot
          src="02-agents-available.png"
          caption="All five agents are now available. A busy agent (on a call) cannot be set offline until the call ends."
        />
      </>
    ),
  },
  {
    id: 'campaigns',
    title: '2. Create a campaign and upload leads',
    part: 'Using the app',
    body: (
      <>
        <p>
          Open <strong>Campaigns</strong>. You can start the sample “Demo Campaign” right away, or
          create your own.
        </p>
        <Shot
          src="03-campaigns-page.png"
          caption={
            <>
              <Num n={1} /> Start a campaign. <Num n={2} /> Create a new campaign: give it a name, a
              speed limit (<b>Max CPS</b> = new calls per second) and <b>Max attempts</b> per lead.{' '}
              <Num n={3} /> Upload leads to any campaign.
            </>
          }
        />
        <p>
          To upload leads, choose the campaign and paste one lead per line as{' '}
          <code>phone,name</code> (a header line is optional). Phone numbers must be in
          international format, for example <code>+14155550100</code>. Up to 5,000 leads per upload.
        </p>
        <Code>
          {'phone,name\n+14155550100,Ann Lee\n+14155550101,Bob Stone\n+14155550102,Carla Diaz'}
        </Code>
        <Shot
          src="04-upload-leads.png"
          caption={
            <>
              <Num n={1} /> Choose the campaign. <Num n={2} /> Paste the leads. <Num n={3} /> The
              result shows how many were inserted, and how many were skipped as duplicates,
              Do-Not-Call numbers or invalid numbers. <Num n={4} /> The campaign's lead count
              updates.
            </>
          }
        />
        <Note>
          Duplicates and invalid numbers never break an upload; they are counted and skipped.
          Numbers on the Do-Not-Call list are stored but <strong>never dialed</strong>.
        </Note>
      </>
    ),
  },
  {
    id: 'start-campaign',
    title: '3. Start (or pause) a campaign',
    part: 'Using the app',
    body: (
      <>
        <p>
          Click <strong>Start</strong>. The dialer begins calling pending leads at the campaign's
          speed limit. A paused campaign can be resumed later. When every lead is finished, the
          campaign becomes <em>completed</em> automatically.
        </p>
        <Shot
          src="05-campaigns-running.png"
          caption={
            <>
              <Num n={1} /> The status changes to <b>Running</b>. <Num n={2} /> <b>Pause</b> stops
              new calls at any time (calls already in progress finish normally).
            </>
          }
        />
      </>
    ),
  },
  {
    id: 'live',
    title: '4. Watch calls live',
    part: 'Using the app',
    body: (
      <>
        <p>
          Go back to the <strong>Live dashboard</strong>. Everything updates in real time; no need
          to refresh the page.
        </p>
        <Shot
          src="06-live-dashboard.png"
          caption={
            <>
              <Num n={1} /> Campaign progress: leads done, calls, answer rate, average duration,
              average QA score, and calls abandoned because no agent was free. <Num n={2} /> Calls
              in progress (initiated → ringing → answered). <Num n={3} /> Agents switch to{' '}
              <b>Busy</b> while on a call, then back to available.
            </>
          }
        />
        <Note>
          <strong>Abandoned</strong> means the customer answered but every agent was busy. Those
          leads are automatically retried later, until the campaign's maximum attempts is reached.
        </Note>
      </>
    ),
  },
  {
    id: 'call-logs',
    title: '5. Review calls, AI summaries and QA scores',
    part: 'Using the app',
    body: (
      <>
        <p>
          <strong>Call logs</strong> lists every call, newest first, with filters and pages.
        </p>
        <Shot
          src="07-call-logs.png"
          caption={
            <>
              <Num n={1} /> Filter by status, agent, campaign or date range. <Num n={2} /> Click any
              call to open its details.
            </>
          }
        />
        <Shot
          src="08-call-detail.png"
          caption={
            <>
              <Num n={1} /> Call facts: customer, agent, times, duration. <Num n={2} /> The AI
              summary, the QA score (0–100) and the issues it found, such as a missing greeting or a
              missing “this call may be recorded” notice. <Num n={3} /> The event timeline from the
              phone system. A greyed row is a late or duplicate event that the system safely
              ignored.
            </>
          }
        />
        <Shot
          src="09-call-transcript.png"
          caption="Scroll down in the same panel to read the full transcript."
        />
        <Note>
          Summaries are produced in the background, usually within a few seconds after a call ends.
          If a call shows “Summary pending”, reopen it shortly. Only calls that reached a person get
          a summary.
        </Note>
      </>
    ),
  },
  {
    id: 'commands',
    title: 'Everyday commands',
    part: 'Reference',
    body: (
      <table className="docs-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Command</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['Start', 'docker compose --profile app up -d'],
            ['Stop (data is kept)', 'docker compose --profile app down'],
            ['Status', 'docker compose --profile app ps -a'],
            ['Live logs', 'docker compose logs -f api dialer summary'],
            ['Update after receiving new code', 'docker compose --profile app up -d --build'],
            ['Reset everything (deletes all data!)', 'docker compose --profile app down -v'],
          ].map(([task, cmd]) => (
            <tr key={task}>
              <td>{task}</td>
              <td>
                <code>{cmd}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    ),
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    part: 'Reference',
    body: (
      <>
        <h4>“port is already allocated” / “address already in use”</h4>
        <p>
          Another program already uses port 5432, 6379, 3000 or 8080 (for example, a PostgreSQL
          installed directly on the computer). Open <code>.env</code>, change the matching line, and
          start again:
        </p>
        <Code>{'POSTGRES_HOST_PORT=5433\nREDIS_HOST_PORT=6381\nWEB_HOST_PORT=8081'}</Code>
        <h4>“Cannot connect to the Docker daemon” / “docker: command not found”</h4>
        <p>
          Docker Desktop is not running. Open it and wait for “Engine running”. On Windows, make
          sure you restarted after installing it.
        </p>
        <h4>
          <code>dialer-migrate</code> shows <code>Exited (1)</code>
        </h4>
        <p>
          The database setup failed. See why with <code>docker compose logs migrate</code>. A reset
          usually fixes it (this deletes all data):
        </p>
        <Code>
          {'docker compose --profile app down -v\ndocker compose --profile app up -d --build'}
        </Code>
        <h4>The dashboard shows “Offline” or “Something went wrong”</h4>
        <p>
          Check that <code>dialer-api</code> is <em>healthy</em> in{' '}
          <code>docker compose --profile app ps -a</code>. If you changed <code>API_KEY</code> in{' '}
          <code>.env</code>, rebuild with <code>docker compose --profile app up -d --build</code>.
        </p>
      </>
    ),
  },
  {
    id: 'production',
    title: 'Before using it beyond a local demo',
    part: 'Reference',
    body: (
      <ul>
        <li>
          Replace <code>API_KEY</code> and <code>WEBHOOK_SECRET</code> in <code>.env</code> with
          long random values, then rebuild.
        </li>
        <li>
          The dashboard has no user login (it uses one shared key). Keep it on a private network or
          behind your company's single sign-on.
        </li>
        <li>
          Server deployment (AWS EC2 with PM2 + Nginx, or managed RDS + ElastiCache) is described in{' '}
          <code>README.md</code>. Design decisions are explained in <code>docs/DECISIONS.md</code>.
        </li>
      </ul>
    ),
  },
];

const PARTS = ['Setup', 'Using the app', 'Reference'] as const;

export function Documentation() {
  // Links scroll within the page instead of using #anchors, which the app's hash router owns.
  const goTo = (id: string) =>
    document.getElementById(`doc-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="docs">
      <nav className="docs-toc panel" aria-label="Guide contents">
        {PARTS.map((part) => (
          <div key={part}>
            <div className="docs-toc-part">{part}</div>
            {SECTIONS.filter((s) => s.part === part).map((s) => (
              <button key={s.id} onClick={() => goTo(s.id)}>
                {s.title}
              </button>
            ))}
          </div>
        ))}
        <button className="docs-print" onClick={() => window.print()}>
          🖨 Print / Save as PDF
        </button>
      </nav>

      <article className="docs-body panel">
        <header className="docs-hero">
          <h1>Mini Dialer — Setup &amp; User Guide</h1>
          <p className="muted">
            From a fresh computer to your first campaign, step by step. All screenshots are from
            this application.
          </p>
        </header>
        {PARTS.map((part) => (
          <div key={part}>
            <h2 className="docs-part">{part}</h2>
            {SECTIONS.filter((s) => s.part === part).map((s) => (
              <section key={s.id} id={`doc-${s.id}`} className="docs-section">
                <h3>{s.title}</h3>
                {s.body}
              </section>
            ))}
          </div>
        ))}
      </article>
    </div>
  );
}
