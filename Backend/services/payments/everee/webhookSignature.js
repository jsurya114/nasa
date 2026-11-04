import { createHmac, timingSafeEqual } from 'node:crypto';

// Checking that a webhook really comes from Everee (issue #31). Everee signs every event:
//   x-everee-webhook-timestamp: Unix seconds
//   x-everee-webhook-signature: one or more "v1=<hex>" separated by commas (two while a signing key is being rotated)
// The signed message is the timestamp, a dot, and the body EXACTLY as received (the raw bytes, never re-serialized JSON), with
// HMAC-SHA256 and the endpoint's signing key. Compared in constant time. An old or future timestamp is refused (replay protection).

export const SIGNATURE_HEADER = 'x-everee-webhook-signature';
export const TIMESTAMP_HEADER = 'x-everee-webhook-timestamp';
export const TOLERANCE_SECONDS = 120;

export const signPayload = (key, timestamp, rawBody) => createHmac('sha256', key).update(`${timestamp}.`).update(rawBody).digest('hex');

// Returns { ok: true } or { ok: false, reason } with reason: no_key, no_body, bad_timestamp, stale, no_signature or mismatch.
export const verifySignature = ({ rawBody, signatureHeader, timestampHeader, key, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = TOLERANCE_SECONDS }) => {
  if (!key) return { ok: false, reason: 'no_key' };
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) return { ok: false, reason: 'no_body' };
  const timestamp = String(timestampHeader ?? '').trim();
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'bad_timestamp' };
  if (Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) return { ok: false, reason: 'stale' };

  const given = String(signatureHeader ?? '').split(',').map((part) => part.trim()).filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));
  if (given.length === 0) return { ok: false, reason: 'no_signature' };
  const expected = Buffer.from(signPayload(key, timestamp, rawBody), 'hex');
  for (const hex of given) {
    const candidate = Buffer.from(hex, 'hex');
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return { ok: true };
  }
  return { ok: false, reason: 'mismatch' };
};
