import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The cookie plumbing is the whole reason decision 1 bought `@supabase/ssr`, so
 * these tests exercise the real library over a fake cookie store and a fake
 * network rather than mocking the library itself. What is proved: a session
 * written by the SDK is read back by a second, independent client (chunked
 * cookie names and all), a request with no cookies has no user, and a session
 * the server rejects is treated as no session rather than as a signed-in user.
 */

const URL_BASE = 'http://127.0.0.1:54321';
// Local Supabase prints its own publishable key. This is not one, and nothing
// here reaches a server.
const PUBLISHABLE = 'sb_publishable_pretend-this-is-real';
const USER_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/** Stands in for the request's cookie store, which `next/headers` owns. */
const jar = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () =>
      [...jar].map(([name, value]) => ({
        name,
        value,
      })),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
  }),
}));

vi.mock('next-intl/server', () => ({
  getLocale: async () => 'es',
}));

const redirected: { href: string; locale: string }[] = [];

vi.mock('../i18n/navigation', () => ({
  redirect: (args: { href: string; locale: string }) => {
    redirected.push(args);
    // Next's own redirect throws; anything after the call never runs.
    throw new Error('NEXT_REDIRECT');
  },
}));

const { currentUser, requireUser, serverClient } = await import('./session');

/** An unsigned JWT. The server verifies tokens; the SDK only reads `exp`. */
function token(secondsFromNow: number): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return [
    part({ alg: 'HS256', typ: 'JWT' }),
    part({
      sub: USER_ID,
      exp: Math.floor(Date.now() / 1000) + secondsFromNow,
      role: 'authenticated',
    }),
    'not-a-real-signature',
  ].join('.');
}

const USER = {
  id: USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'ada@example.test',
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
};

let userStatus = 200;

function stubNetwork() {
  vi.stubGlobal('fetch', (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);

    if (url.includes('/auth/v1/user')) {
      return Promise.resolve(
        userStatus === 200
          ? Response.json(USER)
          : Response.json(
              { error: 'invalid_token', error_description: 'expired' },
              { status: userStatus },
            ),
      );
    }

    if (url.includes('/auth/v1/token')) {
      // Every refresh in these tests is one the server refuses.
      return Promise.resolve(
        Response.json({ error: 'invalid_grant' }, { status: 400 }),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

beforeEach(() => {
  jar.clear();
  redirected.length = 0;
  userStatus = 200;
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_BASE;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE;
  stubNetwork();
});

afterEach(() => {
  vi.unstubAllGlobals();
  restore('NEXT_PUBLIC_SUPABASE_URL', originalUrl);
  restore('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', originalKey);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

/** Signs in by handing the SDK a session, which writes it to the jar. */
async function signIn() {
  const supabase = await serverClient();
  const { error } = await supabase.auth.setSession({
    access_token: token(3600),
    refresh_token: 'refresh-token',
  });
  expect(error).toBeNull();
}

describe('signed out', () => {
  it('has no user', async () => {
    expect(await currentUser()).toBeNull();
  });

  it('sends requireUser to sign in, in the reader’s language', async () => {
    await expect(requireUser()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirected).toEqual([{ href: '/sign-in', locale: 'es' }]);
  });
});

describe('signed in', () => {
  it('reads back a session a previous request wrote', async () => {
    await signIn();
    expect(jar.size).toBeGreaterThan(0);

    // A second client, built from the cookies alone. This is the round trip
    // every server component makes.
    expect(await currentUser()).toMatchObject({ id: USER_ID });
  });

  it('returns the user from requireUser without redirecting', async () => {
    await signIn();

    expect(await requireUser()).toMatchObject({ id: USER_ID });
    expect(redirected).toEqual([]);
  });
});

describe('a session the server rejects', () => {
  it('is not a signed-in user', async () => {
    await signIn();

    // What an expired access token looks like from here: the server refuses the
    // token and refuses to refresh it.
    userStatus = 401;

    expect(await currentUser()).toBeNull();
  });

  it('sends requireUser to sign in', async () => {
    await signIn();
    userStatus = 401;

    await expect(requireUser()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirected).toEqual([{ href: '/sign-in', locale: 'es' }]);
  });
});

describe('fails fast', () => {
  it('when the project URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    await expect(serverClient()).rejects.toThrow(
      /NEXT_PUBLIC_SUPABASE_URL is not set/,
    );
  });

  it('when the publishable key is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    await expect(serverClient()).rejects.toThrow(
      /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set/,
    );
  });
});
