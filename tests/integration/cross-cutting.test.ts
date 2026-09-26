import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../src/middlewares/errorHandler';
import { rateLimit } from '../../src/middlewares/rateLimit';
import { useIntegration } from '../helpers/integration';

describe('cross-cutting concerns', () => {
  const ctx = useIntegration();

  it('GET /health reports DB and Redis status without auth', async () => {
    const res = await request(ctx.app()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data.checks).toEqual({ database: 'up', redis: 'up' });
  });

  it('propagates / generates X-Request-Id', async () => {
    const res = await request(ctx.app()).get('/health').set('X-Request-Id', 'trace-abc-123');
    expect(res.headers['x-request-id']).toBe('trace-abc-123');
    const generated = await request(ctx.app()).get('/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns 429 once the per-IP window is exhausted (shared Redis counter)', async () => {
    const app = express();
    app.use(rateLimit({ windowSec: 60, max: 3 }));
    app.get('/', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await request(app).get('/')).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);

    const limited = await request(app).get('/');
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('returns a clean 400 for malformed JSON and 404 envelope for unknown routes', async () => {
    const bad = await request(ctx.app())
      .post('/api/agents')
      .set('X-API-Key', 'test-api-key')
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });

    const missing = await request(ctx.app()).get('/api/unknown').set('X-API-Key', 'test-api-key');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });
});
