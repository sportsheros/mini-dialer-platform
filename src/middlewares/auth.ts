import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { UnauthorizedError } from '../errors/AppError';

// Compare fixed-length digests so neither content nor length leaks through timing.
const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
const expected = digest(env.API_KEY);

/** Simple shared API key for /api/* (webhooks are authenticated by HMAC instead). */
export const apiKeyAuth: RequestHandler = (req, _res, next) => {
  const provided = req.header('x-api-key');
  if (!provided || !timingSafeEqual(digest(provided), expected)) {
    next(new UnauthorizedError('Missing or invalid X-API-Key header'));
    return;
  }
  next();
};
