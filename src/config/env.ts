import 'dotenv/config';
import { z } from 'zod';

const emptyToString = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : '';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(4000),
    MONGODB_URI: z.string().min(1),
    REDIS_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRES: z.string().default('15m'),
    JWT_REFRESH_EXPIRES: z.string().default('7d'),
    ENCRYPTION_KEY: z.string().length(64).regex(/^[0-9a-f]+$/i),
    FRONTEND_URL: z.string().url(),
    /**
     * Legacy single-app Meta dev fallback only. Production multi-tenant: App Secret + Verify Token
     * per company in Settings (database). PUBLIC_API_BASE_URL builds per-tenant webhook URLs.
     */
    META_APP_SECRET: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().optional(),
    ),
    META_VERIFY_TOKEN: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().optional(),
    ),
    /**
     * Public HTTPS origin of this API (no trailing slash), e.g. https://abc.trycloudflare.com or your prod domain.
     * Used to build Twilio status callback URLs on outbound WhatsApp sends. Incoming webhooks must still be set in Twilio Console.
     */
    PUBLIC_API_BASE_URL: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().url().optional(),
    ),
    TWILIO_WEBHOOK_AUTH_TOKEN: z.string().optional(),
    AWS_REGION: z.string().default('us-east-1'),
    /** Set with MinIO (docker) or AWS. In development, leave empty to run without object storage. */
    S3_BUCKET: z.preprocess(emptyToString, z.string()),
    AWS_ACCESS_KEY_ID: z.preprocess(emptyToString, z.string()),
    AWS_SECRET_ACCESS_KEY: z.preprocess(emptyToString, z.string()),
    S3_ENDPOINT: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().url().optional(),
    ),
    S3_FORCE_PATH_STYLE: z
      .string()
      .optional()
      .transform((v) => v === 'true' || v === '1'),
    LOG_LEVEL: z.string().default('info'),
    SMTP_URL: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV !== 'production') return;
    if (!data.S3_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        message: 'S3_BUCKET is required in production',
        path: ['S3_BUCKET'],
      });
    }
    if (!data.AWS_ACCESS_KEY_ID) {
      ctx.addIssue({
        code: 'custom',
        message: 'AWS_ACCESS_KEY_ID is required in production (or MinIO key)',
        path: ['AWS_ACCESS_KEY_ID'],
      });
    }
    if (!data.AWS_SECRET_ACCESS_KEY) {
      ctx.addIssue({
        code: 'custom',
        message: 'AWS_SECRET_ACCESS_KEY is required in production (or MinIO secret)',
        path: ['AWS_SECRET_ACCESS_KEY'],
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

/**
 * Values copied straight out of `.env.example`.
 *
 * These are published in the repository, so anything still using them is effectively
 * running with no secret at all: the JWT secrets let anyone mint a token for any user,
 * and the encryption key is what protects stored Meta and CRM credentials at rest.
 * Copying the example file and filling in only the parts that produce a visible error
 * is an easy mistake, and nothing used to catch it.
 */
const PLACEHOLDER_SECRETS: Record<string, string> = {
  JWT_ACCESS_SECRET: 'change-me-access-secret-min-32-chars-long-please',
  JWT_REFRESH_SECRET: 'change-me-refresh-secret-min-32-chars-long-please',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

const usingPlaceholders = Object.entries(PLACEHOLDER_SECRETS)
  .filter(([key, placeholder]) => (env as Record<string, unknown>)[key] === placeholder)
  .map(([key]) => key);

if (usingPlaceholders.length) {
  const list = usingPlaceholders.join(', ');
  // Refuses in production, shouts in development — a development server often is the
  // production server with NODE_ENV never changed, which is exactly how this survives.
  if (env.NODE_ENV === 'production') {
    console.error(
      `Refusing to start: ${list} still hold the example values from .env.example. ` +
        'Generate real ones: openssl rand -hex 32',
    );
    process.exit(1);
  }
  console.warn(
    `\n⚠️  ${list} still hold the example values from .env.example.\n` +
      '   Anyone can read them in the repo. On a server reachable from the internet this\n' +
      '   means forged logins and unprotected stored credentials.\n' +
      '   Generate real ones with:  openssl rand -hex 32\n',
  );
}

/** True when MinIO or AWS credentials are set (presigned uploads will work). */
export function isS3MediaConfigured(): boolean {
  return Boolean(
    env.S3_BUCKET.length > 0 &&
      env.AWS_ACCESS_KEY_ID.length > 0 &&
      env.AWS_SECRET_ACCESS_KEY.length > 0,
  );
}
