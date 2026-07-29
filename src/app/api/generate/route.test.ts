import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POSTING, PROFILE } from '../../../core/fixtures';
import { createMockProvider } from '../../../providers/mock';
import { ProviderError } from '../../../providers/types';

/**
 * The generation route, against mocks for everything it touches.
 *
 * The one property worth more than the rest: the user's key appears in no
 * event of any stream this route produces, including its error events. The key
 * below is a fixed string that is grepped for across the whole serialised
 * stream, so a leak anywhere in it fails the test rather than only a leak in
 * the field somebody thought to assert on.
 */

// Not a real credential. Nothing here talks to a provider.
const API_KEY = 'sk-ant-pretend-this-is-a-real-key-0123456789';
const USER = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER_USER = '9c858901-8a57-4791-81fe-4c455b099bc9';
const NAME = 'Ada Lovelace';
const APPLICATION_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

const { currentUser } = vi.hoisted(() => ({ currentUser: vi.fn() }));
const { describeApiKey, getDecryptedKey } = vi.hoisted(() => ({
  describeApiKey: vi.fn(),
  getDecryptedKey: vi.fn(),
}));
const { loadDisplayName, loadProfile, startApplication } = vi.hoisted(() => ({
  loadDisplayName: vi.fn(),
  loadProfile: vi.fn(),
  startApplication: vi.fn(),
}));
const { spendGeneration } = vi.hoisted(() => ({ spendGeneration: vi.fn() }));
const { createProvider } = vi.hoisted(() => ({ createProvider: vi.fn() }));

vi.mock('../../../lib/session', () => ({ currentUser }));
vi.mock('../../../lib/api-keys', () => ({ describeApiKey, getDecryptedKey }));
vi.mock('../../../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/supabase')>()),
  loadDisplayName,
  loadProfile,
  startApplication,
}));
vi.mock('../../../lib/usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/usage')>()),
  spendGeneration,
}));
vi.mock('../../../providers/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../providers/index')>()),
  createProvider,
}));

const { POST } = await import('./route');
const { StoredShapeError } = await import('../../../lib/supabase');
const { GenerationLimitReached } = await import('../../../lib/usage');

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

function post(body: unknown): Request {
  return new Request('http://localhost/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID = { posting: POSTING, tier: 'standard' as const };

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.mockResolvedValue({ id: USER });
  describeApiKey.mockResolvedValue({ provider: 'anthropic' });
  getDecryptedKey.mockResolvedValue({ provider: 'anthropic', apiKey: API_KEY });
  loadDisplayName.mockResolvedValue(NAME);
  loadProfile.mockResolvedValue(PROFILE);
  startApplication.mockResolvedValue(APPLICATION_ID);
  spendGeneration.mockResolvedValue(1);
  createProvider.mockImplementation(() => createMockProvider());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the generation route streams', () => {
  it('an event per stage that ran, then done', async () => {
    // The stages are the calls the pipeline actually makes, plus the row this
    // route writes. Nothing pretends to think.
    const { events } = await read(await POST(post(VALID)));

    expect(events.map((event) => event.event)).toEqual([
      'stage',
      'stage',
      'stage',
      'stage',
      'done',
    ]);
    expect(events.slice(0, 4).map((event) => event.data.stage)).toEqual([
      'draft',
      'review',
      'revise',
      'saving',
    ]);
  });

  it('as an event stream that proxies will not buffer', async () => {
    const response = await POST(post(VALID));

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
  });

  it('the stored application id, and not the documents', async () => {
    // The resume comes back from the render route as a file. A body the client
    // held is a body the client could edit before sending it back.
    const { raw, events } = await read(await POST(post(VALID)));
    const done = events.at(-1);

    expect(done?.event).toBe('done');
    expect(done?.data.applicationId).toBe(APPLICATION_ID);
    expect(raw).not.toContain('month-end close');
    expect(done?.data.resume).toBeUndefined();
    expect(done?.data.coverLetter).toBeUndefined();
  });

  it('exactly one terminal event, never both', async () => {
    const { events } = await read(await POST(post(VALID)));
    const terminal = events.filter((event) => event.event !== 'stage');

    expect(terminal).toHaveLength(1);
  });
});

