/**
 * Lua scripts run atomically inside Redis (no other command interleaves), which is what makes
 * "read-check-write" sequences safe across many API/worker processes.
 * Kept as TS strings so they ship with `tsc` output without a copy step.
 */

/**
 * Fixed-window counter. INCR + EXPIRE in one step so a crash between the two can never leave
 * a counter without a TTL (which would block that IP forever).
 * KEYS[1] = counter key, ARGV[1] = window seconds. Returns the new count.
 */
export const RATE_LIMIT_INCR = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return current
`;

/**
 * CPS token grant. Atomically reserves up to ARGV[2] dial slots out of a per-second budget of
 * ARGV[1]. Returns how many were granted (0..requested). Multiple dialer workers share the
 * same key, so the campaign-wide CPS cap holds no matter how many workers run.
 * KEYS[1] = cps:{campaignId}:{epochSecond}
 */
export const CPS_ACQUIRE = `
local max = tonumber(ARGV[1])
local requested = tonumber(ARGV[2])
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local available = max - used
if available <= 0 then
  return 0
end
local granted = math.min(available, requested)
redis.call('INCRBY', KEYS[1], granted)
redis.call('EXPIRE', KEYS[1], 2)
return granted
`;
