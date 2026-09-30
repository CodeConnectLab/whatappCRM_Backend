import { Types } from 'mongoose';
import { MediaModel } from './media.model.js';
import { MessageModel } from '../chat/message.model.js';
import { downloadMetaMedia } from '../meta/meta.service.js';
import { getTwilioCredentials } from '../twilio/twilio.service.js';
import { makeMediaKey, presignGet, publicObjectUrl, putObject } from './s3.service.js';
import { mediaKindFromMime } from './media-kind.js';
import { isS3MediaConfigured } from '../../config/env.js';
import { emitToCompany } from '../../socket/io.js';
import { logger } from '../../utils/logger.js';

/** Extension for a stored inbound file, so a downloaded document opens in the right app. */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

function fallbackFilename(mimeType: string, metaMediaId: string): string {
  const ext = EXTENSIONS[mimeType] ?? 'bin';
  return `${metaMediaId.slice(-12)}.${ext}`;
}

/**
 * Copies an inbound WhatsApp attachment into our own storage and attaches it to the
 * message.
 *
 * Meta's download URL lives for minutes and needs the access token, so the only way an
 * agent can still open yesterday's photo is if we fetched it at delivery time. Failures
 * are logged and swallowed: the message row already exists with a `[image]` body, and a
 * missing thumbnail must never cost the workspace a lead.
 *
 * Call it detached from the webhook — the download is a network round trip and Meta
 * retires a webhook that does not answer quickly.
 */
export async function ingestInboundMedia(input: {
  companyId: string;
  chatId: string;
  messageId: string;
  metaMediaId: string;
  /** Filename WhatsApp supplied for a document send. */
  filename?: string;
  /** mime_type from the webhook payload; the Graph lookup is authoritative. */
  mimeTypeHint?: string;
}): Promise<void> {
  if (!isS3MediaConfigured()) {
    logger.warn('Inbound media skipped: object storage not configured', {
      companyId: input.companyId,
      messageId: input.messageId,
    });
    await markMediaUnavailable(
      input,
      'Media storage is not configured, so this file could not be saved.',
    );
    return;
  }

  try {
    const { buffer, mimeType, size } = await downloadMetaMedia(input.companyId, input.metaMediaId);
    const effectiveMime = mimeType || input.mimeTypeHint || 'application/octet-stream';
    const filename = input.filename?.trim() || fallbackFilename(effectiveMime, input.metaMediaId);
    const key = makeMediaKey(input.companyId, filename);

    await putObject(key, buffer, effectiveMime);

    const media = await MediaModel.create({
      companyId: new Types.ObjectId(input.companyId),
      key,
      url: publicObjectUrl(key),
      mimeType: effectiveMime,
      filename,
      size,
      source: 'inbound',
    });

    const kind = mediaKindFromMime(effectiveMime);
    await MessageModel.updateOne(
      { _id: new Types.ObjectId(input.messageId) },
      {
        $set: {
          mediaId: media._id,
          media: {
            mediaId: media._id,
            key,
            url: publicObjectUrl(key),
            mimeType: effectiveMime,
            filename,
            size,
            kind,
          },
        },
      },
    );

    // The inbox already rendered this message without its attachment, so push the
    // finished row rather than leaving a placeholder until the next refetch.
    const updated = await MessageModel.findById(new Types.ObjectId(input.messageId)).lean();
    if (updated) {
      const url = await presignGet(key).catch(() => publicObjectUrl(key));
      emitToCompany(input.companyId, 'message:media', {
        chatId: input.chatId,
        message: { ...updated, media: { ...(updated.media ?? {}), url } },
      });
    }

    logger.info('Inbound media stored', {
      companyId: input.companyId,
      messageId: input.messageId,
      kind,
      size,
    });
  } catch (e) {
    logger.error('Inbound media ingest failed', {
      companyId: input.companyId,
      messageId: input.messageId,
      metaMediaId: input.metaMediaId,
      err: e,
    });
    await markMediaUnavailable(
      input,
      e instanceof Error ? e.message : 'The file could not be downloaded from WhatsApp.',
    );
  }
}

