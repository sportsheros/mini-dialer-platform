import type { Request, Response } from 'express';
import { sendSuccess } from '../../lib/http';
import type { ListCallsQuery } from './calls.schema';
import { callsService } from './calls.service';

export const callsController = {
  async list(req: Request, res: Response) {
    const { items, meta } = await callsService.list(req.query as unknown as ListCallsQuery);
    sendSuccess(res, items, 200, meta);
  },

  async get(req: Request, res: Response) {
    sendSuccess(res, await callsService.getById(req.params.id));
  },
};
