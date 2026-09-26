import { randomUUID } from 'node:crypto';
import { AppDataSource } from '../db/data-source';
import { CallEventType, CallStatus, Campaign, CampaignStatus, LeadStatus } from '../entities';
import { queryRows } from '../lib/sql';
import { logger } from '../lib/logger';
import { publish } from '../lib/realtime';
import { applyCallEvent } from '../modules/calls/callLifecycle.service';
import { statsCache } from '../modules/stats/stats.cache';
import type { TelephonyProvider } from '../providers/telephony';
import { acquireDialSlots } from './cpsLimiter';

export interface DialerConfig {
  batchSize: number;
  retryDelaySec: number;
}

export interface ClaimedCall {
  callId: string;
  leadId: string;
  providerCallId: string;
  phone: string;
  campaignId: string;
  createdAt: Date;
}

type RunningCampaign = Pick<Campaign, 'id' | 'maxCps' | 'maxAttempts'>;

/**
 * Transaction boundary for one campaign batch:
 *   lock campaign (FOR SHARE) → claim leads (FOR UPDATE SKIP LOCKED) → DNC re-check
 *   → mark dialing + attempts++ → insert Call rows → COMMIT.  Dialing happens after commit.
 *
 * SKIP LOCKED makes concurrent workers pick *disjoint* rows instead of queueing on each other's
 * locks, so N workers can run safely and no lead is claimed twice.
 */
export async function claimBatch(
  campaign: RunningCampaign,
  limit: number,
  config: DialerConfig,
): Promise<ClaimedCall[]> {
  return AppDataSource.transaction(async (manager) => {
    // FOR SHARE on the campaign: a concurrent pause (UPDATE) waits for this short transaction,
    // and after a pause commits no new batch can be claimed.
    const live = await queryRows<unknown>(
      manager,
      `SELECT id FROM campaigns WHERE id = $1 AND status = $2 FOR SHARE`,
      [campaign.id, CampaignStatus.Running],
    );
    if (live.length === 0) return [];

    const claimed = await queryRows<{ id: string; phone: string }>(
      manager,
      `WITH picked AS (
         SELECT id FROM leads
         WHERE "campaignId" = $1
           AND status = 'pending'
           AND attempts < $2
           AND ("lastAttemptAt" IS NULL OR "lastAttemptAt" <= now() - make_interval(secs => $3))
         ORDER BY attempts ASC, "createdAt" ASC
         LIMIT $4
         FOR UPDATE SKIP LOCKED
       )
       UPDATE leads l
       SET status = 'dialing', attempts = l.attempts + 1, "lastAttemptAt" = now(), "updatedAt" = now()
       FROM picked
       WHERE l.id = picked.id
       RETURNING l.id, l.phone`,
      [campaign.id, campaign.maxAttempts, config.retryDelaySec, limit],
    );
    if (claimed.length === 0) return [];

    // DNC re-check right before dialing: the number may have been added after upload.
    const dncRows = await queryRows<{ phone: string }>(
      manager,
      `SELECT phone FROM dnc_numbers WHERE phone = ANY($1::varchar[])`,
      [claimed.map((l) => l.phone)],
    );
    const dnc = new Set(dncRows.map((r) => r.phone));
    if (dnc.size > 0) {
      await queryRows(
        manager,
        `UPDATE leads SET status = $2, attempts = attempts - 1, "updatedAt" = now()
         WHERE id = ANY($1::uuid[])`,
        [claimed.filter((l) => dnc.has(l.phone)).map((l) => l.id), LeadStatus.Dnc],
      );
      logger.info({ campaignId: campaign.id, count: dnc.size }, 'Skipped DNC numbers at dial time');
    }

    const toDial = claimed.filter((l) => !dnc.has(l.phone));
    if (toDial.length === 0) return [];

    const providerCallIds = toDial.map(() => randomUUID());
    const calls = await queryRows<{
      id: string;
      leadId: string;
      providerCallId: string;
      createdAt: Date;
    }>(
      manager,
      `INSERT INTO calls ("leadId", "campaignId", status, "providerCallId", version)
         SELECT t.lead_id, $1, $2, t.provider_call_id, 1
         FROM unnest($3::uuid[], $4::varchar[]) AS t(lead_id, provider_call_id)
         RETURNING id, "leadId", "providerCallId", "createdAt"`,
      [campaign.id, CallStatus.Initiated, toDial.map((l) => l.id), providerCallIds],
    );

    const phoneByLead = new Map(toDial.map((l) => [l.id, l.phone]));
    return calls.map((c) => ({
      callId: c.id,
      leadId: c.leadId,
      providerCallId: c.providerCallId,
      phone: phoneByLead.get(c.leadId) ?? '',
      campaignId: campaign.id,
      createdAt: c.createdAt,
    }));
  });
}

