/** WhatsApp message buckets an attachment can be delivered as. */
export const MEDIA_KINDS = ['image', 'video', 'audio', 'document', 'sticker'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * Limits Meta enforces per bucket (WhatsApp Cloud API). Rejecting oversize files here
 * turns an opaque Graph error into a sentence the agent can act on.
 */
export const MEDIA_SIZE_LIMITS: Record<MediaKind, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
  sticker: 512 * 1024,
};

/** Types WhatsApp accepts. Anything else has to go out as a document or not at all. */
const IMAGE_TYPES = ['image/jpeg', 'image/png'];
const STICKER_TYPES = ['image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/3gpp'];
const AUDIO_TYPES = ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg', 'audio/opus'];

export function mediaKindFromMime(mimeType: string): MediaKind {
  const mime = mimeType.split(';')[0]!.trim().toLowerCase();
  if (STICKER_TYPES.includes(mime)) return 'sticker';
  if (IMAGE_TYPES.includes(mime)) return 'image';
  if (VIDEO_TYPES.includes(mime)) return 'video';
  if (AUDIO_TYPES.includes(mime)) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

/**
 * Whether WhatsApp will take this file in its natural bucket. An unsupported image
 * (HEIC, GIF, SVG) still goes through as a document, which is better than failing.
 */
export function deliverableKind(mimeType: string): MediaKind {
  const mime = mimeType.split(';')[0]!.trim().toLowerCase();
  const kind = mediaKindFromMime(mime);
  if (kind === 'image' && !IMAGE_TYPES.includes(mime)) return 'document';
  if (kind === 'video' && !VIDEO_TYPES.includes(mime)) return 'document';
  if (kind === 'audio' && !AUDIO_TYPES.includes(mime)) return 'document';
  return kind;
}

export function assertWithinSizeLimit(kind: MediaKind, size: number): void {
  const limit = MEDIA_SIZE_LIMITS[kind];
  if (size > limit) {
    throw new Error(
      `${kind} attachments must be ${Math.round(limit / (1024 * 1024))} MB or smaller for WhatsApp`,
    );
  }
}
