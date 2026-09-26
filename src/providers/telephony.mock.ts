import { randomUUID } from 'node:crypto';
import { logger } from '../lib/logger';
import { signPayload } from '../lib/signature';
import type { DialRequest, TelephonyEvent, TelephonyProvider } from './telephony';

export interface ScheduledEvent {
  /** Delay after dial() at which the event is delivered. */
  deliverAfterMs: number;
  event: TelephonyEvent;
}

export interface ScenarioOptions {
  /** Multiplies all delays; < 1 speeds the simulation up. */
  speed: number;
  random?: () => number;
  now?: () => number;
}

const randomBetween = (random: () => number, min: number, max: number) =>
  min + random() * (max - min);

/**
 * Pure: builds the list of webhook deliveries for one call, deliberately including real-world
 * mess: ~10% of events delivered twice (provider retry), and ~15% of answered calls get their
 * `ringing` event delivered AFTER `answered` (out-of-order delivery).
 */
export function buildCallScenario(
  providerCallId: string,
  { speed, random = Math.random, now = Date.now }: ScenarioOptions,
): ScheduledEvent[] {
  const start = now();
  const events: ScheduledEvent[] = [];
  const make = (
    type: TelephonyEvent['type'],
    atMs: number,
    payload?: Record<string, unknown>,
  ): ScheduledEvent => ({
    deliverAfterMs: Math.round(atMs),
    event: {
      eventId: randomUUID(),
      providerCallId,
      type,
      timestamp: new Date(start + atMs).toISOString(),
      ...(payload ? { payload } : {}),
    },
  });

  let t = randomBetween(random, 200, 800) * speed;
  const ringing = make('ringing', t);
  events.push(ringing);

  const outcome = random();
  t += randomBetween(random, 1_000, 4_000) * speed;
  if (outcome < 0.05) {
    events.push(make('failed', t, { reason: 'carrier_rejected' }));
  } else if (outcome < 0.3) {
    events.push(make('no_answer', t));
  } else {
    const answered = make('answered', t);
    events.push(answered);
    const talkMs = randomBetween(random, 2_000, 10_000) * speed;
    t += talkMs;
    events.push(make('completed', t, { durationSec: Math.round(talkMs / 1000) }));

    if (random() < 0.15) {
      // Out-of-order: deliver ringing shortly after answered (timestamps stay truthful).
      ringing.deliverAfterMs = answered.deliverAfterMs + 50;
    }
  }

  // Duplicates: same eventId delivered again, like a provider retrying after a slow 200.
  const duplicates = events
    .filter(() => random() < 0.1)
    .map((e) => ({ ...e, deliverAfterMs: e.deliverAfterMs + 30 }));
  return [...events, ...duplicates].sort((a, b) => a.deliverAfterMs - b.deliverAfterMs);
}

export interface MockTelephonyOptions {
  /** Where to POST events. If undefined, dial() succeeds but no events are sent (tests). */
  webhookUrl?: string;
  webhookSecret: string;
  speed?: number;
  /** Probability that dial() itself throws (e.g. provider API down). */
  dialFailureRate?: number;
}

/** Simulates a telephony provider by calling our own webhook with signed events. */
export class MockTelephonyProvider implements TelephonyProvider {
  private readonly timers = new Set<NodeJS.Timeout>();
  private closed = false;

  constructor(private readonly options: MockTelephonyOptions) {}

  async dial(request: DialRequest): Promise<void> {
    if (Math.random() < (this.options.dialFailureRate ?? 0)) {
      throw new Error('Mock provider: originate failed');
    }
    const { webhookUrl } = this.options;
    if (!webhookUrl) return;

    for (const scheduled of buildCallScenario(request.providerCallId, {
      speed: this.options.speed ?? 1,
    })) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        void this.deliver(webhookUrl, scheduled.event);
      }, scheduled.deliverAfterMs);
      this.timers.add(timer);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /** At-least-once delivery with small backoff, like real providers. */
  private async deliver(url: string, event: TelephonyEvent, attempt = 1): Promise<void> {
    if (this.closed) return;
    const body = JSON.stringify(event);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signPayload(body, this.options.webhookSecret),
        },
        body,
        signal: AbortSignal.timeout(5_000),
      });
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
      if (res.status >= 400) {
        logger.warn({ status: res.status, event }, 'Webhook rejected by API (not retrying)');
      }
    } catch (err) {
      if (attempt >= 3 || this.closed) {
        logger.error({ err, eventId: event.eventId }, 'Webhook delivery failed permanently');
        return;
      }
      const timer = setTimeout(
        () => {
          this.timers.delete(timer);
          void this.deliver(url, event, attempt + 1);
        },
        500 * 2 ** attempt,
      );
      this.timers.add(timer);
    }
  }
}
