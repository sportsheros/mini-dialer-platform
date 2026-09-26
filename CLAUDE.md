# CLAUDE.md — Mini Dialer Platform (AI Contact Center Backend)

## 1. Project Overview

An AI-assisted **outbound contact-center platform**: supervisors create campaigns, upload leads,
a predictive-style dialer worker places calls, answered calls are routed to a free agent
atomically, and completed calls are summarised + quality-scored asynchronously. A React
supervisor dashboard shows live agents, live calls and call logs.

Real telephony (SIP / FreeSWITCH) and real STT/LLM are **simulated** behind clean interfaces
(`TelephonyProvider`, `SttProvider`, `LlmProvider`) so real providers can be plugged in later.

**The primary goal of this codebase is production-quality engineering**, not feature count:
correctness under concurrency, idempotency, transactions, clean architecture, clear errors,
and explainable trade-offs. Every non-obvious decision must be documented (see §12).

---

## 2. Tech Stack (do not substitute without asking)

| Concern | Choice |
|---|---|
| Runtime | Node.js 20 LTS + **TypeScript (strict mode)** |
| HTTP | **Express** |
| ORM / DB | **TypeORM** + **PostgreSQL 16** (migrations only, `synchronize: false`) |
| Cache / locks / live state | **Redis 7** via **ioredis** |
| Background jobs | **BullMQ** |
| Validation | **Zod** (request bodies, params, query, and env) |
| Logging | **pino** (+ pino-http, request-id per request) |
| Real-time | **Socket.IO** |
| Frontend | **React 18 + Vite + TypeScript** (in `/web`) |
| Testing | **Jest + Supertest** (backend) |
| Local infra | **Docker Compose** (postgres, redis) |
| Deploy target | **AWS EC2** (PM2 + Nginx); document RDS + ElastiCache as the production path |

Package manager: npm. Lint/format: ESLint + Prettier.

---

## 3. Repository Structure

```
/
├── src/
│   ├── config/          env.ts (zod-validated env, fail fast on boot)
│   ├── db/              data-source.ts, migrations/, seed.ts
│   ├── entities/        Agent, Campaign, Lead, DncNumber, Call, CallEvent
│   ├── modules/
│   │   ├── agents/      *.routes.ts, *.controller.ts, *.service.ts, *.schema.ts
│   │   ├── campaigns/
│   │   ├── leads/
│   │   ├── calls/
│   │   └── webhooks/
│   ├── workers/         dialer.worker.ts, summary.worker.ts
│   ├── providers/       telephony.mock.ts, stt.mock.ts, llm.mock.ts (+ interfaces)
│   ├── lib/             redis.ts, logger.ts, queue.ts, socket.ts, lua/
│   ├── middlewares/     errorHandler.ts, validate.ts, rateLimit.ts, requestId.ts, auth.ts
│   ├── errors/          AppError.ts (+ NotFoundError, ConflictError, ValidationError, ...)
│   ├── app.ts           express app (no listen)
│   └── server.ts        boot: env → db → redis → http + socket.io
├── tests/               unit + integration + concurrency tests
├── scripts/             simulate-load.ts, concurrency-check.ts
├── web/                 React dashboard
├── docker-compose.yml
├── .env.example
├── README.md
└── docs/DECISIONS.md    architecture decisions & trade-offs (see §12)
```

**Layering rule:** routes → controller (HTTP only) → service (business logic, transactions)
→ repository/TypeORM. Controllers never touch the DB directly. Services never touch `req`/`res`.

---

## 4. Domain Model (TypeORM entities)

All entities: `id` (uuid), `createdAt`, `updatedAt` (`@CreateDateColumn` / `@UpdateDateColumn`).

- **Agent** — `name`, `email` (UNIQUE), `status` enum `offline | available | busy`.
- **Campaign** — `name`, `status` enum `draft | running | paused | completed`,
  `maxCps` (calls per second, int, default 2), `maxAttempts` (default 3).
