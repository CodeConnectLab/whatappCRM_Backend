import type { NextFunction, Request, Response } from 'express';
import type { AnyZodObject } from 'zod';
import { z } from 'zod';

type Schemas = {
  body?: AnyZodObject;
  query?: AnyZodObject;
  params?: AnyZodObject;
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
