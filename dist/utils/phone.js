import { z } from 'zod';
/** E.164: + followed by 8–15 digits (country code + subscriber). */
export const e164PhoneSchema = z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, 'Phone must be E.164 format (e.g. +15551234567)');
export function normalizeE164(phone) {
    const trimmed = phone.trim();
    if (trimmed.startsWith('+'))
        return trimmed;
    return `+${trimmed.replace(/\D/g, '')}`;
}
