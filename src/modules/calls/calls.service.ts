import { AppDataSource } from '../../db/data-source';
import { Call, CallEvent } from '../../entities';
import { NotFoundError } from '../../errors/AppError';
import type { Paginated } from '../../lib/pagination';
import type { ListCallsQuery } from './calls.schema';

// Heavy text columns (transcript/summary) are left out of the list view; the detail view has them.
const LIST_COLUMNS = [
  'call.id',
  'call.status',
  'call.leadId',
  'call.agentId',
  'call.campaignId',
  'call.providerCallId',
  'call.answeredAt',
  'call.endedAt',
  'call.durationSec',
  'call.qaScore',
  'call.createdAt',
  'call.updatedAt',
  'lead.id',
  'lead.phone',
  'lead.name',
  'agent.id',
  'agent.name',
];

export const callsService = {
  /**
   * Filters map onto the call indexes:
   *  - campaignId (+ createdAt range/sort) → IDX_calls_campaign_created
   *  - status (+ createdAt range/sort)     → IDX_calls_status_created
   *  - agentId                             → IDX_calls_agent
   * Sorting by createdAt DESC with `id` as tie-breaker gives a stable page order.
   * Joins are many-to-one, so they never multiply rows and plain OFFSET/LIMIT is correct.
   */
  async list(query: ListCallsQuery): Promise<Paginated<Call>> {
    const [items, total] = await this.buildListQuery(query).getManyAndCount();
    return { items, meta: { page: query.page, limit: query.limit, total } };
  },

  /** Exposed separately so tests can EXPLAIN the exact SQL and assert index usage. */
  buildListQuery(query: ListCallsQuery) {
    const qb = AppDataSource.getRepository(Call)
      .createQueryBuilder('call')
      .leftJoin('call.lead', 'lead')
      .leftJoin('call.agent', 'agent')
      .select(LIST_COLUMNS);

    if (query.status) qb.andWhere('call.status IN (:...status)', { status: query.status });
    if (query.agentId) qb.andWhere('call.agentId = :agentId', { agentId: query.agentId });
    if (query.campaignId) {
      qb.andWhere('call.campaignId = :campaignId', { campaignId: query.campaignId });
    }
    if (query.from) qb.andWhere('call.createdAt >= :from', { from: query.from });
    if (query.to) qb.andWhere('call.createdAt <= :to', { to: query.to });

    return qb
      .orderBy('call.createdAt', 'DESC')
      .addOrderBy('call.id', 'DESC')
      .offset((query.page - 1) * query.limit)
      .limit(query.limit);
  },

  async getById(id: string): Promise<Call & { events: CallEvent[] }> {
    const call = await AppDataSource.getRepository(Call)
      .createQueryBuilder('call')
      .leftJoinAndSelect('call.lead', 'lead')
      .leftJoinAndSelect('call.agent', 'agent')
      .leftJoinAndSelect('call.campaign', 'campaign')
      .leftJoinAndSelect('call.events', 'event')
      .where('call.id = :id', { id })
      // Timeline in the order things happened, then the order we received them.
      .orderBy('event.occurredAt', 'ASC')
      .addOrderBy('event.receivedAt', 'ASC')
      .getOne();
    if (!call) throw new NotFoundError('Call', id);
    return { ...call, events: call.events ?? [] };
  },
};
