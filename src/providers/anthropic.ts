import { z } from 'zod';
import { DEFAULT_BASE_URLS, DEFAULT_MODELS, SEARCH_MODELS } from './defaults';
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

/**
 * The basic web search tool. `web_search_20260209` and later add dynamic
 * filtering but need Claude 4.6 or newer, so the basic version is the one with
 * the widest model support. `allowed_callers: ["direct"]` is required on models
 * without programmatic tool calling; on models that have it, it just means the
 * search runs directly instead of from inside code execution.
 */
const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  allowed_callers: ['direct'],
};

export function createAnthropicProvider(apiKey: string): Provider {
  return {
    id: 'anthropic',
    supportsSearch: SEARCH_MODELS.anthropic !== undefined,
    async generate(messages: Message[], opts: GenerateOptions = {}) {
      const searching =
        opts.search === true && SEARCH_MODELS.anthropic !== undefined;

      const body = await postJson(
        'anthropic',
        `${DEFAULT_BASE_URLS.anthropic}/messages`,
        { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
        {
          model:
            opts.model ??
            (searching ? SEARCH_MODELS.anthropic : DEFAULT_MODELS.anthropic),
          max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
          ...(opts.system ? { system: opts.system } : {}),
          ...(searching ? { tools: [WEB_SEARCH_TOOL] } : {}),
          messages,
        },
        opts.signal,
      );

      // Every text block, not the first. A searching turn interleaves
      // `server_tool_use` and `web_search_tool_result` blocks with text, and
      // citations split the answer across several text blocks, so taking the
      // first would return the model announcing its search instead of its
      // answer.
      const text = Response.parse(body)
        .content.filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('');
      if (text === '') {
        throw new Error('anthropic returned no text content.');
      }
      return text;
    },
  };
}
