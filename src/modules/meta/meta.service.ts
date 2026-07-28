import { Types } from 'mongoose';
import { MetaWhatsappConfigModel } from './meta-whatsapp-config.model.js';
import { decryptSecret } from '../../utils/encryption.js';
import { logger } from '../../utils/logger.js';
import type { TemplateVariable } from '../template/template.service.js';

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, '');
}

type MetaGraphTextResponse = {
  messages?: { id: string }[];
  error?: { message: string };
};

/** Decrypted Meta credentials for a company. */
async function loadMetaConfig(companyId: string): Promise<{ token: string; wabaId?: string }> {
  const cfg = await MetaWhatsappConfigModel.findOne({
    companyId: new Types.ObjectId(companyId),
    deletedAt: null,
  }).lean();
  if (!cfg?.accessTokenEncrypted) {
    throw new Error('Meta WhatsApp credentials not configured in Settings');
  }
  return {
    token: decryptSecret(cfg.accessTokenEncrypted),
    ...(cfg.wabaId?.trim() ? { wabaId: cfg.wabaId.trim() } : {}),
  };
}

async function graphRequest<T>(
  url: string,
  token: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const json = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) {
    logger.warn('Meta Graph request failed', { url, status: res.status, json });
    throw new Error(json.error?.message ?? `Meta request failed (${res.status})`);
  }
  return json;
}

/**
 * Free-form text/image message. Only deliverable inside the 24-hour customer
 * service window — use `sendMetaWhatsappTemplate` to open a conversation.
 */
export async function sendMetaWhatsappMessage(input: {
  companyId: string;
  wa: { metaPhoneNumberId?: string | null; phoneNumber: string };
  toPhone: string;
  body: string;
  mediaUrl?: string[];
}): Promise<{ sid: string }> {
  const { token } = await loadMetaConfig(input.companyId);

  const phoneNumberId = input.wa.metaPhoneNumberId?.trim();
  if (!phoneNumberId) throw new Error('Meta phone number id missing on sender');

  const to = digitsOnly(input.toPhone);
  if (!to) throw new Error('Invalid recipient phone');

  let payload: Record<string, unknown>;

  if (input.mediaUrl?.length) {
    const link = input.mediaUrl[0]!;
    payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'image',
      image: { link },
      ...(input.body.trim() ? { caption: input.body } : {}),
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: input.body },
    };
  }

  const json = await graphRequest<MetaGraphTextResponse>(
    `${GRAPH_BASE}/${phoneNumberId}/messages`,
    token,
    { method: 'POST', body: payload },
  );

  const sid = json.messages?.[0]?.id ?? '';
  if (!sid) throw new Error('Meta send: no message id');
  logger.info('Meta WhatsApp message created', { sid, companyId: input.companyId });
  return { sid };
}

/**
 * Approved-template message. Works outside the 24-hour window, so this is what
 * campaigns and first-contact messages must use.
 */
export async function sendMetaWhatsappTemplate(input: {
  companyId: string;
  wa: { metaPhoneNumberId?: string | null; phoneNumber: string };
  toPhone: string;
  templateName: string;
  language: string;
  /** Values for {{1}}, {{2}}, ... in order. */
  parameters: string[];
  /** Public HTTPS image for templates that carry an IMAGE header. */
  headerImageUrl?: string;
}): Promise<{ sid: string }> {
  const { token } = await loadMetaConfig(input.companyId);

  const phoneNumberId = input.wa.metaPhoneNumberId?.trim();
  if (!phoneNumberId) throw new Error('Meta phone number id missing on sender');

  const to = digitsOnly(input.toPhone);
  if (!to) throw new Error('Invalid recipient phone');

  const components: Record<string, unknown>[] = [];
  if (input.headerImageUrl) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { link: input.headerImageUrl } }],
    });
  }
  if (input.parameters.length) {
    components.push({
      type: 'body',
      parameters: input.parameters.map((text) => ({ type: 'text', text })),
    });
  }

  const json = await graphRequest<MetaGraphTextResponse>(
    `${GRAPH_BASE}/${phoneNumberId}/messages`,
    token,
    {
      method: 'POST',
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: input.templateName,
          language: { code: input.language },
          ...(components.length ? { components } : {}),
        },
      },
    },
  );

  const sid = json.messages?.[0]?.id ?? '';
  if (!sid) throw new Error('Meta template send: no message id');
  logger.info('Meta WhatsApp template sent', {
    sid,
    template: input.templateName,
    companyId: input.companyId,
  });
  return { sid };
}

