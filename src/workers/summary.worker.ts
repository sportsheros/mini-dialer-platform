import 'reflect-metadata';
import { type Job, Worker } from 'bullmq';
import { env } from '../config/env';
import { AppDataSource } from '../db/data-source';
import { logger } from '../lib/logger';
import { SUMMARY_QUEUE, type SummaryJobData } from '../lib/queue';
import { createRedis, redis } from '../lib/redis';
import { MockLlmProvider } from '../providers/llm.mock';
import { MockSttProvider } from '../providers/stt.mock';
import { processSummaryJob, type SummaryDeps, type SummaryResult } from './summary';

/**
 * BullMQ worker for `call-summary`. If this process dies mid-job, the job's lock stops being
 * renewed; BullMQ's stalled-job check moves it back to `wait` and another worker re-runs it.
 * That is safe because processSummaryJob is idempotent.
 */
export function startSummaryWorker(
  deps: SummaryDeps,
  concurrency = env.SUMMARY_WORKER_CONCURRENCY,
) {
  const connection = createRedis('bullmq-worker', { maxRetriesPerRequest: null });
  const worker = new Worker<SummaryJobData, SummaryResult>(
    SUMMARY_QUEUE,
    (job: Job<SummaryJobData>) => processSummaryJob(job.data.callId, deps),
    { connection, concurrency },
  );

  worker.on('completed', (job, result) =>
    logger.debug({ jobId: job.id, result }, 'Summary job completed'),
  );
  worker.on('failed', (job, err) => {
    const attemptsLeft = (job?.opts.attempts ?? 1) - (job?.attemptsMade ?? 0);
    const log = attemptsLeft > 0 ? logger.warn.bind(logger) : logger.error.bind(logger);
    log(
      { jobId: job?.id, attemptsMade: job?.attemptsMade, attemptsLeft, err: err.message },
      attemptsLeft > 0 ? 'Summary job failed, will retry' : 'Summary job failed permanently',
    );
  });
  worker.on('error', (err) => logger.error({ err }, 'Summary worker error'));

  return {
    worker,
    async close() {
      await worker.close(); // waits for in-flight jobs to finish
      await connection.quit().catch(() => undefined);
    },
  };
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const failureRate = env.MOCK_PROVIDER_FAILURE_RATE;
  const handle = startSummaryWorker({
    stt: new MockSttProvider({ failureRate }),
    llm: new MockLlmProvider({ failureRate }),
  });
  logger.info(
    { concurrency: env.SUMMARY_WORKER_CONCURRENCY, failureRate },
    'Summary worker started',
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Summary worker shutting down');
    await handle.close();
    await AppDataSource.destroy();
    await redis.quit();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (require.main === module) {
  main().catch((err: unknown) => {
    logger.fatal({ err }, 'Summary worker failed to start');
    process.exit(1);
  });
}
