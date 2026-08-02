import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiKeyEndpointInvalid,
  ApiKeyModelInvalid,
  ApiKeyRejected,
  ApiKeyUnreachable,
  deleteApiKey,
  describeApiKey,
  getDecryptedKey,
  saveApiKey,
} from './api-keys';
import { SupabaseError } from './supabase';

/**
 * The key never leaves the server (SLICE-9 non-negotiable 1).
 *
 * Two functions in the whole repo ever hold a plaintext model key:
 * `saveApiKey`, which receives it from the form, and `getDecryptedKey`, which
 * produces it for a provider call. Everything below is about the boundary of
 * those two: what is written, what is returned, and what every failure path
 * carries.
 */

// Not a real credential. It is shaped like one and treated like one, because
// the assertions here are about where a credential can end up.
const PLAINTEXT = 'sk-ant-pretend-this-is-a-real-key-000000';
const SECRET = 'sb_secret_pretend-this-is-real';
const URL_BASE = 'http://127.0.0.1:54321';
const USER = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ENCRYPTION_KEY = randomBytes(32).toString('base64');

// A literal address, not a hostname: `assertResolvesSafely` skips DNS
// entirely for one (`isIP` short-circuits it), so `openai_compatible` tests
// need no DNS mock, the same reasoning `url-guard.test.ts` already uses this
// address for.
const COMPATIBLE_BASE_URL = 'https://8.8.8.8/v1';
const COMPATIBLE_MODEL = 'meta/llama-3.1-70b-instruct';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

let calls: Captured[] = [];
/** What the provider's own key check answers. */
let providerStatus = 200;
/** What PostgREST answers, and with what rows. */
let restStatus = 200;
let rows: unknown[] = [];
/** Set to make the provider call fail the way a dropped connection does. */
let providerThrows = false;

function stubNetwork() {
  vi.stubGlobal(
    'fetch',
    async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({
        url,
        method: init.method ?? 'GET',
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body === undefined ? '' : String(init.body),
      });

      if (url.startsWith(URL_BASE)) {
        return restStatus === 200
          ? Response.json(rows)
          : new Response(null, { status: restStatus });
      }

      if (providerThrows) {
        throw new TypeError('fetch failed');
      }
      return new Response(providerStatus === 200 ? '{"data":[]}' : null, {
        status: providerStatus,
      });
    },
  );
}

const original = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  secret: process.env.SUPABASE_SECRET_KEY,
  encryption: process.env.API_KEY_ENCRYPTION_KEY,
};

beforeEach(() => {
  calls = [];
  rows = [];
  providerStatus = 200;
  restStatus = 200;
  providerThrows = false;
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_BASE;
  process.env.SUPABASE_SECRET_KEY = SECRET;
  process.env.API_KEY_ENCRYPTION_KEY = ENCRYPTION_KEY;
  stubNetwork();
});