- **Lead** — `campaign` (ManyToOne), `phone` (E.164), `name?`,
  `status` enum `pending | dialing | completed | failed | dnc`, `attempts` int,
  `lastAttemptAt?`. UNIQUE(`campaignId`, `phone`). INDEX(`campaignId`, `status`).
- **DncNumber** — `phone` (PK), `reason?`.
- **Call** — `lead` (ManyToOne), `agent?` (ManyToOne, nullable), `campaign` (ManyToOne),
  `status` enum `initiated | ringing | answered | completed | failed | no_answer | abandoned`,
  `providerCallId` (UNIQUE), `answeredAt?`, `endedAt?`, `durationSec?`,
  `transcript?` text, `summary?` text, `qaScore?` int, `version` (`@VersionColumn`).
  INDEX(`agentId`), INDEX(`status`, `createdAt`), INDEX(`campaignId`, `createdAt`).
- **CallEvent** — `call` (ManyToOne), `providerEventId` (UNIQUE), `type`, `payload` (jsonb),
  `receivedAt`.

Relations: Campaign 1–N Lead, Lead 1–N Call, Agent 1–N Call, Campaign 1–N Call, Call 1–N CallEvent.
Explain every index in `docs/DECISIONS.md`.

---

## 5. Features & Acceptance Criteria

### 5.1 Agents
- `POST /api/agents`, `GET /api/agents`, `GET /api/agents/:id`
- `PATCH /api/agents/:id/status` `{ status: "available" | "offline" }`
- Redis set `agents:available` mirrors available agents. Write DB first, then Redis.
- On server boot, rebuild `agents:available` from DB (Redis is a derived cache, DB is source of truth).
- Cannot set `offline` while `busy` on a call → 409.

### 5.2 Campaigns & Leads
- CRUD for campaigns; `POST /api/campaigns/:id/start`, `/pause`.
- `POST /api/campaigns/:id/leads` — body: array of `{ phone, name? }` (max 5,000 per request).
  - Validate E.164, dedupe within payload, skip existing (unique constraint / `ON CONFLICT DO NOTHING`),
    mark DNC numbers as `dnc`. Single transaction. Return `{ inserted, duplicates, dnc, invalid }`.
- `GET /api/campaigns/:id/leads?status=&page=&limit=` — paginated.
- `POST /api/dnc` to add DNC numbers.

### 5.3 Dialer Worker (`workers/dialer.worker.ts`)
- Loops over `running` campaigns. For each, claims a batch of pending leads using
  **`SELECT ... FOR UPDATE SKIP LOCKED`** inside a transaction, marks them `dialing`,
  increments `attempts`, creates `Call` rows (`initiated`), commits, then calls
  `TelephonyProvider.dial()`.
- **Must be safe with multiple worker instances running** — no lead dialed twice.
- **CPS rate limit per campaign** via Redis (`INCR cps:{campaignId}:{epochSecond}` + `EXPIRE 2`
  or a Lua script). Never exceed `maxCps`.
- Re-check DNC right before dialing.
- Leads stuck in `dialing` > N minutes (worker crash) are recovered back to `pending`
  by a reaper job (document this).
- Leads exceeding `maxAttempts` → `failed`.

### 5.4 Telephony Webhook (`POST /api/webhooks/call-events`)
- Body: `{ eventId, providerCallId, type: "ringing"|"answered"|"completed"|"no_answer"|"failed", timestamp, payload? }`
- Verify an HMAC signature header (`X-Signature`) with a shared secret from env.
- **Idempotent:** insert `CallEvent` with UNIQUE `providerEventId`; on duplicate return
  `200 { status: "duplicate_ignored" }` — never process twice, never 500.
- **State machine:** only allow valid transitions
  (`initiated→ringing→answered→completed`, `ringing→no_answer`, any non-terminal→`failed`).
  Invalid / out-of-order events are stored but ignored, logged at warn level.
