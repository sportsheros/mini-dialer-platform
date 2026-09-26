import { type ApplyOutcome, applyCallEvent } from '../calls/callLifecycle.service';
import type { CallEventWebhook } from './webhooks.schema';

export const webhooksService = {
  handleCallEvent(event: CallEventWebhook): Promise<ApplyOutcome> {
    return applyCallEvent({
      eventId: event.eventId,
      providerCallId: event.providerCallId,
      type: event.type,
      occurredAt: event.timestamp,
      payload: event.payload,
    });
  },
};
