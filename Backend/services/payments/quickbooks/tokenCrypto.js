import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// QuickBooks tokens must be sent back to QuickBooks, so they cannot be hashed. They are stored AES-256-GCM encrypted with QUICKBOOKS_TOKEN_KEY
// (kept only in the backend environment). Format: v1.<iv>.<tag>.<ciphertext>, all base64url. A wrong key or any change to the text fails to decrypt.
const keyOf = (hexKey) => {
  if (!/^[0-9a-f]{64}$/i.test(String(hexKey ?? ''))) throw new Error('the QuickBooks token key is missing or malformed');
  return Buffer.from(hexKey, 'hex');
};

export const encryptToken = (plain, hexKey) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(hexKey), iv);
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
};

export const decryptToken = (stored, hexKey) => {
  const [version, iv, tag, body] = String(stored ?? '').split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('the stored QuickBooks token is not readable');
  const decipher = createDecipheriv('aes-256-gcm', keyOf(hexKey), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
};
