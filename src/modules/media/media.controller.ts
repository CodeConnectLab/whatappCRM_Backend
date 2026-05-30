import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { MediaModel } from './media.model.js';
import { makeMediaKey, presignPut, publicObjectUrl } from './s3.service.js';
import { isS3MediaConfigured } from '../../config/env.js';

export async function presignUpload(req: Request, res: Response): Promise<void> {
  if (!isS3MediaConfigured()) {
    res.status(503).json({
      error:
        'Media uploads need S3-compatible storage. For local MinIO: set S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_ENDPOINT (see .env.example).',
    });
    return;
  }
  const companyId = req.companyId!;
  const userId = req.user!.sub;
  const { filename, contentType } = req.body as { filename: string; contentType: string };
  const key = makeMediaKey(companyId, filename);
  const uploadUrl = await presignPut(key, contentType);
  const url = publicObjectUrl(key);
  const media = await MediaModel.create({
    companyId: new Types.ObjectId(companyId),
    key,
    url,
    mimeType: contentType,
    size: 0,
    uploadedBy: new Types.ObjectId(userId),
  });
  res.json({ uploadUrl, mediaId: media._id, url });
}

export async function listMedia(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const rows = await MediaModel.find({
    companyId: new Types.ObjectId(companyId),
    deletedAt: null,
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.json(rows);
}