/**
 * Leaves a reason on the message so the inbox can say the attachment is missing and
 * why, instead of rendering a bare "[image]" that looks like the customer typed it.
 */
async function markMediaUnavailable(
  input: { companyId: string; chatId: string; messageId: string; filename?: string },
  reason: string,
): Promise<void> {
  try {
    await MessageModel.updateOne(
      { _id: new Types.ObjectId(input.messageId) },
      {
        $set: {
          media: {
            ...(input.filename ? { filename: input.filename } : {}),
            unavailableReason: reason.slice(0, 300),
          },
        },
      },
    );
    const updated = await MessageModel.findById(new Types.ObjectId(input.messageId)).lean();
    if (updated) {
      emitToCompany(input.companyId, 'message:media', {
        chatId: input.chatId,
        message: updated,
      });
    }
  } catch (err) {
    logger.warn('Could not record media failure on the message', { err });
  }
}

/**
 * Stores an attachment from a Twilio inbound message.
 *
 * Twilio serves inbound media from its own API behind the account's basic-auth
 * credentials, so — as with Meta — the file has to be fetched now and kept, or the chat
 * ends up pointing at something the browser cannot open.
 */
export async function ingestTwilioInboundMedia(input: {
  companyId: string;
  chatId: string;
  messageId: string;
  mediaUrl: string;
  mimeTypeHint?: string;
}): Promise<void> {
  if (!isS3MediaConfigured()) {
    logger.warn('Inbound Twilio media skipped: object storage not configured', {
      companyId: input.companyId,
      messageId: input.messageId,
    });
    await markMediaUnavailable(
      input,
      'Media storage is not configured, so this file could not be saved.',
    );
    return;
  }

  try {
    const creds = await getTwilioCredentials(input.companyId);
    if (!creds) throw new Error('Twilio credentials not configured');

    const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64');
    const res = await fetch(input.mediaUrl, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) throw new Error(`Twilio media download failed (${res.status})`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const effectiveMime =
      res.headers.get('content-type')?.split(';')[0]?.trim() ||
      input.mimeTypeHint ||
      'application/octet-stream';
    // Twilio's URL ends in the media SID, which is the only name we get.
    const sidPart = input.mediaUrl.split('/').pop() ?? 'attachment';
    const filename = fallbackFilename(effectiveMime, sidPart);
    const key = makeMediaKey(input.companyId, filename);

    await putObject(key, buffer, effectiveMime);

    const media = await MediaModel.create({
      companyId: new Types.ObjectId(input.companyId),
      key,
      url: publicObjectUrl(key),
      mimeType: effectiveMime,
      filename,
      size: buffer.length,
      source: 'inbound',
    });

    const kind = mediaKindFromMime(effectiveMime);
    await MessageModel.updateOne(
      { _id: new Types.ObjectId(input.messageId) },
      {
        $set: {
          mediaId: media._id,
          media: {
            mediaId: media._id,
            key,
            url: publicObjectUrl(key),
            mimeType: effectiveMime,
            filename,
            size: buffer.length,
            kind,
          },
        },
      },
    );

    const updated = await MessageModel.findById(new Types.ObjectId(input.messageId)).lean();
    if (updated) {
      const url = await presignGet(key).catch(() => publicObjectUrl(key));
      emitToCompany(input.companyId, 'message:media', {
        chatId: input.chatId,
        message: { ...updated, media: { ...(updated.media ?? {}), url } },
      });
    }
  } catch (e) {
    logger.error('Twilio inbound media ingest failed', {
      companyId: input.companyId,
      messageId: input.messageId,
      err: e,
    });
    await markMediaUnavailable(
      input,
      e instanceof Error ? e.message : 'The file could not be downloaded from Twilio.',
    );
  }
}
