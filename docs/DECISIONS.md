# Architecture Decisions & Trade-offs

Each section follows the same shape: **Problem → Options → Choice → Why → Trade-offs / failure modes**.
It is written so each answer can be explained out loud in a couple of minutes.

Contents

1. [Claiming leads: `FOR UPDATE SKIP LOCKED`](#1-claiming-leads-for-update-skip-locked)
2. [Agent routing: Redis `SPOP` + a DB guard, with compensation](#2-agent-routing-redis-spop--a-db-guard-with-compensation)
3. [Webhook idempotency: unique constraint](#3-webhook-idempotency-unique-constraint)
4. [Call state machine & out-of-order events](#4-call-state-machine--out-of-order-events)
5. [Pessimistic vs optimistic locking on `Call`](#5-pessimistic-vs-optimistic-locking-on-call)
6. [CPS rate limiting](#6-cps-rate-limiting)
7. [BullMQ summaries: retries, `jobId` dedupe, crashes](#7-bullmq-summaries-retries-jobid-dedupe-crashes)
8. [Stats: cache-aside + TTL](#8-stats-cache-aside--ttl)
9. [Indexes and the queries they serve](#9-indexes-and-the-queries-they-serve)
10. [Real telephony, real STT/LLM, and compliance](#10-real-telephony-real-sttllm-and-compliance)
11. [Smaller decisions made along the way](#11-smaller-decisions-made-along-the-way)

---

## 1. Claiming leads: `FOR UPDATE SKIP LOCKED`

**Problem.** Several dialer workers run at the same time. Each one repeatedly asks "give me the next
N pending leads". Two workers must never get the same lead, or the customer gets called twice.

**Options considered.**

| Option | How it works | Problem |
|---|---|---|
| Plain `SELECT` then `UPDATE` | Read pending leads, then mark them | Two workers read the same rows before either updates → double dial |
| `SELECT … FOR UPDATE` | Lock rows while claiming | Correct, but worker B *waits* on worker A's locks → workers run one at a time |
| Redis lock per campaign | `SET lock:campaign NX PX` | Correct but only one worker per campaign; lock expiry during a GC pause can let two in; a second system to keep consistent |
| Optimistic (`UPDATE … WHERE status='pending'`, check row count) | Race and see who wins | Losers waste a round trip and retry; under contention most attempts fail |
| **`FOR UPDATE SKIP LOCKED`** | Lock rows, *skip* rows someone else already locked | — |

**Choice.** In one transaction (`workers/dialer.ts → claimBatch`):

```sql
WITH picked AS (
  SELECT id FROM leads
  WHERE "campaignId" = $1 AND status = 'pending' AND attempts < $maxAttempts
    AND ("lastAttemptAt" IS NULL OR "lastAttemptAt" <= now() - retry_delay)
  ORDER BY attempts, "createdAt"
  LIMIT $n
  FOR UPDATE SKIP LOCKED
)
UPDATE leads SET status = 'dialing', attempts = attempts + 1, "lastAttemptAt" = now()
FROM picked WHERE leads.id = picked.id
RETURNING id, phone;
```

The same transaction re-checks DNC, then inserts the `Call` rows. It commits, and only **after commit**
do we call `TelephonyProvider.dial()`.

**Why.** It is the textbook "Postgres as a job queue" pattern. Each worker gets a *different* set of
rows with no waiting, so adding workers adds throughput. Correctness comes from the database, which
we trust anyway. No extra locking system is needed.
The test `two workers in parallel on 100 leads` and `scripts/concurrency-check.ts` prove that each
lead is dialed exactly once and that both workers did real work.

The campaign row is read with `FOR SHARE` in the same transaction. A concurrent "pause" (an `UPDATE`)
waits for this short transaction, so once a pause commits no new batch can be claimed.

**Trade-offs / failure modes.**
- *Worker crashes after commit, before dialing.* The lead stays `dialing` and the call stays
  `initiated`. The **reaper** (every `REAPER_INTERVAL_MS`) fails calls stuck in initiated/ringing longer
  than `STUCK_DIALING_MINUTES`, which returns the lead to `pending` (or `failed` if attempts are used up).
  A final safety net resets `dialing` leads that have no active call at all.
- *We dial after commit, not inside the transaction.* Holding a DB transaction open during a network
  call would hold row locks for seconds. The cost is the crash window above, which the reaper covers.
- `SKIP LOCKED` gives no strict global ordering across workers. That is fine for dialing.

---

## 2. Agent routing: Redis `SPOP` + a DB guard, with compensation

**Problem.** When a call is answered we must pick a free agent **instantly**, and one agent must
never be given two calls, even when 50 calls are answered at the same moment.

**Options considered.**
- **DB only:** `SELECT id FROM agents WHERE status='available' LIMIT 1 FOR UPDATE SKIP LOCKED`, then mark
  busy. Correct, but every answered call hits the agents table under contention.
- **Redis only:** `SPOP agents:available`. O(1) and atomic, but Redis is not our source of truth. If
  Redis and Postgres disagree, we could route to an offline agent.
- **Chosen: Redis `SPOP` as a fast candidate picker + a conditional DB update as the guarantee.**

**Choice** (`modules/agents/agentRouting.ts`, `modules/calls/callLifecycle.service.ts`):
1. `SPOP agents:available`. This is atomic, so two concurrent requests can never pop the same id.
2. In the call's DB transaction:
   `UPDATE agents SET status='busy' WHERE id=$1 AND status='available' RETURNING id`.
   If no row comes back, the Redis entry was stale (e.g. the agent went offline a moment ago). We
   drop that id (it isn't free, so it must not go back) and pop the next one, up to 5 tries.
3. Set `call.agentId`, commit.

**Consistency rules.**
- Postgres is the source of truth; `agents:available` is a derived cache.
- Always **write the DB first, then Redis** (status changes, releasing an agent after a call).
- On API boot the set is **rebuilt from the DB** (`agentPool.rebuildFromDb`, `DEL` + `SADD` in one `MULTI`).

**Compensation.** After `SPOP`, the agent is out of Redis, but the DB change isn't committed yet. If
the transaction then fails (DB error, deadlock, crash of the query), the agent would disappear from
routing forever. So `applyCallEvent` remembers the popped id and, in its `catch`, does
`SADD agents:available <id>` and logs a warning. The test *"compensates when the routing transaction
fails after SPOP"* installs a DB trigger that throws mid-transaction and checks that the agent is
routable again and the provider's retry is processed normally.

**Why this combination.** Redis gives speed and a natural atomic "take one" operation. The conditional
`UPDATE` means that **even if Redis is wrong, an agent is never double-assigned**: a second transaction
trying to mark the same agent busy blocks on the row lock, then sees `status='busy'` and matches nothing.
This is tested directly (*"skips a stale agent id in Redis"*).

**Failure modes.**
- *Process dies between `SPOP` and commit (no `catch` runs).* The DB rolls back (agent still
  `available`), but the id is gone from Redis until the next rebuild (API restart). Improvement: a
  periodic reconciler that adds back DB-available agents missing from the set. It must only *add*, never
  `DEL`, to avoid racing with in-flight claims.
- *Redis down.* Routing fails, the webhook returns 5xx, and the provider retries. Nothing is corrupted.
- *No agent free* → the call becomes `abandoned` and the lead goes back for retry. **Alternative:** a
  hold queue (Redis list of waiting calls, drained when an agent is released), with a max wait and a
  compliant message. Real predictive dialers also *pace* dialing by free agents (see §6).

> Note from the load simulation: one pair of calls on the same agent looked like it "overlapped" by
> 46 ms. That compared *provider* timestamps (`answeredAt`/`endedAt`). The assignment itself happened
> after the previous call's release committed; the DB guard makes anything else impossible. Provider
> clocks and our processing order are different timelines.

---

## 3. Webhook idempotency: unique constraint

**Problem.** Telephony providers deliver webhooks **at least once**: after a timeout or a slow `200`
they send the same event again, sometimes at the same instant. Processing an `answered` twice would
claim two agents; processing `completed` twice would enqueue two summaries.

**Options.**
- **Redis `SET event:{id} NX EX 86400`.** Fast, but it is a *separate* system from the data it protects.
  If we set the key and then the DB transaction fails, the retry is wrongly ignored (event lost). If we
  set it after commit, and crash before setting it, we process twice. Keys also expire.
- **Unique constraint on `call_events.providerEventId`** (chosen).

**Choice.** Inside the same transaction as the state change:

```sql
INSERT INTO call_events (...) VALUES (...)
ON CONFLICT ("providerEventId") DO NOTHING
RETURNING id;
```

No row returned → `200 { status: "duplicate_ignored" }`. We never throw, so we never answer 500.

**Why.** The "have I seen this?" record and the effect of the event commit **atomically**: both happen
or neither does. If two identical requests arrive at the same time, the second `INSERT` waits on the
first one's uncommitted unique-index entry. When the first commits, the second sees the conflict and
inserts nothing. If the first rolls back, the second proceeds and processes the event. That is exactly
the right behaviour. The test sends the same `eventId` 10× concurrently and asserts 1 row, 1 state
change (`version` bumped once), and 1 agent claimed.

**Retries and timeouts.**
- We return `200` for anything durably recorded (processed, duplicate, or ignored by the state
  machine), so the provider stops retrying.
- If *we* time out after committing, the provider retries and gets `duplicate_ignored`: safe.
- If we fail before committing, nothing was recorded, so the retry processes normally. This is also
  why the compensation in §2 matters.
- `404` for an unknown `providerCallId` lets the provider retry. We generate the `providerCallId` and
  commit the call *before* dialing, so this should only happen for garbage input.
- Signatures: HMAC-SHA256 over the **raw body bytes** (captured before JSON parsing, because
  re-serialising could change bytes), compared in constant time. Replays of an old valid request are
  harmless because of idempotency. A production version would also reject timestamps older than ~5
  minutes.

---

## 4. Call state machine & out-of-order events

**Problem.** Events can arrive late, twice, or in the wrong order (e.g. `ringing` after `answered`).
Applying them blindly could move a call *backwards* or re-open a finished call.

**Choice** (`modules/calls/callStateMachine.ts`): an explicit transition table.

```
initiated ─► ringing ─► answered ─► completed
    │           │           │
    │           ├─► no_answer
    └───────────┴───────────┴─► failed        (any non-terminal state)
answered ─► abandoned                          (internal: no agent free)
initiated ─► answered / no_answer              (tolerated: the ringing webhook got lost)
```

Terminal states (`completed`, `failed`, `no_answer`, `abandoned`) allow nothing.
Events that don't fit are **stored** in `call_events` with `applied = false` and a `note` such as
`invalid transition answered -> ringing`, logged at `warn`, and answered with `200 { status: "ignored" }`.

**Why.**
- *Forward-only* rules make late events harmless: a late `ringing` after `answered` is ignored.
- *Skipping* is allowed where the meaning is unambiguous. If `answered` arrives and `ringing` never
  did, the call obviously rang. Refusing would strand a live customer with no agent.
- `ringing → completed` is **not** allowed: a call must be answered (and have an agent) to complete.
  If `completed` arrives before `answered`, it is ignored, and the late `answered` then routes an agent.
  In that rare case, the reaper's `MAX_CALL_MINUTES` rule eventually fails the call and releases the
  agent (see §11). An alternative is to buffer early events and re-apply them, at the cost of complexity.
- Keeping ignored events gives a full audit trail. The dashboard timeline shows them greyed out.

**Load-test numbers.** In a 500-lead simulation: 862 calls, 2,283 events stored, 398 of them ignored. Most
were `completed` events for calls we had already marked `abandoned`; the rest were the deliberate
out-of-order `ringing` events. There were 0 errors.

---

## 5. Pessimistic vs optimistic locking on `Call`

**Problem.** Two events for the same call can be processed at the same time (e.g. `answered` and a
fast `completed`, or duplicates). Each does read → decide → write across several tables
(`calls`, `call_events`, `agents`, `leads`) plus Redis.

**Options.**
- **Optimistic:** read the call with its `version`, then
  `UPDATE … WHERE id=$1 AND version=$v`. If 0 rows are updated, reload and retry.
- **Pessimistic:** `SELECT … FOR UPDATE` on the call row at the start of the transaction.

**Choice: pessimistic row lock**, with `@VersionColumn` kept as a change counter.

**Why.**
- Conflicts on a single call are *expected* (bursts of events for one call), and the critical section is
  short. Optimistic locking shines when conflicts are rare. Here, a conflict would mean retrying a
  transaction that has already popped an agent from Redis, so every retry would need compensation too.
- With a row lock, events for the same call simply queue for a few milliseconds and run one after
  another, and the state machine sees the true current state. Different calls never block each other.
- Duplicates are resolved by the unique index anyway (§3), and the lock makes the ordering simple to
  reason about.

**Trade-offs.** A slow transaction holds the lock longer. We keep the transaction small: there are no
network calls except the Redis `SPOP`, and `statement_timeout` is 30 s. `version` still increments on
every change, which the tests use to prove "processed exactly once" and which could serve as an ETag
later.

---

## 6. CPS rate limiting

**Problem.** Each campaign has `maxCps` (new calls per second). Carriers enforce this and block trunks
that exceed it. The limit must hold **across all dialer workers**, not per process.

**Choice.** A Redis Lua script (`lib/lua/index.ts → CPS_ACQUIRE`) on the key
`cps:{campaignId}:{epochSecond}`. It atomically reads how many slots were used this second, grants
`min(requested, maxCps - used)`, `INCRBY`s by that amount, and sets `EXPIRE 2`. The worker then claims
**at most that many leads**.

**Why.**
- Lua runs atomically in Redis, so the read-check-increment cannot interleave between workers.
- Granting a *batch* of slots in one call is cheaper than one `INCR` per call.
- A per-second fixed window is exactly what "calls per second" means, and the key expires on its own.
- If fewer leads are available than slots granted, some slots go unused. That only under-dials, which is safe.

**Trade-offs / failure modes.**
- Fixed windows allow a burst at a second boundary (up to 2 × maxCps within ~1 s). A sliding
  window or token bucket smooths this if a carrier requires it.
- The second is taken from the worker's clock, so keep hosts NTP-synced. Moving the clock into Lua
  (`redis.call('TIME')`) would remove that dependency.
- Redis down → the tick errors and nothing is dialed. This fails *closed*, which is the right direction
  for a compliance limit.
- Not done: **pacing by agent availability** (dial ratio ≈ free agents × expected answer rate). The
  simulation shows why it matters: dialing at 10 CPS with 8 agents abandoned 319 of 572 answered calls.
  That would be the next feature.

---

## 7. BullMQ summaries: retries, `jobId` dedupe, crashes

**Problem.** After a call ends we run STT → LLM (slow, flaky, costly). This must not block the webhook,
must retry on failure, and must never produce two summaries or pay for work twice.

**Choice.**
- Queue `call-summary`, job options `jobId = callId`, `attempts: 3`, exponential backoff (2 s, 4 s).
- The job is enqueued **after** the DB transaction commits (a side effect, §11).
- The processor (`workers/summary.ts`) is **idempotent**:
  1. The call already has a summary → skip.
  2. The call never connected → skip.
  3. The transcript is saved as soon as STT succeeds, so an LLM failure followed by a retry does not
     pay for STT again (tested).
  4. The final write is `UPDATE … WHERE summary IS NULL`, so if two runs race, only one wins.

**Why `jobId = callId`.** BullMQ ignores `add()` for a job id that already exists (waiting, active,
delayed, or retained completed/failed). This stops duplicate enqueues, e.g. a webhook retried after
our commit.

**What if the worker crashes mid-job?** BullMQ holds a lock on the active job and renews it while the
worker is alive. If the process dies, the lock expires, the stalled-job checker moves the job back to
`wait`, and another worker runs it. Because the processor is idempotent, re-running is safe. Graceful
shutdown (`worker.close()`) waits for in-flight jobs instead.

**Trade-offs.** Completed jobs are removed after 24 h, after which `jobId` dedupe no longer applies.
Worker idempotency covers that. If Redis loses the job before it runs (enqueue failed after commit),
the call has no summary. The fix is a periodic sweep ("ended + answered + no summary + older than
5 min → enqueue"), or a transactional outbox (§11). In the 500-lead simulation, all 253 connected
calls got summaries despite a 10% random provider failure rate (52 retries logged).

---

## 8. Stats: cache-aside + TTL

**Problem.** The dashboard polls campaign stats every few seconds per viewer. Each request runs
`GROUP BY` aggregates over leads and calls.

**Choice.** Cache-aside in Redis (`stats:campaign:{id}`, TTL `STATS_CACHE_TTL_SEC` = 30 s):
read Redis → on miss, compute from Postgres and store → return. The response carries `X-Cache: HIT|MISS`.
The entry is **deleted** when a call ends, when leads are uploaded, when a campaign completes or is
deleted, and when a summary lands.

**Why.** Many viewers share one computation. Invalidation on the events that change the numbers means
the cache is usually fresh, and the TTL bounds staleness for everything else.

**Staleness trade-off.**
- Between invalidations, changes such as `ringing → answered` (in-progress counts) can be up to 30 s
  old. That's acceptable for a supervisor overview; live calls come through Socket.IO instead.
- A *race*: request A misses and computes, a call ends and invalidates, then A writes its (now old)
  result. That entry stays stale until the TTL expires. The TTL is what makes this self-healing. A
  version counter or a short TTL removes it entirely if needed.
- The cache **fails open**: a Redis error just means computing from Postgres.
- At much higher scale, maintain counters incrementally (`HINCRBY` on each transition) or use a
  materialised view refreshed every few seconds.

---

## 9. Indexes and the queries they serve

| Index | Columns | Query it serves |
|---|---|---|
| `UQ_agents_email` | `agents(email)` UNIQUE | Duplicate email → `409` without a racy pre-check |
| `UQ_leads_campaign_phone` | `leads(campaignId, phone)` UNIQUE | `ON CONFLICT DO NOTHING` during upload. A phone is unique *per campaign*, not globally |
| `IDX_leads_campaign_status` | `leads(campaignId, status)` | The dialer claim (`campaignId = ? AND status = 'pending'`), lead listing with status filter, stats `GROUP BY status`, campaign-completion check |
| `dnc_numbers` PK | `dnc_numbers(phone)` | DNC lookup at upload and at dial time (`phone = ANY(...)`) |
| `UQ_calls_provider_call_id` | `calls(providerCallId)` UNIQUE | Every webhook finds its call by provider id |
| `IDX_calls_status_created` | `calls(status, createdAt)` | `GET /api/calls?status=…` sorted by `createdAt DESC`; live calls (`status IN (initiated, ringing, answered)`); the reaper's stuck-call scan |
| `IDX_calls_campaign_created` | `calls(campaignId, createdAt)` | `GET /api/calls?campaignId=…` sorted by time; campaign stats aggregates |
| `IDX_calls_agent` | `calls(agentId)` | `GET /api/calls?agentId=…`; the FK to agents (makes `ON DELETE SET NULL` cheap) |
| `IDX_calls_lead` | `calls(leadId)` | The FK to leads; the reaper's "does this lead have an active call?" check |
| `UQ_call_events_provider_event_id` | `call_events(providerEventId)` UNIQUE | **Webhook idempotency** (§3) |
| `IDX_call_events_call_occurred` | `call_events(callId, occurredAt)` | Call detail timeline, in order |

`tests/integration/stats-calls.test.ts` runs `EXPLAIN` on the real list query for each filter and asserts
the matching index appears in the plan. It disables seq scans for that check because test tables are tiny.

Not added (on purpose): a partial index `leads(campaignId, createdAt) WHERE status = 'pending'` would
make claiming slightly cheaper on huge campaigns. It is worth adding once a campaign holds millions of rows.

---

## 10. Real telephony, real STT/LLM, and compliance

**Telephony.** `TelephonyProvider.dial()` would originate a call on a real switch:
- **FreeSWITCH** via ESL: `originate {origination_uuid=<providerCallId>}sofia/gateway/carrier/+1…`.
  We already generate the id before dialing, which maps exactly to `origination_uuid`. Channel events
  (`CHANNEL_PROGRESS`, `CHANNEL_ANSWER`, `CHANNEL_HANGUP_COMPLETE` with hangup cause) become our
  `ringing / answered / completed / no_answer / failed`. An ESL listener service would call
  `applyCallEvent` (or post signed events to the webhook) instead of the mock.
- **Asterisk** via ARI: `POST /channels` with a `channelId`, events over the ARI websocket.
- **CPaaS** (Twilio/Vonage): REST originate + status-callback webhooks, which is the shape our webhook
  already has. Their call SID is stored as a separate column, or we pass our id as a custom parameter.
- **Answering-machine detection** adds a `machine` outcome. **Bridging** the answered leg to the
  agent's SIP endpoint/WebRTC softphone happens at routing time. Recording URLs are stored on the call.

**STT/LLM.** Swap `MockSttProvider` for Deepgram/AWS Transcribe/Whisper (fed with the recording
URL), and `MockLlmProvider` for an LLM call with a structured-output schema
(`{ summary, qaScore, flags[] }`) and a rubric prompt. Keep:
- idempotency and transcript persistence (already in place),
- per-provider timeouts and rate-limit-aware backoff (BullMQ rate limiter per queue),
- PII redaction before sending transcripts to third parties, and data-retention rules.

**Compliance (what a real US/EU deployment needs).**
- **DNC:** national/state DNC lists and internal opt-outs, synced daily. Checked at upload *and*
  immediately before dialing (we do both), and adding a number blocks pending leads in all campaigns.
- **TCPA (US):** consent records for autodialed/prerecorded calls to mobiles. **Calling-hour windows**
  (8am–9pm in the *lead's* local time, so store a timezone per lead and filter in the claim query).
  Caller ID must be valid. **Abandonment rate** ≤ 3% per campaign per 30 days, with a recorded message
  within 2 s when no agent is free. Our `abandoned` status is exactly what you would measure, and
  pacing by agent availability (§6) is how you keep it low.
- **GDPR (EU):** lawful basis, right to erasure (deleting a lead cascades to calls/events; transcripts
  would need scrubbing in backups too), data minimisation, EU data residency for recordings/transcripts.
- Call-recording consent announcements per jurisdiction. The mock QA already flags a missing
  "this call may be recorded" phrase.

---

## 11. Smaller decisions made along the way

- **We generate `providerCallId` before dialing.** The `Call` row with this id is committed *before*
  `dial()`, so a webhook can never arrive for a call we don't know yet. With a provider that assigns its
  own id, you'd store theirs separately and correlate via a custom parameter.
- **Side effects run after commit.** Redis writes (`SADD`), queue jobs, cache invalidation, and socket
  events are collected during the transaction and executed after `COMMIT`. We never announce or cache
  something that then rolls back. The cost is that a crash between commit and side effect loses the side
  effect. Each one self-heals: the pool is rebuilt on boot, the cache has a TTL, summaries can be swept.
  The full solution is a **transactional outbox** table written in the same transaction and relayed by
  a worker.
- **Lead outcome rules.** Answered calls (`completed`, or `failed` after answer) → lead `completed` +
  summary. Calls that never reached a human (`no_answer`, `failed` before answer, `abandoned`) → lead back
  to `pending` for another attempt after `DIALER_RETRY_DELAY_SEC`, or `failed` once
  `attempts >= maxAttempts`. This is a deliberate refinement of "failed → lead completed": a carrier
  failure shouldn't burn a lead that nobody spoke to.
- **Reaper** (runs in every dialer process; every step is idempotent). Calls stuck in
  initiated/ringing → `failed` (lead returns). Calls `answered` longer than `MAX_CALL_MINUTES` →
  `failed`, which **releases the agent**. Without this, a lost `completed` webhook would leave an agent
  busy forever. Orphaned `dialing` leads with no active call → `pending`/`failed`. Synthetic events use
  deterministic ids (`internal:timeout:{callId}`), so two reapers can't double-apply, and they show up
  in the timeline. External webhooks may not use the `internal:` prefix.
- **Campaign completion.** When a claim finds nothing, the dialer marks the campaign `completed` only if
  no lead is `pending` or `dialing` (one conditional `UPDATE`). Leads waiting for their retry delay are
  still `pending`, so they aren't cut off.
- **Campaign start/pause are idempotent.** Starting a running campaign returns `200`. Invalid
  transitions (e.g. pausing a draft) return `422`. Deleting a running campaign returns `409` ("pause
  first") because it cascades to calls.
- **Realtime across processes.** Workers can't reach Socket.IO clients directly, so everything publishes
  to a Redis pub/sub channel and **every API instance** re-emits to its own clients. This works with
  any number of API instances. The dashboard uses the websocket transport only, so no sticky sessions
  are needed behind a load balancer.
- **Rate limiter fails open.** If Redis is down, API requests are allowed (with a warning). An outage
  in a protective layer shouldn't take the product down. The CPS limiter fails *closed* instead (§6),
  because there the limit is a legal/carrier obligation.
- **Webhooks skip the API key and per-IP limit.** They're authenticated by HMAC instead. A provider
  sends everything from a few IPs, and throttling it would only cause retry storms.
- **`queryRows` helper.** TypeORM's Postgres driver returns `[rows, rowCount]` for `UPDATE/DELETE` but
  plain `rows` for `SELECT/INSERT`. Checking `.length` on the former is always 2, which would silently
  break the conditional-update guards (agent claim, lead updates). All raw SQL goes through
  `lib/sql.ts#queryRows`, which normalises this.
- **Offset pagination.** It's simple and matches the `page/limit` contract. For deep pages on huge call
  tables, keyset pagination (`WHERE (createdAt, id) < (?, ?)`) is the upgrade path; the index already
  supports it.
- **API-key auth.** A single shared key (compared in constant time) is enough for an internal
  supervisor tool. Production would use per-user auth (OIDC/JWT) with roles (supervisor vs admin).
- **Tests use the real stack.** Integration tests run the real migrations against a dedicated Postgres
  database and Redis DB, so locking, unique constraints and Lua scripts are exercised for real. Mocks
  would hide exactly the bugs this project is about.
