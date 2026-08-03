import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CV_LINES,
  cvExtractionFixtures,
  pdf,
  textStream,
} from '../../../core/cv-fixtures';
import { MAX_CV_BYTES } from '../../../core/extract-text';
import { createMockProvider } from '../../../providers/mock';
import {
  ProviderError,
  type GenerateOptions,
  type Message,
} from '../../../providers/types';

/**
 * The CV route, against mocks for everything it touches. Same non-negotiables
 * as `/api/generate`'s test, plus SLICE-11's own five (non-negotiables 1-5):
 * the user id comes from the session, the key never reaches the stream, the
 * parse limit is spent before a token is spent and never refunded, every one
 * of the seven extraction failures reaches zero provider calls, and a
 * grounding finding is surfaced rather than swallowed.
 */

// Not a real credential. Nothing here talks to a provider.
const API_KEY = 'AIzaSy-pretend-this-is-a-real-key-0123456789';
const USER = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

// Grounds cleanly against CV_LINES (core/cv-fixtures.ts): every claim's
// numbers and entities, and the one voice anchor, are substrings of it.
const GROUNDED_PROFILE = {
  voiceAnchors: ['Cut the month-end close from three days to one'],
  experience: [
    {
      role: 'Operations analyst',
      organisation: 'Cooperativa del Sur',
      start: '2022',
      end: '2025',
      bullets: [
        {
          text: 'Cut the month-end close from three days to one.',
          source: 'extracted',
          evidence: 'strong',
        },
      ],
    },
  ],
  projects: [],
  skills: [
    {
      name: 'SQL',
      group: 'Data',
      provenBy: 'Tools: SQL, Python, PostgreSQL, dbt.',
      source: 'extracted',
      evidence: 'strong',
    },
  ],
  starStories: [],
  education: [],
  certifications: [],
  languages: [],
  keywordBank: [],
  gaps: [],
};

/** A profile whose voice anchor is not a verbatim quote from the CV. */
function profileWithUngroundedAnchor(): string {
  return JSON.stringify({
    ...GROUNDED_PROFILE,
    voiceAnchors: ['I invented this line, it is nowhere in the CV.'],
  });
}

/** Matches `parsePrompt`'s own heading, the same marker parse-cv.test.ts uses. */
const PARSE_MARKER = 'parse a cv';

function mockParseProvider(
  response: string = JSON.stringify(GROUNDED_PROFILE),
) {
  return createMockProvider({
    id: 'google',
    responses: { [PARSE_MARKER]: response },
  });
}

const { currentUser } = vi.hoisted(() => ({ currentUser: vi.fn() }));
const { describeApiKey, getDecryptedKey } = vi.hoisted(() => ({
  describeApiKey: vi.fn(),
  getDecryptedKey: vi.fn(),
}));
const { loadLocale, saveProfile } = vi.hoisted(() => ({
  loadLocale: vi.fn(),
  saveProfile: vi.fn(),
}));
const { spendParse } = vi.hoisted(() => ({ spendParse: vi.fn() }));
const { createProvider } = vi.hoisted(() => ({ createProvider: vi.fn() }));

vi.mock('../../../lib/session', () => ({ currentUser }));
vi.mock('../../../lib/api-keys', () => ({ describeApiKey, getDecryptedKey }));
vi.mock('../../../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/supabase')>()),
  loadLocale,
  saveProfile,
}));
vi.mock('../../../lib/usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/usage')>()),
  spendParse,
}));
vi.mock('../../../providers/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../providers/index')>()),
  createProvider,
}));

const { POST } = await import('./route');
const { ParseLimitReached } = await import('../../../lib/usage');

interface Event {
  event: string;
  data: Record<string, unknown>;
}

/** The whole stream as text, and as the events it carries. */
async function read(
  response: Response,
): Promise<{ raw: string; events: Event[] }> {
  const raw = await response.text();
  const events = raw
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const [eventLine, dataLine] = block.split('\n');
      return {
        event: eventLine.replace(/^event: /, ''),
        data: JSON.parse(dataLine.replace(/^data: /, '')) as Record<
          string,
          unknown
        >,
      };
    });

  return { raw, events };
}

