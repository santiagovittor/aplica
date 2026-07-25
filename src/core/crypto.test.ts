import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { decrypt, encrypt, encryptionKey } from './crypto';

// Every key here is generated in-process. No real credential, and nothing from
// the environment, ever reaches this file.
const key = randomBytes(32);
const secret = 'sk-ant-api03-pretend-this-is-a-real-users-key';

// The first character always carries six significant bits; a trailing one can
// land on base64 padding bits and decode to the same bytes.
function flipFirstCharacter(part: string): string {
  return (part[0] === 'A' ? 'B' : 'A') + part.slice(1);
}

function tamper(packed: string, index: number): string {
  const parts = packed.split('.');
  parts[index] = flipFirstCharacter(parts[index]);
  return parts.join('.');
}

describe('encrypt / decrypt', () => {
  it('round-trips the plaintext', () => {
    expect(decrypt(encrypt(secret, key), key)).toBe(secret);
  });

  it('never produces the same ciphertext twice', () => {
    expect(encrypt(secret, key)).not.toBe(encrypt(secret, key));
  });

  it('never stores the plaintext in the clear', () => {
    expect(encrypt(secret, key)).not.toContain(secret);
  });

  it('rejects a key of the wrong length', () => {
    expect(() => encrypt(secret, randomBytes(16))).toThrow(/32 bytes, got 16/);
  });
});

describe('decrypt rejects', () => {
  const cases: Record<string, () => string> = {
    'a wrong key': () => decrypt(encrypt(secret, key), randomBytes(32)),
    'a tampered initialisation vector': () =>
      decrypt(tamper(encrypt(secret, key), 1), key),
    'a tampered authentication tag': () =>
      decrypt(tamper(encrypt(secret, key), 2), key),
    'a tampered ciphertext': () =>
      decrypt(tamper(encrypt(secret, key), 3), key),
    'an unknown version': () =>
      decrypt(encrypt(secret, key).replace('v1.', 'v2.'), key),
    'a truncated payload': () =>
      decrypt(encrypt(secret, key).split('.').slice(0, 3).join('.'), key),
    'an empty payload': () => decrypt('', key),
  };

  for (const [name, run] of Object.entries(cases)) {
    it(name, () => {
      expect(run).toThrow();
    });

    // The security property, not just the failure: an error reaches logs and
    // error trackers, so no failure path may carry the credential or the key.
    it(`leaks nothing on ${name}`, () => {
      let thrown: unknown;
      try {
        run();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      const error = thrown as Error;
      for (const text of [error.message, error.stack ?? '', String(error)]) {
        expect(text).not.toContain(secret);
        expect(text).not.toContain(key.toString('base64'));
        expect(text).not.toContain(key.toString('base64url'));
        expect(text).not.toContain(key.toString('hex'));
      }
    });
  }
});

describe('encryptionKey', () => {
  const original = process.env.API_KEY_ENCRYPTION_KEY;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.API_KEY_ENCRYPTION_KEY;
    } else {
      process.env.API_KEY_ENCRYPTION_KEY = original;
    }
  });

  it('reads a 32-byte base64 secret', () => {
    const configured = randomBytes(32);
    process.env.API_KEY_ENCRYPTION_KEY = configured.toString('base64');
    expect(encryptionKey().equals(configured)).toBe(true);
  });

  it('fails fast when the secret is missing', () => {
    delete process.env.API_KEY_ENCRYPTION_KEY;
    expect(encryptionKey).toThrow(/is not set/);
  });

  it('fails fast when the secret is the wrong length', () => {
    const short = randomBytes(16);
    process.env.API_KEY_ENCRYPTION_KEY = short.toString('base64');

    let thrown: unknown;
    try {
      encryptionKey();
    } catch (error) {
      thrown = error;
    }

    const error = thrown as Error;
    expect(error.message).toMatch(/must decode to 32 bytes, got 16/);
    expect(error.stack ?? '').not.toContain(short.toString('base64'));
  });
});
