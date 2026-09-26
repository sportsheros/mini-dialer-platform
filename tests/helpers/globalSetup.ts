import 'reflect-metadata';

/**
 * Runs once before all test files: recreates the test schema from the real migrations,
 * so tests exercise exactly the schema production gets (never `synchronize`).
 */
export default async function globalSetup(): Promise<void> {
  process.env.NODE_ENV = 'test';
  const { AppDataSource } = await import('../../src/db/data-source');
  const { redis } = await import('../../src/lib/redis');
  await AppDataSource.initialize();
  await AppDataSource.dropDatabase();
  await AppDataSource.runMigrations();
  await AppDataSource.destroy();
  await redis.flushdb();
  await redis.quit();
}
