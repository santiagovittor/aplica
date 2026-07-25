import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Symmetric encryption for the user's model API key (PROJECT.md section 6).
 *
 * The key is a parameter rather than a module-level env read so this stays a
 * pure function: tests supply their own random key and no real key material
 * ever exists in the test environment.
 */

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Packs to `v1.<iv>.<tag>.<ciphertext>`, each part base64url. */
export function encrypt(plaintext: string, key: Buffer): string {
  assertKeyLength(key.length);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Throws on a wrong key, a tampered payload, or an unrecognised version. No
 * error path here carries the plaintext or the key: an error surfaces to the
 * user and to logs, and neither may ever contain a credential.
 */
export function decrypt(packed: string, key: Buffer): string {
  assertKeyLength(key.length);

  const parts = packed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Stored key is not a v1 payload.');
  }

  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ciphertext = Buffer.from(parts[3], 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Stored key payload is malformed.');
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    // GCM only authenticates on final(), so nothing leaves this block until the
    // tag verifies.
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error(
      'Stored key failed authentication. It was altered, or the encryption key changed.',
    );
  }
}

/** Reads the server-side secret. Never include its value in an error. */
export function encryptionKey(): Buffer {
  const encoded = process.env.API_KEY_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error('API_KEY_ENCRYPTION_KEY is not set.');
  }

  const key = Buffer.from(encoded, 'base64');
  assertKeyLength(key.length, 'API_KEY_ENCRYPTION_KEY must decode to');
  return key;
}

function assertKeyLength(length: number, subject = 'Encryption key must be') {
  if (length !== KEY_BYTES) {
    throw new Error(`${subject} ${KEY_BYTES} bytes, got ${length}.`);
  }
}
