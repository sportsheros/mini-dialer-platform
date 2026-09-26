import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../db/data-source';
import { AgentStatus, Call, CallEventType, CallStatus, LeadStatus } from '../../entities';
import { NotFoundError } from '../../errors/AppError';
import { queryRows } from '../../lib/sql';
import { logger } from '../../lib/logger';
import { enqueueSummary } from '../../lib/queue';
import { publish } from '../../lib/realtime';
import { agentPool } from '../agents/agentPool';
import { claimAgent, releaseAgent } from '../agents/agentRouting';
import { statsCache } from '../stats/stats.cache';
import { canTransition, statusForEvent } from './callStateMachine';

export interface CallEventInput {
  /** Provider's unique event id: the idempotency key. */
  eventId: string;
  providerCallId: string;
  type: CallEventType;
  occurredAt: Date;
  payload?: Record<string, unknown>;
}

export type ApplyOutcome =
  | { status: 'processed'; callStatus: CallStatus; agentId: string | null }
  | { status: 'duplicate_ignored' }
  | { status: 'ignored'; reason: string; callStatus: CallStatus };

type SideEffect = () => Promise<void> | void;

/**
 * Applies one telephony event to its call. Used by the webhook AND by internal sources
 * (dial failures, the stuck-call reaper) so every state change follows the same rules.
 *
 * Transaction boundary — everything below commits or rolls back together:
 *   lock call row → insert CallEvent (idempotency) → state machine → call/agent/lead updates.
 * Redis writes, queue jobs and socket events are *side effects* run only after COMMIT, so we
 * never announce or cache something the database then rolled back.
 */
export async function applyCallEvent(input: CallEventInput): Promise<ApplyOutcome> {
  const afterCommit: SideEffect[] = [];
  // Agent id taken out of Redis whose DB claim is still uncommitted. If the transaction fails
  // we must put it back, otherwise that agent silently disappears from routing (compensation).
  const claim: { agentId: string | null } = { agentId: null };

  let outcome: ApplyOutcome;
  try {
    outcome = await AppDataSource.transaction('READ COMMITTED', (manager) =>
      applyInTransaction(manager, input, afterCommit, (id) => {
        claim.agentId = id;
      }),
    );
  } catch (err) {
    if (claim.agentId) await compensateAgentClaim(claim.agentId, input);
    throw err;
  }

  for (const effect of afterCommit) {
    try {
      await effect();
    } catch (err) {
      // The DB is already correct; a failed side effect is logged, and self-heals (boot rebuild
      // of agents:available, cache TTL, summary job on retry of the same event is a duplicate).
      logger.error({ err, eventId: input.eventId }, 'Post-commit side effect failed');
    }
  }
  return outcome;
}

async function compensateAgentClaim(agentId: string, input: CallEventInput): Promise<void> {
  try {
    await agentPool.add(agentId);
    logger.warn(
      { agentId, providerCallId: input.providerCallId, eventId: input.eventId },
      'Routing transaction failed; compensated by returning agent to agents:available',
    );
  } catch (err) {
    // Redis is down too: the agent stays available in Postgres and returns on the next rebuild.
    logger.error({ err, agentId }, 'Compensation failed; agent will be restored on rebuild');
  }
}

