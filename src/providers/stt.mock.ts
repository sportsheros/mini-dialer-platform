import { ProviderError, type SttProvider, type TranscriptionRequest } from './ai';

export interface MockAiOptions {
  /** Probability [0..1] that a call fails, to exercise BullMQ retries. */
  failureRate: number;
  random?: () => number;
}

const GREETING =
  'Agent: Hi, this is Sam calling from Acme Energy. Am I speaking with the account holder?';
const COMPLIANCE =
  'Agent: Before we continue, please note this call may be recorded for quality and training purposes.';
const BODY = [
  'Customer: Yes, speaking. What is this about?',
  'Agent: Your fixed-rate plan ends next month, and I can walk you through renewal options.',
  'Customer: Sure, what are the options?',
  'Agent: There is a 12-month plan at the same rate, or a 24-month plan with a 5% discount.',
];
const NEXT_STEP =
  'Agent: I will email you the details today and follow up on Friday. Does that work?';
const CLOSE = 'Customer: That works, thanks. Agent: Thank you for your time, goodbye.';

/** Produces a plausible transcript, randomly leaving out the greeting / compliance / next step. */
export class MockSttProvider implements SttProvider {
  private readonly random: () => number;

  constructor(private readonly options: MockAiOptions) {
    this.random = options.random ?? Math.random;
  }

  async transcribe({ durationSec }: TranscriptionRequest): Promise<string> {
    await new Promise((r) => setTimeout(r, 20 + this.random() * 80)); // network latency
    if (this.random() < this.options.failureRate) {
      throw new ProviderError('mock-stt', 'upstream timeout');
    }
    const lines: string[] = [];
    if (this.random() > 0.15) lines.push(GREETING);
    if (this.random() > 0.2) lines.push(COMPLIANCE);
    const bodyLines = (durationSec ?? 0) < 5 ? BODY.slice(0, 1) : BODY;
    lines.push(...bodyLines);
    if (this.random() > 0.3) lines.push(NEXT_STEP);
    lines.push(CLOSE);
    return lines.join('\n');
  }
}
