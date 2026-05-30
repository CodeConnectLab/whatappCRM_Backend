import { Queue } from 'bullmq';
import { redisConnection } from './queue.connection.js';

export const CAMPAIGN_QUEUE = 'campaign-send';

export const campaignQueue = new Queue(CAMPAIGN_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
  },
});
