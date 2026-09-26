import { CallStatus, LeadStatus, values } from '../../entities';
import { TERMINAL_STATUSES } from '../calls/callStateMachine';

export interface LeadStatusRow {
  status: LeadStatus;
  count: number;
}

/** One row per call status, pre-aggregated by Postgres. */
export interface CallStatusRow {
  status: CallStatus;
  count: number;
  answered: number;
  durationSum: number;
  durationCount: number;
  qaSum: number;
  qaCount: number;
}

export interface CampaignStats {
  campaignId: string;
  totalLeads: number;
  leadsByStatus: Record<LeadStatus, number>;
  totalCalls: number;
  callsByStatus: Record<CallStatus, number>;
  callsInProgress: number;
  callsAnswered: number;
  /** answered / finished calls (in-progress calls have no outcome yet). 0..1, 4 decimals. */
  answerRate: number;
  /** Average talk time of connected calls, seconds. */
  avgDurationSec: number | null;
  avgQaScore: number | null;
  generatedAt: string;
}

const zeroes = <K extends string>(keys: K[]): Record<K, number> =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Pure: turns grouped rows into the stats payload. Unit-tested without a database. */
export function computeCampaignStats(
  campaignId: string,
  leadRows: LeadStatusRow[],
  callRows: CallStatusRow[],
  now: Date = new Date(),
): CampaignStats {
  const leadsByStatus = zeroes(values(LeadStatus));
  for (const r of leadRows) leadsByStatus[r.status] = Number(r.count);

  const callsByStatus = zeroes(values(CallStatus));
  let answered = 0;
  let finished = 0;
  let durationSum = 0;
  let durationCount = 0;
  let qaSum = 0;
  let qaCount = 0;
  for (const r of callRows) {
    const count = Number(r.count);
    callsByStatus[r.status] = count;
    answered += Number(r.answered);
    if (TERMINAL_STATUSES.includes(r.status)) finished += count;
    durationSum += Number(r.durationSum);
    durationCount += Number(r.durationCount);
    qaSum += Number(r.qaSum);
    qaCount += Number(r.qaCount);
  }
  const totalCalls = Object.values(callsByStatus).reduce((a, b) => a + b, 0);

  return {
    campaignId,
    totalLeads: Object.values(leadsByStatus).reduce((a, b) => a + b, 0),
    leadsByStatus,
    totalCalls,
    callsByStatus,
    callsInProgress: totalCalls - finished,
    callsAnswered: answered,
    answerRate: finished === 0 ? 0 : round(Math.min(answered, finished) / finished, 4),
    avgDurationSec: durationCount === 0 ? null : round(durationSum / durationCount, 1),
    avgQaScore: qaCount === 0 ? null : round(qaSum / qaCount, 1),
    generatedAt: now.toISOString(),
  };
}
