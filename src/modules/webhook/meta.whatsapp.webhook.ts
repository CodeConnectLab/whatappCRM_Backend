import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { WhatsappNumberModel } from '../twilio/whatsapp-number.model.js';
import { MessageModel } from '../chat/message.model.js';
import { ChatModel } from '../chat/chat.model.js';
import { ensureInboundChat } from '../chat/chat.service.js';
import { emitToCompany } from '../../socket/io.js';
import { logger } from '../../utils/logger.js';
import { MetaWhatsappConfigModel } from '../meta/meta-whatsapp-config.model.js';
import { decryptSecret } from '../../utils/encryption.js';
import {
  extractPhoneNumberId,
  inboundMessageText,
  normalizeInboundPhone,
  normalizeReferral,
  type MetaWebhookBody,
  verifyMetaSignature,
} from '../meta/meta-webhook.utils.js';
import { pushChatToCrm } from '../crm/crm-bridge.service.js';

type MetaConfigLean = {
  companyId: Types.ObjectId;
  appSecretEncrypted?: string | null;
  webhookVerifyToken?: string | null;
};

async function recordWebhookVerifyResult(
  companyId: Types.ObjectId | undefined,
  ok: boolean,
  error?: string,
): Promise<void> {
  if (!companyId) return;
  const now = new Date();
  if (ok) {
    await MetaWhatsappConfigModel.updateOne(
      { companyId },
      {
        $set: {
          webhookLastVerifyAt: now,
          webhookVerificationStatus: 'verified',
          webhookVerifiedAt: now,
        },
        $unset: { webhookLastVerifyError: '' },
      },
    );
    return;
  }
  await MetaWhatsappConfigModel.updateOne(
    { companyId },
    {
      $set: {
        webhookLastVerifyAt: now,
        webhookVerificationStatus: 'failed',
        webhookLastVerifyError: error ?? 'Verification failed',
      },
      $unset: { webhookVerifiedAt: '' },
    },
  );
}

function getRawBody(req: Request): Buffer {
  const rawBody: Buffer | undefined = (req as Request & { rawBody?: Buffer }).rawBody;
  return rawBody ?? Buffer.from(JSON.stringify(req.body));
}

function resolveAppSecret(cfg: MetaConfigLean | null): string | undefined {
  if (cfg?.appSecretEncrypted) {
    try {
      return decryptSecret(cfg.appSecretEncrypted);
    } catch {
      return undefined;
    }
  }
  return env.META_APP_SECRET;
}

async function loadConfigBySlug(slug: string | undefined): Promise<MetaConfigLean | null> {
  if (!slug) return null;
  return MetaWhatsappConfigModel.findOne({ webhookSlug: slug, deletedAt: null }).lean();
}

async function loadConfigByVerifyToken(token: string): Promise<MetaConfigLean | null> {
  return MetaWhatsappConfigModel.findOne({ webhookVerifyToken: token, deletedAt: null }).lean();
}

async function loadConfigByCompanyId(companyId: Types.ObjectId): Promise<MetaConfigLean | null> {
  return MetaWhatsappConfigModel.findOne({ companyId, deletedAt: null }).lean();
}

export async function metaWhatsappVerify(req: Request, res: Response): Promise<void> {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const slug = typeof req.params.webhookSlug === 'string' ? req.params.webhookSlug : undefined;

  logger.info('Meta webhook verify attempt', {
    path: req.originalUrl,
    slug: slug ?? '(legacy)',
    mode,
    hasChallenge: typeof challenge === 'string',
    hasToken: typeof token === 'string',
  });

  if (mode !== 'subscribe' || typeof challenge !== 'string' || typeof token !== 'string') {
    logger.warn('Meta webhook verify rejected: invalid hub params', { mode, slug });
    res.sendStatus(403);
    return;
  }

  if (slug) {
    const cfg = await loadConfigBySlug(slug);
    if (cfg?.webhookVerifyToken && token === cfg.webhookVerifyToken) {
      await recordWebhookVerifyResult(cfg.companyId, true);
      logger.info('Meta webhook verify OK', { slug, companyId: String(cfg.companyId) });
      res.status(200).send(challenge);
      return;
    }
    await recordWebhookVerifyResult(
      cfg?.companyId,
      false,
      cfg ? 'Verify token does not match saved value for this workspace' : 'Unknown webhook slug',
    );
    logger.warn('Meta webhook verify failed for slug', {
      slug,
      foundTenant: Boolean(cfg),
      tokenMatch: Boolean(cfg && token === cfg.webhookVerifyToken),
    });
    res.sendStatus(403);
    return;
  }

  const byToken = await loadConfigByVerifyToken(token);
  if (byToken?.webhookVerifyToken) {
    await recordWebhookVerifyResult(byToken.companyId, true);
    logger.info('Meta webhook verify OK (by token)', { companyId: String(byToken.companyId) });
    res.status(200).send(challenge);
    return;
  }

  if (env.META_VERIFY_TOKEN && token === env.META_VERIFY_TOKEN) {
    logger.info('Meta webhook verify OK (env META_VERIFY_TOKEN)');
    res.status(200).send(challenge);
    return;
  }

  logger.warn('Meta webhook verify: no matching tenant verify token');
  res.sendStatus(403);
}

