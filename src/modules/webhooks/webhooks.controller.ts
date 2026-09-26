import type { Request, Response } from 'express';
import { sendSuccess } from '../../lib/http';
import type { CallEventWebhook } from './webhooks.schema';
import { webhooksService } from './webhooks.service';

export const webhooksController = {
  /**
   * Always 200 for anything we have durably recorded — processed, duplicate or ignored — so the
   * provider stops retrying. Non-2xx only when a retry could genuinely help (unknown call, 5xx).
   */
  async callEvent(req: Request, res: Response) {
    const outcome = await webhooksService.handleCallEvent(req.body as CallEventWebhook);
    sendSuccess(res, outcome);
  },
};
