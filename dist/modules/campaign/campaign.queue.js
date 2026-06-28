import { Queue } from "bullmq";
import { redisConnection } from "./queue.connection.js";
const CAMPAIGN_QUEUE = "campaign-send";
const campaignQueue = new Queue(CAMPAIGN_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5e3 }
  }
});
export {
  CAMPAIGN_QUEUE,
  campaignQueue
};