afterEach(() => {
  vi.unstubAllGlobals();
  restore('NEXT_PUBLIC_SUPABASE_URL', original.url);
  restore('SUPABASE_SECRET_KEY', original.secret);
  restore('API_KEY_ENCRYPTION_KEY', original.encryption);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

/** The row PostgREST would return after a save, taken from the save itself. */
function storedRow(provider = 'anthropic') {
  const written = calls.find((call) => call.url.includes('/rest/v1/api_keys'));
  const payload = JSON.parse(written?.body ?? '{}') as {
    ciphertext: string;
    base_url: string | null;
    model: string | null;
  };
  return {
    provider,
    ciphertext: payload.ciphertext,
    base_url: payload.base_url ?? null,
    model: payload.model ?? null,
  };
}

describe('saveApiKey', () => {
  it('checks the key with the provider before it writes anything', async () => {
    // A key that does not work fails later, inside a paid generation, as an
    // opaque provider error. One cheap authenticated call answers it for free.
    await saveApiKey(USER, 'anthropic', PLAINTEXT);

    expect(calls[0].url).toContain('api.anthropic.com');
    expect(calls[0].method).toBe('GET');
    expect(calls[1].url).toContain('/rest/v1/api_keys');
  });

  it('sends the key in a header, never in the URL', async () => {
    // A query string ends up in access logs and proxy traces.
    for (const provider of ['anthropic', 'openai', 'google'] as const) {
      calls = [];
      await saveApiKey(USER, provider, PLAINTEXT);

      expect(calls[0].url).not.toContain(PLAINTEXT);
      expect(JSON.stringify(calls[0].headers)).toContain(PLAINTEXT);
    }
  });

  it('writes ciphertext, and never the key itself', async () => {
    await saveApiKey(USER, 'google', PLAINTEXT);
    const write = calls[1];
    const row = JSON.parse(write.body) as Record<string, unknown>;

    expect(write.body).not.toContain(PLAINTEXT);
    expect(row.user_id).toBe(USER);
    expect(row.provider).toBe('google');
    expect(String(row.ciphertext)).toMatch(/^v1\./);
    // The three named providers carry no base URL or model, and the check
    // constraints in 20260726153343 and 20260801120000 refuse a row that does.
    expect(row.base_url ?? null).toBeNull();
    expect(row.model ?? null).toBeNull();
  });

  it('returns nothing at all', async () => {
    // There is no return value to accidentally serialise into a response.
    expect(await saveApiKey(USER, 'anthropic', PLAINTEXT)).toBeUndefined();
  });

  it('replaces the previous key rather than adding a second row', async () => {
    await saveApiKey(USER, 'anthropic', PLAINTEXT);

    expect(calls[1].url).toContain('on_conflict=user_id');
    expect(calls[1].headers.prefer).toContain('resolution=merge-duplicates');
  });

  it('refuses a blank key without calling anyone', async () => {
    await expect(saveApiKey(USER, 'anthropic', '   ')).rejects.toThrow(
      /no key/i,
    );
    expect(calls).toHaveLength(0);
  });

  it('refuses a user id that is not a UUID', async () => {
    await expect(
      saveApiKey('../../other-user', 'anthropic', PLAINTEXT),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('a key the provider refuses', () => {
  it('is rejected at save time, and nothing is written', async () => {
    providerStatus = 401;

    await expect(
      saveApiKey(USER, 'anthropic', PLAINTEXT),
    ).rejects.toBeInstanceOf(ApiKeyRejected);
    expect(calls.map((call) => call.url)).toHaveLength(1);
  });

  it('is told apart from a provider that is down', async () => {
    // A 500 is not evidence about the key, so it must not be reported as one.
    providerStatus = 503;

    await expect(
      saveApiKey(USER, 'anthropic', PLAINTEXT),
    ).rejects.toBeInstanceOf(ApiKeyUnreachable);
  });

  it('treats a dropped connection as unreachable, not as a bad key', async () => {
    providerThrows = true;

    await expect(saveApiKey(USER, 'openai', PLAINTEXT)).rejects.toBeInstanceOf(
      ApiKeyUnreachable,
    );
  });
});

/**
 * `openai_compatible` is the one provider with no fixed host: the base URL
 * and model both come from the account form and are validated here, before
 * `assertKeyWorks` ever reaches the network (SLICE-15 decision 3).
 */
describe('saveApiKey for openai_compatible', () => {
  it('requires a base URL, and calls nobody without one', async () => {
    await expect(
      saveApiKey(
        USER,
        'openai_compatible',
        PLAINTEXT,
        undefined,
        COMPATIBLE_MODEL,
      ),
    ).rejects.toBeInstanceOf(ApiKeyEndpointInvalid);
    expect(calls).toHaveLength(0);
  });

  it('refuses an unsafe base URL, and calls nobody', async () => {
    // The exhaustive SSRF cases already live in url-guard.test.ts; this only
    // proves `saveApiKey` actually calls `assertSafeBaseUrl` before touching
    // the network, with one representative address.
    await expect(
      saveApiKey(
        USER,
        'openai_compatible',
        PLAINTEXT,
        'https://169.254.169.254/v1',
        COMPATIBLE_MODEL,
      ),
    ).rejects.toBeInstanceOf(ApiKeyEndpointInvalid);
    expect(calls).toHaveLength(0);
  });

  it('requires a model, and calls nobody without one', async () => {
    await expect(
      saveApiKey(USER, 'openai_compatible', PLAINTEXT, COMPATIBLE_BASE_URL),
    ).rejects.toBeInstanceOf(ApiKeyModelInvalid);
    expect(calls).toHaveLength(0);
  });

  it('refuses a model name that is not a plausible identifier', async () => {
    // Untrusted input handed to a user-supplied host: no whitespace, no
    // quote or brace characters, nothing that could look like an attempt to
    // break out of the JSON body it is serialised into.
    for (const bad of [
      'not a model',
      'model"; DROP TABLE',
      'model\nwith-newline',
      '{"id":"x"}',
      '',
    ]) {
      calls = [];
      await expect(
        saveApiKey(
          USER,
          'openai_compatible',
          PLAINTEXT,
          COMPATIBLE_BASE_URL,
          bad,
        ),
      ).rejects.toBeInstanceOf(ApiKeyModelInvalid);
      expect(calls).toHaveLength(0);
    }
  });

  it('checks the given endpoint, not a fixed host', async () => {
    await saveApiKey(
      USER,
      'openai_compatible',
      PLAINTEXT,
      COMPATIBLE_BASE_URL,
      COMPATIBLE_MODEL,
    );

    expect(calls[0].url).toBe(`${COMPATIBLE_BASE_URL}/models`);
    expect(calls[0].method).toBe('GET');
    expect(calls[1].url).toContain('/rest/v1/api_keys');
  });

  it('writes the endpoint and model, not just the ciphertext', async () => {
    await saveApiKey(
      USER,
      'openai_compatible',
      PLAINTEXT,
      COMPATIBLE_BASE_URL,
      COMPATIBLE_MODEL,
    );
    const row = JSON.parse(calls[1].body) as Record<string, unknown>;

    expect(row.base_url).toBe(COMPATIBLE_BASE_URL);
    expect(row.model).toBe(COMPATIBLE_MODEL);
  });

  it('is told apart from a provider that is down, same as the named three', async () => {
    providerStatus = 503;

    await expect(
      saveApiKey(
        USER,
        'openai_compatible',
        PLAINTEXT,
        COMPATIBLE_BASE_URL,
        COMPATIBLE_MODEL,
      ),
    ).rejects.toBeInstanceOf(ApiKeyUnreachable);
  });
});

describe('getDecryptedKey', () => {
  it('round trips the key that was saved', async () => {
    await saveApiKey(USER, 'google', PLAINTEXT);
    rows = [storedRow('google')];
    calls = [];

    expect(await getDecryptedKey(USER)).toEqual({
      provider: 'google',
      apiKey: PLAINTEXT,
      baseUrl: null,
      model: null,
    });
  });

  it('round trips the endpoint and model for openai_compatible', async () => {
    await saveApiKey(
      USER,
      'openai_compatible',
      PLAINTEXT,
      COMPATIBLE_BASE_URL,
      COMPATIBLE_MODEL,
    );
    rows = [storedRow('openai_compatible')];
    calls = [];

    expect(await getDecryptedKey(USER)).toEqual({
      provider: 'openai_compatible',
      apiKey: PLAINTEXT,
      baseUrl: COMPATIBLE_BASE_URL,
      model: COMPATIBLE_MODEL,
    });
  });

  it('reads with the secret key, which is the only thing that can', async () => {
    rows = [];
    await getDecryptedKey(USER);

    expect(calls[0].headers.apikey).toBe(SECRET);
    expect(calls[0].url).toContain(`user_id=eq.${USER}`);
  });

  it('is null when there is no key yet', async () => {
    rows = [];

    expect(await getDecryptedKey(USER)).toBeNull();
  });
});

describe('describeApiKey', () => {
  it('says which provider, and nothing else', async () => {
    await saveApiKey(USER, 'openai', PLAINTEXT);
    rows = [{ provider: 'openai', model: null }];

    const described = await describeApiKey(USER);

    expect(described).toEqual({ provider: 'openai', model: null });
    // Not even a fragment. docs/security.md commits to never showing the key or
    // any part of it, so there is no last-four to leak and none to check.
    expect(JSON.stringify(described)).not.toContain(PLAINTEXT.slice(-4));
  });

  it('says the default model for openai_compatible', async () => {
    rows = [{ provider: 'openai_compatible', model: COMPATIBLE_MODEL }];

    expect(await describeApiKey(USER)).toEqual({
      provider: 'openai_compatible',
      model: COMPATIBLE_MODEL,
    });
  });

  it('never asks the database for the ciphertext', async () => {
    rows = [{ provider: 'openai', model: null }];
    await describeApiKey(USER);

    expect(calls[0].url).toContain('select=provider');
    expect(calls[0].url).not.toContain('ciphertext');
  });

  it('is null when there is no key yet', async () => {
    rows = [];

    expect(await describeApiKey(USER)).toBeNull();
  });
});

describe('deleteApiKey', () => {
  it('deletes the row outright rather than blanking it', async () => {
    await deleteApiKey(USER);

    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toContain(`user_id=eq.${USER}`);
  });

  it('clears the endpoint and model alongside the key, not just the ciphertext', async () => {
    // One row, one delete (SLICE-15): base_url and model live on the same
    // row as the ciphertext, and `deleteApiKey` issues no column list, so
    // there is nothing for a delete to leave behind by accident. Simulated
    // here the way the rest of this suite simulates a row disappearing:
    // asserted against what a subsequent read sees, not just the DELETE call.
    await saveApiKey(
      USER,
      'openai_compatible',
      PLAINTEXT,
      COMPATIBLE_BASE_URL,
      COMPATIBLE_MODEL,
    );
    await deleteApiKey(USER);
    rows = [];
    calls = [];

    expect(await getDecryptedKey(USER)).toBeNull();
    expect(await describeApiKey(USER)).toBeNull();
  });
});

/**
 * The assertion that matters most, run over every way each function can fail.
 * An error reaches logs, error trackers and rendered pages, so no failure path
 * may carry the key the user pasted or the key that encrypts it.
 */
describe('no failure path carries a credential', () => {
  const encryptionKeyValue = ENCRYPTION_KEY;

  async function failureOf(run: () => Promise<unknown>): Promise<Error> {
    try {
      await run();
    } catch (error) {
      return error as Error;
    }
    throw new Error('That path did not fail, so it proves nothing.');
  }

  function assertClean(error: Error) {
    for (const text of [
      error.message,
      error.stack ?? '',
      String(error),
      JSON.stringify(error),
      JSON.stringify(
        Object.getOwnPropertyNames(error).map((k) => error[k as keyof Error]),
      ),
    ]) {
      expect(text).not.toContain(PLAINTEXT);
      expect(text).not.toContain(encryptionKeyValue);
      expect(text).not.toContain(SECRET);
    }
  }

  it('not when the provider refuses the key', async () => {
    providerStatus = 401;
    assertClean(
      await failureOf(() => saveApiKey(USER, 'anthropic', PLAINTEXT)),
    );
  });

  it('not when the provider is unreachable', async () => {
    providerThrows = true;
    assertClean(await failureOf(() => saveApiKey(USER, 'google', PLAINTEXT)));
  });

  it('not when the database refuses the write', async () => {
    restStatus = 409;
    const error = await failureOf(() =>
      saveApiKey(USER, 'anthropic', PLAINTEXT),
    );

    expect(error).toBeInstanceOf(SupabaseError);
    assertClean(error);
  });

  it('not when the encryption key is missing', async () => {
    delete process.env.API_KEY_ENCRYPTION_KEY;
    assertClean(
      await failureOf(() => saveApiKey(USER, 'anthropic', PLAINTEXT)),
    );
  });

  it('not when the stored ciphertext will not decrypt', async () => {
    // A rotated encryption key, or a tampered row.
    rows = [
      {
        provider: 'anthropic',
        ciphertext: 'v1.aaa.bbb.ccc',
        base_url: null,
        model: null,
      },
    ];
    assertClean(await failureOf(() => getDecryptedKey(USER)));
  });

  it('not when the stored row is not the shape it should be', async () => {
    rows = [{ provider: 'llamafile', ciphertext: 42 }];
    assertClean(await failureOf(() => getDecryptedKey(USER)));
  });

  it('not when the read itself fails', async () => {
    restStatus = 500;
    assertClean(await failureOf(() => getDecryptedKey(USER)));
  });

  it('not when the delete fails', async () => {
    restStatus = 500;
    assertClean(await failureOf(() => deleteApiKey(USER)));
  });
});
