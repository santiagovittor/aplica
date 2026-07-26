import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../core/profile';
import { SupabaseError, saveProfile } from './supabase';

// Not a real credential: local Supabase prints its own, and nothing here talks
// to a server. It is still treated as one, because the assertions below are
// about a key never reaching an error.
const SECRET = 'sb_secret_pretend-this-is-real';
const URL_BASE = 'http://127.0.0.1:54321';
const USER = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.4\nnot really a pdf\n');
const DOCX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

const PROFILE: Profile = {
  voiceAnchors: ['I cut the month-end close from three days to one.'],
  experience: [],
  projects: [],
  skills: [],
  starStories: [],
  keywordBank: [],
  gaps: [],
};

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: BodyInit | null | undefined;
}

let calls: Captured[] = [];

function respondWith(...statuses: number[]) {
  let index = 0;
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: init.body,
    });
    const status = statuses[Math.min(index, statuses.length - 1)];
    index += 1;
    return Promise.resolve(new Response(null, { status }));
  });
}

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.SUPABASE_SECRET_KEY;

beforeEach(() => {
  calls = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_BASE;
  process.env.SUPABASE_SECRET_KEY = SECRET;
  respondWith(200);
});

afterEach(() => {
  vi.unstubAllGlobals();
  restore('NEXT_PUBLIC_SUPABASE_URL', originalUrl);
  restore('SUPABASE_SECRET_KEY', originalKey);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe('saveProfile', () => {
  it('uploads the file before it writes the row', async () => {
    // Order matters: an orphaned object is overwritten by the next attempt, but
    // a row written first would point cv_path at a file that never arrived.
    await saveProfile(USER, PROFILE, PDF_BYTES);

    expect(calls.map((call) => call.url)).toEqual([
      `${URL_BASE}/storage/v1/object/cvs/${USER}/cv.pdf`,
      `${URL_BASE}/rest/v1/profiles?on_conflict=user_id`,
    ]);
  });

  it('returns the stored path', async () => {
    expect(await saveProfile(USER, PROFILE, PDF_BYTES)).toBe(`${USER}/cv.pdf`);
  });

  it('names the object from the bytes, not from an extension', async () => {
    await saveProfile(USER, PROFILE, DOCX_BYTES);

    expect(calls[0].url).toBe(
      `${URL_BASE}/storage/v1/object/cvs/${USER}/cv.docx`,
    );
    expect(calls[0].headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('overwrites the previous CV rather than orphaning it', async () => {
    await saveProfile(USER, PROFILE, PDF_BYTES);
    expect(calls[0].headers['x-upsert']).toBe('true');
  });

  it('upserts on user_id and sets updated_at', async () => {
    await saveProfile(USER, PROFILE, PDF_BYTES);

    expect(calls[1].headers.prefer).toBe('resolution=merge-duplicates');
    const row = JSON.parse(String(calls[1].body));
    expect(row.user_id).toBe(USER);
    expect(row.cv_path).toBe(`${USER}/cv.pdf`);
    expect(row.data).toEqual(PROFILE);
    expect(Date.parse(row.updated_at)).not.toBeNaN();
  });

  it('authenticates with the secret key on both requests', async () => {
    await saveProfile(USER, PROFILE, PDF_BYTES);

    for (const call of calls) {
      expect(call.headers.apikey).toBe(SECRET);
      expect(call.headers.authorization).toBe(`Bearer ${SECRET}`);
    }
  });
});

describe('saveProfile refuses', () => {
  it('a user id that is not a UUID', async () => {
    // The id is a URL path segment and the storage policy keys off it, so
    // anything else could put one person's CV in another person's folder.
    await expect(
      saveProfile('../../other-user', PROFILE, PDF_BYTES),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('a file that is neither a PDF nor a docx', async () => {
    await expect(
      saveProfile(USER, PROFILE, new TextEncoder().encode('plain text')),
    ).rejects.toThrow(/neither a PDF nor a docx/);
    expect(calls).toHaveLength(0);
  });

  it('a failed upload, without writing the row', async () => {
    respondWith(413);

    await expect(saveProfile(USER, PROFILE, PDF_BYTES)).rejects.toBeInstanceOf(
      SupabaseError,
    );
    expect(calls).toHaveLength(1);
  });

  it('a failed row write', async () => {
    respondWith(200, 409);

    await expect(saveProfile(USER, PROFILE, PDF_BYTES)).rejects.toThrow(
      /profile upsert failed with status 409/,
    );
  });
});

describe('saveProfile fails fast', () => {
  it('when the project URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    await expect(saveProfile(USER, PROFILE, PDF_BYTES)).rejects.toThrow(
      /NEXT_PUBLIC_SUPABASE_URL is not set/,
    );
  });

  it('when the secret key is missing', async () => {
    delete process.env.SUPABASE_SECRET_KEY;

    await expect(saveProfile(USER, PROFILE, PDF_BYTES)).rejects.toThrow(
      /SUPABASE_SECRET_KEY is not set/,
    );
  });
});

// The same property crypto.ts pins for the model key: an error reaches logs and
// error trackers, so no failure path may carry the credential.
describe('a failed write leaks nothing', () => {
  it('not the key, and not the profile', async () => {
    respondWith(401);

    let thrown: unknown;
    try {
      await saveProfile(USER, PROFILE, PDF_BYTES);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SupabaseError);
    const error = thrown as SupabaseError;
    for (const text of [error.message, error.stack ?? '', String(error)]) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(PROFILE.voiceAnchors[0]);
    }
  });
});
