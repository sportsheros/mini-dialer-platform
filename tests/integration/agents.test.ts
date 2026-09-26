import { AppDataSource } from '../../src/db/data-source';
import { Agent, AgentStatus } from '../../src/entities';
import { redis, redisKeys } from '../../src/lib/redis';
import { agentPool } from '../../src/modules/agents/agentPool';
import { api, useIntegration } from '../helpers/integration';

describe('Agents API', () => {
  const ctx = useIntegration();

  async function createAgent(email = 'a@example.com') {
    const res = await api(ctx.app()).post('/api/agents').send({ name: 'Agent A', email });
    expect(res.status).toBe(201);
    return res.body.data as Agent;
  }

  it('rejects requests without a valid API key', async () => {
    const { default: request } = await import('supertest');
    const res = await request(ctx.app()).get('/api/agents').set('X-API-Key', 'wrong-key');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'UNAUTHORIZED', message: expect.any(String) },
    });
  });

  it('creates an agent (offline by default) and rejects duplicate emails with 409', async () => {
    const agent = await createAgent();
    expect(agent.status).toBe(AgentStatus.Offline);

    const dup = await api(ctx.app())
      .post('/api/agents')
      .send({ name: 'Other', email: 'A@EXAMPLE.com' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
  });

  it('validates the body and returns 400 with details', async () => {
    const res = await api(ctx.app()).post('/api/agents').send({ name: '', email: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(2);
  });

  it('lists agents with pagination meta and gets one by id (404 when missing)', async () => {
    await createAgent('a@example.com');
    const b = await createAgent('b@example.com');

    const list = await api(ctx.app()).get('/api/agents?page=1&limit=1');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta).toEqual({ page: 1, limit: 1, total: 2 });

    const one = await api(ctx.app()).get(`/api/agents/${b.id}`);
    expect(one.body.data.email).toBe('b@example.com');

    const missing = await api(ctx.app()).get('/api/agents/7f1c1d2e-8a1b-4c3d-9e8f-0a1b2c3d4e5f');
    expect(missing.status).toBe(404);
  });

  it('mirrors availability into the Redis set (DB first, then Redis)', async () => {
    const agent = await createAgent();

    const on = await api(ctx.app())
      .patch(`/api/agents/${agent.id}/status`)
      .send({ status: 'available' });
    expect(on.status).toBe(200);
    expect(on.body.data.status).toBe('available');
    expect(await redis.sismember(redisKeys.availableAgents, agent.id)).toBe(1);

    const off = await api(ctx.app())
      .patch(`/api/agents/${agent.id}/status`)
      .send({ status: 'offline' });
    expect(off.body.data.status).toBe('offline');
    expect(await redis.sismember(redisKeys.availableAgents, agent.id)).toBe(0);
  });

  it('refuses to set a busy agent offline (409) and never accepts busy from clients', async () => {
    const agent = await createAgent();
    await AppDataSource.getRepository(Agent).update(agent.id, { status: AgentStatus.Busy });

    const res = await api(ctx.app())
      .patch(`/api/agents/${agent.id}/status`)
      .send({ status: 'offline' });
    expect(res.status).toBe(409);

    const busy = await api(ctx.app())
      .patch(`/api/agents/${agent.id}/status`)
      .send({ status: 'busy' });
    expect(busy.status).toBe(400);
  });

  it('rebuilds agents:available from the database', async () => {
    const a = await createAgent('a@example.com');
    const b = await createAgent('b@example.com');
    await AppDataSource.getRepository(Agent).update(a.id, { status: AgentStatus.Available });
    await redis.sadd(redisKeys.availableAgents, b.id, 'stale-id');

    await agentPool.rebuildFromDb();
    expect((await agentPool.members()).sort()).toEqual([a.id]);
  });
});
