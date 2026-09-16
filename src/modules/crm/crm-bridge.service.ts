import axios, { AxiosError } from 'axios';
import { Types } from 'mongoose';
import { CrmBridgeModel } from './crm-bridge.model.js';
import { ChatModel } from '../chat/chat.model.js';
import { ContactModel } from '../contact/contact.model.js';
import { decryptSecret, encryptSecret } from '../../utils/encryption.js';
import { logger } from '../../utils/logger.js';

const PUSH_TIMEOUT_MS = 10_000;

export type CrmBridgeView = {
  enabled: boolean;
  configured: boolean;
  crmBaseUrl?: string;
  apiKeyConfigured: boolean;
  pushMode: 'ad_only' | 'all_inbound';
  leadSourceLabel?: string;
  lastPushAt?: string;
  lastPushStatus?: string;
  lastPushError?: string;
  totalPushed: number;
  totalFailed: number;
};

type CrmBridgeDoc = {
  enabled?: boolean | null;
  crmBaseUrl?: string | null;
  crmApiKeyEncrypted?: string | null;
  pushMode?: string | null;
  leadSourceLabel?: string | null;
  lastPushAt?: Date | null;
  lastPushStatus?: string | null;
  lastPushError?: string | null;
  totalPushed?: number | null;
  totalFailed?: number | null;
};

function toView(doc: CrmBridgeDoc | null): CrmBridgeView {
  if (!doc) {
    return {
      enabled: false,
      configured: false,
      apiKeyConfigured: false,
      pushMode: 'ad_only',
      totalPushed: 0,
      totalFailed: 0,
    };
  }
  const apiKeyConfigured = Boolean(doc.crmApiKeyEncrypted);
  return {
    enabled: Boolean(doc.enabled),
    configured: apiKeyConfigured && Boolean(doc.crmBaseUrl),
    crmBaseUrl: doc.crmBaseUrl ?? undefined,
    apiKeyConfigured,
    pushMode: (doc.pushMode as 'ad_only' | 'all_inbound') ?? 'ad_only',
    leadSourceLabel: doc.leadSourceLabel ?? undefined,
    lastPushAt: doc.lastPushAt?.toISOString(),
    lastPushStatus: doc.lastPushStatus ?? undefined,
    lastPushError: doc.lastPushError ?? undefined,
    totalPushed: doc.totalPushed ?? 0,
    totalFailed: doc.totalFailed ?? 0,
  };
}

export async function getCrmBridge(companyId: string): Promise<CrmBridgeView> {
  const doc = await CrmBridgeModel.findOne({
    companyId: new Types.ObjectId(companyId),
    deletedAt: null,
  }).lean();
  return toView(doc);
}

export async function upsertCrmBridge(
  companyId: string,
  input: {
    enabled?: boolean;
    crmBaseUrl?: string;
    crmApiKey?: string;
    pushMode?: 'ad_only' | 'all_inbound';
    leadSourceLabel?: string;
  },
): Promise<CrmBridgeView> {
  const oid = new Types.ObjectId(companyId);
  const existing = await CrmBridgeModel.findOne({ companyId: oid, deletedAt: null }).lean();

  const set: Record<string, unknown> = { deletedAt: null };
  if (input.crmBaseUrl !== undefined) set.crmBaseUrl = input.crmBaseUrl.replace(/\/$/, '');
  if (input.crmApiKey) set.crmApiKeyEncrypted = encryptSecret(input.crmApiKey);
  if (input.pushMode !== undefined) set.pushMode = input.pushMode;
  if (input.leadSourceLabel !== undefined) set.leadSourceLabel = input.leadSourceLabel || undefined;

  if (input.enabled !== undefined) {
    const willHaveKey = Boolean(input.crmApiKey || existing?.crmApiKeyEncrypted);
    const willHaveUrl = Boolean(input.crmBaseUrl ?? existing?.crmBaseUrl);
    // Turning the bridge on without both halves would silently drop every lead, so
    // refuse it here rather than failing quietly on the first webhook.
    if (input.enabled && (!willHaveKey || !willHaveUrl)) {
      throw new Error('CRM base URL and API key are required before enabling the bridge');
    }
    set.enabled = input.enabled;
  }

  const doc = await CrmBridgeModel.findOneAndUpdate(
    { companyId: oid },
    { $set: set, $setOnInsert: { companyId: oid } },
    { upsert: true, new: true },
  ).lean();

  return toView(doc);
}

