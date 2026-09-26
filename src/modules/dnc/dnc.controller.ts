import type { Request, Response } from 'express';
import { sendSuccess } from '../../lib/http';
import type { Pagination } from '../../lib/pagination';
import type { AddDncInput } from './dnc.schema';
import { dncService } from './dnc.service';

export const dncController = {
  async add(req: Request, res: Response) {
    sendSuccess(res, await dncService.add(req.body as AddDncInput), 201);
  },

  async list(req: Request, res: Response) {
    const { items, meta } = await dncService.list(req.query as unknown as Pagination);
    sendSuccess(res, items, 200, meta);
  },

  async remove(req: Request, res: Response) {
    await dncService.remove(req.params.phone);
    res.status(204).end();
  },
};
