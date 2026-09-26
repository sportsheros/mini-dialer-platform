import 'reflect-metadata';
import http from 'node:http';
import { env } from './config/env';
import { AppDataSource } from './db/data-source';
import { logger } from './lib/logger';
import { redis } from './lib/redis';
import { createApp } from './app';

async function main(): Promise<void> {
  // Boot order: env (validated on import) → DB → Redis → HTTP.
  await AppDataSource.initialize();
  logger.info('Database connected');
  await redis.ping();
  logger.info('Redis connected');

  const app = createApp();
  const server = http.createServer(app);
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
      await new Promise<void>((resolve) => server.close(() => resolve()));
      // 2. Close datastores last, after nothing can use them anymore.
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
