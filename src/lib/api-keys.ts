import { z } from 'zod';
import { decrypt, encrypt, encryptionKey } from '../core/crypto';
import {
  allowPrivateHosts,
  assertResolvesSafely,
  assertSafeBaseUrl,
  type SafeEndpoint,
} from '../core/url-guard';
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

/** The providers a key can be stored for. */
export const KEY_PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'openai_compatible',
] as const;

export type KeyProvider = (typeof KEY_PROVIDERS)[number];

const Provider = z.enum(KEY_PROVIDERS);

/**
 * A model identifier, for the one provider where the user supplies it
 * (`openai_compatible` has no `DEFAULT_MODELS` entry: only the host knows
 * what it serves). This value reaches a request body sent to a host the user
 * named, never a URL, but it is still untrusted input, so it is shape-checked
 * and length-capped here rather than passed through as free text.
 *
 * The character set covers every real example seen across the four target
 * hosts (SLICE-15): NIM/OpenRouter's `vendor/name` shape, Ollama's
 * `name:tag`, and vLLM's Hugging Face-style `Org/Repo-Name`. No whitespace, no
 * quote or brace characters, so nothing here can break out of the JSON body
 * it is serialised into even before `JSON.stringify` would have escaped it
 * anyway.
 */
export const ModelId = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9._:/-]{0,198}[A-Za-z0-9])?$/,
    'That does not look like a model name.',
  );

/** The row as it comes back. `ciphertext` is opaque until `decrypt` runs. */
const StoredKey = z.object({
  provider: Provider,
  ciphertext: z.string(),
  base_url: z.string().nullable(),
  model: z.string().nullable(),
});

const DescribedKey = z.object({
  provider: Provider,
  model: z.string().nullable(),
});

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

/**
 * The endpoint URL is the problem, never the key: missing where
 * `openai_compatible` requires one, malformed, or refused by
 * `assertSafeBaseUrl` (SLICE-15 decision 3). The reason is not carried here on
 * purpose -- one settings-screen sentence covers it, the same way a bad key
 * gets one sentence rather than a forwarded provider message.
 */
export class ApiKeyEndpointInvalid extends Error {
  constructor(readonly provider: KeyProvider) {
    super(`The ${provider} endpoint URL was refused.`);
    this.name = 'ApiKeyEndpointInvalid';
  }
}

/** The model name is the problem: missing where `openai_compatible` requires
 *  one, or not shaped like a model identifier. */
export class ApiKeyModelInvalid extends Error {
  constructor(readonly provider: KeyProvider) {
    super(`The ${provider} model name was refused.`);
    this.name = 'ApiKeyModelInvalid';
  }
}

const CHECK_TIMEOUT_MS = 15_000;

/**
 * The cheapest authenticated GET each provider offers, used only to find out
 * whether the key works. This is the one place a key is used outside a
 * generation.
 *
 * The key goes in a header in all four. Google also accepts `?key=`, and a
 * query string ends up in access logs and proxy traces.
 *
 * `openai_compatible`'s check is model-agnostic on purpose: it proves the
 * endpoint and the key work, not that any particular model responds, because
 * `GET /v1/models` is the one endpoint shape all four target hosts (NIM,
 * Ollama, OpenRouter, vLLM) are confirmed to implement the same way the three
 * named providers' checks already rely on (SLICE-15's own NIM run measured
 * this at 0.66s). Whether the account's chosen model is actually being served
 * is a nice-to-have this endpoint can answer, not a gate: a host that does not
 * enumerate everything it serves would otherwise fail a check for a model that
 * works fine.
 */
const KEY_CHECKS: Record<
  KeyProvider,
  (
    apiKey: string,
    endpoint?: SafeEndpoint,
  ) => { url: string; headers: Record<string, string> }
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
  openai_compatible: (apiKey, endpoint) => {
    if (endpoint === undefined) {
      throw new Error('An endpoint is required for a custom provider.');
    }
    return {
      url: `${endpoint.url}/models`,
      headers: { authorization: `Bearer ${apiKey}` },
    };
  },
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
 *
 * `baseUrl` and `model` are required if and only if `provider` is
 * `openai_compatible` (SLICE-15 decision 3), checked here before a single
 * network call: a bad literal address or an unshaped model name is refused on
 * the settings form, not discovered mid-check or mid-generation.
 */
