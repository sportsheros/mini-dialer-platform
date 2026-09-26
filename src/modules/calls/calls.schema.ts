import { z } from 'zod';
import { CallStatus, values } from '../../entities';
import { paginationSchema } from '../../lib/pagination';

const callStatusEnum = z.enum(values(CallStatus) as [CallStatus, ...CallStatus[]]);

export const listCallsQuerySchema = paginationSchema
  .extend({
    /** One status or a comma-separated list, e.g. `initiated,ringing,answered` for live calls. */
    status: z
      .string()
      .transform((s) =>
        s
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      )
      .pipe(z.array(callStatusEnum).min(1))
      .optional(),
    agentId: z.string().uuid().optional(),
    campaignId: z.string().uuid().optional(),
    from: z
      .string()
      .datetime({ offset: true })
      .transform((s) => new Date(s))
      .optional(),
    to: z
      .string()
      .datetime({ offset: true })
      .transform((s) => new Date(s))
      .optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: '`from` must be before `to`',
    path: ['from'],
  });

export type ListCallsQuery = z.infer<typeof listCallsQuerySchema>;
