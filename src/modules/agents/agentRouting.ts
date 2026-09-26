import type { EntityManager } from 'typeorm';
import { AgentStatus } from '../../entities';
import { queryRows } from '../../lib/sql';
import { logger } from '../../lib/logger';
import { agentPool } from './agentPool';

/** Bounded so a badly drifted set can't turn one webhook into an unbounded loop. */
const MAX_CLAIM_ATTEMPTS = 5;

/**
 * Claims a free agent for a call, inside the caller's DB transaction.
 *
 * Two layers:
 *  1. `SPOP agents:available` — atomic in Redis, so two concurrent answers never pop the same id.
 *  2. `UPDATE agents SET status='busy' WHERE id=$1 AND status='available'` — the real guarantee.
 *     If Redis ever drifted (stale id, agent went offline in between), the row doesn't match, we
 *     drop that id (it is not free, so it must not go back in the set) and try the next one.
 *
 * `onPopped` is invoked immediately after each SPOP so the caller can track the id for
 * compensation even if the following UPDATE throws.
 */
export async function claimAgent(
  manager: EntityManager,
  onPopped: (agentId: string | null) => void,
): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const candidate = await agentPool.claim();
    onPopped(candidate);
    if (!candidate) return null;

    const rows = await queryRows<unknown>(
      manager,
      `UPDATE agents SET status = $2, "updatedAt" = now()
       WHERE id = $1 AND status = $3
       RETURNING id`,
      [candidate, AgentStatus.Busy, AgentStatus.Available],
    );
    if (rows.length === 1) return candidate;

    logger.warn({ agentId: candidate }, 'Popped agent is not available in DB; dropping stale id');
    onPopped(null);
  }
  return null;
}

/**
 * Marks an agent available again inside the caller's transaction. Returns true if it was busy.
 * The caller adds it back to Redis only AFTER commit (DB first, then Redis).
 */
export async function releaseAgent(manager: EntityManager, agentId: string): Promise<boolean> {
  const rows = await queryRows<unknown>(
    manager,
    `UPDATE agents SET status = $2, "updatedAt" = now()
     WHERE id = $1 AND status = $3
     RETURNING id`,
    [agentId, AgentStatus.Available, AgentStatus.Busy],
  );
  return rows.length === 1;
}
