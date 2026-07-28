import { connectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { startCampaignWorker } from './modules/campaign/campaign.worker.js';
import { logger } from './utils/logger.js';
await connectDatabase();
startCampaignWorker();
logger.info('Campaign worker process started', { env: env.NODE_ENV });
