import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { env } from '../../src/config/env';
import { signPayload } from '../../src/lib/signature';

export interface WebhookBody {
  eventId?: string;
  providerCallId: string;
  type: 'ringing' | 'answered' | 'completed' | 'no_answer' | 'failed';
  timestamp?: string;
  payload?: Record<string, unknown>;
}

/** Sends a correctly signed webhook, exactly like the telephony provider would. */
export function sendWebhook(app: Express, body: WebhookBody, secret = env.WEBHOOK_SECRET) {
  const raw = JSON.stringify({
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    ...body,
  });
  return request(app)
    .post('/api/webhooks/call-events')
    .set('Content-Type', 'application/json')
    .set('X-Signature', signPayload(raw, secret))
    .send(raw);
}
