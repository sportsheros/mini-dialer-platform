import { In } from 'typeorm';
import { AppDataSource } from '../../db/data-source';
import { Campaign, CampaignStatus } from '../../entities';
import { ConflictError, InvalidStateTransitionError, NotFoundError } from '../../errors/AppError';
import { type Paginated, toSkipTake } from '../../lib/pagination';
import { publish } from '../../lib/realtime';
import { statsCache } from '../stats/stats.cache';
import type {
  CreateCampaignInput,
  ListCampaignsQuery,
  UpdateCampaignInput,
} from './campaigns.schema';

const repo = () => AppDataSource.getRepository(Campaign);

/** Which states each lifecycle action may start from. */
const TRANSITIONS = {
  start: { from: [CampaignStatus.Draft, CampaignStatus.Paused], to: CampaignStatus.Running },
  pause: { from: [CampaignStatus.Running], to: CampaignStatus.Paused },
} as const;

export type CampaignAction = keyof typeof TRANSITIONS;

export const campaignsService = {
  async create(input: CreateCampaignInput): Promise<Campaign> {
    const campaign = await repo().save(repo().create({ ...input, status: CampaignStatus.Draft }));
    publish('campaign:updated', campaign);
    return campaign;
  },

  async list(query: ListCampaignsQuery): Promise<Paginated<Campaign>> {
    const [items, total] = await repo().findAndCount({
      where: query.status ? { status: query.status } : {},
      order: { createdAt: 'DESC', id: 'ASC' },
      ...toSkipTake(query),
    });
    return { items, meta: { page: query.page, limit: query.limit, total } };
  },

  async getById(id: string): Promise<Campaign> {
    const campaign = await repo().findOneBy({ id });
    if (!campaign) throw new NotFoundError('Campaign', id);
    return campaign;
  },

  async update(id: string, input: UpdateCampaignInput): Promise<Campaign> {
    const campaign = await this.getById(id);
    if (campaign.status === CampaignStatus.Completed) {
      throw new InvalidStateTransitionError('A completed campaign cannot be modified');
    }
    // Settings changes on a running campaign are fine: the dialer re-reads them every tick.
    const saved = await repo().save(repo().merge(campaign, input));
    publish('campaign:updated', saved);
    return saved;
  },

  /** Deleting cascades leads and calls, so it is refused while the campaign is dialing. */
  async remove(id: string): Promise<void> {
    const result = await repo().delete({
      id,
      status: In([CampaignStatus.Draft, CampaignStatus.Paused, CampaignStatus.Completed]),
    });
    if (result.affected === 0) {
      await this.getById(id); // 404 if it doesn't exist
      throw new ConflictError('Pause the campaign before deleting it');
    }
    await statsCache.invalidate(id);
  },

  /**
   * start/pause via a single conditional UPDATE, so two concurrent requests (or a request racing
   * the dialer marking the campaign completed) can't both "win". Repeating the action on a
   * campaign already in the target state is a no-op (idempotent), not an error.
   */
  async transition(id: string, action: CampaignAction): Promise<Campaign> {
    const { from, to } = TRANSITIONS[action];
    const result = await repo()
      .createQueryBuilder()
      .update(Campaign)
      .set({ status: to })
      .where('id = :id', { id })
      .andWhere('status IN (:...from)', { from })
      .returning('*')
      .execute();

    const rows = result.raw as Campaign[];
    if (rows.length === 0) {
      const current = await this.getById(id);
      if (current.status === to) return current;
      throw new InvalidStateTransitionError(
        `Cannot ${action} a campaign that is '${current.status}'`,
        [{ from: current.status, action, allowedFrom: from }],
      );
    }
    const campaign = repo().create(rows[0]);
    publish('campaign:updated', campaign);
    return campaign;
  },
};
