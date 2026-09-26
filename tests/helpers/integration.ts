import 'reflect-metadata';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/app';
import { AppDataSource } from '../../src/db/data-source';
import { env } from '../../src/config/env';
import { redis } from '../../src/lib/redis';

/**
 * Registers per-file lifecycle hooks for tests that need real Postgres + Redis.
 * Every test starts from empty tables and an empty Redis DB.
 */
export function useIntegration(): { app: () => Express } {
  let app: Express;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    app = createApp();
  });

  beforeEach(async () => {
    await resetState();
  });

  afterAll(async () => {
    await closeConnections();
  });

  return { app: () => app };
}

export async function resetState(): Promise<void> {
  await AppDataSource.query(
    'TRUNCATE TABLE call_events, calls, leads, campaigns, agents, dnc_numbers RESTART IDENTITY CASCADE',
  );
  await redis.flushdb();
}

export async function closeConnections(): Promise<void> {
  // Imported lazily so files that never touch the queue don't open a BullMQ connection.
  const { closeQueues } = await import('../../src/lib/queue');
  await closeQueues();
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  await redis.quit();
}

export const API_KEY = env.API_KEY;

/** Supertest agent with the API key pre-applied. */
export function api(app: Express) {
  return {
    get: (url: string) => request(app).get(url).set('X-API-Key', API_KEY),
    post: (url: string) => request(app).post(url).set('X-API-Key', API_KEY),
    patch: (url: string) => request(app).patch(url).set('X-API-Key', API_KEY),
    delete: (url: string) => request(app).delete(url).set('X-API-Key', API_KEY),
  };
}
