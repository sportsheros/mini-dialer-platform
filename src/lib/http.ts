import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Forwards rejected promises from async handlers to the central error handler. */
export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req as Req, res, next).catch(next);
  };
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
}

export function sendSuccess<T>(res: Response, data: T, status = 200, meta?: PageMeta): Response {
  return res.status(status).json(meta ? { success: true, data, meta } : { success: true, data });
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Exact bytes received; needed to verify webhook HMAC signatures. */
      rawBody?: Buffer;
    }
  }
}
