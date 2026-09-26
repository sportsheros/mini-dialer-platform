/**
 * PM2 process file for a single EC2 host.  `npm run build` first, then:
 *   pm2 start ecosystem.config.js --env production && pm2 save
 *
 * All three process types are stateless, so each can be scaled independently:
 *  - api:     cluster mode. No sticky sessions needed because the dashboard uses the websocket
 *             transport only, and every instance re-emits Redis pub/sub events to its clients.
 *  - dialer:  N forks are safe — leads are claimed with FOR UPDATE SKIP LOCKED and the CPS budget
 *             lives in Redis, shared by all workers.
 *  - summary: BullMQ workers; add instances (or raise SUMMARY_WORKER_CONCURRENCY) for throughput.
 */
const common = {
  cwd: __dirname,
  env_production: { NODE_ENV: 'production' },
  // Give graceful shutdown (drain HTTP, finish in-flight batch/jobs) time before SIGKILL.
  kill_timeout: 20000,
  max_memory_restart: '512M',
  time: true,
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'dialer-api',
      script: 'dist/server.js',
      exec_mode: 'cluster',
      instances: 2,
    },
    {
      ...common,
      name: 'dialer-worker',
      script: 'dist/workers/dialer.worker.js',
      exec_mode: 'fork',
      instances: 2,
    },
    {
      ...common,
      name: 'summary-worker',
      script: 'dist/workers/summary.worker.js',
      exec_mode: 'fork',
      instances: 1,
    },
  ],
};
