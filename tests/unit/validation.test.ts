import { createAgentSchema, updateAgentStatusSchema } from '../../src/modules/agents/agents.schema';
import { listCallsQuerySchema } from '../../src/modules/calls/calls.schema';
import {
  createCampaignSchema,
  updateCampaignSchema,
} from '../../src/modules/campaigns/campaigns.schema';
import { uploadLeadsSchema } from '../../src/modules/leads/leads.schema';
import { prepareLeads } from '../../src/modules/leads/leads.prepare';
import { callEventWebhookSchema } from '../../src/modules/webhooks/webhooks.schema';
import { isE164, normalizePhone } from '../../src/lib/phone';
import { paginationSchema } from '../../src/lib/pagination';

describe('phone helpers', () => {
  it.each([
    ['+14155550123', true],
    ['+442071838750', true],
    ['+1415555012', true],
    ['14155550123', false], // no +
    ['+04155550123', false], // country code can't start with 0
    ['+1234567890123456', false], // > 15 digits
    ['+12345', false], // too short
  ])('isE164(%s) = %s', (phone, ok) => expect(isE164(phone)).toBe(ok));

  it('normalises common human formatting', () => {
    expect(normalizePhone(' +1 (415) 555-0123 ')).toBe('+14155550123');
    expect(normalizePhone('0044 20 7183 8750')).toBe('+442071838750');
    expect(normalizePhone('415.555.0123')).toBe('4155550123'); // still invalid: no country code
  });
});

describe('prepareLeads', () => {
  it('counts invalid numbers and in-payload duplicates, keeping the first occurrence', () => {
    const result = prepareLeads([
      { phone: '+14155550100', name: 'First' },
      { phone: '+1 415 555 0100', name: 'Second' },
      { phone: 'garbage' },
      { phone: '+14155550101' },
    ]);
    expect(result.invalid).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.candidates).toEqual([
      { phone: '+14155550100', name: 'First' },
      { phone: '+14155550101', name: null },
    ]);
  });
});

describe('request schemas', () => {
  it('agents: lowercases email and only allows available/offline from clients', () => {
    expect(createAgentSchema.parse({ name: ' Ann ', email: 'ANN@X.COM' })).toEqual({
      name: 'Ann',
      email: 'ann@x.com',
    });
    expect(updateAgentStatusSchema.safeParse({ status: 'busy' }).success).toBe(false);
  });

  it('campaigns: applies defaults and bounds', () => {
    expect(createCampaignSchema.parse({ name: 'Q3' })).toEqual({
      name: 'Q3',
      maxCps: 2,
      maxAttempts: 3,
    });
    expect(createCampaignSchema.safeParse({ name: 'Q3', maxCps: 1000 }).success).toBe(false);
    expect(updateCampaignSchema.safeParse({}).success).toBe(false);
  });

  it('leads upload: 1..5000 rows', () => {
    expect(uploadLeadsSchema.safeParse([]).success).toBe(false);
    expect(uploadLeadsSchema.safeParse([{ phone: 'anything' }]).success).toBe(true);
    const tooMany = Array.from({ length: 5001 }, () => ({ phone: '+14155550100' }));
    expect(uploadLeadsSchema.safeParse(tooMany).success).toBe(false);
  });

  it('pagination: coerces strings, defaults, caps limit at 100', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(paginationSchema.parse({ page: '3', limit: '50' })).toEqual({ page: 3, limit: 50 });
    expect(paginationSchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(paginationSchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('calls list: splits comma-separated statuses and validates date order', () => {
    const q = listCallsQuerySchema.parse({ status: 'ringing, answered' });
    expect(q.status).toEqual(['ringing', 'answered']);
    expect(listCallsQuerySchema.safeParse({ status: 'ringing,nope' }).success).toBe(false);
    expect(
      listCallsQuerySchema.safeParse({ from: '2030-01-02T00:00:00Z', to: '2030-01-01T00:00:00Z' })
        .success,
    ).toBe(false);
  });

  it('webhook: parses ISO or epoch-ms timestamps and reserves the internal: prefix', () => {
    const base = { eventId: 'e1', providerCallId: 'p1', type: 'answered' };
    const iso = callEventWebhookSchema.parse({ ...base, timestamp: '2030-01-01T00:00:00Z' });
    expect(iso.timestamp).toEqual(new Date('2030-01-01T00:00:00Z'));
    const ms = callEventWebhookSchema.parse({ ...base, timestamp: 1893456000000 });
    expect(ms.timestamp.toISOString()).toBe('2030-01-01T00:00:00.000Z');
    expect(
      callEventWebhookSchema.safeParse({ ...base, eventId: 'internal:x', timestamp: 1 }).success,
    ).toBe(false);
    expect(
      callEventWebhookSchema.safeParse({ ...base, type: 'hangup', timestamp: 1 }).success,
    ).toBe(false);
  });
});
