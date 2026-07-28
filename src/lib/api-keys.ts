import { z } from 'zod';
import { decrypt, encrypt, encryptionKey } from '../core/crypto';
import { DEFAULT_BASE_URLS } from '../providers/defaults';
import { supabaseRequest } from './supabase';

/**
 * The user's model key: stored, read back, described, deleted.
 *
 * Two functions here ever hold a plaintext key, and they are the only two in
 * the repo (SLICE-9 decision 4). `saveApiKey` receives it from the form,
 * validates it, encrypts it, and lets it go. `getDecryptedKey` produces it
 * in-process for a server-side provider call and nothing else. Neither value is
 * ever returned to a client, serialised into a response, logged, or put in an
 * error.
 *
 * Everything here reads with `SUPABASE_SECRET_KEY`. `public.api_keys` grants
 * nothing to `anon` or `authenticated` and has row-level security on with no
 * policies, so this is not a convenience: it is the only way in.
 */

/**
 * The providers a key can be stored for today. `openai_compatible` is legal in
 * the column and deliberately absent here: it carries a user-supplied base URL,
 * which is an SSRF surface with its own guard (`src/core/url-guard.ts`), and it
 * does not belong in the same change as the key handling. Its own slice adds it.
 */
export const KEY_PROVIDERS = ['anthropic', 'openai', 'google'] as const;

export type KeyProvider = (typeof KEY_PROVIDERS)[number];

const Provider = z.enum(KEY_PROVIDERS);

/** The row as it comes back. `ciphertext` is opaque until `decrypt` runs. */
const StoredKey = z.object({
  provider: Provider,
  ciphertext: z.string(),
});

const DescribedKey = z.object({ provider: Provider });

/**
 * The provider answered, and the answer was no.
 *
 * Carries the provider and the status, and never the response body: a 401 body
 * can echo the key straight back, and this error reaches logs and a rendered
 * page. Same discipline as `ProviderError` in `src/providers/types.ts`.
 */
export class ApiKeyRejected extends Error {
  constructor(
    readonly provider: KeyProvider,
    readonly status: number,
  ) {
    super(`The ${provider} key check was refused with status ${status}.`);
    this.name = 'ApiKeyRejected';
  }
}

/**
 * We could not get an answer, which is not the same as a bad key and must never
 * be reported as one. A 500 or a dropped connection says nothing about the key.
 */
export class ApiKeyUnreachable extends Error {
  constructor(readonly provider: KeyProvider) {
    super(`The ${provider} key check could not be completed.`);
    this.name = 'ApiKeyUnreachable';
  }
}

const CHECK_TIMEOUT_MS = 15_000;

/**
 * The cheapest authenticated GET each provider offers, used only to find out
 * whether the key works. This is the one place a key is used outside a
 * generation.
 *
 * The key goes in a header in all three. Google also accepts `?key=`, and a
 * query string ends up in access logs and proxy traces.
 */
const KEY_CHECKS: Record<
  KeyProvider,
  (apiKey: string) => { url: string; headers: Record<string, string> }
> = {
  anthropic: (apiKey) => ({
    url: `${DEFAULT_BASE_URLS.anthropic}/models?limit=1`,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
  }),
  openai: (apiKey) => ({
    url: `${DEFAULT_BASE_URLS.openai}/models`,
    headers: { authorization: `Bearer ${apiKey}` },
  }),
  google: (apiKey) => ({
    url: `${DEFAULT_BASE_URLS.google}/models`,
    headers: { 'x-goog-api-key': apiKey },
  }),
};

/**
 * Checks the key, encrypts it, stores the ciphertext. Returns nothing, so there
 * is no value for a caller to hand back to a browser.
 *
 * The check comes first on purpose (SLICE-9 decision 5). A key that does not
 * work fails later, inside a paid generation, as an opaque provider error,
 * which is the worst possible place to discover it. One free call answers it
 * here instead.
 *
 * `plaintext` does not leave this function: it goes to the provider in a
 * request header and to `encrypt`, and neither the value nor anything derived
 * from it other than the ciphertext is returned, thrown, or written.
 */
