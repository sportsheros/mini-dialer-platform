import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, NotFoundError, ValidationError } from '../errors/AppError';
import { logger } from '../lib/logger';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError('Route', `${req.method} ${req.path}`));
};

interface BodyParserError extends Error {
  type?: string;
  status?: number;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return err instanceof Error && typeof (err as BodyParserError).type === 'string';
}

function normalize(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return new ValidationError('Request validation failed', err.issues);
  }
  if (isBodyParserError(err)) {
    if (err.type === 'entity.parse.failed') return new ValidationError('Malformed JSON body');
    if (err.type === 'entity.too.large') {
      return new AppError(413, 'VALIDATION_ERROR', 'Request body too large');
    }
  }
  return new AppError(500, 'INTERNAL_ERROR', 'Internal server error');
}

// Express recognises error handlers by arity, so all four params must stay.
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const appError = normalize(err);
  const log = req.log ?? logger;

  if (appError.statusCode >= 500) {
    log.error({ err }, 'Unhandled error');
  } else {
    log.debug({ code: appError.code, message: appError.message }, 'Request failed');
  }

  res.status(appError.statusCode).json({
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
    },
  });
};
