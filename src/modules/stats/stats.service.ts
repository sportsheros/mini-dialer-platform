import { AppDataSource } from '../../db/data-source';
import { Campaign } from '../../entities';
import { NotFoundError } from '../../errors/AppError';
import { queryRows } from '../../lib/sql';
import { statsCache } from './stats.cache';
import {
  type CallStatusRow,
  type CampaignStats,
  computeCampaignStats,
  type LeadStatusRow,
} from './stats.calc';

export const statsService = {
  /**
   * Cache-aside: read Redis → on miss compute from Postgres → store with TTL. Entries are also
   * deleted whenever a call ends, so staleness is bounded by the TTL for anything else
   * (e.g. calls merely changing from ringing to answered).
   */
  async getCampaignStats(campaignId: string): Promise<{ stats: CampaignStats; cached: boolean }> {
    const hit = await statsCache.get<CampaignStats>(campaignId);
    if (hit) return { stats: hit, cached: true };

    const exists = await AppDataSource.getRepository(Campaign).existsBy({ id: campaignId });
    if (!exists) throw new NotFoundError('Campaign', campaignId);

    const [leadRows, callRows] = await Promise.all([
      // IDX_leads_campaign_status (campaignId, status) → index-only style scan per campaign
      queryRows<LeadStatusRow>(
        AppDataSource,
        `SELECT status, count(*)::int AS count FROM leads WHERE "campaignId" = $1 GROUP BY status`,
        [campaignId],
      ),
      // IDX_calls_campaign_created (campaignId, createdAt) narrows to this campaign's calls
      queryRows<CallStatusRow>(
        AppDataSource,
        `SELECT status,
                count(*)::int                         AS count,
                count("answeredAt")::int              AS answered,
                COALESCE(sum("durationSec"), 0)::int  AS "durationSum",
                count("durationSec")::int             AS "durationCount",
                COALESCE(sum("qaScore"), 0)::int      AS "qaSum",
                count("qaScore")::int                 AS "qaCount"
         FROM calls WHERE "campaignId" = $1 GROUP BY status`,
        [campaignId],
      ),
    ]);

    const stats = computeCampaignStats(campaignId, leadRows, callRows);
    await statsCache.set(campaignId, stats);
    return { stats, cached: false };
  },
};
