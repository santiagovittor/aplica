import { z } from 'zod';
import { assertResolvesSafely, type HostPolicy } from '../core/url-guard';
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
  /** Set for `openai_compatible`. Already through `assertSafeBaseUrl`. */
  baseUrl?: string;
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
  baseUrl,
  policy,
}: OpenAiOptions): Provider {
  const compatible = baseUrl !== undefined;
  const id: ProviderId = compatible ? 'openai_compatible' : 'openai';
  const base = baseUrl ?? DEFAULT_BASE_URLS.openai;

  return {
    id,
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

      if (compatible) {
        // Re-checked per request, not once at construction: a hostname is free
        // to start resolving somewhere private later.
        await assertResolvesSafely(
          new URL(base).hostname,
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
