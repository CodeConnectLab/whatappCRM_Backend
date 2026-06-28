import { createRedisConnection } from "../../config/redis.js";
const redisConnection = createRedisConnection();
export {
  redisConnection
};
