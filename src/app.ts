import express, { type Express, Router } from 'express';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { apiKeyAuth } from './middlewares/auth';
import { cors } from './middlewares/cors';
import { rateLimit } from './middlewares/rateLimit';
import { requestLogger } from './middlewares/requestId';
import { agentsRouter } from './modules/agents/agents.routes';
import { callsRouter } from './modules/calls/calls.routes';
import { campaignsRouter } from './modules/campaigns/campaigns.routes';
import { dncRouter } from './modules/dnc/dnc.routes';
import { healthRouter } from './modules/health/health.routes';
import { webhooksRouter } from './modules/webhooks/webhooks.routes';

/** Builds the Express app without listening, so tests can drive it with Supertest. */
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  // Behind Nginx / an ALB: trust the first proxy hop so req.ip is the real client IP.
  app.set('trust proxy', 1);

  app.use(requestLogger);
  app.use(cors);
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      },
    }),
  );

  app.use(healthRouter);

  // Webhooks authenticate with an HMAC signature instead of the API key, and are exempt from the
  // per-IP limit: a provider sends all traffic from a few IPs, and throttling it would just
  // cause retries. Mounted before the `/api` stack so that stack never sees them.
  app.use('/api/webhooks', webhooksRouter);

  const api = Router();
  api.use('/agents', agentsRouter);
  api.use('/campaigns', campaignsRouter);
  api.use('/dnc', dncRouter);
  api.use('/calls', callsRouter);
  app.use('/api', rateLimit(), apiKeyAuth, api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
