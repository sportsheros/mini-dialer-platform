import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { ValidationError } from '../errors/AppError';

interface RequestSchemas {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
}

/**
 * Validates and *replaces* req.body / req.params / req.query with the parsed (coerced, defaulted)
 * values, so controllers can trust their shape. All issues from all parts are reported together.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    const issues: unknown[] = [];
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (result.success) {
        req[part] = result.data;
      } else {
        issues.push(...result.error.issues.map((i) => ({ ...i, path: [part, ...i.path] })));
      }
    }
    if (issues.length > 0) {
      next(new ValidationError('Request validation failed', issues));
      return;
    }
    next();
  };
}