const VALID_CV = pdf(textStream(CV_LINES));

function post(
  bytes: Uint8Array | null,
  {
    signal,
    contentLength,
  }: { signal?: AbortSignal; contentLength?: number } = {},
): Request {
  const form = new FormData();
  if (bytes !== null) {
    form.set(
      'cv',
      new File([new Uint8Array(bytes)], 'cv.pdf', { type: 'application/pdf' }),
    );
  }

  const headers: Record<string, string> = {};
  if (contentLength !== undefined) {
    headers['content-length'] = String(contentLength);
  }

  return new Request('http://localhost/api/cv', {
    method: 'POST',
    body: form,
    headers,
    signal,
  });
}

/** A request whose body cannot be parsed as multipart at all. */
function nonMultipartRequest(): Request {
  return new Request('http://localhost/api/cv', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'not a multipart body',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.mockResolvedValue({ id: USER });
  describeApiKey.mockResolvedValue({ provider: 'google' });
  getDecryptedKey.mockResolvedValue({ provider: 'google', apiKey: API_KEY });
  loadLocale.mockResolvedValue('en');
  saveProfile.mockResolvedValue(`${USER}/cv`);
  spendParse.mockResolvedValue(1);
  createProvider.mockImplementation(() => mockParseProvider());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the CV route streams', () => {
  it('an event per stage that ran, then done', async () => {
    const { events } = await read(await POST(post(VALID_CV)));

    expect(events.map((event) => event.event)).toEqual([
      'stage',
      'stage',
      'stage',
      'stage',
      'done',
    ]);
    expect(events.slice(0, 4).map((event) => event.data.stage)).toEqual([
      'reading',
      'parsing',
      'checking',
      'saving',
    ]);
  });

  it('as an event stream that proxies will not buffer', async () => {
    const response = await POST(post(VALID_CV));

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
  });

  it('summary counts, and not the profile itself', async () => {
    const { raw, events } = await read(await POST(post(VALID_CV)));
    const done = events.at(-1);

    expect(done?.event).toBe('done');
    expect(done?.data).toEqual({
      findings: [],
      droppedAnchors: [],
      roles: 1,
      skills: 1,
      keywords: 0,
    });
    // The profile's own claim text never appears; only the counts do.
    expect(raw).not.toContain('Cooperativa del Sur');
  });

  it('exactly one terminal event, never both', async () => {
    const { events } = await read(await POST(post(VALID_CV)));
    const terminal = events.filter((event) => event.event !== 'stage');

    expect(terminal).toHaveLength(1);
  });
});

describe('the user id comes from the session', () => {
  it('every call reads and writes on it, not a guess', async () => {
    await read(await POST(post(VALID_CV)));

    for (const mock of [describeApiKey, loadLocale, spendParse]) {
      expect(mock).toHaveBeenCalledWith(USER);
    }
    expect(getDecryptedKey).toHaveBeenCalledWith(USER);
    expect(saveProfile.mock.calls[0][0]).toBe(USER);
  });

  it('and no session is a 401 with no stream at all', async () => {
    currentUser.mockResolvedValue(null);

    const response = await POST(post(VALID_CV));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(spendParse).not.toHaveBeenCalled();
    expect(createProvider).not.toHaveBeenCalled();
  });
});

describe('the key never reaches the stream', () => {
  it('not in any event of a successful run', async () => {
    const { raw } = await read(await POST(post(VALID_CV)));

    expect(raw).not.toContain(API_KEY);
  });

  it('not in the error event when the provider rejects it', async () => {
    createProvider.mockImplementation(() => ({
      id: 'google',
      supportsSearch: false,
      generate: () => Promise.reject(new ProviderError('google', 401)),
    }));

    const { raw, events } = await read(await POST(post(VALID_CV)));

    expect(raw).not.toContain(API_KEY);
    expect(events.at(-1)).toEqual({
      event: 'error',
      data: { error: 'provider_rejected_key', status: 401 },
    });
  });

  it('not when the thing that throws is carrying it', async () => {
    createProvider.mockImplementation(() => ({
      id: 'google',
      supportsSearch: false,
      generate: () =>
        Promise.reject(new Error(`request failed: key ${API_KEY}`)),
    }));

    const { raw, events } = await read(await POST(post(VALID_CV)));

    expect(raw).not.toContain(API_KEY);
    expect(events.at(-1)?.data).toEqual({ error: 'unexpected' });
  });
});

