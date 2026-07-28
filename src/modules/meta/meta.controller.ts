import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { MetaWhatsappConfigModel } from './meta-whatsapp-config.model.js';
import {
  buildMetaWebhookUrl,
  generateWebhookSlug,
  generateWebhookVerifyToken,
} from './meta-webhook.utils.js';
import { encryptSecret } from '../../utils/encryption.js';
import { logActivity } from '../activity/activity.service.js';

async function ensureUniqueWebhookSlug(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const slug = generateWebhookSlug();
    const exists = await MetaWhatsappConfigModel.exists({ webhookSlug: slug });
    if (!exists) return slug;
  }
  throw new Error('Could not allocate webhook slug');
}

function toConfigResponse(doc: {
  accessTokenEncrypted?: string | null;
  appSecretEncrypted?: string | null;
  wabaId?: string | null;
  appId?: string | null;
  webhookSlug?: string | null;
  webhookVerifyToken?: string | null;
  webhookVerificationStatus?: string | null;
  webhookVerifiedAt?: Date | null;
  webhookLastVerifyAt?: Date | null;
  webhookLastVerifyError?: string | null;
}) {
  const slug = doc.webhookSlug ?? undefined;
  return {
    accessTokenConfigured: Boolean(doc.accessTokenEncrypted),
    appSecretConfigured: Boolean(doc.appSecretEncrypted),
    configured: Boolean(doc.accessTokenEncrypted && doc.appSecretEncrypted),
    wabaId: doc.wabaId ?? undefined,
    appId: doc.appId ?? undefined,
    webhookSlug: slug,
    webhookUrl: slug ? buildMetaWebhookUrl(slug) : null,
    webhookVerifyToken: doc.webhookVerifyToken ?? undefined,
    webhookVerificationStatus:
      (doc.webhookVerificationStatus as 'pending' | 'verified' | 'failed' | undefined) ?? 'pending',
    webhookVerifiedAt: doc.webhookVerifiedAt?.toISOString(),
    webhookLastVerifyAt: doc.webhookLastVerifyAt?.toISOString(),
    webhookLastVerifyError: doc.webhookLastVerifyError ?? undefined,
  };
}

export async function getMetaWhatsappConfig(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const oid = new Types.ObjectId(companyId);
  let doc = await MetaWhatsappConfigModel.findOne({ companyId: oid, deletedAt: null }).lean();

  if (doc && (!doc.webhookSlug || !doc.webhookVerifyToken)) {
    const patch: Record<string, string> = {};
    if (!doc.webhookSlug) patch.webhookSlug = await ensureUniqueWebhookSlug();
    if (!doc.webhookVerifyToken) patch.webhookVerifyToken = generateWebhookVerifyToken();
    doc = await MetaWhatsappConfigModel.findOneAndUpdate(
      { companyId: oid },
      { $set: patch },
      { new: true },
    ).lean();
  }

  if (!doc) {
    res.json({
      accessTokenConfigured: false,
      appSecretConfigured: false,
      configured: false,
      webhookUrl: null,
      webhookVerificationStatus: 'pending' as const,
    });
    return;
  }

  res.json(toConfigResponse(doc));
}

export async function upsertMetaWhatsappConfig(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const body = req.body as {
    accessToken?: string;
    appSecret?: string;
    wabaId?: string;
    appId?: string;
    webhookVerifyToken?: string;
    regenerateWebhookVerifyToken?: boolean;
  };

  const oid = new Types.ObjectId(companyId);
  const existing = await MetaWhatsappConfigModel.findOne({ companyId: oid, deletedAt: null }).lean();

  const set: Record<string, unknown> = { deletedAt: null };

  if (body.accessToken) {
    set.accessTokenEncrypted = encryptSecret(body.accessToken);
  } else if (!existing?.accessTokenEncrypted) {
    res.status(400).json({ error: 'Access token is required on first setup' });
    return;
  }

  if (body.appSecret) {
    set.appSecretEncrypted = encryptSecret(body.appSecret);
  } else if (!existing?.appSecretEncrypted) {
    res.status(400).json({ error: 'App secret is required on first setup' });
    return;
  }

  if (body.regenerateWebhookVerifyToken) {
    set.webhookVerifyToken = generateWebhookVerifyToken();
    set.webhookVerificationStatus = 'pending';
  } else if (body.webhookVerifyToken) {
    const taken = await MetaWhatsappConfigModel.findOne({
      webhookVerifyToken: body.webhookVerifyToken,
      companyId: { $ne: oid },
      deletedAt: null,
    }).lean();
    if (taken) {
      res.status(409).json({ error: 'This verify token is already used by another workspace' });
      return;
    }
    set.webhookVerifyToken = body.webhookVerifyToken;
    set.webhookVerificationStatus = 'pending';
  } else if (!existing?.webhookVerifyToken) {
    set.webhookVerifyToken = generateWebhookVerifyToken();
  }

  if (!existing?.webhookSlug) {
    set.webhookSlug = await ensureUniqueWebhookSlug();
  }

  if (body.wabaId !== undefined) {
    set.wabaId = body.wabaId || undefined;
  }

  if (body.appId !== undefined) {
    set.appId = body.appId || undefined;
  }

  const update: { $set: Record<string, unknown>; $setOnInsert: { companyId: Types.ObjectId }; $unset?: Record<string, ''> } =
    { $set: set, $setOnInsert: { companyId: oid } };

  if (body.regenerateWebhookVerifyToken) {
    update.$unset = { webhookVerifiedAt: '', webhookLastVerifyError: '' };
  }

  const doc = await MetaWhatsappConfigModel.findOneAndUpdate(
    { companyId: oid },
    update,
    { upsert: true, new: true },
  ).lean();

  await logActivity({
    companyId,
    userId: req.user?.sub ?? null,
    action: 'meta.whatsapp_config.upsert',
    resource: 'meta_whatsapp',
  });

  res.json(toConfigResponse(doc));
}
