import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { UnauthorizedError } from '../errors/AppError';
import { SIGNATURE_HEADER, verifySignature } from '../lib/signature';

/**
 * Webhooks don't carry our API key; instead the provider signs the exact raw body with a shared
 * secret. Verifying the raw bytes (captured by express.json's `verify` hook) matters: re-serialising
 * the parsed JSON could reorder keys or change whitespace and break the HMAC.
 */
export const verifyWebhookSignature: RequestHandler = (req, _res, next) => {
  if (!verifySignature(req.rawBody, req.header(SIGNATURE_HEADER), env.WEBHOOK_SECRET)) {
    next(new UnauthorizedError('Invalid or missing X-Signature'));
    return;
  }
  next();
};
