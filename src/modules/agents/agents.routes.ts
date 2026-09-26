import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { uuidParam } from '../../lib/pagination';
import { validate } from '../../middlewares/validate';
import { agentsController } from './agents.controller';
import { createAgentSchema, listAgentsQuerySchema, updateAgentStatusSchema } from './agents.schema';

export const agentsRouter = Router();

agentsRouter.post(
  '/',
  validate({ body: createAgentSchema }),
  asyncHandler(agentsController.create),
);
agentsRouter.get(
  '/',
  validate({ query: listAgentsQuerySchema }),
  asyncHandler(agentsController.list),
);
agentsRouter.get('/:id', validate({ params: uuidParam }), asyncHandler(agentsController.get));
agentsRouter.patch(
  '/:id/status',
  validate({ params: uuidParam, body: updateAgentStatusSchema }),
  asyncHandler(agentsController.updateStatus),
);
