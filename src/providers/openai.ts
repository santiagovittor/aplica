import { z } from 'zod';
import {
  assertResolvesSafely,
  guardedLookup,
  type HostPolicy,
  type SafeEndpoint,
} from '../core/url-guard';
import { DEFAULT_BASE_URLS, DEFAULT_MODELS } from './defaults';
import {
  DEFAULT_MAX_TOKENS,
  type GenerateOptions,
  type Message,
  type Provider,
  type ProviderId,
  postJson,
  postJsonPinned,
} from './types';

const Response = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
});

export interface OpenAiOptions {
  apiKey: string;
  /**
   * Set for `openai_compatible`, and only ever the value `assertSafeBaseUrl`
   * returned. Taking `SafeEndpoint` rather than a bare string is what stops a
   * caller handing this adapter a URL that never went through the guard.
   */
  endpoint?: SafeEndpoint;
  policy?: HostPolicy;
}

/**
 * One adapter, two provider ids. `openai` is this shape at OpenAI's own host;
 * `openai_compatible` is the same shape at whatever host the user names, which
 * covers NVIDIA NIM, Ollama, OpenRouter and vLLM without a line of per-vendor
 * code (PROJECT.md sections 3 and 5).
 */
export function createOpenAiProvider({
  apiKey,
  endpoint,
  policy,
}: OpenAiOptions): Provider {
  const compatible = endpoint !== undefined;
  const id: ProviderId = compatible ? 'openai_compatible' : 'openai';
  const base = endpoint?.url ?? DEFAULT_BASE_URLS.openai;

  return {
    id,
    // Both ids report false, for different reasons.
    //
    // `openai_compatible` is a user-supplied host. We cannot know what it
    // serves, and a search tool it does not implement is a 400 at best.
    //
    // `openai` is a genuine gap rather than a choice. OpenAI's `web_search`
    // tool runs on the Responses API; this adapter speaks `/chat/completions`
    // because that is the shape every OpenAI-compatible host implements, and
    // one shape serving both is the reason there is no fourth adapter. The web
    // search guide names a `gpt-5-search-api` model for Chat Completions, but
    // that string is absent from the models page, and shipping an unverified
    // model ID is not worth a capability. Closing this means a second request
    // shape in this file, used only by the reviewer's research pass.
    supportsSearch: false,
    async generate(messages: Message[], opts: GenerateOptions = {}) {
      // A custom endpoint has no default: guessing a model name for someone
      // else's host is how you get a confusing 404 instead of a clear error.
      const model =
        opts.model ?? (compatible ? undefined : DEFAULT_MODELS.openai);
      if (model === undefined) {
        throw new Error(
          'A model is required for a custom endpoint: only the host knows what it serves.',
        );
      }

      const hostPolicy = policy ?? { allowPrivate: false };
      if (endpoint !== undefined && !hostPolicy.allowPrivate) {
        // Re-checked per request, not once at construction: a hostname is free
        // to start resolving somewhere private later. The hostname comes from
        // the guard rather than from `new URL(base).hostname`, which would hand
        // DNS a bracketed `[::1]` that is neither an address nor a name.
        //
        // This is the cheap pre-check that gives a clear error. The request
        // below is what actually closes the window, by resolving through
        // `guardedLookup` so the checked address is the connected address.
        await assertResolvesSafely(endpoint.hostname, hostPolicy);
      }

      const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

      // A user-supplied host goes over the pinned transport, so the address the
      // guard approved is the address the socket connects to. Everything else,
      // including a self-hoster who turned the guard off, uses plain fetch.
      const post =
        endpoint !== undefined && !hostPolicy.allowPrivate
          ? (
              provider: typeof id,
              url: string,
              headers: Record<string, string>,
              payload: unknown,
              signal?: AbortSignal,
            ) =>
              postJsonPinned(
                provider,
                url,
                headers,
                payload,
                guardedLookup(hostPolicy),
                signal,
              )
          : postJson;

      const body = await post(
        id,
        `${base}/chat/completions`,
        { authorization: `Bearer ${apiKey}` },
        {
          model,
          messages: opts.system
            ? [{ role: 'system', content: opts.system }, ...messages]
            : messages,
          // Checked 2026-07-26 against OpenAI's own docs. `max_tokens` is
          // deprecated in favour of `max_completion_tokens` and is not accepted
          // by the reasoning models at all; it still works on older models, so
          // it is deprecated rather than removed. OpenAI therefore gets the new
          // name. The compatible hosts (NIM, Ollama, vLLM, OpenRouter)
          // implement the older Chat Completions surface, where `max_tokens` is
          // the field with universal support, so they get that one.
          ...(compatible
            ? { max_tokens: maxTokens }
            : { max_completion_tokens: maxTokens }),
        },
        opts.signal,
      );

      return Response.parse(body).choices[0].message.content;
    },
  };
}
