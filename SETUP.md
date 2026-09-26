# Setup Guide — Running Mini Dialer on Your Computer

This guide takes you from a fresh computer to the running application. You do **not** need to install
PostgreSQL, Redis or Node.js: everything runs inside Docker, and **the database, its tables and
sample data are created automatically** the first time you start it.

Time needed: about 15 minutes, most of it installing Docker.

---

## What you need to install

| Software | Required? | Why |
|---|---|---|
| **Docker Desktop** (Windows / macOS) or **Docker Engine + Compose plugin** (Linux) | **Yes** | Runs the whole application |
| **Git** | Only if you received a repository link | To download the code. Not needed if you received a ZIP file |
| **Node.js 20+** | Optional | Only for the load simulator and automated tests (see step 7) |

Your computer should have at least 8 GB RAM and 5 GB of free disk space.

---

## Step 1 — Install Docker

**Windows 10/11**
1. Download Docker Desktop: https://www.docker.com/products/docker-desktop/
2. Run the installer and keep the default option **"Use WSL 2"** ticked.
3. **Restart your computer** when asked. This is required: Docker will not work until you restart.
4. After the restart, open **Docker Desktop** from the Start menu, accept the terms, and wait until
   the bottom-left corner shows **"Engine running"**.

   If Docker says WSL needs updating, open PowerShell **as Administrator**, run `wsl --update`, then
   restart Docker Desktop.

**macOS:** Install Docker Desktop from the same link (pick Apple Silicon or Intel), open it, and wait
for "Engine running".

**Linux:** Install Docker Engine and the Compose plugin: https://docs.docker.com/engine/install/

**Check it works.** Open a terminal (PowerShell on Windows, Terminal on macOS) and run:

```bash
docker --version
docker compose version
```

Both should print a version number.

---

## Step 2 — Get the code

- **If you received a ZIP file:** extract it, e.g. to `C:\mini-dialer-platform`.
- **If you received a Git link:**
  ```bash
  git clone <repository-url> mini-dialer-platform
  ```

Then open a terminal **inside that folder**:

```bash
cd mini-dialer-platform
```

---

## Step 3 — Create the settings file

The app reads its settings from a file called `.env`. A ready-made template is included; just copy it.

Windows (PowerShell):
```powershell
Copy-Item .env.example .env
```

macOS / Linux:
```bash
cp .env.example .env
```

The defaults work as-is for local use.

---

## Step 4 — Start the application

```bash
docker compose --profile app up -d --build
```

The first run takes **3–5 minutes** because it downloads and builds everything. Later starts take a few
seconds.

**What happens automatically:**
1. A PostgreSQL 16 database server starts, and the databases `mini_dialer` and `mini_dialer_test` are
   created.
2. A Redis 7 server starts.
3. A one-time setup step creates all tables (migrations) and loads sample data: 5 agents, a demo
   campaign with 50 leads, and 2 Do-Not-Call numbers.
4. The API, the dialer worker, the AI-summary worker and the web dashboard start.

---

## Step 5 — Check everything is running

```bash
docker compose --profile app ps -a
```

You should see:

| Name | Expected status |
|---|---|
| dialer-postgres | Up (healthy) |
| dialer-redis | Up (healthy) |
| dialer-migrate | **Exited (0)**. This is correct: it runs once to set up the database |
| dialer-api | Up (healthy) |
| dialer-worker | Up |
| dialer-summary | Up |
| dialer-web | Up |

---

## Step 6 — Open the application

| What | Address |
|---|---|
| **Supervisor dashboard** | http://localhost:8080 |
| API health check | http://localhost:3000/health (should show `"status":"ok"`) |

In the dashboard:
1. Open **Live dashboard** and set a few agents to **"Go available"**.
2. Open **Campaigns** and click **Start** on "Demo Campaign".
3. Watch calls appear live, then open **Call logs** and click a call to see its timeline, AI summary
   and QA score.

> Calls are **simulated**: no real phone calls are made. Telephony, speech-to-text and the AI summary
> are realistic mocks that can be swapped for real providers later.

---

## Step 7 (optional) — Run a larger simulation or the tests

This needs **Node.js 20+** from https://nodejs.org (choose the LTS version).

```bash
npm install
npm run simulate        # creates a 500-lead campaign and shows live progress in the terminal
```

Automated tests (they use the `mini_dialer_test` database inside Docker):

```bash
cp .env.test.example .env.test    # Windows: Copy-Item .env.test.example .env.test
npm test
```

---

## Everyday commands

| Task | Command |
|---|---|
| Start | `docker compose --profile app up -d` |
| Stop (data is kept) | `docker compose --profile app down` |
| Status | `docker compose --profile app ps -a` |
| Live logs | `docker compose logs -f api dialer summary` |
| Reset everything (**deletes all data**) | `docker compose --profile app down -v`, then start again |

Data is stored in Docker volumes, so it survives stopping, restarting and rebooting.

---

## Troubleshooting

**"port is already allocated" / "address already in use"**
Another program on your computer already uses port 5432, 6379, 3000 or 8080 (for example, a locally
installed PostgreSQL). Open `.env` and change the matching line, for example:

```
POSTGRES_HOST_PORT=5433
REDIS_HOST_PORT=6381
WEB_HOST_PORT=8081
```

If you changed `POSTGRES_HOST_PORT` or `REDIS_HOST_PORT` and plan to run the optional step 7, also
update the port in the `DATABASE_URL` and `REDIS_URL` lines. Then run `docker compose --profile app up -d` again.

**"Cannot connect to the Docker daemon" / "docker: command not found"**
Docker Desktop is not running. Open it and wait for "Engine running". On Windows, make sure you
restarted the computer after installing it.

**`dialer-migrate` shows `Exited (1)`** (database setup failed)
See why with `docker compose logs migrate`. Resetting usually fixes it:
`docker compose --profile app down -v` followed by `docker compose --profile app up -d --build`.

**The dashboard opens but shows "Something went wrong" or "Offline"**
Check `docker compose --profile app ps -a` shows `dialer-api` as healthy. If you changed `API_KEY` in
`.env`, rebuild so the dashboard picks it up: `docker compose --profile app up -d --build`.

---

## Before using this beyond a local demo

- In `.env`, replace `API_KEY` and `WEBHOOK_SECRET` with long random values, then rebuild.
- The dashboard has no user login (it uses one shared API key). Keep it on a private network or put it
  behind your company's single sign-on.
- For server deployment (AWS EC2 with PM2 + Nginx, or managed RDS + ElastiCache), see the
  **Deployment** section in `README.md`.
- Design decisions and trade-offs are explained in `docs/DECISIONS.md`.
