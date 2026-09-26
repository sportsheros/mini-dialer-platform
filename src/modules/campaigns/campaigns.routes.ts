import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { uuidParam } from '../../lib/pagination';
import { validate } from '../../middlewares/validate';
import { leadsController } from '../leads/leads.controller';
import { statsController } from '../stats/stats.controller';
import { listLeadsQuerySchema, uploadLeadsSchema } from '../leads/leads.schema';
import { campaignsController } from './campaigns.controller';
import {
  createCampaignSchema,
  listCampaignsQuerySchema,
  updateCampaignSchema,
} from './campaigns.schema';

export const campaignsRouter = Router();

campaignsRouter.post(
  '/',
  validate({ body: createCampaignSchema }),
  asyncHandler(campaignsController.create),
);
campaignsRouter.get(
  '/',
  validate({ query: listCampaignsQuerySchema }),
  asyncHandler(campaignsController.list),
);
campaignsRouter.get('/:id', validate({ params: uuidParam }), asyncHandler(campaignsController.get));
campaignsRouter.patch(
  '/:id',
  validate({ params: uuidParam, body: updateCampaignSchema }),
  asyncHandler(campaignsController.update),
);
campaignsRouter.delete(
  '/:id',
  validate({ params: uuidParam }),
  asyncHandler(campaignsController.remove),
);
campaignsRouter.post(
  '/:id/start',
  validate({ params: uuidParam }),
  asyncHandler(campaignsController.start),
);
campaignsRouter.post(
  '/:id/pause',
  validate({ params: uuidParam }),
  asyncHandler(campaignsController.pause),
);

// Leads are a sub-resource of a campaign.
campaignsRouter.post(
  '/:id/leads',
  validate({ params: uuidParam, body: uploadLeadsSchema }),
  asyncHandler(leadsController.upload),
);
campaignsRouter.get(
  '/:id/leads',
  validate({ params: uuidParam, query: listLeadsQuerySchema }),
  asyncHandler(leadsController.list),
);

campaignsRouter.get(
  '/:id/stats',
  validate({ params: uuidParam }),
  asyncHandler(statsController.campaignStats),
);
