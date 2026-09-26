import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { validate } from '../../middlewares/validate';
import { dncController } from './dnc.controller';
import { addDncSchema, dncPhoneParam, listDncQuerySchema } from './dnc.schema';

export const dncRouter = Router();

dncRouter.post('/', validate({ body: addDncSchema }), asyncHandler(dncController.add));
dncRouter.get('/', validate({ query: listDncQuerySchema }), asyncHandler(dncController.list));
dncRouter.delete(
  '/:phone',
  validate({ params: dncPhoneParam }),
  asyncHandler(dncController.remove),
);
