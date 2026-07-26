import {
  allowPrivateHosts,
  assertSafeBaseUrl,
  type HostPolicy,
} from '../core/url-guard';
import { createAnthropicProvider } from './anthropic';
import { createGoogleProvider } from './google';
import { createOpenAiProvider } from './openai';
import type { Provider } from './types';

export { DEFAULT_BASE_URLS, DEFAULT_MODELS } from './defaults';
export { createMockProvider, MOCK_RESPONSES } from './mock';
export {
  PROVIDER_IDS,
  ProviderError,
  type GenerateOptions,
  type Message,
  type Provider,
  type ProviderId,
} from './types';

export type ProviderConfig =
  | { id: 'anthropic' | 'openai' | 'google'; apiKey: string }
  | {
      id: 'openai_compatible';
      apiKey: string;
      baseUrl: string;
      policy?: HostPolicy;
    };

/**
 * The one place a provider is chosen. The key is an argument and never read
 * from the environment, so tests and CI hold no credential (crypto.ts takes its
 * key the same way and for the same reason).
 */
export function createProvider(config: ProviderConfig): Provider {
  switch (config.id) {
    case 'anthropic':
      return createAnthropicProvider(config.apiKey);
    case 'google':
      return createGoogleProvider(config.apiKey);
    case 'openai':
      return createOpenAiProvider({ apiKey: config.apiKey });
    case 'openai_compatible': {
      // Fail here, at save time, rather than at generate time: a bad endpoint
      // should be a validation error on the settings form, not a failed
      // application halfway through the pipeline.
      const policy = config.policy ?? { allowPrivate: allowPrivateHosts() };
      return createOpenAiProvider({
        apiKey: config.apiKey,
        endpoint: assertSafeBaseUrl(config.baseUrl, policy),
        policy,
      });
    }
  }
}
