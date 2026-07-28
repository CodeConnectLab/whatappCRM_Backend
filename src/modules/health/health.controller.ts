import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { createRedisConnection } from '../../config/redis.js';
import { env } from '../../config/env.js';

type CheckStatus = 'ok' | 'error';

async function checkMongo(): Promise<CheckStatus> {
  if (mongoose.connection.readyState !== 1) return 'error';
  const db = mongoose.connection.db;
  if (!db) return 'error';
  try {
    await db.admin().ping();
    return 'ok';
  } catch {
    return 'error';
  }
}

async function checkRedis(): Promise<CheckStatus> {
  const redis = createRedisConnection();
  try {
    const pong = await redis.ping();
    return pong === 'PONG' ? 'ok' : 'error';
  } catch {
    return 'error';
  } finally {
    redis.disconnect();
  }
}

export async function healthCheck(_req: Request, res: Response): Promise<void> {
  const [mongodb, redis] = await Promise.all([checkMongo(), checkRedis()]);
  const healthy = mongodb === 'ok' && redis === 'ok';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    uptime: Math.floor(process.uptime()),
    env: env.NODE_ENV,
    checks: {
      mongodb,
      redis,
    },
  });
}
