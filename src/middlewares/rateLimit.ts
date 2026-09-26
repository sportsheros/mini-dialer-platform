import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { RateLimitError } from '../errors/AppError';
import { logger } from '../lib/logger';
import { RATE_LIMIT_INCR } from '../lib/lua';
import { redis, redisKeys } from '../lib/redis';

interface RateLimitOptions {
  windowSec: number;
  max: number;
}

/**
 * Redis-backed fixed-window limiter, per client IP. Shared by every API instance, so the limit
 * is global rather than per-process. Fails OPEN if Redis is unreachable: a cache outage should
 * degrade protection, not take the whole API down (documented in DECISIONS.md).
 */
export function rateLimit(
  { windowSec, max }: RateLimitOptions = {
    windowSec: env.RATE_LIMIT_WINDOW_SEC,
    max: env.RATE_LIMIT_MAX,
  },
): RequestHandler {
  return (req, res, next) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const windowStart = nowSec - (nowSec % windowSec);
    const key = redisKeys.rateLimit(req.ip ?? 'unknown', windowStart);

    redis
      .eval(RATE_LIMIT_INCR, 1, key, windowSec)
      .then((result) => {
        const count = Number(result);
        const remaining = Math.max(0, max - count);
        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', remaining);
        res.setHeader('X-RateLimit-Reset', windowStart + windowSec);
        if (count > max) {
          res.setHeader('Retry-After', windowStart + windowSec - nowSec);
          next(new RateLimitError());
          return;
        }
        next();
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Rate limiter unavailable, failing open');
        next();
      });
  };
}
