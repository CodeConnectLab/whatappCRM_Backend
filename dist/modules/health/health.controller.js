import mongoose from "mongoose";
import { createRedisConnection } from "../../config/redis.js";
import { env } from "../../config/env.js";
async function checkMongo() {
  if (mongoose.connection.readyState !== 1) return "error";
  try {
    await mongoose.connection.db.admin().ping();
    return "ok";
  } catch {
    return "error";
  }
}
async function checkRedis() {
  const redis = createRedisConnection();
  try {
    const pong = await redis.ping();
    return pong === "PONG" ? "ok" : "error";
  } catch {
    return "error";
  } finally {
    redis.disconnect();
  }
}
async function healthCheck(_req, res) {
  const [mongodb, redis] = await Promise.all([checkMongo(), checkRedis()]);
  const healthy = mongodb === "ok" && redis === "ok";
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    uptime: Math.floor(process.uptime()),
    env: env.NODE_ENV,
    checks: {
      mongodb,
      redis
    }
  });
}
export {
  healthCheck
};
