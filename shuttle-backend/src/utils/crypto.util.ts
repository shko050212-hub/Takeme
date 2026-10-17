import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
// Master encryption key derived using SHA-256 from env variable or a persistent secret key
const MASTER_SECRET = process.env.ENCRYPTION_KEY || 'TakemeSecureMasterKey2026!@#$';
const KEY = crypto.createHash('sha256').update(MASTER_SECRET).digest();

export function encrypt(data: any): string | null {
  if (data === null || data === undefined) return data;
  const text = typeof data === 'object' ? JSON.stringify(data) : String(data);
  if (!text) return text;
  if (text.startsWith('enc:')) return text; // already encrypted

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return `enc:${iv.toString('hex')}:${tag}:${encrypted}`;
}

export function decrypt(text: string | null | undefined): any {
  if (!text || typeof text !== 'string') return text;
  if (!text.startsWith('enc:')) {
    // If not encrypted, return as is (parse json if applicable)
    try {
      if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
        return JSON.parse(text);
      }
    } catch (e) {}
    return text;
  }

  try {
    const parts = text.split(':');
    if (parts.length !== 4) return text;
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const encryptedHex = parts[3];

    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    try {
      if ((decrypted.startsWith('{') && decrypted.endsWith('}')) || (decrypted.startsWith('[') && decrypted.endsWith(']'))) {
        return JSON.parse(decrypted);
      }
    } catch (e) {}
    return decrypted;
  } catch (err) {
    console.error('Decryption failed, fallback to raw', err);
    return text;
  }
}

export const encryptionTransformer = {
  to: (value: any) => encrypt(value),
  from: (value: any) => decrypt(value),
};