async function applyInTransaction(
  manager: EntityManager,
  input: CallEventInput,
  afterCommit: SideEffect[],
  trackAgentClaim: (agentId: string | null) => void,
): Promise<ApplyOutcome> {
  // Pessimistic row lock: events for the same call are serialised here (see DECISIONS.md for why
  // this beats optimistic retries for a hot, short, multi-table critical section).
  const call = await manager
    .createQueryBuilder(Call, 'call')
    .setLock('pessimistic_write')
    .where('call.providerCallId = :pid', { pid: input.providerCallId })
    .getOne();
  if (!call) throw new NotFoundError('Call', input.providerCallId);

  // Idempotency: the UNIQUE(providerEventId) index decides. A concurrent duplicate blocks on the
  // index entry until we commit, then sees the conflict and inserts nothing.
  const inserted = await queryRows<{ id: string }>(
    manager,
    `INSERT INTO call_events ("callId", "providerEventId", type, payload, "occurredAt")
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ("providerEventId") DO NOTHING
     RETURNING id`,
    [call.id, input.eventId, input.type, input.payload ?? null, input.occurredAt],
  );
  if (inserted.length === 0) return { status: 'duplicate_ignored' };
  const eventRowId = inserted[0].id;

  const from = call.status;
  const to = statusForEvent(input.type);
  if (!canTransition(from, to)) {
    const reason = `invalid transition ${from} -> ${to}`;
    await queryRows(manager, `UPDATE call_events SET applied = false, note = $2 WHERE id = $1`, [
      eventRowId,
      reason,
    ]);
    logger.warn(
      { callId: call.id, eventId: input.eventId, from, to },
      'Ignoring out-of-order or invalid call event',
    );
    return { status: 'ignored', reason, callStatus: from };
  }

  const releasedAgentId = call.agentId;
  switch (to) {
    case CallStatus.Ringing:
      call.status = CallStatus.Ringing;
      break;

    case CallStatus.Answered: {
      call.answeredAt = input.occurredAt;
      const agentId = await claimAgent(manager, trackAgentClaim);
      if (agentId) {
        call.status = CallStatus.Answered;
        call.agentId = agentId;
        afterCommit.push(() => publish('agent:updated', { id: agentId, status: AgentStatus.Busy }));
      } else {
        // No free agent. Alternative (documented): park the caller in a hold queue.
        call.status = CallStatus.Abandoned;
        call.endedAt = input.occurredAt;
        await finishLeadWithoutContact(manager, call.leadId);
        logger.warn({ callId: call.id }, 'No agent available; call abandoned');
      }
      break;
    }

    case CallStatus.Completed:
    case CallStatus.Failed:
    case CallStatus.NoAnswer: {
      call.status = to;
      call.endedAt = input.occurredAt;
      call.durationSec = computeDuration(call, input.payload);
      if (releasedAgentId && (await releaseAgent(manager, releasedAgentId))) {
        afterCommit.push(async () => {
          await agentPool.add(releasedAgentId); // DB committed first, then Redis
          publish('agent:updated', { id: releasedAgentId, status: AgentStatus.Available });
        });
      }
      // A call that was answered reached a human: the lead is done and the call gets a summary.
      // Otherwise the lead goes back for another attempt (or fails when attempts are used up).
      if (call.answeredAt) {
        await queryRows(
          manager,
          `UPDATE leads SET status = $2, "updatedAt" = now() WHERE id = $1 AND status = $3`,
          [call.leadId, LeadStatus.Completed, LeadStatus.Dialing],
        );
        const callId = call.id;
        afterCommit.push(() => enqueueSummary(callId));
      } else {
        await finishLeadWithoutContact(manager, call.leadId);
      }
      break;
    }

    default:
      // Abandoned/Initiated are never produced by provider events.
      throw new Error(`Unhandled target status ${to}`);
  }

  // save() bumps the @VersionColumn, so every state change is visible as a new version.
  const saved = await manager.save(Call, call);
  const phone = await leadPhone(manager, saved.leadId);
  afterCommit.push(() => publish('call:updated', toRealtimeCall(saved, phone)));
  if (saved.endedAt) afterCommit.push(() => statsCache.invalidate(saved.campaignId));

  return { status: 'processed', callStatus: saved.status, agentId: saved.agentId };
}

/**
 * No human conversation happened (no answer, failure before answer, abandoned): retry later
 * unless the campaign's attempt budget is spent, in which case the lead is `failed`.
 * Guarded by status='dialing' so a lead that was meanwhile put on DNC is left alone.
 */
async function finishLeadWithoutContact(manager: EntityManager, leadId: string): Promise<void> {
  await queryRows(
    manager,
    `UPDATE leads l
     SET status = CASE WHEN l.attempts >= c."maxAttempts"
                       THEN 'failed'::lead_status ELSE 'pending'::lead_status END,
         "updatedAt" = now()
     FROM campaigns c
     WHERE l.id = $1 AND c.id = l."campaignId" AND l.status = 'dialing'`,
    [leadId],
  );
}

function computeDuration(call: Call, payload?: Record<string, unknown>): number | null {
  const reported = payload?.durationSec;
  if (typeof reported === 'number' && Number.isFinite(reported) && reported >= 0) {
    return Math.round(reported);
  }
  if (call.answeredAt && call.endedAt) {
    return Math.max(0, Math.round((call.endedAt.getTime() - call.answeredAt.getTime()) / 1000));
  }
  return call.answeredAt ? 0 : null;
}

async function leadPhone(manager: EntityManager, leadId: string): Promise<string | null> {
  const rows = await queryRows<{ phone: string }>(
    manager,
    'SELECT phone FROM leads WHERE id = $1',
    [leadId],
  );
  return rows[0]?.phone ?? null;
}

export function toRealtimeCall(call: Call, phone: string | null) {
  return {
    id: call.id,
    status: call.status,
    campaignId: call.campaignId,
    leadId: call.leadId,
    agentId: call.agentId,
    phone,
    answeredAt: call.answeredAt,
    endedAt: call.endedAt,
    durationSec: call.durationSec,
    qaScore: call.qaScore,
    createdAt: call.createdAt,
    updatedAt: call.updatedAt,
  };
}
