import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from '../core/application';
import type { Profile } from '../core/profile';
import type { RenderedFile } from '../render/index';
import {
  attachFiles,
  loadApplication,
  loadDisplayName,
  loadLocale,
  loadProfile,
  saveApplication,
  saveLocale,
  saveProfile,
  startApplication,
  StoredShapeError,
  SupabaseError,
} from './supabase';

// Not a real credential: local Supabase prints its own, and nothing here talks
// to a server. It is still treated as one, because the assertions below are
// about a key never reaching an error.
const SECRET = 'sb_secret_pretend-this-is-real';
const URL_BASE = 'http://127.0.0.1:54321';
const USER = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.4\nnot really a pdf\n');
const CV_TEXT = 'Santiago Vittor. Squad Leader at FoodStyles since May 2024.';
const DOCX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

const PROFILE: Profile = {
  voiceAnchors: ['I cut the month-end close from three days to one.'],
  experience: [],
  projects: [],
  skills: [],
  starStories: [],
  education: [],
  certifications: [],
  languages: [],
  keywordBank: [],
  gaps: [],
};

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: BodyInit | null | undefined;
}

let calls: Captured[] = [];

function capture(url: string, init: RequestInit) {
  calls.push({
    url,
    method: init.method ?? 'POST',
    headers: init.headers as Record<string, string>,
    body: init.body,
  });
}

function respondWith(...statuses: number[]) {
  let index = 0;
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    capture(url, init);
    const status = statuses[Math.min(index, statuses.length - 1)];
    index += 1;
    return Promise.resolve(new Response(null, { status }));
  });
}

/**
 * Queued JSON bodies, in order, for the reads. The last one repeats, so a test
 * that only cares about the first response does not have to count the writes
 * that follow it.
 */
function respondWithJson(...bodies: unknown[]) {
  let index = 0;
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    capture(url, init);
    const body = bodies[Math.min(index, bodies.length - 1)];
    index += 1;
    return Promise.resolve(Response.json(body));
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
    await saveProfile(USER, PROFILE, PDF_BYTES, CV_TEXT);

    expect(calls.map((call) => call.url)).toEqual([
      `${URL_BASE}/storage/v1/object/cvs/${USER}/cv`,
      `${URL_BASE}/rest/v1/profiles?on_conflict=user_id`,
    ]);
  });

  it('returns the stored path', async () => {
    expect(await saveProfile(USER, PROFILE, PDF_BYTES, CV_TEXT)).toBe(
      `${USER}/cv`,
    );
  });

  it('types the object from the bytes, not from an extension', async () => {
    await saveProfile(USER, PROFILE, DOCX_BYTES, CV_TEXT);

    expect(calls[0].headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('overwrites the previous CV rather than orphaning it', async () => {
    // Same key whatever the format. A key that carried the extension would
    // leave the old PDF behind the day somebody re-parses from a docx.
    await saveProfile(USER, PROFILE, PDF_BYTES, CV_TEXT);
    await saveProfile(USER, PROFILE, DOCX_BYTES, CV_TEXT);

    expect(calls[0].url).toBe(calls[2].url);
    expect(calls[0].headers['x-upsert']).toBe('true');
  });

  it('upserts on user_id and sets updated_at', async () => {
    await saveProfile(USER, PROFILE, PDF_BYTES, CV_TEXT);

    expect(calls[1].headers.prefer).toBe('resolution=merge-duplicates');
    const row = JSON.parse(String(calls[1].body));
    expect(row.user_id).toBe(USER);
    expect(row.cv_path).toBe(`${USER}/cv`);
    expect(row.data).toEqual(PROFILE);
    // The evidence grounding checks against, stored with the profile.
    expect(row.source_text).toBe(CV_TEXT);
    expect(Date.parse(row.updated_at)).not.toBeNaN();
  });

  it('authenticates with the secret key on both requests', async () => {
    await saveProfile(USER, PROFILE, PDF_BYTES, CV_TEXT);

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
      saveProfile('../../other-user', PROFILE, PDF_BYTES, CV_TEXT),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('a file that is neither a PDF nor a docx', async () => {
    await expect(
      saveProfile(
        USER,
        PROFILE,
        new TextEncoder().encode('plain text'),
        CV_TEXT,
      ),
    ).rejects.toThrow(/neither a PDF nor a docx/);
    expect(calls).toHaveLength(0);
  });

  it('a failed upload, without writing the row', async () => {
    respondWith(413);

    await expect(
      saveProfile(USER, PROFILE, PDF_BYTES, CV_TEXT),
    ).rejects.toBeInstanceOf(SupabaseError);
    expect(calls).toHaveLength(1);
  });

  it('a failed row write', async () => {
    respondWith(200, 409);

    await expect(
      saveProfile(USER, PROFILE, PDF_BYTES, CV_TEXT),
    ).rejects.toThrow(/profile upsert failed with status 409/);
  });
});

describe('saveProfile fails fast', () => {
  it('when the project URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    await expect(
      saveProfile(USER, PROFILE, PDF_BYTES, CV_TEXT),
    ).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL is not set/);
  });

  it('when the secret key is missing', async () => {
    delete process.env.SUPABASE_SECRET_KEY;

    await expect(
      saveProfile(USER, PROFILE, PDF_BYTES, CV_TEXT),
    ).rejects.toThrow(/SUPABASE_SECRET_KEY is not set/);
  });
});

