import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { z } from 'zod';

/**
 * `ZodTypeAny` rather than `AnyZodObject`: schemas refined with `.refine()` or
 * `.superRefine()` are `ZodEffects`, not `ZodObject`, and several routes pass those.
 */
type Schemas = {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
};

export function validateRequest(schemas: Schemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) req.query = schemas.query.parse(req.query) as Request['query'];
      if (schemas.params) req.params = schemas.params.parse(req.params) as Request['params'];
      next();
    } catch (e) {
      next(e);
    }
  };
}

export const idParamSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/i),
});