/** Marks a running campaign completed once nothing is left to dial or in flight. */
async function completeIfExhausted(campaignId: string): Promise<boolean> {
  const rows = await queryRows<unknown>(
    AppDataSource,
    `UPDATE campaigns SET status = 'completed', "updatedAt" = now()
     WHERE id = $1 AND status = 'running'
       AND NOT EXISTS (
         SELECT 1 FROM leads WHERE "campaignId" = $1 AND status IN ('pending', 'dialing')
       )
     RETURNING id`,
    [campaignId],
  );
  if (rows.length > 0) {
    logger.info({ campaignId }, 'Campaign completed: no leads left');
    publish('campaign:updated', { id: campaignId, status: CampaignStatus.Completed });
    await statsCache.invalidate(campaignId);
    return true;
  }
  return false;
}

async function dialOne(telephony: TelephonyProvider, call: ClaimedCall): Promise<void> {
  publish('call:updated', {
    id: call.callId,
    status: CallStatus.Initiated,
    campaignId: call.campaignId,
    leadId: call.leadId,
    agentId: null,
    phone: call.phone,
    createdAt: call.createdAt,
  });
  try {
    await telephony.dial({
      callId: call.callId,
      providerCallId: call.providerCallId,
      phone: call.phone,
      campaignId: call.campaignId,
    });
  } catch (err) {
    logger.warn({ err, callId: call.callId }, 'Dial failed; marking call failed');
    // Same path as a provider "failed" webhook, with a deterministic id so it is idempotent.
    await applyCallEvent({
      eventId: `internal:dial_failed:${call.callId}`,
      providerCallId: call.providerCallId,
      type: CallEventType.Failed,
      occurredAt: new Date(),
      payload: { reason: 'dial_error', message: err instanceof Error ? err.message : 'unknown' },
    });
  }
}

export interface TickResult {
  dialed: number;
  campaigns: number;
}

/** One pass over all running campaigns. Safe to run concurrently in many processes. */
export async function runDialerTick(
  telephony: TelephonyProvider,
  config: DialerConfig,
): Promise<TickResult> {
  const campaigns = await AppDataSource.getRepository(Campaign).find({
    select: { id: true, maxCps: true, maxAttempts: true },
    where: { status: CampaignStatus.Running },
  });

  let dialed = 0;
  for (const campaign of campaigns) {
    const wanted = Math.min(config.batchSize, campaign.maxCps);
    const slots = await acquireDialSlots(campaign.id, campaign.maxCps, wanted);
    if (slots === 0) continue; // CPS budget for this second already used (by us or a peer)

    const batch = await claimBatch(campaign, slots, config);
    if (batch.length === 0) {
      await completeIfExhausted(campaign.id);
      continue;
    }
    await Promise.allSettled(batch.map((call) => dialOne(telephony, call)));
    await statsCache.invalidate(campaign.id);
    dialed += batch.length;
  }
  return { dialed, campaigns: campaigns.length };
}
