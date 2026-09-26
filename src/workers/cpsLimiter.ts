import { CPS_ACQUIRE } from '../lib/lua';
import { redis } from '../lib/redis';

/**
 * Reserves up to `requested` dial slots for the current second out of `maxCps`, shared by all
 * dialer workers through key `cps:{campaignId}:{epochSecond}`. The second is taken from the
 * worker's clock; keep workers NTP-synced (see DECISIONS.md).
 */
export async function acquireDialSlots(
  campaignId: string,
  maxCps: number,
  requested: number,
  nowMs: number = Date.now(),
): Promise<number> {
  if (requested <= 0) return 0;
  const epochSecond = Math.floor(nowMs / 1000);
  const granted = await redis.eval(
    CPS_ACQUIRE,
    1,
    `cps:${campaignId}:${epochSecond}`,
    maxCps,
    requested,
  );
  return Number(granted);
}