export async function saveApiKey(
  userId: string,
  provider: KeyProvider,
  plaintext: string,
): Promise<void> {
  const owner = z.uuid().parse(userId);
  const named = Provider.parse(provider);

  // Pasting picks up whitespace at both ends often enough to be worth handling
  // rather than failing the check on it.
  const apiKey = plaintext.trim();
  if (apiKey === '') {
    throw new Error('There is no key to save.');
  }

  await assertKeyWorks(named, apiKey);

  const ciphertext = encrypt(apiKey, encryptionKey());

  await supabaseRequest(
    'api key upsert',
    '/rest/v1/api_keys?on_conflict=user_id',
    {
      headers: {
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        user_id: owner,
        provider: named,
        ciphertext,
        // The three named providers carry no base URL, and the check
        // constraint refuses a row that does.
        base_url: null,
        // `merge-duplicates` writes only the columns in this payload, so the
        // column default never fires on the update half of the upsert.
        updated_at: new Date().toISOString(),
      }),
    },
  );
}

/**
 * The plaintext key, in-process, for a server-side provider call.
 *
 * The only function in the repo that produces one. Its return value is never
 * serialised, never put in a response body, and never passed to anything that
 * logs. It is called at the moment of a provider request and the result is not
 * cached: a key held in memory between requests is a key that can be read out
 * of a heap dump long after the request that needed it.
 */
export async function getDecryptedKey(
  userId: string,
): Promise<{ provider: KeyProvider; apiKey: string } | null> {
  const owner = z.uuid().parse(userId);

  const response = await supabaseRequest(
    'api key read',
    `/rest/v1/api_keys?user_id=eq.${owner}&select=provider,ciphertext&limit=1`,
    { method: 'GET' },
  );

  const row = (await response.json()) as unknown[];
  if (row.length === 0) {
    return null;
  }

  const stored = StoredKey.parse(row[0]);

  return {
    provider: stored.provider,
    apiKey: decrypt(stored.ciphertext, encryptionKey()),
  };
}

/**
 * What the settings screen is allowed to know: which provider is configured.
 *
 * Not a masked key, not the last four characters. `docs/security.md` commits to
 * never showing the key or a fragment of it, and a fragment is the reflexive
 * thing to build here.
 */
export async function describeApiKey(
  userId: string,
): Promise<{ provider: KeyProvider } | null> {
  const owner = z.uuid().parse(userId);

  const response = await supabaseRequest(
    'api key describe',
    `/rest/v1/api_keys?user_id=eq.${owner}&select=provider&limit=1`,
    { method: 'GET' },
  );

  const row = (await response.json()) as unknown[];

  return row.length === 0 ? null : DescribedKey.parse(row[0]);
}

/** One click, and the row goes. Deleted outright rather than blanked. */
export async function deleteApiKey(userId: string): Promise<void> {
  const owner = z.uuid().parse(userId);

  await supabaseRequest(
    'api key delete',
    `/rest/v1/api_keys?user_id=eq.${owner}`,
    { method: 'DELETE' },
  );
}

/**
 * One authenticated GET. A 4xx is the provider saying the key is not good; a
 * 5xx, a timeout or a dropped connection says nothing about the key at all, and
 * telling a user their key is wrong because someone else's server fell over is
 * worse than saying we could not check.
 *
 * The response body is never read on any path.
 */
async function assertKeyWorks(
  provider: KeyProvider,
  apiKey: string,
): Promise<void> {
  const { url, headers } = KEY_CHECKS[provider](apiKey);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      // A redirect would carry the key to a second, unchecked host.
      redirect: 'error',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
  } catch {
    // The thrown error is discarded rather than wrapped: a fetch failure can
    // carry the request, and the request carries the key in a header.
    throw new ApiKeyUnreachable(provider);
  }

  if (response.ok) {
    return;
  }

  throw response.status >= 500
    ? new ApiKeyUnreachable(provider)
    : new ApiKeyRejected(provider, response.status);
}
