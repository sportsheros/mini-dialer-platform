import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../db/data-source';
import { Agent, AgentStatus } from '../../entities';
import { logger } from '../../lib/logger';
import { redis, redisKeys } from '../../lib/redis';

/**
 * Redis mirror of "which agents are free right now" (SET agents:available).
 *
 * Rules that keep it honest:
 *  - Postgres is the source of truth; this set is a derived cache used for O(1) atomic claims.
 *  - Always write the DB first, then Redis.
 *  - A claim from Redis is only a *candidate*. The routing code confirms it with a conditional
 *    `UPDATE agents SET status='busy' WHERE status='available'` in the same transaction as the
 *    call update, so even if the set drifts an agent can never be assigned twice.
 */
export const agentPool = {
  async add(agentId: string): Promise<void> {
    await redis.sadd(redisKeys.availableAgents, agentId);
  },

  async remove(agentId: string): Promise<void> {
    await redis.srem(redisKeys.availableAgents, agentId);
  },

  /** Atomically removes and returns one random free agent id, or null if none is free. */
  async claim(): Promise<string | null> {
    return redis.spop(redisKeys.availableAgents);
  },

  async size(): Promise<number> {
    return redis.scard(redisKeys.availableAgents);
  },

  async members(): Promise<string[]> {
    return redis.smembers(redisKeys.availableAgents);
  },

  /**
   * Rebuilds the set from Postgres. Run on API boot. DEL + SADD go in one MULTI so readers
   * never observe a half-built set.
   */
  async rebuildFromDb(manager: EntityManager = AppDataSource.manager): Promise<number> {
    const rows = await manager.find(Agent, {
      select: { id: true },
      where: { status: AgentStatus.Available },
    });
    const ids = rows.map((r) => r.id);
    const tx = redis.multi().del(redisKeys.availableAgents);
    if (ids.length > 0) tx.sadd(redisKeys.availableAgents, ...ids);
    await tx.exec();
    logger.info({ available: ids.length }, 'Rebuilt agents:available from database');
    return ids.length;
  },
};
