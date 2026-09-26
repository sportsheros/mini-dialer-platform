import type { Request, Response } from 'express';
import { sendSuccess } from '../../lib/http';
import type {
  CreateCampaignInput,
  ListCampaignsQuery,
  UpdateCampaignInput,
} from './campaigns.schema';
import { campaignsService } from './campaigns.service';

export const campaignsController = {
  async create(req: Request, res: Response) {
    sendSuccess(res, await campaignsService.create(req.body as CreateCampaignInput), 201);
  },

  async list(req: Request, res: Response) {
    const { items, meta } = await campaignsService.list(req.query as unknown as ListCampaignsQuery);
    sendSuccess(res, items, 200, meta);
  },

  async get(req: Request, res: Response) {
    sendSuccess(res, await campaignsService.getById(req.params.id));
  },

  async update(req: Request, res: Response) {
    sendSuccess(res, await campaignsService.update(req.params.id, req.body as UpdateCampaignInput));
  },

  async remove(req: Request, res: Response) {
    await campaignsService.remove(req.params.id);
    res.status(204).end();
  },

  async start(req: Request, res: Response) {
    sendSuccess(res, await campaignsService.transition(req.params.id, 'start'));
  },

  async pause(req: Request, res: Response) {
    sendSuccess(res, await campaignsService.transition(req.params.id, 'pause'));
  },
};
