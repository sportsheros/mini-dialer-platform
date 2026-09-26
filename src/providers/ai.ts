export interface TranscriptionRequest {
  callId: string;
  durationSec: number | null;
}

/** Speech-to-text boundary (e.g. Deepgram, AWS Transcribe, Whisper). */
export interface SttProvider {
  transcribe(request: TranscriptionRequest): Promise<string>;
}

export type QaFlag =
  'greeting_missed' | 'compliance_phrase_missing' | 'no_next_step' | 'short_call';

export interface CallAnalysis {
  summary: string;
  /** 0-100 */
  qaScore: number;
  flags: QaFlag[];
}

/** LLM boundary for summarisation + QA audit (e.g. Claude with a structured-output prompt). */
export interface LlmProvider {
  analyzeCall(transcript: string): Promise<CallAnalysis>;
}

/** Thrown by providers for transient failures that are worth retrying. */
export class ProviderError extends Error {
  constructor(provider: string, message: string) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
  }
}