- Use optimistic locking (`version`) or a row lock when updating the Call; explain the choice.

### 5.5 Agent Routing (on `answered`)
- Atomically claim a free agent: `SPOP agents:available` (or a Lua script if extra
  conditions are needed). One agent can never get two calls.
- In a DB transaction: set `call.agentId`, `agent.status = busy`.
  If the DB transaction fails → **compensate** by `SADD` the agent back. Log it.
- If no agent is free → call becomes `abandoned` (document alternative: hold queue).
- On `completed` / `failed`: release agent (`status=available`, `SADD`), set `endedAt`,
  `durationSec`, lead → `completed`, enqueue summary job.
- Emit Socket.IO events: `agent:updated`, `call:updated`.

### 5.6 Post-call Summary & Audit (BullMQ, `workers/summary.worker.ts`)
- Job `call-summary` with `jobId = callId` (dedupe), `attempts: 3`, exponential backoff.
- Steps: mock STT → transcript; mock LLM → summary + `qaScore` (0–100) + flags
  (e.g. greeting missed, compliance phrase missing).
- Idempotent: if `summary` already set, skip.
- Mock providers should randomly fail ~10% to prove retries work.

### 5.7 Stats & Caching
- `GET /api/campaigns/:id/stats` → total leads, by status, calls answered, answer rate,
  avg duration, avg qaScore.
- Cache-aside in Redis (`stats:campaign:{id}`, TTL 30s); invalidate on call completion.
- Document staleness trade-off.

### 5.8 Calls API
- `GET /api/calls?status=&agentId=&campaignId=&from=&to=&page=&limit=` — paginated, filtered,
  sorted by `createdAt desc`. Use QueryBuilder; must hit the indexes.
- `GET /api/calls/:id` — includes events timeline, transcript, summary, qaScore.

### 5.9 Cross-cutting
- `GET /health` → checks DB + Redis, returns 200/503.
- Global rate limit on public API (Redis-based, per IP), 429 on exceed.
- Simple API-key auth middleware for `/api/*` (header `X-API-Key`), webhooks use HMAC instead.
- Graceful shutdown: stop accepting requests, close workers, queue, DB, Redis.

### 5.10 React Dashboard (`/web`)
- Pages: **Live Dashboard** (agents panel with status badges, live calls table, campaign stat cards),
  **Call Logs** (filters + pagination + detail drawer with timeline/summary/qaScore),
  **Campaigns** (list, create, upload leads via JSON/CSV paste, start/pause).
- Socket.IO for live updates.
- Custom hooks: `useAgents`, `useCalls(filters)`, `useSocket`. Typed API client.
- Every data view has loading, empty and error states. Reusable components
  (`StatusBadge`, `DataTable`, `Pagination`, `StatCard`). Keep UI simple and clean — no heavy UI lib needed.

### 5.11 Simulator (`scripts/simulate-load.ts`)
- Seeds agents + a campaign with ~500 leads, marks agents available, starts the campaign,
  and the mock telephony provider fires webhook events back (random ringing/answered/no_answer,
  random durations, **random duplicate and out-of-order events**) so the whole system runs end-to-end locally.

---

## 6. API Conventions
- Base path `/api`. Resource-based, plural nouns. Correct verbs.
- Success: `{ "success": true, "data": ..., "meta": { page, limit, total } }`
- Error: `{ "success": false, "error": { "code": "CONFLICT", "message": "...", "details": [...] } }`
- Status codes: 200, 201, 204, 400 (validation), 401, 404, 409 (conflict/duplicate state),
  422 (invalid state transition), 429, 500, 503.
- Pagination: `page` (1-based), `limit` (default 20, max 100).

---

## 7. Coding Standards
- TypeScript `strict: true`; no `any` (use `unknown` + narrowing).
- Meaningful names; small functions; no business logic in controllers.
- All async errors flow to the central error handler (use an `asyncHandler` wrapper).
- All env via `config/env.ts` — never read `process.env` elsewhere.
- No secrets in code; `.env.example` lists every variable.
- Comments only where the *why* isn't obvious (locks, idempotency, compensation).
- Every multi-step write is inside a transaction; name the transaction boundary clearly.

