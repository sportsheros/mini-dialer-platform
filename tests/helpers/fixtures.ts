import { AppDataSource } from '../../src/db/data-source';
import { Agent, AgentStatus, Campaign, CampaignStatus } from '../../src/entities';
import { agentPool } from '../../src/modules/agents/agentPool';
import { leadsService } from '../../src/modules/leads/leads.service';
import type { DialRequest, TelephonyProvider } from '../../src/providers/telephony';

export async function createCampaign(
  overrides: Partial<Campaign> = {},
  leadCount = 0,
): Promise<Campaign> {
  const repo = AppDataSource.getRepository(Campaign);
  const campaign = await repo.save(
    repo.create({
      name: 'Test campaign',
      status: CampaignStatus.Running,
      maxCps: 1000,
      maxAttempts: 3,
      ...overrides,
    }),
  );
  if (leadCount > 0) {
    await leadsService.upload(
      campaign.id,
      Array.from({ length: leadCount }, (_, i) => ({ phone: `+1415${String(2000000 + i)}` })),
    );
  }
  return campaign;
}

/** Creates agents that are available in both Postgres and the Redis set. */
export async function createAvailableAgents(count: number): Promise<Agent[]> {
  const repo = AppDataSource.getRepository(Agent);
  const agents = await repo.save(
    Array.from({ length: count }, (_, i) =>
      repo.create({
        name: `Agent ${i}`,
        email: `agent${i}-${Date.now()}@example.com`,
        status: AgentStatus.Available,
      }),
    ),
  );
  for (const a of agents) await agentPool.add(a.id);
  return agents;
}

/** Telephony stub that records every dial request (optionally failing some). */
export class RecordingTelephony implements TelephonyProvider {
  readonly dials: DialRequest[] = [];
  constructor(private readonly shouldFail: (req: DialRequest) => boolean = () => false) {}

  async dial(request: DialRequest): Promise<void> {
    this.dials.push(request);
    if (this.shouldFail(request)) throw new Error('simulated originate failure');
  }

  async close(): Promise<void> {}
}
