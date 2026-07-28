import { Types } from 'mongoose';
import { MetaWhatsappConfigModel } from './meta-whatsapp-config.model.js';
import { decryptSecret } from '../../utils/encryption.js';
import { logger } from '../../utils/logger.js';
const GRAPH_API_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
function digitsOnly(phone) {
    return phone.replace(/\D/g, '');
}
/** Decrypted Meta credentials for a company. */
async function loadMetaConfig(companyId) {
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
        ...(cfg.appId?.trim() ? { appId: cfg.appId.trim() } : {}),
    };
}
/**
 * Meta rejections are almost always operator-fixable (bad category, missing
 * sample, expired token), so they are re-thrown as 400 with Meta's own wording —
 * a bare 500 would hide the one line that says how to fix it.
 */
function metaError(err, status) {
    const detail = err?.error_user_msg ?? err?.message ?? `Meta request failed (${status})`;
    const title = err?.error_user_title;
    const e = new Error(title ? `${title}: ${detail}` : detail);
    e.status = status >= 400 && status < 500 ? 400 : 502;
    return e;
}
async function graphRequest(url, token, init) {
    const res = await fetch(url, {
        method: init?.method ?? 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    });
    const json = (await res.json());
    if (!res.ok) {
        logger.warn('Meta Graph request failed', { url, status: res.status, json });
        throw metaError(json.error, res.status);
    }
    return json;
}
/**
 * Free-form text/image message. Only deliverable inside the 24-hour customer
 * service window — use `sendMetaWhatsappTemplate` to open a conversation.
 */
export async function sendMetaWhatsappMessage(input) {
    const { token } = await loadMetaConfig(input.companyId);
    const phoneNumberId = input.wa.metaPhoneNumberId?.trim();
    if (!phoneNumberId)
        throw new Error('Meta phone number id missing on sender');
    const to = digitsOnly(input.toPhone);
    if (!to)
        throw new Error('Invalid recipient phone');
    let payload;
    if (input.mediaUrl?.length) {
        const link = input.mediaUrl[0];
        payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'image',
            image: { link },
            ...(input.body.trim() ? { caption: input.body } : {}),
        };
    }
    else {
        payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { preview_url: false, body: input.body },
        };
    }
    const json = await graphRequest(`${GRAPH_BASE}/${phoneNumberId}/messages`, token, { method: 'POST', body: payload });
    const sid = json.messages?.[0]?.id ?? '';
    if (!sid)
        throw new Error('Meta send: no message id');
    logger.info('Meta WhatsApp message created', { sid, companyId: input.companyId });
    return { sid };
}
/**
 * Approved-template message. Works outside the 24-hour window, so this is what
 * campaigns and first-contact messages must use.
 */
export async function sendMetaWhatsappTemplate(input) {
    const { token } = await loadMetaConfig(input.companyId);
    const phoneNumberId = input.wa.metaPhoneNumberId?.trim();
    if (!phoneNumberId)
        throw new Error('Meta phone number id missing on sender');
    const to = digitsOnly(input.toPhone);
    if (!to)
        throw new Error('Invalid recipient phone');
    const components = [];
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
    const json = await graphRequest(`${GRAPH_BASE}/${phoneNumberId}/messages`, token, {
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
    });
    const sid = json.messages?.[0]?.id ?? '';
    if (!sid)
        throw new Error('Meta template send: no message id');
    logger.info('Meta WhatsApp template sent', {
        sid,
        template: input.templateName,
        companyId: input.companyId,
    });
    return { sid };
}
/** The App ID owning this token — needed for resumable uploads, not for messaging. */
async function resolveAppId(token, storedAppId) {
    if (storedAppId)
        return storedAppId;
    const json = await graphRequest(`${GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(token)}`, token);
    const appId = json.data?.app_id;
    if (!appId) {
        throw new Error('Could not determine your Meta App ID automatically — add it in Settings → WhatsApp (Meta)');
    }
    return appId;
}
/**
 * Uploads an image through Meta's Resumable Upload API and returns the handle.
 * Template creation rejects plain URLs in `example.header_handle`; only a handle
 * produced here is accepted. (Sending a template later *does* take a plain link.)
 */