const APPLICATION: Application = {
  fit: {
    score: 85,
    skills: 'The close work maps.',
    seniority: 'Same level.',
    timezone: 'not scored: no timezone on file',
    pay: 'not scored: no salary floor on file',
  },
  strengths: [],
  gaps: [],
  recommendation: 'apply',
  reason: 'The close work maps directly.',
  keywordCoverage: 90,
  resume: '# Ada Lovelace',
  coverLetter: 'I ran the month-end close.',
  flags: [],
};

function rendered(kind: RenderedFile['kind'], format: RenderedFile['format']) {
  return {
    kind,
    format,
    filename: `Ada Lovelace - ${kind}.${format}`,
    bytes: new Uint8Array([1, 2, 3, 4]),
  };
}

const FILES = [rendered('resume', 'pdf'), rendered('cover-letter', 'pdf')];

/** The uuid the row and the object keys are both built from. */
function idFrom(url: string): string {
  return url.split('/')[8];
}

describe('saveApplication', () => {
  it('uploads every file before it writes the row', async () => {
    // Same order and the same reason as saveProfile: a row written first would
    // index objects that never arrived.
    const { id } = await saveApplication(USER, APPLICATION, FILES, {
      tier: 'standard',
    });

    expect(calls.map((call) => call.url)).toEqual([
      `${URL_BASE}/storage/v1/object/outputs/${USER}/${id}/resume.pdf`,
      `${URL_BASE}/storage/v1/object/outputs/${USER}/${id}/cover-letter.pdf`,
      `${URL_BASE}/rest/v1/applications`,
    ]);
  });

  it('mints the id here, so the objects and the row agree', async () => {
    // Not gen_random_uuid(): the object key contains the id, so waiting for the
    // database to mint it would mean insert, read back, upload, update.
    const { id } = await saveApplication(USER, APPLICATION, FILES, {
      tier: 'standard',
    });
    const row = JSON.parse(String(calls[2].body));

    expect(row.id).toBe(id);
    expect(idFrom(calls[0].url)).toBe(id);
    expect(row.files.map((file: { path: string }) => file.path)).toEqual([
      `${USER}/${id}/resume.pdf`,
      `${USER}/${id}/cover-letter.pdf`,
    ]);
  });

  it('keys the object off the kind, not off the display filename', async () => {
    // A recruiter-facing filename carries the company. An object key that did
    // would move every time somebody typed the company differently.
    await saveApplication(USER, APPLICATION, FILES, { tier: 'standard' });

    expect(calls[0].url.endsWith('/resume.pdf')).toBe(true);
    expect(calls[0].headers['content-type']).toBe('application/pdf');
  });

  it('records the byte length of each file', async () => {
    const { files } = await saveApplication(USER, APPLICATION, FILES, {
      tier: 'standard',
    });

    expect(files.map((file) => file.bytes)).toEqual([4, 4]);
  });

  it('writes the caller-supplied company and role', async () => {
    await saveApplication(USER, APPLICATION, FILES, {
      tier: 'standard',
      company: '  Wilson Sonsini  ',
      role: 'Operations analyst',
    });
    const row = JSON.parse(String(calls[2].body));

    expect(row.company).toBe('Wilson Sonsini');
    expect(row.role).toBe('Operations analyst');
    expect(row.tier).toBe('standard');
    expect(row.fit_score).toBe(85);
  });

  it('writes null rather than an empty string for either column', async () => {
    await saveApplication(USER, APPLICATION, FILES, {
      tier: 'standard',
      company: '   ',
    });
    const row = JSON.parse(String(calls[2].body));

    expect(row.company).toBeNull();
    expect(row.role).toBeNull();
  });

  it('sends the docx content type for a docx', async () => {
    await saveApplication(USER, APPLICATION, [rendered('resume', 'docx')], {
      tier: 'full',
    });

    expect(calls[0].headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });
});

describe('saveApplication refuses', () => {
  it('a user id that is not a UUID', async () => {
    await expect(
      saveApplication('../../other-user', APPLICATION, FILES, {
        tier: 'standard',
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('a fit score that a smallint column cannot hold', async () => {
    // `Percentage` in core is z.number().min(0).max(100), so 0.85 for 85% is a
    // legal Application and an illegal row. Refused here with a sentence,
    // rather than as an opaque Supabase status three layers from its cause.
    await expect(
      saveApplication(
        USER,
        { ...APPLICATION, fit: { ...APPLICATION.fit, score: 0.85 } },
        FILES,
        { tier: 'standard' },
      ),
    ).rejects.toThrow(/whole number from 0 to 100/);
    // Not rounded to 1: a wrong number written confidently is worse than a
    // refused insert.
    expect(calls).toHaveLength(0);
  });

  it('an application with no rendered files', async () => {
    await expect(
      saveApplication(USER, APPLICATION, [], { tier: 'standard' }),
    ).rejects.toThrow(/no rendered files/);
    expect(calls).toHaveLength(0);
  });

  it('a failed upload, without writing the row', async () => {
    respondWith(413);

    await expect(
      saveApplication(USER, APPLICATION, FILES, { tier: 'standard' }),
    ).rejects.toBeInstanceOf(SupabaseError);
    expect(calls).toHaveLength(1);
  });

  it('a failed row write', async () => {
    respondWith(200, 200, 409);

    await expect(
      saveApplication(USER, APPLICATION, FILES, { tier: 'standard' }),
    ).rejects.toThrow(/application insert failed with status 409/);
  });
});

// The same property crypto.ts pins for the model key: an error reaches logs and
// error trackers, so no failure path may carry the credential.
describe('a failed write leaks nothing', () => {
  it('not the key, and not the profile', async () => {
    respondWith(401);

    let thrown: unknown;
    try {
      await saveProfile(USER, PROFILE, PDF_BYTES, CV_TEXT);
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

  it('not the key, and not a line of the application', async () => {
    respondWith(401);

    let thrown: unknown;
    try {
      await saveApplication(USER, APPLICATION, FILES, { tier: 'standard' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SupabaseError);
    const error = thrown as SupabaseError;
    for (const text of [error.message, error.stack ?? '', String(error)]) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(APPLICATION.resume);
      expect(text).not.toContain(APPLICATION.coverLetter);
    }
  });
});

describe('loadProfile', () => {
  it('returns the stored profile', async () => {
    respondWithJson([{ data: PROFILE }]);

    expect(await loadProfile(USER)).toEqual(PROFILE);
    expect(calls[0].url).toBe(
      `${URL_BASE}/rest/v1/profiles?user_id=eq.${USER}&select=data&limit=1`,
    );
    expect(calls[0].method).toBe('GET');
  });

  it('returns null when the user has no profile yet', async () => {
    // An ordinary state for somebody who has not uploaded a CV. Not an error,
    // and not reported as one.
    respondWithJson([]);

    expect(await loadProfile(USER)).toBeNull();
  });

  it('refuses a stored profile that no longer matches the schema', async () => {
    // profiles.data is jsonb and the database constrains nothing, so this is
    // the boundary. A profile that does not validate is a refused request, not
    // three model calls spent reasoning over garbage.
    respondWithJson([{ data: { ...PROFILE, experience: 'not a list' } }]);

    await expect(loadProfile(USER)).rejects.toThrow(StoredShapeError);
    await expect(loadProfile(USER)).rejects.toThrow(/experience is wrong/);
  });

  it('names the path and never quotes the value', async () => {
    // A Zod message quotes the offending value, and the offending value here
    // is a line of somebody's CV.
    const secret = 'Ada Lovelace, 07700 900123, ada@example.org';
    respondWithJson([{ data: { ...PROFILE, voiceAnchors: [{ secret }] } }]);

    let thrown: unknown;
    try {
      await loadProfile(USER);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StoredShapeError);
    const error = thrown as StoredShapeError;
    for (const text of [error.message, error.stack ?? '', String(error)]) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain(SECRET);
    }
  });

  it('refuses a user id that is not a UUID', async () => {
    await expect(loadProfile('../../other-user')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('loadDisplayName', () => {
  it('returns the stored name', async () => {
    respondWithJson([{ display_name: 'Ada Lovelace' }]);

    expect(await loadDisplayName(USER)).toBe('Ada Lovelace');
  });

  it('returns null when the column is null', async () => {
    // An email sign-up has no name on file until somebody types one. The
    // caller refuses with its own sentence rather than inventing one.
    respondWithJson([{ display_name: null }]);

    expect(await loadDisplayName(USER)).toBeNull();
  });

  it('returns null when the column holds only whitespace', async () => {
    // A column holding whitespace is a column holding no answer, and a name of
    // spaces would reach a filename and a PDF author field.
    respondWithJson([{ display_name: '   ' }]);

    expect(await loadDisplayName(USER)).toBeNull();
  });

  it('trims a name that was pasted with whitespace', async () => {
    respondWithJson([{ display_name: '  Ada Lovelace \n' }]);

    expect(await loadDisplayName(USER)).toBe('Ada Lovelace');
  });

  it('returns null when there is no account row', async () => {
    respondWithJson([]);

    expect(await loadDisplayName(USER)).toBeNull();
  });
});

describe('loadLocale', () => {
  it('returns the stored locale', async () => {
    respondWithJson([{ locale: 'es' }]);

    expect(await loadLocale(USER)).toBe('es');
  });

  it('falls back to the default when there is no account row', async () => {
    // The trigger that creates a row always sets this column, so a missing
    // row should never happen. A locale nicety is not worth failing sign-in
    // over if it somehow does.
    respondWithJson([]);

    expect(await loadLocale(USER)).toBe('en');
  });
});

describe('saveLocale', () => {
  it('patches the account row with the new locale', async () => {
    await saveLocale(USER, 'es');

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toBe(`${URL_BASE}/rest/v1/users?id=eq.${USER}`);
    expect(JSON.parse(String(calls[0].body))).toEqual({ locale: 'es' });
  });
});

describe('startApplication', () => {
  it('writes the generated application and no files', async () => {
    // Decision 1: the row exists before any file does, so a render failure
    // retries against a row that is already there. applications.files defaults
    // to '[]'::jsonb, so a row with no files is a legal row.
    respondWith(200);

    const id = await startApplication(USER, APPLICATION, { tier: 'standard' });
    const row = JSON.parse(String(calls[0].body));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${URL_BASE}/rest/v1/applications`);
    expect(row.id).toBe(id);
    expect(row.user_id).toBe(USER);
    expect(row.content).toEqual(APPLICATION);
    expect(row.files).toBeUndefined();
    expect(row.fit_score).toBe(85);
  });

  it('writes null rather than an empty string for either column', async () => {
    await startApplication(USER, APPLICATION, {
      tier: 'standard',
      company: '   ',
    });
    const row = JSON.parse(String(calls[0].body));

    expect(row.company).toBeNull();
    expect(row.role).toBeNull();
  });

  it('refuses a fit score that a smallint column cannot hold', async () => {
    await expect(
      startApplication(
        USER,
        { ...APPLICATION, fit: { ...APPLICATION.fit, score: 0.85 } },
        { tier: 'standard' },
      ),
    ).rejects.toThrow(/whole number from 0 to 100/);
    expect(calls).toHaveLength(0);
  });

  it('refuses a user id that is not a UUID', async () => {
    await expect(
      startApplication('../../other-user', APPLICATION, { tier: 'standard' }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

const APPLICATION_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: APPLICATION_ID,
    tier: 'standard',
    company: 'Cooperativa del Norte',
    role: 'Operations analyst',
    content: APPLICATION,
    files: [],
    ...overrides,
  };
}

describe('loadApplication', () => {
  it('returns the row and its generated application', async () => {
    respondWithJson([storedRow()]);

    const stored = await loadApplication(USER, APPLICATION_ID);

    expect(stored?.application).toEqual(APPLICATION);
    expect(stored?.tier).toBe('standard');
    expect(stored?.company).toBe('Cooperativa del Norte');
    expect(calls[0].method).toBe('GET');
  });

  it('scopes the read to the owner as well as the id', async () => {
    // This reads with the secret key, which bypasses row-level security, so
    // the user_id filter is the only thing between a guessed id and somebody
    // else's resume.
    respondWithJson([storedRow()]);

    await loadApplication(USER, APPLICATION_ID);

    expect(calls[0].url).toContain(`id=eq.${APPLICATION_ID}`);
    expect(calls[0].url).toContain(`user_id=eq.${USER}`);
  });

  it('returns null for an application that belongs to somebody else', async () => {
    // Null covers both "no such application" and "not yours" on purpose:
    // telling the two apart tells a caller which ids exist.
    respondWithJson([]);

    expect(await loadApplication(USER, APPLICATION_ID)).toBeNull();
  });

  it('refuses a row written before the content column existed', async () => {
    respondWithJson([storedRow({ content: null })]);

    await expect(loadApplication(USER, APPLICATION_ID)).rejects.toThrow(
      /nothing to render/,
    );
  });

  it('refuses stored content that no longer matches the schema', async () => {
    respondWithJson([
      storedRow({ content: { ...APPLICATION, resume: { text: 'nope' } } }),
    ]);

    await expect(loadApplication(USER, APPLICATION_ID)).rejects.toThrow(
      /resume is wrong/,
    );
  });

  it('refuses an application id that is not a UUID', async () => {
    await expect(loadApplication(USER, '../../other')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('attachFiles', () => {
  it('uploads every file before it updates the column', async () => {
    // Same order and the same reason as saveProfile: a column written first
    // would index objects that never arrived.
    await attachFiles(USER, APPLICATION_ID, FILES);

    expect(calls.map((call) => call.url)).toEqual([
      `${URL_BASE}/storage/v1/object/outputs/${USER}/${APPLICATION_ID}/resume.pdf`,
      `${URL_BASE}/storage/v1/object/outputs/${USER}/${APPLICATION_ID}/cover-letter.pdf`,
      `${URL_BASE}/rest/v1/applications?id=eq.${APPLICATION_ID}&user_id=eq.${USER}`,
    ]);
    expect(calls[2].method).toBe('PATCH');
  });

  it('overwrites on a second run rather than failing on a 409', async () => {
    // Non-negotiable 5: the render route has to be safe to run twice. The
    // object keys are the same on every run, so without x-upsert the second
    // run is a 409 and the cheap retry this split exists for does not work.
    await attachFiles(USER, APPLICATION_ID, FILES);

    expect(calls[0].headers['x-upsert']).toBe('true');
    expect(calls[1].headers['x-upsert']).toBe('true');
  });

  it('replaces the files column rather than appending to it', async () => {
    // A retry that appended would leave the row indexing each file twice.
    await attachFiles(USER, APPLICATION_ID, FILES);
    await attachFiles(USER, APPLICATION_ID, FILES);

    const first = JSON.parse(String(calls[2].body));
    const second = JSON.parse(String(calls[5].body));

    expect(first).toEqual(second);
    expect(second.files).toHaveLength(2);
  });

  it('returns the stored paths and byte lengths', async () => {
    const stored = await attachFiles(USER, APPLICATION_ID, FILES);

    expect(stored).toEqual([
      {
        kind: 'resume',
        format: 'pdf',
        path: `${USER}/${APPLICATION_ID}/resume.pdf`,
        bytes: 4,
      },
      {
        kind: 'cover-letter',
        format: 'pdf',
        path: `${USER}/${APPLICATION_ID}/cover-letter.pdf`,
        bytes: 4,
      },
    ]);
  });

  it('refuses an application with no rendered files', async () => {
    await expect(attachFiles(USER, APPLICATION_ID, [])).rejects.toThrow(
      /no rendered files/,
    );
    expect(calls).toHaveLength(0);
  });

  it('does not update the column when an upload fails', async () => {
    respondWith(413);

    await expect(
      attachFiles(USER, APPLICATION_ID, FILES),
    ).rejects.toBeInstanceOf(SupabaseError);
    expect(calls).toHaveLength(1);
  });
});
