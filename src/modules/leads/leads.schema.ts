import { z } from 'zod';
import { LeadStatus, values } from '../../entities';
import { paginationSchema } from '../../lib/pagination';

export const MAX_LEADS_PER_UPLOAD = 5_000;

/**
 * Phone format is deliberately NOT validated here: a bad number in a 5,000-row upload should be
 * counted as `invalid`, not reject the whole batch with a 400.
 */
export const uploadLeadsSchema = z
  .array(
    z.object({
      phone: z.string().max(64),
      name: z.string().trim().max(200).optional(),
    }),
  )
  .min(1, 'Provide at least one lead')
  .max(MAX_LEADS_PER_UPLOAD, `At most ${MAX_LEADS_PER_UPLOAD} leads per request`);

export const listLeadsQuerySchema = paginationSchema.extend({
  status: z.enum(values(LeadStatus) as [LeadStatus, ...LeadStatus[]]).optional(),
});

export type UploadLeadsInput = z.infer<typeof uploadLeadsSchema>;
export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;
