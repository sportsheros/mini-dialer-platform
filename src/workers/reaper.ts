import { AppDataSource } from '../db/data-source';
import { CallEventType, CallStatus } from '../entities';
import { logger } from '../lib/logger';
import { queryRows } from '../lib/sql';
import { applyCallEvent } from '../modules/calls/callLifecycle.service';

export interface ReaperConfig {
  stuckDialingMinutes: number;
  maxCallMinutes: number;
}

export interface ReaperResult {
  timedOutCalls: number;
  overlongCalls: number;
  recoveredLeads: number;
}

const BATCH = 500;

/**
 * Recovers work left behind by crashes or lost webhooks. Safe to run in every dialer process at
 * once: each step is either routed through the (row-locked, idempotent) call lifecycle with a
 * deterministic event id, or is a single conditional UPDATE.
 *
 * 1. Calls stuck in initiated/ringing (worker died before/after dial, or provider never called
 *    back) → `failed`. The lifecycle then puts the lead back to pending (or failed if attempts
 *    are exhausted).
 * 2. Calls answered but never completed (lost `completed` webhook) → `failed` after
 *    MAX_CALL_MINUTES, which releases the agent — otherwise that agent stays busy forever.
 * 3. Safety net: leads stuck in `dialing` with no active call at all → pending / failed.
 */
export async function reapStuckWork(config: ReaperConfig): Promise<ReaperResult> {
  const stuck = await queryRows<{ providerCallId: string; id: string }>(
    AppDataSource,
    `SELECT id, "providerCallId" FROM calls
     WHERE status IN ('initiated', 'ringing')
       AND "createdAt" < now() - make_interval(mins => $1)
     ORDER BY "createdAt" LIMIT $2`,
    [config.stuckDialingMinutes, BATCH],
  );
  for (const call of stuck) {
    await applyCallEvent({
      eventId: `internal:timeout:${call.id}`,
      providerCallId: call.providerCallId,
      type: CallEventType.Failed,
      occurredAt: new Date(),
      payload: { reason: 'reaper_timeout' },
    });
  }

  const overlong = await queryRows<{ providerCallId: string; id: string }>(
    AppDataSource,
    `SELECT id, "providerCallId" FROM calls
     WHERE status = $1 AND "answeredAt" < now() - make_interval(mins => $2)
     ORDER BY "answeredAt" LIMIT $3`,
    [CallStatus.Answered, config.maxCallMinutes, BATCH],
  );
  for (const call of overlong) {
    await applyCallEvent({
      eventId: `internal:max_duration:${call.id}`,
      providerCallId: call.providerCallId,
      type: CallEventType.Failed,
      occurredAt: new Date(),
      payload: { reason: 'max_call_duration_exceeded' },
    });
  }

  const recovered = await queryRows<{ id: string }>(
    AppDataSource,
    `UPDATE leads l
     SET status = CASE WHEN l.attempts >= c."maxAttempts"
                       THEN 'failed'::lead_status ELSE 'pending'::lead_status END,
         "updatedAt" = now()
     FROM campaigns c
     WHERE c.id = l."campaignId"
       AND l.status = 'dialing'
       AND l."lastAttemptAt" < now() - make_interval(mins => $1)
       AND NOT EXISTS (
         SELECT 1 FROM calls k
         WHERE k."leadId" = l.id AND k.status IN ('initiated', 'ringing', 'answered')
       )
     RETURNING l.id`,
    [config.stuckDialingMinutes],
  );

  const result = {
    timedOutCalls: stuck.length,
    overlongCalls: overlong.length,
    recoveredLeads: recovered.length,
  };
  if (result.timedOutCalls || result.overlongCalls || result.recoveredLeads) {
    logger.warn(result, 'Reaper recovered stuck work');
  }
  return result;
}
