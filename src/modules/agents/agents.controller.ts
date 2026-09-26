import type { Request, Response } from 'express';
import { sendSuccess } from '../../lib/http';
import type { CreateAgentInput, ListAgentsQuery, UpdateAgentStatusInput } from './agents.schema';
import { agentsService } from './agents.service';

export const agentsController = {
  async create(req: Request, res: Response) {
    const agent = await agentsService.create(req.body as CreateAgentInput);
    sendSuccess(res, agent, 201);
  },

  async list(req: Request, res: Response) {
    const { items, meta } = await agentsService.list(req.query as unknown as ListAgentsQuery);
    sendSuccess(res, items, 200, meta);
  },

  async get(req: Request, res: Response) {
    sendSuccess(res, await agentsService.getById(req.params.id));
  },

  async updateStatus(req: Request, res: Response) {
    const agent = await agentsService.setStatus(req.params.id, req.body as UpdateAgentStatusInput);
    sendSuccess(res, agent);
  },
};
