import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'mini-dialer' },
  redact: {
    paths: ['req.headers["x-api-key"]', 'req.headers["x-signature"]', 'req.headers.authorization'],
    censor: '[redacted]',
  },
  // Human-friendly logs locally; plain JSON everywhere else (log shippers parse it).
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } }
      : undefined,
});

export type Logger = typeof logger;
