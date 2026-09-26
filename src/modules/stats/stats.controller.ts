import type { Request, Response } from 'express';
import { sendSuccess } from '../../lib/http';
import { statsService } from './stats.service';

export const statsController = {
  async campaignStats(req: Request, res: Response) {
    const { stats, cached } = await statsService.getCampaignStats(req.params.id);
    res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
    sendSuccess(res, stats);
  },
};
