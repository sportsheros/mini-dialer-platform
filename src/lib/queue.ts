import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { logger } from './logger';
import { createRedis } from './redis';

export const SUMMARY_QUEUE = 'call-summary';

export interface SummaryJobData {
  callId: string;
}

let connection: Redis | undefined;
let summaryQueue: Queue<SummaryJobData> | undefined;

/** Created lazily so processes that never enqueue don't hold an extra Redis connection. */
export function getSummaryQueue(): Queue<SummaryJobData> {
  if (!summaryQueue) {
    // BullMQ requires maxRetriesPerRequest: null on its connections.
    connection = createRedis('bullmq-producer', { maxRetriesPerRequest: null });
    summaryQueue = new Queue<SummaryJobData>(SUMMARY_QUEUE, { connection });
  }
  return summaryQueue;
}

/**
 * `jobId = callId` makes enqueueing idempotent: while a job with that id exists (waiting,
 * active, completed-and-retained, or failed-and-retained) BullMQ ignores a second add.
 * The worker is ALSO idempotent (skips calls that already have a summary), which covers the
 * window after a completed job has been removed.
 */
export async function enqueueSummary(callId: string): Promise<void> {
  await getSummaryQueue().add(
    SUMMARY_QUEUE,
    { callId },
    {
      jobId: callId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 24 * 3600, count: 5_000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  );
  logger.debug({ callId }, 'Enqueued call summary job');
}

export async function closeQueues(): Promise<void> {
  if (summaryQueue) await summaryQueue.close();
  if (connection) await connection.quit().catch(() => undefined);
  summaryQueue = undefined;
  connection = undefined;
}
