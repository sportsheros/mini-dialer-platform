import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import pinoHttp from 'pino-http';
import { logger } from '../lib/logger';

const HEADER = 'x-request-id';
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Reuse an upstream request id (e.g. from Nginx/ALB) when it's sane, otherwise mint one. */
function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[HEADER];
  const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

/** Attaches `req.id` and a child logger `req.log` (carrying the request id) to every request. */
export const requestLogger = pinoHttp({
  logger,
  genReqId,
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // Health probes every few seconds would drown the logs.
  autoLogging: { ignore: (req) => req.url === '/health' },
  serializers: {
    req: (req: { id: string; method: string; url: string }) => ({
      id: req.id,
      method: req.method,
      url: req.url,
    }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
});
