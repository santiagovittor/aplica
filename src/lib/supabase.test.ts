import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from '../core/application';
import type { Profile } from '../core/profile';
import type { RenderedFile } from '../render/index';
import { SupabaseError, saveApplication, saveProfile } from './supabase';

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
