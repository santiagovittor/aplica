import { z } from 'zod';
import { DEFAULT_BASE_URLS, DEFAULT_MODELS } from './defaults';
import {
  DEFAULT_MAX_TOKENS,
  type GenerateOptions,
  type Message,
  type Provider,
  postJson,
} from './types';

const Response = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string() })) }),
      }),
    )
    .min(1),
});

export function createGoogleProvider(apiKey: string): Provider {
  return {
    id: 'google',
    async generate(messages: Message[], opts: GenerateOptions = {}) {
      const model = opts.model ?? DEFAULT_MODELS.google;

      const body = await postJson(
        'google',
        `${DEFAULT_BASE_URLS.google}/models/${model}:generateContent`,
        // Google also accepts `?key=`, but a query string ends up in access
        // logs and proxy traces. The key belongs in a header (PROJECT.md
        // section 6).
        { 'x-goog-api-key': apiKey },
        {
          contents: messages.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
          })),
          ...(opts.system
            ? { systemInstruction: { parts: [{ text: opts.system }] } }
            : {}),
          generationConfig: {
            maxOutputTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
          },
        },
        opts.signal,
      );

      const parts = Response.parse(body).candidates[0].content.parts;
      if (parts.length === 0) {
        throw new Error('google returned no text content.');
      }
      return parts.map((part) => part.text).join('');
    },
  };
}
