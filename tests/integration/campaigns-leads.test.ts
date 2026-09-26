import { AppDataSource } from '../../src/db/data-source';
import { Lead, LeadStatus } from '../../src/entities';
import { api, useIntegration } from '../helpers/integration';

describe('Campaigns, leads upload and DNC', () => {
  const ctx = useIntegration();

  async function createCampaign(body: Record<string, unknown> = { name: 'Q3 renewals' }) {
    const res = await api(ctx.app()).post('/api/campaigns').send(body);
    expect(res.status).toBe(201);
    return res.body.data as { id: string; status: string; maxCps: number; maxAttempts: number };
  }

  it('creates a draft campaign with defaults and validates input', async () => {
    const c = await createCampaign();
    expect(c).toMatchObject({ status: 'draft', maxCps: 2, maxAttempts: 3 });

    const bad = await api(ctx.app()).post('/api/campaigns').send({ name: 'x', maxCps: 0 });
    expect(bad.status).toBe(400);
  });

  it('enforces the campaign lifecycle (start/pause, idempotent, 422 on invalid)', async () => {
    const c = await createCampaign();

    const paused = await api(ctx.app()).post(`/api/campaigns/${c.id}/pause`);
    expect(paused.status).toBe(422);
    expect(paused.body.error.code).toBe('INVALID_STATE_TRANSITION');

    const started = await api(ctx.app()).post(`/api/campaigns/${c.id}/start`);
    expect(started.body.data.status).toBe('running');
    const again = await api(ctx.app()).post(`/api/campaigns/${c.id}/start`);
    expect(again.status).toBe(200);

    const del = await api(ctx.app()).delete(`/api/campaigns/${c.id}`);
    expect(del.status).toBe(409);

    await api(ctx.app()).post(`/api/campaigns/${c.id}/pause`).expect(200);
    await api(ctx.app()).delete(`/api/campaigns/${c.id}`).expect(204);
    await api(ctx.app()).get(`/api/campaigns/${c.id}`).expect(404);
  });

  it('upload with duplicates + DNC + invalid numbers returns correct counts', async () => {
    const c = await createCampaign();
    await api(ctx.app())
      .post('/api/dnc')
      .send({ numbers: [{ phone: '+14155550999', reason: 'opt-out' }] })
      .expect(201);

    const first = await api(ctx.app())
      .post(`/api/campaigns/${c.id}/leads`)
      .send([
        { phone: '+14155550100', name: 'Ann' },
        { phone: '+1 (415) 555-0101', name: 'Bob' }, // normalised to +14155550101
        { phone: '+14155550100', name: 'Ann again' }, // duplicate in payload
        { phone: '+14155550999' }, // DNC
        { phone: '4155550102' }, // invalid: no country code
        { phone: 'not-a-number' }, // invalid
      ]);
    expect(first.status).toBe(201);
    expect(first.body.data).toEqual({ inserted: 2, duplicates: 1, dnc: 1, invalid: 2 });

    // Re-upload: everything already exists in the campaign.
    const second = await api(ctx.app())
      .post(`/api/campaigns/${c.id}/leads`)
      .send([{ phone: '+14155550100' }, { phone: '+14155550999' }, { phone: '+14155550103' }]);
    expect(second.body.data).toEqual({ inserted: 1, duplicates: 2, dnc: 0, invalid: 0 });

    const leads = await AppDataSource.getRepository(Lead).find({ where: { campaignId: c.id } });
    expect(leads).toHaveLength(4);
    expect(leads.find((l) => l.phone === '+14155550999')?.status).toBe(LeadStatus.Dnc);
    expect(leads.find((l) => l.phone === '+14155550100')?.name).toBe('Ann');
  });

  it('concurrent uploads of the same numbers never create duplicate leads', async () => {
    const c = await createCampaign();
    const batch = Array.from({ length: 200 }, (_, i) => ({ phone: `+1415555${1000 + i}` }));
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api(ctx.app()).post(`/api/campaigns/${c.id}/leads`).send(batch),
      ),
    );
    const inserted = results.reduce((sum, r) => sum + (r.body.data.inserted as number), 0);
    expect(inserted).toBe(200);
    expect(await AppDataSource.getRepository(Lead).countBy({ campaignId: c.id })).toBe(200);
  });

  it('rejects uploads over 5,000 leads and to unknown campaigns', async () => {
    const c = await createCampaign();
    const tooMany = Array.from({ length: 5001 }, (_, i) => ({ phone: `+1415${1000000 + i}` }));
    await api(ctx.app()).post(`/api/campaigns/${c.id}/leads`).send(tooMany).expect(400);
    await api(ctx.app())
      .post('/api/campaigns/7f1c1d2e-8a1b-4c3d-9e8f-0a1b2c3d4e5f/leads')
      .send([{ phone: '+14155550100' }])
      .expect(404);
  });

  it('lists leads with status filter and pagination', async () => {
    const c = await createCampaign();
    await api(ctx.app())
      .post('/api/dnc')
      .send({ numbers: [{ phone: '+14155550002' }] });
    await api(ctx.app())
      .post(`/api/campaigns/${c.id}/leads`)
      .send([{ phone: '+14155550001' }, { phone: '+14155550002' }, { phone: '+14155550003' }]);

    const pending = await api(ctx.app()).get(`/api/campaigns/${c.id}/leads?status=pending&limit=1`);
    expect(pending.body.meta).toEqual({ page: 1, limit: 1, total: 2 });
    const dnc = await api(ctx.app()).get(`/api/campaigns/${c.id}/leads?status=dnc`);
    expect(dnc.body.data.map((l: Lead) => l.phone)).toEqual(['+14155550002']);
  });

  it('adding a DNC number blocks existing pending leads in every campaign', async () => {
    const a = await createCampaign({ name: 'A' });
    const b = await createCampaign({ name: 'B' });
    for (const c of [a, b]) {
      await api(ctx.app())
        .post(`/api/campaigns/${c.id}/leads`)
        .send([{ phone: '+14155550123' }]);
    }
    const res = await api(ctx.app())
      .post('/api/dnc')
      .send({ numbers: [{ phone: '+14155550123' }, { phone: 'bad' }] });
    expect(res.body.data).toEqual({ added: 1, alreadyPresent: 0, invalid: 1, leadsMarkedDnc: 2 });
  });
});
