import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', details: err.flatten() });
    return;
  }
  logger.error('Unhandled error', { err, path: req.path });
  const status = typeof err === 'object' && err && 'status' in err && typeof err.status === 'number' ? err.status : 500;
  const message =
    status === 500 ? 'Internal server error' : err instanceof Error ? err.message : 'Error';
  res.status(status).json({ error: message });
};
