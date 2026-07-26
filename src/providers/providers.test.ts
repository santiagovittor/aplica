import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockProvider,
  createProvider,
  PROVIDER_IDS,
  type ProviderConfig,
} from './index';

// No network and no DNS. The suite must pass with every provider environment
// variable unset, because CI never holds a key (CLAUDE.md section 5).
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn((hostname: string) => {
    // Real DNS cannot resolve a bracketed literal, so neither does this. Without
    // that, a caller handing DNS `[::1]` would pass here and fail in production.
    if (hostname.startsWith('[')) {
      throw new Error(`ENOTFOUND ${hostname}`);
    }
    return Promise.resolve([{ address: '203.0.113.10', family: 4 }]);
  }),
}));

// A stand-in shaped like a real key, so a leak would be unmistakable.
const KEY = 'sk-test-not-a-real-key-0123456789';
const COMPATIBLE_URL = 'https://integrate.api.nvidia.com/v1';

interface StubbedResponse {
  ok?: boolean;
  status?: number;
  body?: unknown;
}

function stubFetch({
  ok = true,
  status = 200,
  body = {},
}: StubbedResponse = {}) {
  const json = vi.fn(() => Promise.resolve(body));
  const fetchSpy = vi.fn(() =>
    Promise.resolve({ ok, status, json } as unknown as Response),
  );
  vi.stubGlobal('fetch', fetchSpy);
  return { fetchSpy, json };
}

function requestFrom(fetchSpy: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  const headers = init.headers as Record<string, string>;
  return { url, init, headers, body: JSON.parse(init.body as string) };
}

/** Every adapter, its config, a well-formed response, and where the key goes. */
const ADAPTERS = {
  anthropic: {
    config: { id: 'anthropic', apiKey: KEY } as ProviderConfig,
    body: { content: [{ type: 'text', text: 'drafted' }] },
    urlContains: 'api.anthropic.com',
    keyHeader: (h: Record<string, string>) => h['x-api-key'],
  },
  openai: {
    config: { id: 'openai', apiKey: KEY } as ProviderConfig,
    body: { choices: [{ message: { content: 'drafted' } }] },
    urlContains: 'api.openai.com',
    keyHeader: (h: Record<string, string>) => h.authorization,
  },
  google: {
    config: { id: 'google', apiKey: KEY } as ProviderConfig,
    body: { candidates: [{ content: { parts: [{ text: 'drafted' }] } }] },
    urlContains: 'generativelanguage.googleapis.com',
    keyHeader: (h: Record<string, string>) => h['x-goog-api-key'],
  },
  openai_compatible: {
    config: {
      id: 'openai_compatible',
      apiKey: KEY,
      baseUrl: COMPATIBLE_URL,
    } as ProviderConfig,
    body: { choices: [{ message: { content: 'drafted' } }] },
    urlContains: 'integrate.api.nvidia.com',
    keyHeader: (h: Record<string, string>) => h.authorization,
  },
} as const;

const entries = Object.entries(ADAPTERS);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the seam', () => {
  it('covers every provider id', () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual([...PROVIDER_IDS].sort());
  });

  for (const [name, adapter] of entries) {
    it(`${name} posts to its endpoint and returns the text`, async () => {
      const { fetchSpy } = stubFetch({ body: adapter.body });
      const provider = createProvider(adapter.config);

      const text = await provider.generate(
        [{ role: 'user', content: 'hello' }],
        {
          system: 'be brief',
          model: 'some-model',
        },
      );

      expect(text).toBe('drafted');
      const { url, init, headers } = requestFrom(fetchSpy);
      expect(url).toContain(adapter.urlContains);
      expect(init.method).toBe('POST');
      expect(adapter.keyHeader(headers)).toContain(KEY);
      // A followed redirect would walk straight past the SSRF guard, and an
      // absent signal would hang forever.
      expect(init.redirect).toBe('error');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it(`${name} rejects a response of the wrong shape`, async () => {
      stubFetch({ body: { unexpected: true } });
      const provider = createProvider(adapter.config);
      await expect(
        provider.generate([{ role: 'user', content: 'hello' }]),
      ).rejects.toThrow();
    });
  }
});

