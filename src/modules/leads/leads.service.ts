import { AppDataSource } from '../../db/data-source';
import { queryRows } from '../../lib/sql';
import { Campaign, Lead, LeadStatus } from '../../entities';
import { NotFoundError } from '../../errors/AppError';
import { type Paginated, toSkipTake } from '../../lib/pagination';
import { isE164, normalizePhone } from '../../lib/phone';
import { statsCache } from '../stats/stats.cache';
import type { ListLeadsQuery, UploadLeadsInput } from './leads.schema';

export interface UploadResult {
  /** New dialable leads (status pending). */
  inserted: number;
  /** Repeated within the payload, or already present in the campaign. */
  duplicates: number;
  /** New leads stored with status `dnc` because the number is on the DNC list. */
  dnc: number;
  /** Not a valid E.164 number after normalisation. */
  invalid: number;
}

interface Candidate {
  phone: string;
  name: string | null;
}

/** Pure step: normalise, drop invalid numbers, dedupe within the payload (first one wins). */
export function prepareLeads(rows: UploadLeadsInput): {
  candidates: Candidate[];
  invalid: number;
  duplicates: number;
} {
  const seen = new Map<string, Candidate>();
  let invalid = 0;
  let duplicates = 0;
  for (const row of rows) {
    const phone = normalizePhone(row.phone);
    if (!isE164(phone)) {
      invalid++;
    } else if (seen.has(phone)) {
      duplicates++;
    } else {
      seen.set(phone, { phone, name: row.name || null });
    }
  }
  return { candidates: [...seen.values()], invalid, duplicates };
}

export const leadsService = {
  /**
   * One transaction for the whole batch. Existing (campaignId, phone) pairs are skipped by the
   * unique constraint (ON CONFLICT DO NOTHING) rather than a racy "SELECT then INSERT", so two
   * concurrent uploads of the same file can never create duplicates.
   */
  async upload(campaignId: string, rows: UploadLeadsInput): Promise<UploadResult> {
    const { candidates, invalid, duplicates: payloadDuplicates } = prepareLeads(rows);

    const result = await AppDataSource.transaction(async (manager) => {
      // FOR SHARE: the campaign can't be deleted mid-upload, but concurrent uploads don't block.
      const campaign = await manager
        .createQueryBuilder(Campaign, 'c')
        .select('c.id')
        .where('c.id = :campaignId', { campaignId })
        .setLock('pessimistic_read')
        .getOne();
      if (!campaign) throw new NotFoundError('Campaign', campaignId);

      if (candidates.length === 0) {
        return { inserted: 0, dnc: 0, existing: 0 };
      }

      const phones = candidates.map((c) => c.phone);
      const dncRows = await queryRows<{ phone: string }>(
        manager,
        'SELECT phone FROM dnc_numbers WHERE phone = ANY($1::varchar[])',
        [phones],
      );
      const dncSet = new Set(dncRows.map((r) => r.phone));

      // unnest() turns three parallel arrays into rows: one round-trip for up to 5,000 leads.
      const insertedRows = await queryRows<{ status: LeadStatus }>(
        manager,
        `INSERT INTO leads ("campaignId", phone, name, status)
         SELECT $1, t.phone, t.name, t.status
         FROM unnest($2::varchar[], $3::varchar[], $4::lead_status[]) AS t(phone, name, status)
         ON CONFLICT ("campaignId", phone) DO NOTHING
         RETURNING status`,
        [
          campaignId,
          phones,
          candidates.map((c) => c.name),
          candidates.map((c) => (dncSet.has(c.phone) ? LeadStatus.Dnc : LeadStatus.Pending)),
        ],
      );

      const dnc = insertedRows.filter((r) => r.status === LeadStatus.Dnc).length;
      return {
        inserted: insertedRows.length - dnc,
        dnc,
        existing: candidates.length - insertedRows.length,
      };
    });

    await statsCache.invalidate(campaignId);
    return {
      inserted: result.inserted,
      duplicates: payloadDuplicates + result.existing,
      dnc: result.dnc,
      invalid,
    };
  },

  async list(campaignId: string, query: ListLeadsQuery): Promise<Paginated<Lead>> {
    const exists = await AppDataSource.getRepository(Campaign).existsBy({ id: campaignId });
    if (!exists) throw new NotFoundError('Campaign', campaignId);

    // Served by IDX_leads_campaign_status (campaignId, status).
    const [items, total] = await AppDataSource.getRepository(Lead).findAndCount({
      where: { campaignId, ...(query.status ? { status: query.status } : {}) },
      order: { createdAt: 'ASC', id: 'ASC' },
      ...toSkipTake(query),
    });
    return { items, meta: { page: query.page, limit: query.limit, total } };
  },
};