describe('the key is read at the moment of use', () => {
  it('once, for the one model call this route makes', async () => {
    await read(await POST(post(VALID_CV)));

    expect(getDecryptedKey).toHaveBeenCalledTimes(1);
    expect(createProvider).toHaveBeenCalledTimes(1);
  });

  it('and a key deleted mid-parse stops the run', async () => {
    getDecryptedKey.mockResolvedValue(null);

    const { events } = await read(await POST(post(VALID_CV)));

    expect(events.at(-1)).toEqual({
      event: 'error',
      data: { error: 'key_missing' },
    });
  });
});

describe('the CV route refuses before it spends anything', () => {
  it('a user with no stored key, before the stream opens', async () => {
    describeApiKey.mockResolvedValue(null);

    const response = await POST(post(VALID_CV));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'key_missing' });
    expect(createProvider).not.toHaveBeenCalled();
    expect(spendParse).not.toHaveBeenCalled();
  });

  it('a declared body larger than the cap, before it is read', async () => {
    const response = await POST(
      post(VALID_CV, { contentLength: MAX_CV_BYTES + 1 }),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'too_large' });
    expect(createProvider).not.toHaveBeenCalled();
    expect(spendParse).not.toHaveBeenCalled();
  });

  it('a body that is not multipart at all', async () => {
    const { events } = await read(await POST(nonMultipartRequest()));

    expect(events.at(-1)).toEqual({
      event: 'error',
      data: { error: 'bad_request', status: 400 },
    });
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('a request with no cv field', async () => {
    const { events } = await read(await POST(post(null)));

    expect(events.at(-1)).toEqual({
      event: 'error',
      data: { error: 'bad_request', status: 400 },
    });
    expect(createProvider).not.toHaveBeenCalled();
  });
});

describe('a file that is not a CV never reaches a model', () => {
  const fixtures = cvExtractionFixtures();

  for (const [code, bytes] of Object.entries(fixtures)) {
    it(`refuses ${code} with zero provider calls`, async () => {
      const { events } = await read(await POST(post(bytes)));

      expect(events.at(-1)).toEqual({ event: 'error', data: { error: code } });
      expect(createProvider).not.toHaveBeenCalled();
      expect(getDecryptedKey).not.toHaveBeenCalled();
      expect(spendParse).not.toHaveBeenCalled();
    });
  }
});

describe('the parse limit is spent before a token is', () => {
  it('and a refusal never reaches a provider', async () => {
    spendParse.mockRejectedValue(new ParseLimitReached(3));

    const { events } = await read(await POST(post(VALID_CV)));

    expect(events.at(-1)).toEqual({
      event: 'error',
      data: { error: 'rate_limited', status: 429, limit: 3 },
    });
    expect(createProvider).not.toHaveBeenCalled();
    expect(getDecryptedKey).not.toHaveBeenCalled();
  });

  it('and it is spent before the model call, not after', async () => {
    const order: string[] = [];
    spendParse.mockImplementation(async () => {
      order.push('spend');
      return 1;
    });
    createProvider.mockImplementation(() => {
      order.push('provider');
      return mockParseProvider();
    });

    await read(await POST(post(VALID_CV)));

    expect(order).toEqual(['spend', 'provider']);
  });

  it('and a failed parse is not refunded', async () => {
    createProvider.mockImplementation(() => ({
      id: 'google',
      supportsSearch: false,
      generate: () => Promise.reject(new ProviderError('google', 500)),
    }));

    const { events } = await read(await POST(post(VALID_CV)));

    expect(events.at(-1)?.data).toMatchObject({
      error: 'provider_unavailable',
    });
    expect(spendParse).toHaveBeenCalledTimes(1);
  });

  it('and the profile is not saved when the parse failed', async () => {
    createProvider.mockImplementation(() => ({
      id: 'google',
      supportsSearch: false,
      generate: () => Promise.reject(new ProviderError('google', 429)),
    }));

    await read(await POST(post(VALID_CV)));

    expect(saveProfile).not.toHaveBeenCalled();
  });
});

