import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env, isS3MediaConfigured } from '../../config/env.js';
import { randomUUID } from 'crypto';

/** Narrow config avoids `ConstructorParameters<S3Client>` expanding the full AWS SDK type graph (can OOM `tsc`). */
type LocalS3ClientConfig = {
  region: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
  endpoint?: string;
  forcePathStyle?: boolean;
};

let _client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!isS3MediaConfigured()) {
    throw new Error('S3-compatible storage is not configured');
  }
  if (!_client) {
    const clientConfig: LocalS3ClientConfig = {
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

export async function presignPut(key: string, contentType: string, expires = 900): Promise<string> {
  const client = getS3Client();
  const cmd = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, cmd, { expiresIn: expires });
}

export function makeMediaKey(companyId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `companies/${companyId}/media/${randomUUID()}-${safe}`;
}

/** Public URL for an object key. When storage is not configured (local dev), returns a harmless placeholder. */
export function publicObjectUrl(key: string): string {
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

export function getS3ClientOrNull(): S3Client | null {
  if (!isS3MediaConfigured()) return null;
  return getS3Client();
}
