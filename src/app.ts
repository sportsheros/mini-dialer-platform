import express, { type Express, Router } from 'express';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { apiKeyAuth } from './middlewares/auth';
import { cors } from './middlewares/cors';
import { rateLimit } from './middlewares/rateLimit';
import { requestLogger } from './middlewares/requestId';
import { agentsRouter } from './modules/agents/agents.routes';
import { campaignsRouter } from './modules/campaigns/campaigns.routes';
import { dncRouter } from './modules/dnc/dnc.routes';
import { healthRouter } from './modules/health/health.routes';

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

  const api = Router();
  api.use('/agents', agentsRouter);
  api.use('/campaigns', campaignsRouter);
  api.use('/dnc', dncRouter);
  app.use('/api', rateLimit(), apiKeyAuth, api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
