import { Router } from 'express';
import { pingDatabase } from '../../db/data-source';
import { asyncHandler } from '../../lib/http';
import { pingRedis } from '../../lib/redis';

const CHECK_TIMEOUT_MS = 2_000;

function withTimeout(check: Promise<boolean>): Promise<boolean> {
  return Promise.race([
    check,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), CHECK_TIMEOUT_MS).unref()),
  ]);
}

export const healthRouter = Router();

// Unauthenticated on purpose: used by load balancers / PM2 / uptime checks.
healthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const [database, redis] = await Promise.all([
      withTimeout(pingDatabase()),
      withTimeout(pingRedis()),
    ]);
    const healthy = database && redis;
    res.status(healthy ? 200 : 503).json({
      success: healthy,
      data: {
        status: healthy ? 'ok' : 'degraded',
        checks: { database: database ? 'up' : 'down', redis: redis ? 'up' : 'down' },
        uptimeSec: Math.round(process.uptime()),
      },
    });
  }),
);
