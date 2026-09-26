import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// The ONLY place in the codebase that reads process.env. Everything else imports `env`.
// Jest sets NODE_ENV=test, so tests transparently pick up .env.test.
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
dotenv.config({ path: path.resolve(process.cwd(), envFile), quiet: true });

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().url(),
  DB_POOL_SIZE: z.coerce.number().int().positive().default(20),
  DB_LOGGING: bool.default('false'),
  REDIS_URL: z.string().url(),

  API_KEY: z.string().min(8, 'API_KEY must be at least 8 characters'),
  WEBHOOK_SECRET: z.string().min(8, 'WEBHOOK_SECRET must be at least 8 characters'),

  RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),

  DIALER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  DIALER_BATCH_SIZE: z.coerce.number().int().positive().default(20),
  DIALER_RETRY_DELAY_SEC: z.coerce.number().int().min(0).default(60),
  REAPER_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  STUCK_DIALING_MINUTES: z.coerce.number().int().positive().default(5),
  MAX_CALL_MINUTES: z.coerce.number().int().positive().default(60),

  MOCK_TELEPHONY_WEBHOOK_URL: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined))
    .pipe(z.string().url().optional()),
  MOCK_PROVIDER_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  MOCK_TELEPHONY_SPEED: z.coerce.number().positive().default(1),

  SUMMARY_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  STATS_CACHE_TTL_SEC: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast on boot with a readable list of problems; the logger may not exist yet.
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error(`Invalid environment configuration (${envFile}):\n${problems}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
