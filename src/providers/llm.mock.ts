import { type CallAnalysis, type LlmProvider, ProviderError, type QaFlag } from './ai';
import type { MockAiOptions } from './stt.mock';

const PENALTIES: Record<QaFlag, number> = {
  greeting_missed: 20,
  compliance_phrase_missing: 35,
  no_next_step: 15,
  short_call: 10,
};

/**
 * Deterministic "LLM": rule-based checks over the transcript stand in for a structured-output
 * prompt. A real implementation would return the same CallAnalysis shape.
 */
export class MockLlmProvider implements LlmProvider {
  private readonly random: () => number;

  constructor(private readonly options: MockAiOptions) {
    this.random = options.random ?? Math.random;
  }

  async analyzeCall(transcript: string): Promise<CallAnalysis> {
    await new Promise((r) => setTimeout(r, 20 + this.random() * 80));
    if (this.random() < this.options.failureRate) {
      throw new ProviderError('mock-llm', 'rate limited (429)');
    }
    return analyzeTranscript(transcript);
  }
}

export function analyzeTranscript(transcript: string): CallAnalysis {
  const text = transcript.toLowerCase();
  const flags: QaFlag[] = [];
  if (!/\b(hi|hello|good (morning|afternoon))\b/.test(text)) flags.push('greeting_missed');
  if (!text.includes('may be recorded')) flags.push('compliance_phrase_missing');
  if (!/follow up|email you/.test(text)) flags.push('no_next_step');
  if (transcript.split('\n').length < 4) flags.push('short_call');

  const qaScore = Math.max(0, 100 - flags.reduce((sum, f) => sum + PENALTIES[f], 0));
  const interested = /that works|sounds good|yes/.test(text);
  const summary = [
    'Outbound renewal call.',
    interested
      ? 'Customer engaged and agreed to receive renewal details.'
      : 'Customer did not commit to a next step.',
    flags.length ? `QA issues: ${flags.join(', ')}.` : 'No QA issues detected.',
  ].join(' ');

  return { summary, qaScore, flags };
}
