import { Redis } from "ioredis";
import { env } from "./env.js";
function createRedisConnection() {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
export {
  createRedisConnection
};
