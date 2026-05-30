import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

/** Logs every webhook HTTP call to the console (visible in `npm run dev`). */
export function webhookRequestLogger(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  const path = req.originalUrl;
  const method = req.method;

  logger.info(`[webhook] ${method} ${path} — incoming`);

  res.on('finish', () => {
    const ms = Date.now() - started;
    logger.info(`[webhook] ${method} ${path} — ${res.statusCode} (${ms}ms)`);
  });

  next();
}
