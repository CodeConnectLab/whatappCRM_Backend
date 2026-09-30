import { randomUUID } from 'crypto';
import { env, isS3MediaConfigured } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { makeMediaKey, presignGet, presignPut, putObject } from './s3.service.js';
function awsErrorCode(e) {
    if (typeof e !== 'object' || !e)
        return undefined;
    const err = e;
    return err.Code ?? err.name ?? (err.$metadata?.httpStatusCode ? String(err.$metadata.httpStatusCode) : undefined);
}
function message(e) {
    return e instanceof Error ? e.message : String(e);
}
/**
 * Proves, end to end, whether media storage actually works — rather than whether it is
 * merely configured.
 *
 * Presigning a URL is pure local crypto: it succeeds even when the credentials have no
 * permission to write and even when the bucket does not exist. So "presign worked but
 * the upload failed" is the normal shape of every media problem here, and the only way
 * to tell the cases apart is to do the round trip: write an object, sign a read for it,
 * fetch it back. Each step reports the AWS error code, which is the part that says what
 * to fix.
 */
export async function runMediaDiagnostics(companyId) {
    const steps = [];
    const advice = [];
    const configured = isS3MediaConfigured();
    steps.push({
        step: 'Credentials and bucket configured',
        ok: configured,
        ...(configured ? {} : { detail: 'S3_BUCKET, AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY is empty' }),
    });
    if (!configured) {
        advice.push('Set S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (and AWS_REGION) in the API’s .env, then restart it.');
        return { ok: false, configured, steps, advice };
    }
    const base = {
        bucket: env.S3_BUCKET,
        region: env.AWS_REGION,
        ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    };
    const key = makeMediaKey(companyId, `diagnostic-${randomUUID()}.txt`);
    const body = Buffer.from('wtsp media diagnostic', 'utf8');
    // 1. Server-side write. This is the step inbound WhatsApp media depends on.
    try {
        await putObject(key, body, 'text/plain');
        steps.push({ step: 'Server can write to the bucket', ok: true });
    }
    catch (e) {
        const code = awsErrorCode(e);
        steps.push({
            step: 'Server can write to the bucket',
            ok: false,
            detail: message(e),
            ...(code ? { code } : {}),
        });
        logger.error('Media diagnostics: putObject failed', { err: e });
        if (code === 'AccessDenied') {
            advice.push(`The API’s credentials cannot write to ${env.S3_BUCKET}. Attach an IAM policy allowing s3:PutObject and s3:GetObject on arn:aws:s3:::${env.S3_BUCKET}/*.`);
        }
        else if (code === 'NoSuchBucket') {
            advice.push(`Bucket "${env.S3_BUCKET}" does not exist in ${env.AWS_REGION}. Check the name and the region.`);
        }
        else if (code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch') {
            advice.push('The access key or secret is wrong. Re-copy both into the API’s .env and restart.');
        }
        else if (code === 'PermanentRedirect' || code === 'AuthorizationHeaderMalformed') {
            advice.push(`AWS_REGION does not match the bucket’s real region. Fix AWS_REGION and restart.`);
        }
        else {
            advice.push('The server could not write to the bucket — see the detail above and the API logs.');
        }
        advice.push('Inbound WhatsApp media cannot be stored until this step passes.');
        return { ok: false, configured, ...base, steps, advice };
    }
    // 2. Signed read. This is what the browser and WhatsApp both use to fetch media.
    let readUrl;
    try {
        readUrl = await presignGet(key, 300);
        steps.push({ step: 'Server can sign a read URL', ok: true });
    }
    catch (e) {
        steps.push({ step: 'Server can sign a read URL', ok: false, detail: message(e) });
        advice.push('Signing failed locally, which points at a malformed key or secret.');
        return { ok: false, configured, ...base, steps, advice };
    }
    try {
        const res = await fetch(readUrl);
        const ok = res.ok;
        steps.push({
            step: 'Signed read URL actually downloads',
            ok,
            ...(ok ? {} : { detail: `HTTP ${res.status}`, code: String(res.status) }),
        });
        if (!ok) {
            advice.push('The signed read URL was rejected. Usually the credentials lack s3:GetObject, or a bucket policy denies it.');
        }
    }
    catch (e) {
        steps.push({ step: 'Signed read URL actually downloads', ok: false, detail: message(e) });
        advice.push('The server could not reach the bucket over the network — check egress rules and S3_ENDPOINT.');
    }
    // 3. Presign a PUT. Always succeeds locally; included so the operator sees the URL the
    // browser will be sent to, which is how a wrong region or endpoint becomes obvious.
    try {
        const uploadUrl = await presignPut(makeMediaKey(companyId, 'diagnostic-upload.txt'), 'text/plain', 300);
        steps.push({
            step: 'Browser upload URL can be signed',
            ok: true,
            detail: new URL(uploadUrl).host,
        });
    }
    catch (e) {
        steps.push({ step: 'Browser upload URL can be signed', ok: false, detail: message(e) });
    }
    const ok = steps.every((s) => s.ok);
    // CORS cannot be tested from here — it is enforced by the browser, not by S3 — so it
    // is always worth naming, because it is the one cause that leaves the server looking
    // perfectly healthy while every upload from the app fails.
    advice.push(`Uploads happen browser → bucket directly, so ${env.S3_BUCKET} needs a CORS rule allowing PUT and GET from ${env.FRONTEND_URL} with the * header. Without it the browser blocks the upload and the app can only report a network error.`);
    return { ok, configured, ...base, steps, advice };
}
