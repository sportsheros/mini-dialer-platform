import { AppDataSource } from '../../src/db/data-source';
import { Call, CallEventType } from '../../src/entities';
import { enqueueSummary, getSummaryQueue } from '../../src/lib/queue';
import { applyCallEvent } from '../../src/modules/calls/callLifecycle.service';
import type { CallAnalysis, LlmProvider, SttProvider } from '../../src/providers/ai';
import { analyzeTranscript } from '../../src/providers/llm.mock';
import { runDialerTick } from '../../src/workers/dialer';
import { processSummaryJob } from '../../src/workers/summary';
import { startSummaryWorker } from '../../src/workers/summary.worker';
import { createAvailableAgents, createCampaign, RecordingTelephony } from '../helpers/fixtures';
import { useIntegration } from '../helpers/integration';

const TRANSCRIPT = [
  'Agent: Hi, this is Sam from Acme.',
  'Agent: This call may be recorded for quality purposes.',
  'Customer: Yes, go ahead.',
  'Agent: I will email you the details and follow up Friday.',
].join('\n');

class CountingStt implements SttProvider {
  calls = 0;
  async transcribe(): Promise<string> {
    this.calls++;
    return TRANSCRIPT;
  }
}

/** Fails the first `failures` calls, then behaves like the mock LLM. */
class FlakyLlm implements LlmProvider {
  calls = 0;
  constructor(private failures: number) {}
  async analyzeCall(transcript: string): Promise<CallAnalysis> {
    this.calls++;
    if (this.calls <= this.failures) throw new Error(`transient failure #${this.calls}`);
    return analyzeTranscript(transcript);
  }
}

async function createFinishedCall(outcome: 'completed' | 'no_answer' = 'completed'): Promise<Call> {
  await createCampaign({}, 1);
  await createAvailableAgents(1);
  const telephony = new RecordingTelephony();
  await runDialerTick(telephony, { batchSize: 10, retryDelaySec: 0 });
  const [{ providerCallId }] = telephony.dials;
  const at = Date.now();
  if (outcome === 'completed') {
    await applyCallEvent({
      eventId: 'a',
      providerCallId,
      type: CallEventType.Answered,
      occurredAt: new Date(at - 30_000),
    });
  }
  await applyCallEvent({
    eventId: 'b',
    providerCallId,
    type: outcome === 'completed' ? CallEventType.Completed : CallEventType.NoAnswer,
    occurredAt: new Date(at),
  });
  // The lifecycle enqueued a job; remove it so tests control processing explicitly.
  await getSummaryQueue().obliterate({ force: true });
  return AppDataSource.getRepository(Call).findOneByOrFail({ providerCallId });
}

describe('Post-call summary worker', () => {
  useIntegration();

  it('writes transcript, summary, qaScore and flags; re-running is a no-op', async () => {
    const call = await createFinishedCall();
    const stt = new CountingStt();
    const llm = new FlakyLlm(0);

    const first = await processSummaryJob(call.id, { stt, llm });
    expect(first).toEqual({ status: 'summarized', qaScore: 100 });

    const saved = await AppDataSource.getRepository(Call).findOneByOrFail({ id: call.id });
    expect(saved.transcript).toBe(TRANSCRIPT);
    expect(saved.summary).toContain('No QA issues');
    expect(saved.qaScore).toBe(100);
    expect(saved.qaFlags).toEqual([]);

    const second = await processSummaryJob(call.id, { stt, llm });
    expect(second).toEqual({ status: 'skipped', reason: 'already_summarized' });
    expect(stt.calls).toBe(1);
    expect(llm.calls).toBe(1);
  });

  it('keeps the transcript when the LLM fails, so a retry does not pay for STT again', async () => {
    const call = await createFinishedCall();
    const stt = new CountingStt();
    const llm = new FlakyLlm(1);

    await expect(processSummaryJob(call.id, { stt, llm })).rejects.toThrow('transient');
    const mid = await AppDataSource.getRepository(Call).findOneByOrFail({ id: call.id });
    expect(mid.transcript).toBe(TRANSCRIPT);
    expect(mid.summary).toBeNull();

    await processSummaryJob(call.id, { stt, llm });
    expect(stt.calls).toBe(1);
  });

  it('skips calls that never connected', async () => {
    const call = await createFinishedCall('no_answer');
    const result = await processSummaryJob(call.id, {
      stt: new CountingStt(),
      llm: new FlakyLlm(0),
    });
    expect(result).toEqual({ status: 'skipped', reason: 'not_eligible' });
  });

  it('dedupes enqueues by jobId = callId', async () => {
    const call = await createFinishedCall();
    await enqueueSummary(call.id);
    await enqueueSummary(call.id);
    await enqueueSummary(call.id);
    const counts = await getSummaryQueue().getJobCounts('waiting', 'delayed', 'active');
    expect(counts.waiting + counts.delayed + counts.active).toBe(1);
  });

  it('BullMQ retries with backoff until the flaky provider succeeds', async () => {
    const call = await createFinishedCall();
    const llm = new FlakyLlm(2);
    const handle = startSummaryWorker({ stt: new CountingStt(), llm }, 1);
    try {
      const done = new Promise<void>((resolve, reject) => {
        handle.worker.on('completed', () => resolve());
        setTimeout(() => reject(new Error('timed out waiting for job')), 25_000).unref();
      });
      await enqueueSummary(call.id);
      await done;
    } finally {
      await handle.close();
    }

    expect(llm.calls).toBe(3); // 2 failures + 1 success, within attempts: 3
    const saved = await AppDataSource.getRepository(Call).findOneByOrFail({ id: call.id });
    expect(saved.summary).not.toBeNull();
  });
});
