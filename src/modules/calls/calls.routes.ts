import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { uuidParam } from '../../lib/pagination';
import { validate } from '../../middlewares/validate';
import { callsController } from './calls.controller';
import { listCallsQuerySchema } from './calls.schema';

export const callsRouter = Router();

callsRouter.get('/', validate({ query: listCallsQuerySchema }), asyncHandler(callsController.list));
callsRouter.get('/:id', validate({ params: uuidParam }), asyncHandler(callsController.get));