describe('a grounding finding is shown to the user', () => {
  it('a dropped voice anchor is reported in the done event', async () => {
    createProvider.mockImplementation(() =>
      mockParseProvider(profileWithUngroundedAnchor()),
    );

    const { events } = await read(await POST(post(VALID_CV)));
    const done = events.at(-1);

    expect(done?.event).toBe('done');
    expect(done?.data.droppedAnchors).toEqual([
      'I invented this line, it is nowhere in the CV.',
    ]);
  });
});

describe('openai_compatible needs a model before it needs a token', () => {
  it('refuses before the stream opens when the account has none', async () => {
    // Before this precondition existed, a missing model surfaced mid-parse as
    // a plain, un-typed Error from the adapter and fell through to
    // `unexpected`. This is the honest refusal that replaces that.
    describeApiKey.mockResolvedValue({
      provider: 'openai_compatible',
      model: null,
    });

    const response = await POST(post(VALID_CV));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'model_missing' });
    expect(createProvider).not.toHaveBeenCalled();
    expect(spendParse).not.toHaveBeenCalled();
  });

  it('threads the account default model and endpoint to the provider', async () => {
    const MODEL = 'meta/llama-3.1-70b-instruct';
    const BASE_URL = 'https://host.example.com/v1';
    describeApiKey.mockResolvedValue({
      provider: 'openai_compatible',
      model: MODEL,
    });
    getDecryptedKey.mockResolvedValue({
      provider: 'openai_compatible',
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    });
    const generate = vi.fn(() =>
      Promise.resolve(JSON.stringify(GROUNDED_PROFILE)),
    );
    createProvider.mockImplementation(() => ({
      id: 'openai_compatible',
      supportsSearch: false,
      generate,
    }));

    await read(await POST(post(VALID_CV)));

    expect(createProvider).toHaveBeenCalledWith({
      id: 'openai_compatible',
      apiKey: API_KEY,
      baseUrl: BASE_URL,
    });
    expect(generate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: MODEL }),
    );
  });
});

describe('a provider failure is told apart from the others', () => {
  const cases: [number, string][] = [
    [401, 'provider_rejected_key'],
    [403, 'provider_rejected_key'],
    [429, 'provider_rate_limited'],
    [400, 'provider_refused'],
    [503, 'provider_unavailable'],
  ];

  for (const [status, code] of cases) {
    it(`reports ${code} for status ${status}`, async () => {
      createProvider.mockImplementation(() => ({
        id: 'google',
        supportsSearch: false,
        generate: () => Promise.reject(new ProviderError('google', status)),
      }));

      const { events } = await read(await POST(post(VALID_CV)));

      expect(events.at(-1)?.data).toMatchObject({ error: code });
    });
  }

  it('reports a bad key on a 400 that says so, not a generic refusal', async () => {
    createProvider.mockImplementation(() => ({
      id: 'google',
      supportsSearch: false,
      generate: () =>
        Promise.reject(new ProviderError('google', 400, 'API_KEY_INVALID')),
    }));

    const { events } = await read(await POST(post(VALID_CV)));

    expect(events.at(-1)?.data).toEqual({
      error: 'provider_rejected_key',
      status: 400,
    });
  });
});

describe('the timeout budget', () => {
  it('an aborted signal mid-parse ends in a calm, specific event, not a hang', async () => {
    // Both this route's own deadline and a closed client tab feed the same
    // combined AbortSignal into parseCv, so triggering the abort here proves
    // the same code path a real near-timeout would hit: a graceful
    // parse_timeout event and a closed stream, never a dangling request.
    createProvider.mockImplementation(() => ({
      id: 'google',
      supportsSearch: false,
      generate: (_messages: Message[], opts?: GenerateOptions) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }),
    }));

    const controller = new AbortController();
    const responsePromise = POST(post(VALID_CV, { signal: controller.signal }));
    // Yield once so the route reaches the model call before aborting.
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();

    const { events } = await read(await responsePromise);

    expect(events.at(-1)).toEqual({
      event: 'error',
      data: { error: 'parse_timeout' },
    });
  });
});
