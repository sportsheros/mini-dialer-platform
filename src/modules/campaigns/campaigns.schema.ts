import { z } from 'zod';
import { CampaignStatus, values } from '../../entities';
import { paginationSchema } from '../../lib/pagination';

const campaignFields = {
  name: z.string().trim().min(1).max(200),
  maxCps: z.number().int().min(1).max(100),
  maxAttempts: z.number().int().min(1).max(10),
};

export const createCampaignSchema = z.object({
  name: campaignFields.name,
  maxCps: campaignFields.maxCps.default(2),
  maxAttempts: campaignFields.maxAttempts.default(3),
});

export const updateCampaignSchema = z
  .object(campaignFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const listCampaignsQuerySchema = paginationSchema.extend({
  status: z.enum(values(CampaignStatus) as [CampaignStatus, ...CampaignStatus[]]).optional(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;
