import { signPayload, verifySignature } from '../../src/lib/signature';
import { analyzeTranscript } from '../../src/providers/llm.mock';
import { buildCallScenario } from '../../src/providers/telephony.mock';

describe('HMAC signatures', () => {
  const body = Buffer.from('{"eventId":"e1"}');

  it('verifies a valid signature, with or without the sha256= prefix', () => {
    const sig = signPayload(body, 'secret-123');
    expect(sig.startsWith('sha256=')).toBe(true);
    expect(verifySignature(body, sig, 'secret-123')).toBe(true);
    expect(verifySignature(body, sig.slice(7), 'secret-123')).toBe(true);
  });

  it('rejects wrong secret, tampered body, garbage and missing input', () => {
    const sig = signPayload(body, 'secret-123');
    expect(verifySignature(body, sig, 'other-secret')).toBe(false);
    expect(verifySignature(Buffer.from('{"eventId":"e2"}'), sig, 'secret-123')).toBe(false);
    expect(verifySignature(body, 'sha256=zz', 'secret-123')).toBe(false);
    expect(verifySignature(undefined, sig, 'secret-123')).toBe(false);
    expect(verifySignature(body, undefined, 'secret-123')).toBe(false);
  });
});

describe('mock telephony scenario', () => {
  /** Deterministic PRNG so scenarios are reproducible. */
  const seeded = (values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
  };

  it('answered call: ringing → answered → completed with a duration', () => {
    // outcome draw 0.9 → answered; no duplicates (0.99 > 0.1); no reorder (0.99 > 0.15)
    const events = buildCallScenario('p1', {
      speed: 1,
      random: seeded([0.5, 0.5, 0.9, 0.5, 0.99]),
      now: () => 0,
    });
    expect(events.map((e) => e.event.type)).toEqual(['ringing', 'answered', 'completed']);
    expect(events[2].event.payload).toHaveProperty('durationSec');
    expect(new Set(events.map((e) => e.event.eventId)).size).toBe(3);
  });

  it('can deliver ringing after answered while keeping truthful timestamps', () => {
    const events = buildCallScenario('p1', {
      speed: 1,
      random: seeded([0.5, 0.5, 0.9, 0.5, 0.01, 0.99, 0.99, 0.99]),
      now: () => 0,
    });
    const types = events.map((e) => e.event.type);
    expect(types.indexOf('ringing')).toBeGreaterThan(types.indexOf('answered'));
    const ringing = events.find((e) => e.event.type === 'ringing')!;
    const answered = events.find((e) => e.event.type === 'answered')!;
    expect(Date.parse(ringing.event.timestamp)).toBeLessThan(Date.parse(answered.event.timestamp));
  });

  it('duplicates reuse the same eventId', () => {
    const events = buildCallScenario('p1', {
      speed: 1,
      random: seeded([0.5, 0.5, 0.1, 0.01]),
      now: () => 0,
    });
    const ids = events.map((e) => e.event.eventId);
    expect(ids.length).toBeGreaterThan(new Set(ids).size);
  });
});

describe('mock LLM analysis', () => {
  it('scores a compliant call 100 with no flags', () => {
    const result = analyzeTranscript(
      [
        'Agent: Hi, this is Sam.',
        'Agent: This call may be recorded.',
        'Customer: Yes.',
        'Agent: I will email you and follow up.',
      ].join('\n'),
    );
    expect(result).toMatchObject({ qaScore: 100, flags: [] });
  });

  it('flags missing greeting and compliance phrase', () => {
    const result = analyzeTranscript('Agent: Your plan ends soon.\nCustomer: ok');
    expect(result.flags).toEqual(
      expect.arrayContaining(['greeting_missed', 'compliance_phrase_missing', 'no_next_step']),
    );
    expect(result.qaScore).toBeLessThan(50);
  });
});