---

## 8. Testing Requirements
- Unit tests: state machine transitions, validation schemas, stats calculation.
- Integration tests (Supertest, real Postgres + Redis from docker-compose):
  - webhook duplicate `eventId` sent 10× → exactly 1 CallEvent, call processed once.
  - 50 concurrent `answered` events with 5 available agents → exactly 5 calls get agents,
    no agent assigned twice.
  - two dialer workers in parallel on 100 leads → each lead dialed exactly once.
  - lead upload with duplicates + DNC + invalid numbers → correct counts.
- `npm test` must pass. Add `scripts/concurrency-check.ts` that prints a clear PASS/FAIL report.

---

## 9. Scripts (package.json)
`dev`, `build`, `start`, `worker:dialer`, `worker:summary`, `migration:generate`, `migration:run`,
`seed`, `simulate`, `test`, `lint`, `web:dev`, `web:build`.

---

## 10. Build Order (implement in phases; commit after each)
1. Docker Compose, TS config, env validation, logger, error handling, `/health`.
2. Entities + migrations + seed.
3. Agents module + Redis availability set.
4. Campaigns, leads upload, DNC.
5. Dialer worker with SKIP LOCKED + CPS limit + stuck-lead reaper.
6. Webhook: HMAC, idempotency, state machine, agent routing with compensation.
7. BullMQ summary/audit worker with mock STT/LLM.
8. Stats + caching; calls listing API.
9. Tests + concurrency check script.
10. Simulator script.
11. React dashboard.
12. Deploy docs (EC2 + PM2 + Nginx), README, DECISIONS.md.

Use clear conventional commit messages (`feat:`, `fix:`, `test:`, `docs:`).

---

## 11. README.md must include
- What the platform does (1 paragraph) + architecture diagram (ASCII or Mermaid).
- Quick start: `docker compose up -d && npm i && npm run migration:run && npm run seed && npm run dev`.
- How to run workers, simulator, tests, and the dashboard.
- API reference table.
- "Scaling to 10x" section: stateless API behind a load balancer, horizontal workers,
  SKIP LOCKED + Redis make workers safe to scale, read replicas, connection pooling,
  partitioning `call`/`call_event` by month, moving to RDS + ElastiCache, observability.
- Deployment guide for AWS EC2.

---

## 12. docs/DECISIONS.md (very important)
For each of these, write: **problem → options considered → choice → why → trade-offs / failure modes**.
Write it in simple language so the author can explain it verbally in an interview.
- Why `FOR UPDATE SKIP LOCKED` for lead claiming (vs Redis lock, vs optimistic).
- Why Redis `SPOP` for agent routing (vs DB `SELECT ... FOR UPDATE` on agents); DB↔Redis consistency and compensation.
- Webhook idempotency via unique constraint (vs Redis `SET NX`) — and what happens on retries/timeouts.
- Call state machine and handling out-of-order events.
- Optimistic vs pessimistic locking on `Call`.
- CPS rate limiting approach.
- BullMQ retries, dedupe via `jobId`, what happens if the worker crashes mid-job.
- Cache-aside + TTL, stale-data trade-off.
- Each index and which query it serves.
- What would change for real telephony (FreeSWITCH/Asterisk via ESL/ARI, SIP), real STT/LLM, and compliance (DNC, TCPA/GDPR, calling-hour windows).

---

## 13. Rules for Claude while working in this repo
- Follow the build order; finish and test a phase before starting the next.
- Never use `synchronize: true`. Always generate migrations.
- Prefer correctness and clarity over cleverness. No unnecessary dependencies.
- When making a design choice not specified here, pick the simplest robust option and
  add it to `docs/DECISIONS.md`.
- After each phase, give a short summary of what was built and how to verify it.
