import type { RequestHandler } from 'express';
import { env } from '../config/env';

export const allowedOrigins = env.CORS_ORIGIN.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/** Minimal CORS for the dashboard; avoids a dependency for ~10 lines of logic. */
export const cors: RequestHandler = (req, res, next) => {
  const origin = req.header('origin');
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-API-Key,X-Request-Id');
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id,X-RateLimit-Remaining');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
};
