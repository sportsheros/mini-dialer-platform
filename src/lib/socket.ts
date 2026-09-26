import type http from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { allowedOrigins } from '../middlewares/cors';
import { logger } from './logger';
import type { RealtimeMessage } from './realtime';
import { createRedis, redisKeys } from './redis';

export interface RealtimeServer {
  close(): Promise<void>;
}

/**
 * Attaches Socket.IO to the HTTP server and bridges the Redis pub/sub channel to it.
 * A dedicated Redis connection is required because a subscribed connection can't run
 * normal commands (RESP2).
 */
export async function initSocket(server: http.Server): Promise<RealtimeServer> {
  const io = new Server(server, {
    cors: { origin: allowedOrigins },
    serveClient: false,
  });

  // Same shared API key as REST. Sent by the dashboard in the handshake `auth` payload.
  io.use((socket, next) => {
    const auth = socket.handshake.auth as { apiKey?: unknown } | undefined;
    if (auth?.apiKey === env.API_KEY) return next();
    next(new Error('unauthorized'));
  });

  io.on('connection', (socket) => {
    logger.debug({ socketId: socket.id }, 'Socket connected');
  });

  const subscriber = createRedis('realtime-subscriber');
  subscriber.on('message', (_channel: string, raw: string) => {
    try {
      const { event, payload } = JSON.parse(raw) as RealtimeMessage;
      io.emit(event, payload);
    } catch (err) {
      logger.warn({ err }, 'Dropping malformed realtime message');
    }
  });
  await subscriber.subscribe(redisKeys.realtimeChannel);

  return {
    async close() {
      await subscriber.quit().catch(() => undefined);
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
