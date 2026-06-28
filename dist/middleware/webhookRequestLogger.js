import { logger } from "../utils/logger.js";
function webhookRequestLogger(req, res, next) {
  const started = Date.now();
  const path = req.originalUrl;
  const method = req.method;
  logger.info(`[webhook] ${method} ${path} \u2014 incoming`);
  res.on("finish", () => {
    const ms = Date.now() - started;
    logger.info(`[webhook] ${method} ${path} \u2014 ${res.statusCode} (${ms}ms)`);
  });
  next();
}
export {
  webhookRequestLogger
};
