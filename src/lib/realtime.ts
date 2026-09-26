import { logger } from './logger';
import { redis, redisKeys } from './redis';

export type RealtimeEvent = 'agent:updated' | 'call:updated' | 'campaign:updated';

export interface RealtimeMessage {
  event: RealtimeEvent;
  payload: unknown;
}

/**
 * Publishes a live-update event. API processes AND worker processes call this; every API
 * instance subscribes to the channel and re-emits to its own Socket.IO clients (see socket.ts).
 * Fire-and-forget: a missed dashboard update must never fail a business operation.
 */
export function publish(event: RealtimeEvent, payload: unknown): void {
  const message: RealtimeMessage = { event, payload };
  redis.publish(redisKeys.realtimeChannel, JSON.stringify(message)).catch((err: unknown) => {
    logger.warn({ err, event }, 'Failed to publish realtime event');
  });
}
