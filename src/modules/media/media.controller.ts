import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { MediaModel } from './media.model.js';
import { makeMediaKey, presignGet, presignPut, publicObjectUrl } from './s3.service.js';
import { deliverableKind, assertWithinSizeLimit } from './media-kind.js';
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
  const { filename, contentType, size } = req.body as {
    filename: string;
    contentType: string;
    size?: number;
  };

  // Reject an oversize file before the browser spends bandwidth on it, rather than
  // letting Meta refuse the send afterwards.
  const kind = deliverableKind(contentType);
  if (size) {
    try {
      assertWithinSizeLimit(kind, size);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'File too large' });
      return;
    }
  }

  const key = makeMediaKey(companyId, filename);
  const uploadUrl = await presignPut(key, contentType);
  const url = publicObjectUrl(key);
  const media = await MediaModel.create({
    companyId: new Types.ObjectId(companyId),
    key,
    url,
    mimeType: contentType,
    filename,
    size: size ?? 0,
    source: 'upload',
    uploadedBy: new Types.ObjectId(userId),
  });
  res.json({ uploadUrl, mediaId: media._id, url, kind });
}

/**
 * Called once the browser's PUT succeeds.
 *
 * The presign step only reserves a key — without this the row would keep `size: 0` and
 * the WhatsApp size check on send would have nothing to work with.
 */
export async function completeUpload(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const { id } = req.params as { id: string };
  const { size } = req.body as { size: number };

  const media = await MediaModel.findOne({
    _id: new Types.ObjectId(id),
    companyId: new Types.ObjectId(companyId),
    deletedAt: null,
  });
  if (!media) {
    res.status(404).json({ error: 'Attachment not found' });
    return;
  }

  const kind = deliverableKind(media.mimeType);
  try {
    assertWithinSizeLimit(kind, size);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'File too large' });
    return;
  }

  media.size = size;
  await media.save();

  const url = await presignGet(media.key).catch(() => media.url);
  res.json({ mediaId: String(media._id), url, kind, mimeType: media.mimeType, size });
}

/** Fresh read URL for an attachment whose presigned link has expired. */
export async function getMediaUrl(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const { id } = req.params as { id: string };
  const media = await MediaModel.findOne({
    _id: new Types.ObjectId(id),
    companyId: new Types.ObjectId(companyId),
    deletedAt: null,
  }).lean();
  if (!media) {
    res.status(404).json({ error: 'Attachment not found' });
    return;
  }
  const url = await presignGet(media.key).catch(() => media.url);
  res.json({ url, mimeType: media.mimeType, filename: media.filename, size: media.size });
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