export async function metaWhatsappWebhook(req: Request, res: Response): Promise<void> {
  const raw = getRawBody(req);
  const signature = req.header('x-hub-signature-256');
  const slug = typeof req.params.webhookSlug === 'string' ? req.params.webhookSlug : undefined;
  const body = req.body as MetaWebhookBody;

  let tenantCfg = await loadConfigBySlug(slug);

  const phoneNumberId = extractPhoneNumberId(body);
  const wa = phoneNumberId
    ? await WhatsappNumberModel.findOne({
        metaPhoneNumberId: phoneNumberId,
        provider: 'meta',
        deletedAt: null,
      }).lean()
    : null;

  if (slug && tenantCfg && wa && String(wa.companyId) !== String(tenantCfg.companyId)) {
    logger.warn('Meta webhook: phone_number_id not owned by slug tenant', {
      slug,
      phoneNumberId,
    });
    res.status(403).json({ error: 'Sender does not belong to this workspace' });
    return;
  }

  if (!tenantCfg && wa) {
    tenantCfg = await loadConfigByCompanyId(wa.companyId as Types.ObjectId);
  }

  const appSecret = resolveAppSecret(tenantCfg);
  const signatureOk = appSecret ? verifyMetaSignature(raw, signature, appSecret) : false;

  if (!signatureOk) {
    if (!appSecret && env.NODE_ENV === 'development') {
      logger.warn('Meta webhook: skipping signature check (no app secret, development only)');
    } else {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  }

  try {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;
        const value = change.value;
        if (!value) continue;

        const inboundPhoneNumberId = value.metadata?.phone_number_id;
        if (!inboundPhoneNumberId) continue;

        const sender = await WhatsappNumberModel.findOne({
          metaPhoneNumberId: inboundPhoneNumberId,
          provider: 'meta',
          deletedAt: null,
        }).lean();

        if (!sender) {
          logger.warn('Meta inbound: unknown phone_number_id', { phoneNumberId: inboundPhoneNumberId });
          continue;
        }

        if (tenantCfg && String(sender.companyId) !== String(tenantCfg.companyId)) {
          logger.warn('Meta inbound: company mismatch for webhook tenant', {
            phoneNumberId: inboundPhoneNumberId,
          });
          continue;
        }

        const companyId = String(sender.companyId);
        const profileName = value.contacts?.[0]?.profile?.name;

        for (const m of value.messages ?? []) {
          if (!m.from) continue;
          // Every inbound type is kept. Dropping non-text used to lose any lead whose
          // first contact was an image or an ad button tap.
          const body = inboundMessageText(m);
          if (!body) continue;

          const fromPhone = normalizeInboundPhone(m.from);
          const sid = m.id ?? '';

          if (sid) {
            const exists = await MessageModel.exists({ twilioSid: sid });
            if (exists) continue;
          }

          const { chatId } = await ensureInboundChat({
            companyId,
            contactPhone: fromPhone,
            contactName: profileName,
            whatsappNumberId: new Types.ObjectId(sender._id),
          });

          const referral = normalizeReferral(m.referral);

          const msg = await MessageModel.create({
            companyId: new Types.ObjectId(companyId),
            chatId: new Types.ObjectId(chatId),
            direction: 'inbound',
            body,
            messageType: m.type ?? 'text',
            status: 'delivered',
            twilioSid: sid || undefined,
            referral,
            metaMediaId:
              m.image?.id ?? m.video?.id ?? m.audio?.id ?? m.document?.id ?? m.sticker?.id,
          });

          const created = await MessageModel.findById(msg._id).lean();

          const chatUpdate: Record<string, unknown> = {
            lastMessageAt: new Date(),
            lastMessagePreview: body.slice(0, 140),
          };
          // The referral rides only on the opening message of a conversation, so this
          // is the one chance to record which ad produced the lead.
          if (referral) {
            chatUpdate.referral = { ...referral, capturedAt: new Date() };
          }

          const existingChat = await ChatModel.findById(chatId)
            .select('firstInboundAt crmSyncStatus')
            .lean();
          const isFirstInbound = !existingChat?.firstInboundAt;
          if (isFirstInbound) {
            chatUpdate.firstInboundMessage = body;
            chatUpdate.firstInboundAt = new Date();
          }

          await ChatModel.updateOne(
            { _id: chatId },
            { $set: chatUpdate, $inc: { unreadCount: 1 } },
          );
          emitToCompany(companyId, 'message:new', { chatId, message: created });

          // Hand the lead to the client's CRM once per conversation. Detached on purpose:
          // Meta retires a webhook that does not answer within seconds, so a slow or down
          // CRM must never hold up the 200 or the inbox.
          if (isFirstInbound && !existingChat?.crmSyncStatus) {
            void pushChatToCrm(companyId, chatId).catch((err: unknown) => {
              logger.error('CRM bridge: unhandled push error', { companyId, chatId, err });
            });
          }
        }

        const statusMap: Record<string, 'delivered' | 'read' | 'failed' | 'sent'> = {
          delivered: 'delivered',
          read: 'read',
          failed: 'failed',
          sent: 'sent',
        };
        for (const st of value.statuses ?? []) {
          const sid = st.id ?? '';
          const next = statusMap[(st.status ?? '').toLowerCase()];
          if (!sid || !next) continue;

          const err = st.errors?.[0];
          const statusDetail =
            err?.error_data?.details ||
            err?.message ||
            err?.title ||
            (err?.code != null ? `Meta error ${err.code}` : undefined);

          const updated = await MessageModel.findOneAndUpdate(
            { twilioSid: sid },
            {
              $set: {
                status: next,
                ...(statusDetail ? { statusDetail } : {}),
              },
              ...(next !== 'failed' ? { $unset: { statusDetail: '' } } : {}),
            },
            { new: true },
          ).lean();

          if (updated) {
            emitToCompany(companyId, 'message:status', {
              chatId: String(updated.chatId),
              message: updated,
            });
          }
        }
      }
    }
    res.sendStatus(200);
  } catch (e) {
    logger.error('Meta webhook error', { err: e });
    res.sendStatus(500);
  }
}