async function uploadHeaderImage(token, appId, imageUrl) {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
        throw new Error(`Could not download the header image (${imgRes.status}) — is the URL public?`);
    }
    const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
    const bytes = Buffer.from(await imgRes.arrayBuffer());
    const session = await graphRequest(`${GRAPH_BASE}/${appId}/uploads?file_length=${bytes.length}&file_type=${encodeURIComponent(contentType)}`, token, { method: 'POST' });
    if (!session.id)
        throw new Error('Meta did not return an upload session');
    // Raw binary with an OAuth (not Bearer) header — cannot go through graphRequest.
    const res = await fetch(`${GRAPH_BASE}/${session.id}`, {
        method: 'POST',
        headers: { Authorization: `OAuth ${token}`, file_offset: '0' },
        body: new Uint8Array(bytes),
    });
    const json = (await res.json());
    if (!res.ok || !json.h) {
        logger.warn('Meta header image upload failed', { status: res.status, json });
        throw metaError(json.error, res.ok ? 502 : res.status);
    }
    logger.info('Meta header image uploaded', { appId, bytes: bytes.length });
    return json.h;
}
/** Realistic sample values — Meta rejects templates whose examples look like placeholders. */
const SAMPLE_VALUES = {
    name: 'Rahul',
    phone: '919876543210',
    email: 'rahul@example.com',
};
/**
 * Submits a template to Meta for review. Returns the new template id and its
 * initial status (usually PENDING).
 */
export async function submitMetaTemplate(input) {
    const { token, wabaId, appId: storedAppId } = await loadMetaConfig(input.companyId);
    if (!wabaId) {
        throw new Error('WABA ID missing — add it in Settings → WhatsApp (Meta) before submitting templates');
    }
    const components = [];
    if (input.headerImageUrl) {
        const appId = await resolveAppId(token, storedAppId);
        const handle = await uploadHeaderImage(token, appId, input.headerImageUrl);
        components.push({
            type: 'HEADER',
            format: 'IMAGE',
            example: { header_handle: [handle] },
        });
    }
    const bodyComponent = {
        type: 'BODY',
        text: input.positionalBody,
    };
    if (input.variables.length) {
        bodyComponent.example = {
            body_text: [input.variables.map((key) => SAMPLE_VALUES[key])],
        };
    }
    components.push(bodyComponent);
    const json = await graphRequest(`${GRAPH_BASE}/${wabaId}/message_templates`, token, {
        method: 'POST',
        body: {
            name: input.metaTemplateName,
            language: input.language,
            category: input.category,
            components,
        },
    });
    if (!json.id)
        throw new Error('Meta template submit: no template id returned');
    logger.info('Meta template submitted', {
        metaTemplateId: json.id,
        name: input.metaTemplateName,
        companyId: input.companyId,
    });
    return { metaTemplateId: json.id, status: json.status ?? 'PENDING' };
}
/** All templates Meta holds for this company's WABA. */
export async function fetchMetaTemplates(companyId) {
    const { token, wabaId } = await loadMetaConfig(companyId);
    if (!wabaId) {
        throw new Error('WABA ID missing — add it in Settings → WhatsApp (Meta) before syncing templates');
    }
    const json = await graphRequest(`${GRAPH_BASE}/${wabaId}/message_templates?limit=200&fields=id,name,status,category,language,rejected_reason`, token);
    return json.data ?? [];
}
/** Removes a template from Meta. Local rows are deleted separately. */
export async function deleteMetaTemplate(companyId, metaTemplateName) {
    const { token, wabaId } = await loadMetaConfig(companyId);
    if (!wabaId)
        return;
    await graphRequest(`${GRAPH_BASE}/${wabaId}/message_templates?name=${encodeURIComponent(metaTemplateName)}`, token, { method: 'DELETE' });
}
