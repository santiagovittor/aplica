import { z } from 'zod';
import {
  assertResolvesSafely,
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

      if (endpoint !== undefined) {
        // Re-checked per request, not once at construction: a hostname is free
        // to start resolving somewhere private later. The hostname comes from
        // the guard rather than from `new URL(base).hostname`, which would hand
        // DNS a bracketed `[::1]` that is neither an address nor a name.
        await assertResolvesSafely(
          endpoint.hostname,
          policy ?? { allowPrivate: false },
        );
      }

      const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

      const body = await postJson(
        id,
        `${base}/chat/completions`,
        { authorization: `Bearer ${apiKey}` },
        {
          model,
          messages: opts.system
            ? [{ role: 'system', content: opts.system }, ...messages]
            : messages,
          // OpenAI renamed this field; most compatible hosts only know the old
          // name, so each gets the one it accepts.
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
