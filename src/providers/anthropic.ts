import { z } from 'zod';
import { DEFAULT_BASE_URLS, DEFAULT_MODELS } from './defaults';
import {
  DEFAULT_MAX_TOKENS,
  type GenerateOptions,
  type Message,
  type Provider,
  postJson,
} from './types';

const ANTHROPIC_VERSION = '2023-06-01';

// Model output is an external boundary (CLAUDE.md section 2), so the response
// is parsed rather than trusted. Only the fields we read are described.
const Response = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

export function createAnthropicProvider(apiKey: string): Provider {
  return {
    id: 'anthropic',
    async generate(messages: Message[], opts: GenerateOptions = {}) {
      const body = await postJson(
        'anthropic',
        `${DEFAULT_BASE_URLS.anthropic}/messages`,
        { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
        {
          model: opts.model ?? DEFAULT_MODELS.anthropic,
          max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
          ...(opts.system ? { system: opts.system } : {}),
          messages,
        },
        opts.signal,
      );

      const text = Response.parse(body).content.find(
        (block) => block.type === 'text',
      )?.text;
      if (text === undefined) {
        throw new Error('anthropic returned no text content.');
      }
      return text;
    },
  };
}
