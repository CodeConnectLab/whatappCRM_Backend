import { logger } from '../utils/logger.js';
/** Logs every webhook HTTP call to the console (visible in `npm run dev`). */
export function webhookRequestLogger(req, res, next) {
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
