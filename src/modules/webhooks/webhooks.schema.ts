import { z } from 'zod';
import { CallEventType, values } from '../../entities';

export const callEventWebhookSchema = z.object({
  eventId: z
    .string()
    .min(1)
    .max(128)
    // Reserved for events we synthesise ourselves (reaper, dial failures).
    .refine((id) => !id.startsWith('internal:'), 'eventId prefix "internal:" is reserved'),
  providerCallId: z.string().min(1).max(128),
  type: z.enum(values(CallEventType) as [CallEventType, ...CallEventType[]]),
  timestamp: z.union([
    z
      .string()
      .datetime({ offset: true })
      .transform((s) => new Date(s)),
    z
      .number()
      .int()
      .positive()
      .transform((ms) => new Date(ms)),
  ]),
  payload: z.record(z.unknown()).optional(),
});

export type CallEventWebhook = z.infer<typeof callEventWebhookSchema>;
