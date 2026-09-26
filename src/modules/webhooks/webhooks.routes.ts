import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { validate } from '../../middlewares/validate';
import { verifyWebhookSignature } from '../../middlewares/verifyWebhookSignature';
import { webhooksController } from './webhooks.controller';
import { callEventWebhookSchema } from './webhooks.schema';

export const webhooksRouter = Router();

// Signature is checked BEFORE validation so unauthenticated callers learn nothing about the schema.
webhooksRouter.post(
  '/call-events',
  verifyWebhookSignature,
  validate({ body: callEventWebhookSchema }),
  asyncHandler(webhooksController.callEvent),
);
