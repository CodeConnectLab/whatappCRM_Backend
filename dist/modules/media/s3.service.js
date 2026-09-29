import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env, isS3MediaConfigured } from '../../config/env.js';
import { randomUUID } from 'crypto';
let _client = null;
function getS3Client() {
    if (!isS3MediaConfigured()) {
        throw new Error('S3-compatible storage is not configured');
    }
    if (!_client) {
        const clientConfig = {
            region: env.AWS_REGION,
            credentials: {
                accessKeyId: env.AWS_ACCESS_KEY_ID,
                secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            },
        };
        if (env.S3_ENDPOINT) {
            clientConfig.endpoint = env.S3_ENDPOINT;
            clientConfig.forcePathStyle = Boolean(env.S3_FORCE_PATH_STYLE);
        }
        _client = new S3Client(clientConfig);
    }
    return _client;
}
export async function presignPut(key, contentType, expires = 900) {
    const client = getS3Client();
    const cmd = new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        ContentType: contentType,
    });
    return getSignedUrl(client, cmd, { expiresIn: expires });
}
/**
 * Short-lived read URL for an object.
 *
 * Both the browser and Meta's own fetcher are served from here rather than from a
 * public bucket: Meta only needs the link for the few seconds it takes to pull the
 * file, and a signed URL keeps a customer's documents from being world-readable.
 */
export async function presignGet(key, expires = 3600) {
    const client = getS3Client();
    const cmd = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key });
    return getSignedUrl(client, cmd, { expiresIn: expires });
}
/** Server-side upload — used for attachments pulled off an inbound WhatsApp message. */
export async function putObject(key, body, contentType) {
    const client = getS3Client();
    await client.send(new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
    }));
}
export function makeMediaKey(companyId, filename) {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `companies/${companyId}/media/${randomUUID()}-${safe}`;
}
/** Public URL for an object key. When storage is not configured (local dev), returns a harmless placeholder. */
export function publicObjectUrl(key) {
    if (!isS3MediaConfigured()) {
        const base = env.FRONTEND_URL.replace(/\/$/, '');
        return `${base}/media/not-configured/${encodeURIComponent(key)}`;
    }
    if (env.S3_ENDPOINT) {
        const base = env.S3_ENDPOINT.replace(/\/$/, '');
        return `${base}/${env.S3_BUCKET}/${key}`;
    }
    return `https://${env.S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
}
export function getS3ClientOrNull() {
    if (!isS3MediaConfigured())
        return null;
    return getS3Client();
}
