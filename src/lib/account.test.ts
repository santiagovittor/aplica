import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteAccount } from './account';
import { SupabaseError } from './supabase';

/**
 * Deleting an account actually deletes (SLICE-9 non-negotiable 3).
 *
 * The order is the whole design. Storage has no foreign key to cascade
 * through, so deleting the auth user first would leave the files behind
 * permanently with no row left to find them from. Files first, then the auth
 * user, which cascades every table.
 *
 * The nesting matters too: `outputs` is keyed <uid>/<application>/<file>, so a
 * single flat listing of <uid>/ returns folders rather than objects, and a
 * delete built from it would remove nothing while looking like it worked.
 */

const SECRET = 'sb_secret_pretend-this-is-real';
const URL_BASE = 'http://127.0.0.1:54321';
const USER = 'b69b2ef7-7749-4210-849c-af8cd6c54987';
const APP_ONE = '16f54978-4f5f-4287-9997-37c0eb0cec05';
const APP_TWO = '9c0f1f0e-3c8b-4a5a-9d3e-2b1a0c7d5e42';

interface Captured {
  url: string;
  method: string;
  body: string;
}

let calls: Captured[] = [];

/** Folders come back with a null id, which is how `list` reports them. */
function folder(name: string) {
  return { name, id: null };
}
function object(name: string) {
  return { name, id: crypto.randomUUID() };
}

/** What each bucket answers for each prefix, one page each. */
const listing: Record<string, Record<string, unknown[]>> = {
  cvs: { [USER]: [object('cv')] },
  outputs: {
    [USER]: [folder(APP_ONE), folder(APP_TWO)],
    [`${USER}/${APP_ONE}`]: [
      object('resume.pdf'),
      object('resume.docx'),
      object('cover-letter.pdf'),
      object('cover-letter.docx'),
    ],
    [`${USER}/${APP_TWO}`]: [object('resume.pdf')],
  },
};

/** Set to a status to make that operation fail. */
let failOn: { match: string; status: number } | null = null;

function stubNetwork() {
  vi.stubGlobal(
    'fetch',
    async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      const body = init.body === undefined ? '' : String(init.body);
      calls.push({ url, method: init.method ?? 'POST', body });

      if (failOn && url.includes(failOn.match)) {
        return new Response(null, { status: failOn.status });
      }

      const listMatch = /\/storage\/v1\/object\/list\/(\w+)$/.exec(url);
      if (listMatch) {
        const { prefix } = JSON.parse(body) as { prefix: string };
        return Response.json(listing[listMatch[1]]?.[prefix] ?? []);
      }

      return new Response(null, { status: 200 });
    },
  );
}

const original = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  secret: process.env.SUPABASE_SECRET_KEY,
};

beforeEach(() => {
  calls = [];
  failOn = null;
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_BASE;
  process.env.SUPABASE_SECRET_KEY = SECRET;
  stubNetwork();
});

afterEach(() => {
  vi.unstubAllGlobals();
  restore('NEXT_PUBLIC_SUPABASE_URL', original.url);
  restore('SUPABASE_SECRET_KEY', original.secret);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function deletedFrom(bucket: string): string[] {
  const call = calls.find(
    (entry) =>
      entry.method === 'DELETE' &&
      entry.url.endsWith(`/storage/v1/object/${bucket}`),
  );
  return call
    ? ((JSON.parse(call.body) as { prefixes: string[] }).prefixes ?? [])
    : [];
}

describe('deleteAccount', () => {
  it('removes the uploaded CV', async () => {
    await deleteAccount(USER);

    expect(deletedFrom('cvs')).toEqual([`${USER}/cv`]);
  });

  it('walks into every application folder in outputs', async () => {
    // The orphan slice 7 named. A flat listing would have found two folders and
    // deleted nothing.
    await deleteAccount(USER);

    expect(deletedFrom('outputs').sort()).toEqual(
      [
        `${USER}/${APP_ONE}/resume.pdf`,
        `${USER}/${APP_ONE}/resume.docx`,
        `${USER}/${APP_ONE}/cover-letter.pdf`,
        `${USER}/${APP_ONE}/cover-letter.docx`,
        `${USER}/${APP_TWO}/resume.pdf`,
      ].sort(),
    );
  });

  it('deletes the auth user last, which cascades every table', async () => {
    await deleteAccount(USER);

    const last = calls[calls.length - 1];
    expect(last.method).toBe('DELETE');
    expect(last.url).toBe(`${URL_BASE}/auth/v1/admin/users/${USER}`);
  });

  it('empties both buckets before it touches the auth user', async () => {
    await deleteAccount(USER);
    const order = calls.map((call) => `${call.method} ${call.url}`);

    expect(order).toEqual([
      `POST ${URL_BASE}/storage/v1/object/list/cvs`,
      `DELETE ${URL_BASE}/storage/v1/object/cvs`,
      `POST ${URL_BASE}/storage/v1/object/list/outputs`,
      `POST ${URL_BASE}/storage/v1/object/list/outputs`,
      `POST ${URL_BASE}/storage/v1/object/list/outputs`,
      `DELETE ${URL_BASE}/storage/v1/object/outputs`,
      `DELETE ${URL_BASE}/auth/v1/admin/users/${USER}`,
    ]);
  });

  it('does not ask storage to delete nothing', async () => {
    // A user who never uploaded anything. An empty prefixes array is a request
    // that can only fail.
    await deleteAccount('3f2504e0-4f89-41d3-9a0c-0305e82c3301');

    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('refuses a user id that is not a UUID', async () => {
    // The id goes straight into a storage prefix and a URL path.
    await expect(deleteAccount('../../other-user')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('a failed deletion stops', () => {
  it('leaving the account intact when the files cannot be removed', async () => {
    // Better a live account with its files than a deleted account whose files
    // nobody can find any more.
    failOn = { match: '/storage/v1/object/cvs', status: 500 };

    await expect(deleteAccount(USER)).rejects.toBeInstanceOf(SupabaseError);
    expect(
      calls.some((call) => call.url.includes('/auth/v1/admin/users/')),
    ).toBe(false);
  });

  it('and says which step failed, without the secret key', async () => {
    failOn = { match: '/auth/v1/admin/users/', status: 403 };

    let thrown: unknown;
    try {
      await deleteAccount(USER);
    } catch (error) {
      thrown = error;
    }

    const error = thrown as SupabaseError;
    expect(error.message).toMatch(/account delete failed with status 403/);
    for (const text of [error.message, error.stack ?? '', String(error)]) {
      expect(text).not.toContain(SECRET);
    }
  });
});
