import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { env } from '../config/env.js';
const IV_LENGTH = 12;
const SALT = 'wtsp-twilio-salt';
function getKey() {
    return scryptSync(Buffer.from(env.ENCRYPTION_KEY, 'hex'), SALT, 32);
}
export function encryptSecret(plain) {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
}
export function decryptSecret(payload) {
    const buf = Buffer.from(payload, 'base64');
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
    const data = buf.subarray(IV_LENGTH + 16);
    const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
