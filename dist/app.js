import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env.js";
import { swaggerSpec } from "./config/swagger.js";
import { apiRouter } from "./routes/index.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { twilioIncomingController, twilioStatusController } from "./modules/webhook/twilio.webhook.js";
import { metaWhatsappVerify, metaWhatsappWebhook } from "./modules/webhook/meta.whatsapp.webhook.js";
import { healthCheck } from "./modules/health/health.controller.js";
import { asyncHandler } from "./utils/asyncHandler.js";
import { webhookRequestLogger } from "./middleware/webhookRequestLogger.js";
function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  const allowedOrigins = [env.FRONTEND_URL, env.FRONTEND_URL.replace(/\/$/, "")];
  const corsOptions = {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) cb(null, true);
      else cb(new Error("Not allowed by CORS"));
    },
    credentials: true
  };
  app.options("*", cors(corsOptions));
  app.use(cors(corsOptions));
  app.get("/health", asyncHandler(healthCheck));
  const metaJson = express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  });
  const webhooks = express.Router();
  webhooks.use(webhookRequestLogger);
  webhooks.get("/meta/whatsapp/:webhookSlug", asyncHandler(metaWhatsappVerify));
  webhooks.post("/meta/whatsapp/:webhookSlug", metaJson, asyncHandler(metaWhatsappWebhook));
  webhooks.get("/meta/whatsapp", asyncHandler(metaWhatsappVerify));
  webhooks.post("/meta/whatsapp", metaJson, asyncHandler(metaWhatsappWebhook));
  const twForm = express.urlencoded({ extended: false });
  webhooks.post("/twilio/incoming", twForm, asyncHandler(twilioIncomingController));
  webhooks.post("/twilio/status", twForm, asyncHandler(twilioStatusController));
  app.use("/webhooks", webhooks);
  const metaWebhookAlias = express.Router();
  metaWebhookAlias.use(webhookRequestLogger);
  metaWebhookAlias.get("/:webhookSlug", asyncHandler(metaWhatsappVerify));
  metaWebhookAlias.post("/:webhookSlug", metaJson, asyncHandler(metaWhatsappWebhook));
  app.use("/meta/whatsapp", metaWebhookAlias);
  app.use(express.json({ limit: "2mb" }));
  const limiter = rateLimit({ windowMs: 6e4, max: 300 });
  app.use("/api", limiter, apiRouter);
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.use(errorHandler);
  return app;
}
export {
  createApp
};
