import 'reflect-metadata';
import http from 'node:http';
import { env } from './config/env';
import { AppDataSource } from './db/data-source';
import { logger } from './lib/logger';
import { closeQueues } from './lib/queue';
import { redis } from './lib/redis';
import { initSocket } from './lib/socket';
import { agentPool } from './modules/agents/agentPool';
import { createApp } from './app';

async function main(): Promise<void> {
  // Boot order: env (validated on import) → DB → Redis → HTTP.
  await AppDataSource.initialize();
  logger.info('Database connected');
  await redis.ping();
  logger.info('Redis connected');
  // Redis is a derived cache of agent availability: rebuild it from the source of truth.
  await agentPool.rebuildFromDb();

  const app = createApp();
  const server = http.createServer(app);
  const realtime = await initSocket(server);
  await new Promise<void>((resolve) => server.listen(env.PORT, resolve));
  logger.info({ port: env.PORT }, 'HTTP server listening');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');
    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 15_000);
    forceExit.unref();
    try {
      // 1. Stop accepting new connections and let in-flight requests finish.
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      await realtime.close(); // also disconnects websocket clients so server.close can finish
      await closed;
      // 2. Close the queue producer, then datastores last, after nothing can use them anymore.
      await closeQueues();
      await AppDataSource.destroy();
      await redis.quit();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