/** Realistic sample values — Meta rejects templates whose examples look like placeholders. */
const SAMPLE_VALUES: Record<TemplateVariable, string> = {
  name: 'Rahul',
  phone: '919876543210',
  email: 'rahul@example.com',
};

/**
 * Submits a template to Meta for review. Returns the new template id and its
 * initial status (usually PENDING).
 */
export async function submitMetaTemplate(input: {
  companyId: string;
  /** Lowercase snake_case name. */
  metaTemplateName: string;
  /** Body text already rewritten to {{1}}, {{2}}, ... */
  positionalBody: string;
  variables: TemplateVariable[];
  category: string;
  language: string;
  headerImageUrl?: string;
}): Promise<{ metaTemplateId: string; status: string }> {
  const { token, wabaId } = await loadMetaConfig(input.companyId);
  if (!wabaId) {
    throw new Error('WABA ID missing — add it in Settings → WhatsApp (Meta) before submitting templates');
  }

  const components: Record<string, unknown>[] = [];

  if (input.headerImageUrl) {
    components.push({
      type: 'HEADER',
      format: 'IMAGE',
      example: { header_handle: [input.headerImageUrl] },
    });
  }

  const bodyComponent: Record<string, unknown> = {
    type: 'BODY',
    text: input.positionalBody,
  };
  if (input.variables.length) {
    bodyComponent.example = {
      body_text: [input.variables.map((key) => SAMPLE_VALUES[key])],
    };
  }
  components.push(bodyComponent);

  const json = await graphRequest<{ id?: string; status?: string }>(
    `${GRAPH_BASE}/${wabaId}/message_templates`,
    token,
    {
      method: 'POST',
      body: {
        name: input.metaTemplateName,
        language: input.language,
        category: input.category,
        components,
      },
    },
  );

  if (!json.id) throw new Error('Meta template submit: no template id returned');
  logger.info('Meta template submitted', {
    metaTemplateId: json.id,
    name: input.metaTemplateName,
    companyId: input.companyId,
  });
  return { metaTemplateId: json.id, status: json.status ?? 'PENDING' };
}

export type MetaTemplateSummary = {
  id: string;
  name: string;
  status: string;
  category?: string;
  language?: string;
  rejected_reason?: string;
};

/** All templates Meta holds for this company's WABA. */
export async function fetchMetaTemplates(companyId: string): Promise<MetaTemplateSummary[]> {
  const { token, wabaId } = await loadMetaConfig(companyId);
  if (!wabaId) {
    throw new Error('WABA ID missing — add it in Settings → WhatsApp (Meta) before syncing templates');
  }

  const json = await graphRequest<{ data?: MetaTemplateSummary[] }>(
    `${GRAPH_BASE}/${wabaId}/message_templates?limit=200&fields=id,name,status,category,language,rejected_reason`,
    token,
  );
  return json.data ?? [];
}

/** Removes a template from Meta. Local rows are deleted separately. */
export async function deleteMetaTemplate(companyId: string, metaTemplateName: string): Promise<void> {
  const { token, wabaId } = await loadMetaConfig(companyId);
  if (!wabaId) return;
  await graphRequest(
    `${GRAPH_BASE}/${wabaId}/message_templates?name=${encodeURIComponent(metaTemplateName)}`,
    token,
    { method: 'DELETE' },
  );
}
