import { AppDataSource } from '../../db/data-source';
import { Agent, AgentStatus } from '../../entities';
import { ConflictError, NotFoundError } from '../../errors/AppError';
import { isUniqueViolation } from '../../lib/db-errors';
import { type Paginated, toSkipTake } from '../../lib/pagination';
import { publish } from '../../lib/realtime';
import { agentPool } from './agentPool';
import type { CreateAgentInput, ListAgentsQuery, UpdateAgentStatusInput } from './agents.schema';

const repo = () => AppDataSource.getRepository(Agent);

export const agentsService = {
  async create(input: CreateAgentInput): Promise<Agent> {
    try {
      const agent = await repo().save(repo().create({ ...input, status: AgentStatus.Offline }));
      publish('agent:updated', agent);
      return agent;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError(`An agent with email '${input.email}' already exists`);
      }
      throw err;
    }
  },

  async list(query: ListAgentsQuery): Promise<Paginated<Agent>> {
    const [items, total] = await repo().findAndCount({
      where: query.status ? { status: query.status } : {},
      order: { name: 'ASC', id: 'ASC' },
      ...toSkipTake(query),
    });
    return { items, meta: { page: query.page, limit: query.limit, total } };
  },

  async getById(id: string): Promise<Agent> {
    const agent = await repo().findOneBy({ id });
    if (!agent) throw new NotFoundError('Agent', id);
    return agent;
  },

  /**
   * DB first, then Redis. The conditional UPDATE is what enforces "can't go offline while busy":
   * checking status in a separate SELECT would race with call routing marking the agent busy.
   * The operation is idempotent, so if the Redis write fails the client can simply retry.
   */
  async setStatus(id: string, { status }: UpdateAgentStatusInput): Promise<Agent> {
    const result = await repo()
      .createQueryBuilder()
      .update(Agent)
      .set({ status })
      .where('id = :id', { id })
      .andWhere('status <> :busy', { busy: AgentStatus.Busy })
      .returning('*')
      .execute();

    const rows = result.raw as Agent[];
    if (rows.length === 0) {
      const existing = await repo().findOneBy({ id });
      if (!existing) throw new NotFoundError('Agent', id);
      throw new ConflictError(
        `Agent is busy on a call and cannot be set to '${status}' until the call ends`,
      );
    }

    if (status === AgentStatus.Available) await agentPool.add(id);
    else await agentPool.remove(id);

    const agent = repo().create(rows[0]);
    publish('agent:updated', agent);
    return agent;
  },
};
