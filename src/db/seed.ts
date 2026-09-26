import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { Agent, Campaign, CampaignStatus, DncNumber, Lead, LeadStatus } from '../entities';
import { logger } from '../lib/logger';
import { redis } from '../lib/redis';

const AGENTS = [
  { name: 'Asha Rao', email: 'asha@example.com' },
  { name: 'Ben Carter', email: 'ben@example.com' },
  { name: 'Chen Li', email: 'chen@example.com' },
  { name: 'Diego Alvarez', email: 'diego@example.com' },
  { name: 'Emma Novak', email: 'emma@example.com' },
];

const DEMO_CAMPAIGN = 'Demo Campaign';
const DNC = ['+14155550001', '+14155550002'];

/** Idempotent: safe to run repeatedly (unique keys + "insert if missing"). */
async function seed(): Promise<void> {
  await AppDataSource.initialize();

  await AppDataSource.transaction(async (manager) => {
    await manager
      .createQueryBuilder()
      .insert()
      .into(Agent)
      .values(AGENTS)
      .orIgnore() // ON CONFLICT DO NOTHING on the email unique index
      .execute();

    await manager
      .createQueryBuilder()
      .insert()
      .into(DncNumber)
      .values(DNC.map((phone) => ({ phone, reason: 'seed: customer opted out' })))
      .orIgnore()
      .execute();

    let campaign = await manager.findOneBy(Campaign, { name: DEMO_CAMPAIGN });
    if (!campaign) {
      campaign = await manager.save(
        manager.create(Campaign, {
          name: DEMO_CAMPAIGN,
          status: CampaignStatus.Draft,
          maxCps: 2,
          maxAttempts: 3,
        }),
      );
    }

    const leads = Array.from({ length: 50 }, (_, i) => {
      const phone = `+141555501${String(i).padStart(2, '0')}`;
      return {
        campaignId: campaign.id,
        phone,
        name: `Lead ${i + 1}`,
        status: DNC.includes(phone) ? LeadStatus.Dnc : LeadStatus.Pending,
      };
    });
    await manager.createQueryBuilder().insert().into(Lead).values(leads).orIgnore().execute();
  });

  const [agents, leads] = await Promise.all([
    AppDataSource.getRepository(Agent).count(),
    AppDataSource.getRepository(Lead).count(),
  ]);
  logger.info({ agents, leads }, 'Seed complete');
}

seed()
  .catch((err: unknown) => {
    logger.error({ err }, 'Seed failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await AppDataSource.destroy().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  });
