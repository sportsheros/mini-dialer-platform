import 'reflect-metadata';
import { env } from '../config/env';
import { AppDataSource } from '../db/data-source';
import { logger } from '../lib/logger';
import { closeQueues } from '../lib/queue';
import { redis } from '../lib/redis';
import type { TelephonyProvider } from '../providers/telephony';
import { MockTelephonyProvider } from '../providers/telephony.mock';
import { runDialerTick } from './dialer';
import { reapStuckWork } from './reaper';

export interface DialerHandle {
  stop(): Promise<void>;
}

/**
 * Runs the dial loop and the reaper on timers. Uses setTimeout chaining (not setInterval), so a
 * slow tick never overlaps with the next one inside the same process.
 */
export function startDialer(telephony: TelephonyProvider): DialerHandle {
  let stopped = false;
  let current: Promise<unknown> = Promise.resolve();
  let tickTimer: NodeJS.Timeout | undefined;
  let reaperTimer: NodeJS.Timeout | undefined;

  const loop = (name: string, intervalMs: number, fn: () => Promise<unknown>) => {
    const run = async () => {
      if (stopped) return;
      current = fn().catch((err: unknown) => logger.error({ err }, `${name} failed`));
      await current;
      if (stopped) return;
      const timer = setTimeout(run, intervalMs);
      if (name === 'dialer tick') tickTimer = timer;
      else reaperTimer = timer;
    };
    void run();
  };

  loop('dialer tick', env.DIALER_POLL_INTERVAL_MS, () =>
    runDialerTick(telephony, {
      batchSize: env.DIALER_BATCH_SIZE,
      retryDelaySec: env.DIALER_RETRY_DELAY_SEC,
    }),
  );
  loop('reaper', env.REAPER_INTERVAL_MS, () =>
    reapStuckWork({
      stuckDialingMinutes: env.STUCK_DIALING_MINUTES,
      maxCallMinutes: env.MAX_CALL_MINUTES,
    }),
  );

  return {
    async stop() {
      stopped = true;
      clearTimeout(tickTimer);
      clearTimeout(reaperTimer);
      await current; // let the in-flight batch finish so no claimed lead is left undialed
    },
  };
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const telephony = new MockTelephonyProvider({
    webhookUrl: env.MOCK_TELEPHONY_WEBHOOK_URL,
    webhookSecret: env.WEBHOOK_SECRET,
    speed: env.MOCK_TELEPHONY_SPEED,
    dialFailureRate: 0.02,
  });
  const dialer = startDialer(telephony);
  logger.info(
    { pollMs: env.DIALER_POLL_INTERVAL_MS, webhook: env.MOCK_TELEPHONY_WEBHOOK_URL ?? 'disabled' },
    'Dialer worker started',
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Dialer worker shutting down');
    await dialer.stop();
    await telephony.close();
    await closeQueues();
    await AppDataSource.destroy();
    await redis.quit();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (require.main === module) {
  main().catch((err: unknown) => {
    logger.fatal({ err }, 'Dialer worker failed to start');
    process.exit(1);
  });
}