// The property, not just the failure: an error reaches logs and error trackers,
// so no failure path may carry the user's key. Mirrors crypto.test.ts.
describe('no adapter leaks the key', () => {
  for (const [name, adapter] of entries) {
    it(`${name} on a rejected request`, async () => {
      // The provider echoes the key back in its error body, which is exactly
      // why the body never enters a ProviderError.
      const { json } = stubFetch({
        ok: false,
        status: 401,
        body: { error: { message: `Incorrect API key provided: ${KEY}` } },
      });
      const logs = [
        vi.spyOn(console, 'log').mockImplementation(() => {}),
        vi.spyOn(console, 'error').mockImplementation(() => {}),
        vi.spyOn(console, 'warn').mockImplementation(() => {}),
      ];

      let thrown: unknown;
      try {
        await createProvider(adapter.config).generate(
          [{ role: 'user', content: 'hello' }],
          {
            model: 'some-model',
          },
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      const error = thrown as Error;
      for (const text of [error.message, error.stack ?? '', String(error)]) {
        expect(text).not.toContain(KEY);
      }
      expect(JSON.stringify(error)).not.toContain(KEY);
      expect(json).not.toHaveBeenCalled();
      for (const spy of logs) {
        expect(spy).not.toHaveBeenCalled();
      }
    });
  }
});

describe('the custom endpoint', () => {
  const privateUrls = [
    'http://localhost:11434/v1',
    'https://169.254.169.254/v1',
    'https://10.0.0.5:8000/v1',
    'https://[::1]/v1',
  ];

  for (const baseUrl of privateUrls) {
    it(`refuses ${baseUrl} at save time`, () => {
      expect(() =>
        createProvider({ id: 'openai_compatible', apiKey: KEY, baseUrl }),
      ).toThrow();
    });
  }

  it('accepts a private endpoint when the self-host flag is passed', () => {
    const provider = createProvider({
      id: 'openai_compatible',
      apiKey: KEY,
      baseUrl: 'http://localhost:11434/v1',
      policy: { allowPrivate: true },
    });
    expect(provider.id).toBe('openai_compatible');
  });

  it('requires a model, because only the host knows what it serves', async () => {
    stubFetch({ body: ADAPTERS.openai_compatible.body });
    const provider = createProvider(ADAPTERS.openai_compatible.config);
    await expect(
      provider.generate([{ role: 'user', content: 'hi' }]),
    ).rejects.toThrow(/model is required/);
  });

  // Before the guard returned a normalised hostname this threw: the adapter
  // re-derived it with `new URL(base).hostname`, which keeps the brackets, and
  // handed DNS `[2606:4700::1111]`.
  it('reaches a public IPv6 literal endpoint', async () => {
    stubFetch({ body: ADAPTERS.openai_compatible.body });
    const provider = createProvider({
      id: 'openai_compatible',
      apiKey: KEY,
      baseUrl: 'https://[2606:4700::1111]/v1',
    });

    await expect(
      provider.generate([{ role: 'user', content: 'hi' }], { model: 'llama' }),
    ).resolves.toBe('drafted');
  });

  it('sends the token cap under the name compatible hosts understand', async () => {
    const { fetchSpy } = stubFetch({ body: ADAPTERS.openai_compatible.body });
    await createProvider(ADAPTERS.openai_compatible.config).generate(
      [{ role: 'user', content: 'hi' }],
      { model: 'meta/llama-3.1-8b-instruct', maxTokens: 128 },
    );

    const { body } = requestFrom(fetchSpy);
    expect(body.max_tokens).toBe(128);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it('uses the current OpenAI field name against OpenAI itself', async () => {
    const { fetchSpy } = stubFetch({ body: ADAPTERS.openai.body });
    await createProvider(ADAPTERS.openai.config).generate(
      [{ role: 'user', content: 'hi' }],
      {
        maxTokens: 128,
      },
    );

    const { body } = requestFrom(fetchSpy);
    expect(body.max_completion_tokens).toBe(128);
    expect(body.max_tokens).toBeUndefined();
  });
});

describe('the mock provider', () => {
  const messages = [{ role: 'user' as const, content: 'the job posting' }];

  it('needs no key, no network and no environment', async () => {
    // No fetch stub on purpose: a real call here would throw.
    await expect(createMockProvider().generate(messages)).resolves.toContain(
      'billing export',
    );
  });

  it('returns the same answer for the same call', async () => {
    const provider = createMockProvider();
    const [first, second] = await Promise.all([
      provider.generate(messages, { system: 'draft the resume' }),
      provider.generate(messages, { system: 'draft the resume' }),
    ]);
    expect(first).toBe(second);
  });

  it('returns a different answer for each stage of the pipeline', async () => {
    const provider = createMockProvider();
    const stages = await Promise.all(
      [
        'draft the resume',
        'reviewer critique',
        'revise using the critique',
      ].map((system) => provider.generate(messages, { system })),
    );

    expect(new Set(stages).size).toBe(3);
  });

  it('never emits an em dash or the key', async () => {
    const provider = createMockProvider();
    for (const system of ['draft', 'reviewer', 'revise']) {
      const text = await provider.generate(messages, { system });
      expect(text).not.toContain('—');
      expect(text).not.toContain(KEY);
    }
  });

  // A real posting is free to say "we need a reviewer". The stage is the
  // caller's decision, so the pasted input must not be able to change it.
  it('ignores stage words in the pasted job posting', async () => {
    const provider = createMockProvider();
    const posting = [
      { role: 'user' as const, content: 'Hiring a reviewer to revise drafts.' },
    ];

    await expect(
      provider.generate(posting, { system: 'draft the resume' }),
    ).resolves.toBe(await provider.generate(messages, { system: 'draft' }));
  });

  it('stands in for whichever provider a test needs', () => {
    expect(createMockProvider({ id: 'google' }).id).toBe('google');
  });
});
