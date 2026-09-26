import type { Request, Response } from 'express';
import { sendSuccess } from '../../lib/http';
import type { ListLeadsQuery, UploadLeadsInput } from './leads.schema';
import { leadsService } from './leads.service';

export const leadsController = {
  async upload(req: Request, res: Response) {
    const result = await leadsService.upload(req.params.id, req.body as UploadLeadsInput);
    sendSuccess(res, result, 201);
  },

  async list(req: Request, res: Response) {
    const { items, meta } = await leadsService.list(
      req.params.id,
      req.query as unknown as ListLeadsQuery,
    );
    sendSuccess(res, items, 200, meta);
  },
};
