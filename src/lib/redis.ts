import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';

/** Every Redis key the app uses lives here, so the keyspace is documented in one place. */
export const redisKeys = {
  /** SET of agent ids that are free to take a call. Derived cache; Postgres is the truth. */
  availableAgents: 'agents:available',
  /** Per-campaign, per-second dial counter for CPS limiting. */
  cps: (campaignId: string, epochSecond: number) => `cps:${campaignId}:${epochSecond}`,
  /** Cache-aside entry for campaign stats. */
  campaignStats: (campaignId: string) => `stats:campaign:${campaignId}`,
  /** Fixed-window API rate-limit counter. */
  rateLimit: (ip: string, windowStart: number) => `ratelimit:${ip}:${windowStart}`,
  /** Pub/Sub channel bridging worker processes to the Socket.IO server. */
  realtimeChannel: 'realtime:events',
} as const;

/**
 * Creates a new connection. BullMQ requires `maxRetriesPerRequest: null` on the connections it
 * uses for blocking commands, so callers that hand the client to BullMQ pass that override.
 */
export function createRedis(name: string, overrides: RedisOptions = {}): Redis {
  const client = new Redis(env.REDIS_URL, {
    connectionName: `mini-dialer:${name}`,
    // Keep v5 wire protocol: behaves identically on Redis 6/7 and on managed ElastiCache.
    protocol: 2,
    ...overrides,
  });
  client.on('error', (err) => logger.error({ err, connection: name }, 'Redis connection error'));
  return client;
}

/** Shared client for normal commands (cache, sets, rate limiting, publishing). */
export const redis = createRedis('main');

export async function pingRedis(): Promise<boolean> {
  try {
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}
