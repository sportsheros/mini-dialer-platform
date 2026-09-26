import 'reflect-metadata';
import path from 'node:path';
import { DataSource } from 'typeorm';
import { env } from '../config/env';
import { entities } from '../entities';

/**
 * Single DataSource used by the API, workers, scripts, tests AND the TypeORM CLI
 * (`npm run migration:*` points at this file).
 * `synchronize` is permanently off: schema changes only happen through reviewed migrations.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: env.DATABASE_URL,
  entities,
  migrations: [path.join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
  migrationsRun: false,
  // Query errors are already surfaced by our error handler / callers (many are expected, e.g.
  // unique violations we map to 409), so TypeORM's own error logging would only add noise.
  logging: env.DB_LOGGING ? ['query', 'error'] : false,
  extra: {
    max: env.DB_POOL_SIZE,
    // Fail a checkout instead of hanging forever if the pool is exhausted.
    connectionTimeoutMillis: 10_000,
    // Guard against runaway queries holding locks.
    statement_timeout: 30_000,
    application_name: 'mini-dialer',
  },
});

export async function pingDatabase(): Promise<boolean> {
  try {
    await AppDataSource.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
