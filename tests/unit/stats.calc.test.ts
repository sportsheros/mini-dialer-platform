import { CallStatus, LeadStatus } from '../../src/entities';
import { type CallStatusRow, computeCampaignStats } from '../../src/modules/stats/stats.calc';

const row = (
  status: CallStatus,
  count: number,
  extra: Partial<CallStatusRow> = {},
): CallStatusRow => ({
  status,
  count,
  answered: 0,
  durationSum: 0,
  durationCount: 0,
  qaSum: 0,
  qaCount: 0,
  ...extra,
});

describe('computeCampaignStats', () => {
  const now = new Date('2030-01-01T00:00:00Z');

  it('returns zeroes and nulls for an empty campaign', () => {
    const stats = computeCampaignStats('c1', [], [], now);
    expect(stats).toMatchObject({
      totalLeads: 0,
      totalCalls: 0,
      callsAnswered: 0,
      answerRate: 0,
      avgDurationSec: null,
      avgQaScore: null,
      generatedAt: '2030-01-01T00:00:00.000Z',
    });
    expect(stats.leadsByStatus).toEqual({
      pending: 0,
      dialing: 0,
      completed: 0,
      failed: 0,
      dnc: 0,
    });
  });

  it('aggregates lead and call rows', () => {
    const stats = computeCampaignStats(
      'c1',
      [
        { status: LeadStatus.Pending, count: 5 },
        { status: LeadStatus.Completed, count: 3 },
        { status: LeadStatus.Dnc, count: 2 },
      ],
      [
        row(CallStatus.Completed, 3, {
          answered: 3,
          durationSum: 90,
          durationCount: 3,
          qaSum: 240,
          qaCount: 3,
        }),
        row(CallStatus.NoAnswer, 4),
        row(CallStatus.Abandoned, 1, { answered: 1 }),
        row(CallStatus.Ringing, 2),
      ],
      now,
    );
    expect(stats.totalLeads).toBe(10);
    expect(stats.totalCalls).toBe(10);
    expect(stats.callsInProgress).toBe(2);
    expect(stats.callsAnswered).toBe(4);
    expect(stats.answerRate).toBe(0.5); // 4 answered / 8 finished (in-progress excluded)
    expect(stats.avgDurationSec).toBe(30);
    expect(stats.avgQaScore).toBe(80);
    expect(stats.callsByStatus.failed).toBe(0);
  });

  it('coerces numeric strings (Postgres bigint) and rounds', () => {
    const stats = computeCampaignStats(
      'c1',
      [],
      [
        row(CallStatus.Completed, '2' as unknown as number, {
          answered: '2' as unknown as number,
          durationSum: '10' as unknown as number,
          durationCount: '3' as unknown as number,
        }),
        row(CallStatus.NoAnswer, 1),
      ],
    );
    expect(stats.answerRate).toBe(0.6667);
    expect(stats.avgDurationSec).toBe(3.3);
  });
});