export async function deleteCrmBridge(companyId: string): Promise<void> {
  await CrmBridgeModel.updateOne(
    { companyId: new Types.ObjectId(companyId) },
    { $set: { deletedAt: new Date(), enabled: false } },
  );
}

/** Split a WhatsApp profile name into the first/last shape the CRM expects. */
function splitName(profileName: string | undefined | null): { firstName: string; lastName: string } {
  const name = (profileName ?? '').trim();
  if (!name) return { firstName: '', lastName: '' };
  const parts = name.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] ?? '', lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] ?? '' };
}

function errorText(e: unknown): string {
  if (e instanceof AxiosError) {
    const body = e.response?.data as { message?: string } | undefined;
    return body?.message ?? e.message;
  }
  return e instanceof Error ? e.message : 'unknown error';
}

export type CrmPushOutcome = 'synced' | 'duplicate' | 'skipped' | 'failed';

/**
 * Push one conversation to the client's CRM as a lead.
 *
 * Called once per chat, right after the opening inbound message, because that is the
 * only message carrying the ad referral. The CRM's own 30-day de-duplication decides
 * whether a repeat enquiry becomes a new lead, so re-sends here are harmless.
 */
export async function pushChatToCrm(companyId: string, chatId: string): Promise<CrmPushOutcome> {
  const oid = new Types.ObjectId(companyId);

  const bridge = await CrmBridgeModel.findOne({ companyId: oid, deletedAt: null }).lean();
  if (!bridge?.enabled || !bridge.crmBaseUrl || !bridge.crmApiKeyEncrypted) return 'skipped';

  const chat = await ChatModel.findOne({ _id: new Types.ObjectId(chatId), companyId: oid }).lean();
  if (!chat) return 'skipped';

  // Already handled — never create the same lead twice from a webhook retry.
  if (chat.crmSyncStatus === 'synced' || chat.crmSyncStatus === 'duplicate') return 'skipped';

  const referral = chat.referral;
  if ((bridge.pushMode ?? 'ad_only') === 'ad_only' && !referral?.ctwaClid) {
    await ChatModel.updateOne({ _id: chat._id }, { $set: { crmSyncStatus: 'skipped' } });
    return 'skipped';
  }

  const contact = await ContactModel.findById(chat.contactId).lean();
  if (!contact) return 'skipped';

  let apiKey: string;
  try {
    apiKey = decryptSecret(bridge.crmApiKeyEncrypted);
  } catch {
    logger.error('CRM bridge: could not decrypt API key', { companyId });
    await ChatModel.updateOne(
      { _id: chat._id },
      { $set: { crmSyncStatus: 'failed', crmSyncError: 'API key could not be decrypted' } },
    );
    return 'failed';
  }

  const { firstName, lastName } = splitName(contact.name);
  const adLabel = referral?.headline ?? bridge.leadSourceLabel ?? 'WhatsApp';

  const payload: Record<string, unknown> = {
    firstName: firstName || contact.phone,
    lastName,
    contactNumber: contact.phone,
    description: chat.firstInboundMessage ?? 'Lead from WhatsApp',
    // Reuse the CRM's existing Facebook ad columns so the lead lists light up without
    // a second set of campaign fields.
    campaignName: adLabel,
    adName: referral?.headline ?? adLabel,
    fbLeadGenAdId: referral?.sourceId,
    // WhatsApp-specific columns added to the CRM's lead schema alongside these.
    waId: contact.phone,
    waChatId: String(chat._id),
    waCtwaClid: referral?.ctwaClid,
    waSourceId: referral?.sourceId,
    waSourceType: referral?.sourceType,
    waSourceUrl: referral?.sourceUrl,
    waAdHeadline: referral?.headline,
    waAdBody: referral?.adBody,
    waFirstMessage: chat.firstInboundMessage,
  };
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined || payload[key] === '') delete payload[key];
  }

  try {
    const res = await axios.post<{
      error?: boolean;
      message?: string;
      data?: { lead?: { _id?: string }; duplicate?: boolean };
    }>(`${bridge.crmBaseUrl}/outsource-lead`, payload, {
      params: { apikey: apiKey },
      timeout: PUSH_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    });

    const duplicate = Boolean(res.data?.data?.duplicate);
    const leadId = res.data?.data?.lead?._id;
    const outcome: CrmPushOutcome = duplicate ? 'duplicate' : 'synced';

    await ChatModel.updateOne(
      { _id: chat._id },
      {
        $set: {
          crmSyncStatus: outcome,
          crmLeadId: leadId,
          crmSyncedAt: new Date(),
        },
        $unset: { crmSyncError: '' },
        $inc: { crmSyncAttempts: 1 },
      },
    );
    await CrmBridgeModel.updateOne(
      { companyId: oid },
      {
        $set: { lastPushAt: new Date(), lastPushStatus: outcome },
        $unset: { lastPushError: '' },
        $inc: { totalPushed: 1 },
      },
    );

    logger.info('CRM bridge: lead pushed', { companyId, chatId, outcome, leadId });
    return outcome;
  } catch (e) {
    const message = errorText(e);
    logger.error('CRM bridge: push failed', { companyId, chatId, err: message });

    await ChatModel.updateOne(
      { _id: chat._id },
      {
        $set: { crmSyncStatus: 'failed', crmSyncError: message },
        $inc: { crmSyncAttempts: 1 },
      },
    );
    await CrmBridgeModel.updateOne(
      { companyId: oid },
      {
        $set: { lastPushAt: new Date(), lastPushStatus: 'failed', lastPushError: message },
        $inc: { totalFailed: 1 },
      },
    );
    return 'failed';
  }
}