describe('the user id comes from the session', () => {
  it('and a user_id in the body is ignored', async () => {
    // A body that carries a user id is a body somebody edits. This one names
    // another real user, and every read has to stay on the session's user.
    await read(await POST(post({ ...VALID, user_id: OTHER_USER })));

    for (const mock of [
      describeApiKey,
      loadDisplayName,
      loadProfile,
      spendGeneration,
    ]) {
      expect(mock).toHaveBeenCalledWith(USER);
    }
    expect(startApplication.mock.calls[0][0]).toBe(USER);
    expect(getDecryptedKey).not.toHaveBeenCalledWith(OTHER_USER);
  });

  it('and no session is a 401 with no stream at all', async () => {
    currentUser.mockResolvedValue(null);

    const response = await POST(post(VALID));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(spendGeneration).not.toHaveBeenCalled();
  });
});

describe('the key never reaches the stream', () => {
  it('not in any event of a successful run', async () => {
    const { raw } = await read(await POST(post(VALID)));

    expect(raw).not.toContain(API_KEY);
  });

  it('not in the error event when the provider rejects it', async () => {
    // The one case where a naive implementation echoes it back: a 401 body
    // from a provider can quote the key it was sent.
    createProvider.mockImplementation(() => ({
      id: 'anthropic',
      supportsSearch: false,
      generate: () => Promise.reject(new ProviderError('anthropic', 401)),
    }));

    const { raw, events } = await read(await POST(post(VALID)));

    expect(raw).not.toContain(API_KEY);
    expect(events.at(-1)).toEqual({
      event: 'error',
      data: { error: 'provider_rejected_key', status: 401 },
    });
  });

  it('not when the thing that throws is carrying it', async () => {
    // An exception from an unaudited layer. A route that forwarded
    // `error.message` would put the key straight into the stream, so this
    // route emits a code from a fixed set and never a message.
    createProvider.mockImplementation(() => ({
      id: 'anthropic',
      supportsSearch: false,
      generate: () =>
        Promise.reject(
          new Error(`POST https://api.anthropic.com failed: key ${API_KEY}`),
        ),
    }));

    const { raw, events } = await read(await POST(post(VALID)));

    expect(raw).not.toContain(API_KEY);
    expect(events.at(-1)?.data).toEqual({ error: 'unexpected' });
  });

  it('not when the stage callback runs between paid calls', async () => {
    const { events } = await read(await POST(post(VALID)));

    for (const event of events) {
      expect(JSON.stringify(event)).not.toContain(API_KEY);
    }
  });
});

describe('the key is read at the moment of use', () => {
  it('once per model call, and never cached across them', async () => {
    // Not once for the pipeline. A key held across three calls is a key that
    // can be read out of a heap dump long after the request that needed it.
    await read(await POST(post(VALID)));

    expect(getDecryptedKey).toHaveBeenCalledTimes(3);
    expect(createProvider).toHaveBeenCalledTimes(3);
  });

  it('and a key deleted mid-pipeline stops the run', async () => {
    // The account screen has a one-click delete, so this is a real race.
    getDecryptedKey
      .mockResolvedValueOnce({ provider: 'anthropic', apiKey: API_KEY })
      .mockResolvedValue(null);

    const { events } = await read(await POST(post(VALID)));

    expect(events.at(-1)).toEqual({
      event: 'error',
      data: { error: 'key_missing' },
    });
  });
});

describe('the generation route refuses before it spends anything', () => {
  const refusals: [string, () => void, number, string][] = [
    [
      'a user with no stored key',
      () => describeApiKey.mockResolvedValue(null),
      409,
      'key_missing',
    ],
    [
      'a user whose name we do not have',
      () => loadDisplayName.mockResolvedValue(null),
      409,
      'name_missing',
    ],
    [
      'a user with no parsed profile',
      () => loadProfile.mockResolvedValue(null),
      409,
      'profile_missing',
    ],
    [
      'a stored profile that no longer validates',
      () =>
        loadProfile.mockRejectedValue(
          new StoredShapeError('profile', 'experience is wrong'),
        ),
      409,
      'profile_unreadable',
    ],
  ];

  for (const [name, arrange, status, code] of refusals) {
    it(name, async () => {
      arrange();

      const response = await POST(post(VALID));

      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: code });
      expect(createProvider).not.toHaveBeenCalled();
    });
  }

  it('a posting that is empty or absurd, naming the field only', async () => {
    // A Zod message quotes the offending value, and the offending value is the
    // posting somebody pasted.
    const response = await POST(post({ posting: '   ', tier: 'standard' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'bad_request',
      fields: ['posting'],
    });
    expect(spendGeneration).not.toHaveBeenCalled();
  });

  it('a body that is not JSON at all', async () => {
    const response = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        body: 'not json',
      }),
    );

    expect(response.status).toBe(400);
    expect(createProvider).not.toHaveBeenCalled();
  });
});

