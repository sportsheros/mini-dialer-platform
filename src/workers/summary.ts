import { AppDataSource } from '../db/data-source';
import { Call, CallStatus } from '../entities';
import { logger } from '../lib/logger';
import { publish } from '../lib/realtime';
import { queryRows } from '../lib/sql';
import { toRealtimeCall } from '../modules/calls/callLifecycle.service';
import { statsCache } from '../modules/stats/stats.cache';
import type { LlmProvider, SttProvider } from '../providers/ai';

export interface SummaryDeps {
  stt: SttProvider;
  llm: LlmProvider;
}

export type SummaryResult =
  | { status: 'summarized'; qaScore: number }
  | { status: 'skipped'; reason: 'not_found' | 'already_summarized' | 'not_eligible' };

const ELIGIBLE: readonly CallStatus[] = [CallStatus.Completed, CallStatus.Failed];

/**
 * Idempotent job body. Can run any number of times for the same call (retries, a stalled job
 * re-run after a worker crash, or a duplicate enqueue) and the end state is the same:
 *  - skip if the summary already exists;
 *  - the transcript is persisted as soon as we have it, so a retry after an LLM failure does not
 *    pay for STT again;
 *  - the final write is conditional (`WHERE summary IS NULL`), so two racing runs can't both win.
 * Throwing lets BullMQ retry with exponential backoff.
 */
export async function processSummaryJob(callId: string, deps: SummaryDeps): Promise<SummaryResult> {
  const repo = AppDataSource.getRepository(Call);
  const call = await repo.findOneBy({ id: callId });
  if (!call) return { status: 'skipped', reason: 'not_found' };
  if (call.summary) return { status: 'skipped', reason: 'already_summarized' };
  if (!ELIGIBLE.includes(call.status) || !call.answeredAt) {
    return { status: 'skipped', reason: 'not_eligible' };
  }

  let transcript = call.transcript;
  if (!transcript) {
    transcript = await deps.stt.transcribe({ callId, durationSec: call.durationSec });
    await queryRows(
      AppDataSource,
      `UPDATE calls SET transcript = $2, version = version + 1, "updatedAt" = now()
       WHERE id = $1 AND transcript IS NULL`,
      [callId, transcript],
    );
  }

  const analysis = await deps.llm.analyzeCall(transcript);
  const updated = await queryRows<{ id: string }>(
    AppDataSource,
    `UPDATE calls
     SET summary = $2, "qaScore" = $3, "qaFlags" = $4::jsonb,
         version = version + 1, "updatedAt" = now()
     WHERE id = $1 AND summary IS NULL
     RETURNING id`,
    [callId, analysis.summary, analysis.qaScore, JSON.stringify(analysis.flags)],
  );
  if (updated.length === 0) return { status: 'skipped', reason: 'already_summarized' };

  const saved = await repo.findOneByOrFail({ id: callId });
  await statsCache.invalidate(saved.campaignId);
  publish('call:updated', toRealtimeCall(saved, null));
  logger.info({ callId, qaScore: analysis.qaScore, flags: analysis.flags }, 'Call summarized');
  return { status: 'summarized', qaScore: analysis.qaScore };
}