/**
 * Send a throwaway lead so the client can confirm the CRM credentials before any real
 * traffic depends on them. Nothing is written to chats; only the bridge stats move.
 */
export async function testCrmBridge(companyId: string): Promise<{ ok: boolean; message: string }> {
  const oid = new Types.ObjectId(companyId);
  const bridge = await CrmBridgeModel.findOne({ companyId: oid, deletedAt: null }).lean();
  if (!bridge?.crmBaseUrl || !bridge.crmApiKeyEncrypted) {
    return { ok: false, message: 'Save the CRM base URL and API key first' };
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(bridge.crmApiKeyEncrypted);
  } catch {
    return { ok: false, message: 'Stored API key could not be decrypted — save it again' };
  }

  // A number in the reserved +91 99999 range so a stray test never collides with a
  // real customer's lead in the CRM.
  const testPhone = '+919999900001';
  try {
    const res = await axios.post<{ message?: string; data?: { duplicate?: boolean } }>(
      `${bridge.crmBaseUrl}/outsource-lead`,
      {
        firstName: 'WTSP Connection Test',
        contactNumber: testPhone,
        description: 'Test lead from the WhatsApp panel — safe to delete.',
        campaignName: 'WTSP Test',
      },
      { params: { apikey: apiKey }, timeout: PUSH_TIMEOUT_MS },
    );
    const duplicate = Boolean(res.data?.data?.duplicate);
    await CrmBridgeModel.updateOne(
      { companyId: oid },
      { $set: { lastPushAt: new Date(), lastPushStatus: 'test-ok' }, $unset: { lastPushError: '' } },
    );
    return {
      ok: true,
      message: duplicate
        ? 'Connected. The CRM already had this test lead and de-duplicated it.'
        : 'Connected. A test lead was created in the CRM — you can delete it.',
    };
  } catch (e) {
    const message = errorText(e);
    await CrmBridgeModel.updateOne(
      { companyId: oid },
      { $set: { lastPushAt: new Date(), lastPushStatus: 'test-failed', lastPushError: message } },
    );
    return { ok: false, message };
  }
}
