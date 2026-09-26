import { AppDataSource } from '../../db/data-source';
import { queryRows } from '../../lib/sql';
import { DncNumber, LeadStatus } from '../../entities';
import { NotFoundError } from '../../errors/AppError';
import { type Paginated, type Pagination, toSkipTake } from '../../lib/pagination';
import { isE164, normalizePhone } from '../../lib/phone';
import type { AddDncInput } from './dnc.schema';

export interface AddDncResult {
  added: number;
  alreadyPresent: number;
  invalid: number;
  /** Pending leads (any campaign) switched to `dnc` so they will never be dialed. */
  leadsMarkedDnc: number;
}

export const dncService = {
  async add({ numbers }: AddDncInput): Promise<AddDncResult> {
    const byPhone = new Map<string, string | null>();
    let invalid = 0;
    for (const n of numbers) {
      const phone = normalizePhone(n.phone);
      if (isE164(phone)) byPhone.set(phone, n.reason ?? null);
      else invalid++;
    }
    const phones = [...byPhone.keys()];
    if (phones.length === 0) return { added: 0, alreadyPresent: 0, invalid, leadsMarkedDnc: 0 };

    // One transaction: the number is on the list AND its pending leads are blocked, or neither.
    return AppDataSource.transaction(async (manager) => {
      const added = await queryRows<unknown>(
        manager,
        `INSERT INTO dnc_numbers (phone, reason)
         SELECT * FROM unnest($1::varchar[], $2::varchar[])
         ON CONFLICT (phone) DO NOTHING
         RETURNING phone`,
        [phones, phones.map((p) => byPhone.get(p) ?? null)],
      );
      // Leads already `dialing` are caught by the dialer's DNC re-check or are already ringing.
      const marked = await queryRows<unknown>(
        manager,
        `UPDATE leads SET status = $2, "updatedAt" = now()
         WHERE phone = ANY($1::varchar[]) AND status = $3
         RETURNING id`,
        [phones, LeadStatus.Dnc, LeadStatus.Pending],
      );
      return {
        added: added.length,
        alreadyPresent: phones.length - added.length,
        invalid,
        leadsMarkedDnc: marked.length,
      };
    });
  },

  async list(query: Pagination): Promise<Paginated<DncNumber>> {
    const [items, total] = await AppDataSource.getRepository(DncNumber).findAndCount({
      order: { createdAt: 'DESC', phone: 'ASC' },
      ...toSkipTake(query),
    });
    return { items, meta: { page: query.page, limit: query.limit, total } };
  },

  async remove(rawPhone: string): Promise<void> {
    const phone = normalizePhone(rawPhone);
    const result = await AppDataSource.getRepository(DncNumber).delete({ phone });
    if (result.affected === 0) throw new NotFoundError('DNC number', phone);
  },
};
