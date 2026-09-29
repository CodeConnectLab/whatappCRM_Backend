import twilio from 'twilio';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { TwilioAccountModel } from './twilio-account.model.js';
import { decryptSecret } from '../../utils/encryption.js';
import { logger } from '../../utils/logger.js';
function twilioStatusCallbackUrl() {
    const base = env.PUBLIC_API_BASE_URL?.trim().replace(/\/$/, '');
    if (!base)
        return undefined;
    return `${base}/webhooks/twilio/status`;
}
export async function getTwilioClientForCompany(companyId) {
    const acc = await TwilioAccountModel.findOne({
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
    }).lean();
    if (!acc)
        return null;
    const token = decryptSecret(acc.authTokenEncrypted);
    return twilio(acc.accountSid, token);
}
/**
 * Basic-auth credentials for fetching an inbound MMS attachment.
 *
 * Twilio hosts inbound media behind the account's own credentials, so the URL in the
 * webhook is useless on its own — the file has to be pulled with these and copied into
 * our storage, exactly as with Meta.
 */
export async function getTwilioCredentials(companyId) {
    const acc = await TwilioAccountModel.findOne({
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
    }).lean();
    if (!acc)
        return null;
    return { accountSid: acc.accountSid, authToken: decryptSecret(acc.authTokenEncrypted) };
}
export async function sendTwilioWhatsappMessage(input) {
    const client = await getTwilioClientForCompany(input.companyId);
    if (!client)
        throw new Error('Twilio not configured');
    const from = input.fromNumber.startsWith('whatsapp:')
        ? input.fromNumber
        : `whatsapp:${input.fromNumber}`;
    const to = input.toPhone.startsWith('whatsapp:') ? input.toPhone : `whatsapp:${input.toPhone}`;
    const statusCallback = twilioStatusCallbackUrl();
    const msg = await client.messages.create({
        from,
        to,
        // Twilio rejects a blank body when there is no media; with media it is the caption.
        ...(input.body.trim() || !input.mediaUrl?.length ? { body: input.body } : {}),
        ...(input.mediaUrl?.length ? { mediaUrl: input.mediaUrl } : {}),
        ...(statusCallback
            ? { statusCallback, statusCallbackMethod: 'POST' }
            : {}),
    });
    logger.info('Twilio message created', { sid: msg.sid, companyId: input.companyId });
    return { sid: msg.sid };
}