export async function saveApiKey(
  userId: string,
  provider: KeyProvider,
  plaintext: string,
  baseUrl?: string,
  model?: string,
): Promise<void> {
  const owner = z.uuid().parse(userId);
  const named = Provider.parse(provider);

  // Pasting picks up whitespace at both ends often enough to be worth handling
  // rather than failing the check on it.
  const apiKey = plaintext.trim();
  if (apiKey === '') {
    throw new Error('There is no key to save.');
  }

  const endpoint = endpointFor(named, baseUrl);
  const modelId = modelFor(named, model);

  await assertKeyWorks(named, apiKey, endpoint);

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
        // Null for the three named providers; the check constraint refuses a
        // row where that does not match the provider.
        base_url: endpoint?.url ?? null,
        model: modelId ?? null,
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
 *
 * `baseUrl` and `model` come back alongside it for `openai_compatible`: the
 * endpoint a provider adapter needs to reach, and the account's default model
 * (`/apply` may override the latter per application, but a caller that wants
 * the account default reads it from here).
 */
export async function getDecryptedKey(userId: string): Promise<{
  provider: KeyProvider;
  apiKey: string;
  baseUrl: string | null;
  model: string | null;
} | null> {
  const owner = z.uuid().parse(userId);

  const response = await supabaseRequest(
    'api key read',
    `/rest/v1/api_keys?user_id=eq.${owner}&select=provider,ciphertext,base_url,model&limit=1`,
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
    baseUrl: stored.base_url,
    model: stored.model,
  };
}

/**
 * What the settings and apply screens are allowed to know without decrypting
 * anything: which provider is configured, and its default model where one
 * applies.
 *
 * Not a masked key, not the last four characters. `docs/security.md` commits to
 * never showing the key or a fragment of it, and a fragment is the reflexive
 * thing to build here.
 */
export async function describeApiKey(
  userId: string,
): Promise<{ provider: KeyProvider; model: string | null } | null> {
  const owner = z.uuid().parse(userId);

  const response = await supabaseRequest(
    'api key describe',
    `/rest/v1/api_keys?user_id=eq.${owner}&select=provider,model&limit=1`,
    { method: 'GET' },
  );

  const row = (await response.json()) as unknown[];

  return row.length === 0 ? null : DescribedKey.parse(row[0]);
}

/** One click, and the row goes -- ciphertext, base URL and model together,
 *  since they are one row and a delete is never column by column. */
export async function deleteApiKey(userId: string): Promise<void> {
  const owner = z.uuid().parse(userId);

  await supabaseRequest(
    'api key delete',
    `/rest/v1/api_keys?user_id=eq.${owner}`,
    { method: 'DELETE' },
  );
}

/**
 * Validated once, before a network call or a write: a bad literal address is
 * refused before `assertKeyWorks` ever reaches the network (SLICE-15
 * decision 3). `allowPrivateHosts` mirrors the same escape hatch
 * `src/providers/index.ts` reads for the real provider calls, so a
 * self-hoster's account key is validated under the same policy their
 * generations will run under.
 */
function endpointFor(
  provider: KeyProvider,
  baseUrl: string | undefined,
): SafeEndpoint | undefined {
  if (provider !== 'openai_compatible') {
    return undefined;
  }
  const raw = (baseUrl ?? '').trim();
  if (raw === '') {
    throw new ApiKeyEndpointInvalid(provider);
  }
  try {
    return assertSafeBaseUrl(raw, { allowPrivate: allowPrivateHosts() });
  } catch {
    throw new ApiKeyEndpointInvalid(provider);
  }
}

/** Required and shape-checked for `openai_compatible`; absent for the three
 *  named providers, which have a `DEFAULT_MODELS` constant instead. */
function modelFor(
  provider: KeyProvider,
  model: string | undefined,
): string | undefined {
  if (provider !== 'openai_compatible') {
    return undefined;
  }
  const parsed = ModelId.safeParse(model ?? '');
  if (!parsed.success || parsed.data === '') {
    throw new ApiKeyModelInvalid(provider);
  }
  return parsed.data;
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
  endpoint?: SafeEndpoint,
): Promise<void> {
  if (endpoint !== undefined) {
    const policy = { allowPrivate: allowPrivateHosts() };
    if (!policy.allowPrivate) {
      // The literal-address half already ran in `endpointFor`. This is the
      // other half `assertSafeBaseUrl` cannot do: a public hostname that is
      // free to resolve to a private address. This one-time save-time check
      // runs over plain `fetch`, which cannot take a pinned lookup the way
      // `openai.ts`'s repeated, real request does (`postJsonPinned`'s own
      // comment explains why: Node's global fetch takes no dispatcher or
      // lookup) -- so this is the pre-check that gives a clear error, not the
      // socket-level close a recurring request gets.
      await assertResolvesSafely(endpoint.hostname, policy);
    }
  }

  const { url, headers } = KEY_CHECKS[provider](apiKey, endpoint);

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