describe('the daily limit is spent before a token is', () => {
  it('and a refusal never reaches a provider', async () => {
    spendGeneration.mockRejectedValue(new GenerationLimitReached(20));

    const response = await POST(post(VALID));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'rate_limited', limit: 20 });
    expect(createProvider).not.toHaveBeenCalled();
    expect(getDecryptedKey).not.toHaveBeenCalled();
  });

  it('and it is spent before the first call, not after the last', async () => {
    const order: string[] = [];
    spendGeneration.mockImplementation(async () => {
      order.push('spend');
      return 1;
    });
    createProvider.mockImplementation(() => {
      order.push('provider');
      return createMockProvider();
    });

    await read(await POST(post(VALID)));

    expect(order[0]).toBe('spend');
  });

  it('and a failed generation is not refunded', async () => {
    // A failed generation still spent the user's tokens, and a limit that
    // refunds on error is a limit a crafted failure walks straight through.
    createProvider.mockImplementation(() => ({
      id: 'anthropic',
      supportsSearch: false,
      generate: () => Promise.reject(new ProviderError('anthropic', 500)),
    }));

    const { events } = await read(await POST(post(VALID)));

    expect(events.at(-1)?.data).toMatchObject({
      error: 'provider_unavailable',
    });
    expect(spendGeneration).toHaveBeenCalledTimes(1);
  });
});

describe('a provider failure is told apart from the others', () => {
  const cases: [number | Error, string][] = [
    [401, 'provider_rejected_key'],
    [403, 'provider_rejected_key'],
    [429, 'provider_rate_limited'],
    [400, 'provider_refused'],
    [503, 'provider_unavailable'],
    [
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
      'provider_timeout',
    ],
    [
      Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
      'provider_timeout',
    ],
  ];

  for (const [thrown, code] of cases) {
    it(`reports ${code} for ${thrown instanceof Error ? thrown.name : thrown}`, async () => {
      // Bad key, rate limit and timeout need different things from the user:
      // fix the key, wait, or try again. One generic failure would tell them
      // to do the wrong one.
      const error =
        thrown instanceof Error
          ? thrown
          : new ProviderError('anthropic', thrown);
      createProvider.mockImplementation(() => ({
        id: 'anthropic',
        supportsSearch: false,
        generate: () => Promise.reject(error),
      }));

      const { events } = await read(await POST(post(VALID)));

      expect(events.at(-1)?.event).toBe('error');
      expect(events.at(-1)?.data).toMatchObject({ error: code });
    });
  }

  it('reports a bad key on a 400 that says so, not a generic refusal', async () => {
    // Google answers a bad key with 400, not 401. Without the reason code this
    // lands on "try again", which is the wrong instruction for a dead key: the
    // user would retry forever. The reason is a machine-readable enum, not
    // free text, so reading it costs nothing in leak terms.
    createProvider.mockImplementation(() => ({
      id: 'google',
      supportsSearch: false,
      generate: () =>
        Promise.reject(new ProviderError('google', 400, 'API_KEY_INVALID')),
    }));

    const { events } = await read(await POST(post(VALID)));

    expect(events.at(-1)?.data).toEqual({
      error: 'provider_rejected_key',
      status: 400,
    });
  });

  it('and a 400 with no reason stays a generic refusal', async () => {
    // A malformed request is also a 400. Without the enum there is nothing to
    // tell them apart, and guessing would tell a user their key is fine when
    // it is not, or the reverse.
    createProvider.mockImplementation(() => ({
      id: 'google',
      supportsSearch: false,
      generate: () => Promise.reject(new ProviderError('google', 400)),
    }));

    const { events } = await read(await POST(post(VALID)));

    expect(events.at(-1)?.data).toMatchObject({ error: 'provider_refused' });
  });

  it('and the row is not written when generation failed', async () => {
    createProvider.mockImplementation(() => ({
      id: 'anthropic',
      supportsSearch: false,
      generate: () => Promise.reject(new ProviderError('anthropic', 429)),
    }));

    await read(await POST(post(VALID)));

    expect(startApplication).not.toHaveBeenCalled();
  });
});
