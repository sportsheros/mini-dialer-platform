import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { redis, redisKeys } from '../../lib/redis';

/**
 * Cache-aside helpers for campaign stats. Cache failures are logged and swallowed: the cache is
 * an optimisation, so a Redis hiccup must degrade to "compute from Postgres", never to an error.
 */
export const statsCache = {
  async get<T>(campaignId: string): Promise<T | null> {
    try {
      const raw = await redis.get(redisKeys.campaignStats(campaignId));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      logger.warn({ err, campaignId }, 'Stats cache read failed');
      return null;
    }
  },

  async set(campaignId: string, value: unknown): Promise<void> {
    try {
      await redis.set(
        redisKeys.campaignStats(campaignId),
        JSON.stringify(value),
        'EX',
        env.STATS_CACHE_TTL_SEC,
      );
    } catch (err) {
      logger.warn({ err, campaignId }, 'Stats cache write failed');
    }
  },

  async invalidate(campaignId: string): Promise<void> {
    try {
      await redis.del(redisKeys.campaignStats(campaignId));
    } catch (err) {
      logger.warn({ err, campaignId }, 'Stats cache invalidation failed');
    }
  },
};
