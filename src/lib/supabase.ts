import { z } from 'zod';
import { applicationSchema, type Application } from '../core/application';
import { cvFormat, type CvFormat } from '../core/extract-text';
import { profileSchema, type Profile } from '../core/profile';
import { routing, type Locale } from '../i18n/routing';
// Types only, and erased at compile: `lib` describes what it is handed rather
// than declaring a second copy of the render seam's unions, which is how the
// two would drift.
import type { RenderedFile, Tier } from '../render/index';

/**
 * The server-side writes the two flows make: the CV file and the parsed profile
 * (flow 1), and the rendered files plus their `applications` row (flow 3).
 *
 * Plain `fetch` against PostgREST and the Storage API rather than the Supabase
 * SDK. Two requests with a bearer token do not earn a vendor client, and this
 * keeps `core` free of one.
 *
 * `SUPABASE_SECRET_KEY` bypasses row-level security, which is the only way to
 * reach these rows server-side. It is a credential: it is never logged, never
 * returned, and never put in an error.
 */

const CONTENT_TYPES: Record<CvFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const TIMEOUT_MS = 30_000;

/** Carries the operation and the status. Never the body, never the key. */
export class SupabaseError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
  ) {
    super(`Supabase ${operation} failed with status ${status}.`);
    this.name = 'SupabaseError';
  }
}

/**
 * Stores the CV and its parsed profile, replacing whatever was there.
 *
 * One profile per user (`profiles.user_id` is unique), so one file per user.
 * The object key is the same on every re-parse, with no extension and no
 * timestamp in it: a key that varies with the format would leave the old PDF in
 * the bucket the day somebody re-parses from a docx. The format is carried by
 * the content type instead, which is where a reader looks anyway.
 *
 * Returns the stored object path, which is what `profiles.cv_path` holds.
 */
export async function saveProfile(
  userId: string,
  profile: Profile,
  cvBytes: Uint8Array,
  sourceText: string,
): Promise<string> {
  // The id goes straight into a URL path, so it is validated as a UUID before
  // it gets there. The `cvs owner full access` policy keys off the first path
  // segment, and a segment that is not a user id would put one person's CV
  // inside another person's folder.
  const owner = z.uuid().parse(userId);

  const format = cvFormat(cvBytes);
  if (format === undefined) {
    throw new Error(
      'That file is neither a PDF nor a docx, so it is not saved.',
    );
  }

  // The file first. A failed row write leaves an object that the next attempt
  // overwrites; a failed upload after a successful row write would leave
  // `cv_path` pointing at nothing.
  const path = `${owner}/cv`;
  await request('storage upload', `/storage/v1/object/cvs/${path}`, {
    headers: { 'content-type': CONTENT_TYPES[format], 'x-upsert': 'true' },
    // `BodyInit` will not take a view over an arbitrary buffer, and a Buffer
    // read off disk is one. Copying at most 10 MB once per upload is cheaper
    // than a cast that stops the compiler checking anything here.
    body: new Uint8Array(cvBytes),
  });

  await request('profile upsert', '/rest/v1/profiles?on_conflict=user_id', {
    headers: {
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      user_id: owner,
      data: profile,
      cv_path: path,
      // The evidence the profile was checked against. Stored with the profile
      // so a claim can be re-verified without re-running the extractor.
      source_text: sourceText,
      // `merge-duplicates` writes only the columns in this payload, so the
      // column default never fires on the update half of the upsert.
      updated_at: new Date().toISOString(),
    }),
  });

  return path;
}

/**
 * Something stored no longer matches the schema that defines it.
 *
 * Carries what was wrong with the shape and never the value. A Zod message
 * quotes the offending value, and the offending value here is a line of
 * somebody's CV or resume. Same discipline as `ApplicationError`.
 */
export class StoredShapeError extends Error {
  constructor(
    readonly what: 'profile' | 'application',
    detail: string,
  ) {
    super(
      `The stored ${what} no longer matches the shape the app expects: ${detail}.`,
    );
    this.name = 'StoredShapeError';
  }
}

/** Paths only, for the reason `StoredShapeError` gives. */
function shapeDetail(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'} is wrong`)
    .join(', ');
}

/** One row, or none. PostgREST answers a filtered select with an array. */
async function readOne(
  operation: string,
  path: string,
): Promise<unknown | null> {
  const response = await supabaseRequest(operation, path, { method: 'GET' });
  const rows = (await response.json()) as unknown[];

  return rows.length === 0 ? null : rows[0];
}

const StoredProfile = z.object({ data: z.unknown() });

/**
 * The parsed profile the apply pipeline draws every claim from, read back out.
 *
 * `profiles.data` is `jsonb` and the database does not constrain it, so
 * `profileSchema` is the only definition of that shape that exists and this is
 * the boundary it has to be checked at (CLAUDE.md section 2). A profile that no
 * longer validates is a refused request with a sentence, not three model calls
 * spent reasoning over garbage.
 *
 * Null means the user has no profile yet, which is an ordinary state for
 * somebody who has not uploaded a CV. That is not an error and is not reported
 * as one.
 */
export async function loadProfile(userId: string): Promise<Profile | null> {
  const owner = z.uuid().parse(userId);

  const row = await readOne(
    'profile read',
    `/rest/v1/profiles?user_id=eq.${owner}&select=data&limit=1`,
  );
  if (row === null) {
    return null;
  }

  const result = profileSchema.safeParse(StoredProfile.parse(row).data);
  if (!result.success) {
    throw new StoredShapeError('profile', shapeDetail(result.error));
  }

  return result.data;
}

const StoredName = z.object({ display_name: z.string().nullable() });

/**
 * The applicant's own name, which goes on the documents.
 *
 * It cannot come from the profile: `profileSchema` has no name field on
 * purpose, and deriving one from a CV would be an invention. So it is a fact
 * the account holds, seeded from the OAuth profile at sign-up where the
 * provider told us and typed once otherwise.
 *
 * Null is a real answer, not a failure: an email sign-up has no name on file
 * until somebody supplies one. The caller refuses with its own sentence rather
 * than inventing one.
 */
export async function loadDisplayName(userId: string): Promise<string | null> {
  const owner = z.uuid().parse(userId);

  const row = await readOne(
    'display name read',
    `/rest/v1/users?id=eq.${owner}&select=display_name&limit=1`,
  );
  if (row === null) {
    return null;
  }

  const name = StoredName.parse(row).display_name?.trim() ?? '';

  // A column holding whitespace is a column holding no answer.
  return name === '' ? null : name;
}

const StoredLocale = z.object({ locale: z.enum(routing.locales) });

/**
 * The account's own language preference, `users.locale` (SLICE-11 decision 7).
 *
 * The trigger that creates a `public.users` row on sign-up always sets this
 * column (it is `not null default 'en'`), so a missing row is the one case
 * this falls back rather than fails on: a locale nicety should never be what
 * breaks a sign-in.
 */
export async function loadLocale(userId: string): Promise<Locale> {
  const owner = z.uuid().parse(userId);

  const row = await readOne(
    'locale read',
    `/rest/v1/users?id=eq.${owner}&select=locale&limit=1`,
  );

  return row === null ? routing.defaultLocale : StoredLocale.parse(row).locale;
}

/**
 * Writes the account's language preference.
 *
 * Two callers: the settings screen's language toggle, and sign-in/sign-up
 * flows that want a signed-in user's next visit to open in their own
 * language rather than whatever `Accept-Language` guesses.
 */
export async function saveLocale(
  userId: string,
  locale: Locale,
): Promise<void> {
  const owner = z.uuid().parse(userId);

  await supabaseRequest('locale update', `/rest/v1/users?id=eq.${owner}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locale }),
  });
}

/** One rendered file as `applications.files` records it. Bytes are a length. */
export interface StoredFile {
  kind: RenderedFile['kind'];
  format: RenderedFile['format'];
  path: string;
  bytes: number;
}

export interface ApplicationMeta {
  tier: Tier;
  /** Both columns are nullable, and the caller supplies both. */
  company?: string;
  role?: string;
}

/**
 * `applications.fit_score` is a `smallint`, and `applicationSchema`'s
 * `Percentage` is `z.number().min(0).max(100)`, which legally accepts `0.85`.
 * This is where those two meet, so the integer is asserted here rather than
 * discovered as an opaque Supabase status three layers from its cause
 * (CLAUDE.md's Zod-at-every-boundary rule, with `core` left alone).
 *
 * Deliberately not `Math.round`: rounding `0.85` would store `1` for an 85%
 * fit, which is a wrong number written confidently, and that is worse than a
 * refused insert.
 */
const FitScore = z.number().int().min(0).max(100);

/** The score as the column can hold it, or a sentence saying why it cannot. */
function fitScore(application: Application): number {
  const score = FitScore.safeParse(application.fit.score);
  if (!score.success) {
    throw new Error(
      `applications.fit_score is a smallint, so the fit score has to be a whole number from 0 to 100. This application carries ${application.fit.score}.`,
    );
  }

  return score.data;
}

/**
 * Stores the rendered files and the row that indexes them.
 *
 * The id is minted here rather than by `gen_random_uuid()`, because the object
 * key contains it: letting the database mint it would mean insert, read back,
 * upload, update, and a half-written row whenever an upload fails. Files first,
 * then the row, for the reason `saveProfile` gives.
 */
export async function saveApplication(
  userId: string,
  application: Application,
  files: RenderedFile[],
  meta: ApplicationMeta,
): Promise<{ id: string; files: StoredFile[] }> {
  // Straight into a URL path, and into the first segment the `outputs owner
  // read` policy keys off. A segment that is not a user id would put one
  // person's resume inside another person's folder.
  const owner = z.uuid().parse(userId);
  const id = crypto.randomUUID();

  const score = fitScore(application);

  if (files.length === 0) {
    throw new Error('An application with no rendered files is not saved.');
  }

  const stored: StoredFile[] = [];
  for (const file of files) {
    // `${kind}.${format}`, not the display filename: the object key should not
    // change because somebody typed a different company name.
    const path = `${owner}/${id}/${file.kind}.${file.format}`;
    await request('storage upload', `/storage/v1/object/outputs/${path}`, {
      headers: { 'content-type': CONTENT_TYPES[file.format] },
      // `BodyInit` will not take a view over an arbitrary buffer. Copying once
      // per file is cheaper than a cast that stops the compiler checking here.
      body: new Uint8Array(file.bytes),
    });
    stored.push({
      kind: file.kind,
      format: file.format,
      path,
      bytes: file.bytes.byteLength,
    });
  }

  await request('application insert', '/rest/v1/applications', {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id,
      user_id: owner,
      company: blankToNull(meta.company),
      role: blankToNull(meta.role),
      tier: meta.tier,
      fit_score: score,
      // Written here too, so a row the dev script saved is re-renderable by the
      // same route as a row the pipeline saved. A column that only one of the
      // two write paths fills is a column somebody trips over later.
      content: application,
      files: stored,
    }),
  });

  return { id, files: stored };
}

/**
 * The row the generation route writes, before any file exists (SLICE-10
 * decision 1).
 *
 * Generation and rendering are two requests, so the generated application has
 * to survive the first one. It survives here, in `applications.content`, rather
 * than in the browser: a body the client held could be edited before it came
 * back, and a retry would depend on the client still having it.
 *
 * `applications.files` defaults to `'[]'::jsonb`, so a row with no files yet is
 * a legal row. `attachFiles` fills it in, and can do so more than once.
 *
 * The id is minted here rather than by `gen_random_uuid()` for the reason
 * `saveApplication` gives: the object keys `attachFiles` writes contain it, and
 * letting the database mint it would mean insert, read back, then upload.
 */
export async function startApplication(
  userId: string,
  application: Application,
  meta: ApplicationMeta,
): Promise<string> {
  const owner = z.uuid().parse(userId);
  const id = crypto.randomUUID();

  await request('application insert', '/rest/v1/applications', {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id,
      user_id: owner,
      company: blankToNull(meta.company),
      role: blankToNull(meta.role),
      tier: meta.tier,
      fit_score: fitScore(application),
      content: application,
    }),
  });

  return id;
}

/** An application row as the render route needs it back. */
export interface StoredApplication {
  id: string;
  application: Application;
  tier: Tier;
  company: string | null;
  role: string | null;
  /** Empty until `attachFiles` has run, and rewritten when it runs again. */
  files: StoredFile[];
}

const StoredFileRow = z.object({
  kind: z.enum(['resume', 'cover-letter']),
  format: z.enum(['pdf', 'docx']),
  path: z.string(),
  bytes: z.number(),
});

const ApplicationRow = z.object({
  id: z.uuid(),
  tier: z.enum(['basic', 'standard', 'full']),
  company: z.string().nullable(),
  role: z.string().nullable(),
  content: z.unknown(),
  files: z.array(StoredFileRow),
});

/**
 * One application row, read back by id for the user who owns it.
 *
 * The `user_id` filter is not decoration. This reads with
 * `SUPABASE_SECRET_KEY`, which bypasses row-level security, so the filter is
 * the only thing standing between a guessed id and somebody else's resume.
 * Null covers both "no such application" and "not yours", deliberately: telling
 * the two apart tells a caller which ids exist.
 *
 * `content` is validated here for the same reason `loadProfile` validates
 * `data`: the column is `jsonb`, the database constrains nothing, and
 * `applicationSchema` is the only definition of the shape that exists.
 */
export async function loadApplication(
  userId: string,
  applicationId: string,
): Promise<StoredApplication | null> {
  const owner = z.uuid().parse(userId);
  const id = z.uuid().parse(applicationId);

  const row = await readOne(
    'application read',
    `/rest/v1/applications?id=eq.${id}&user_id=eq.${owner}&select=id,tier,company,role,content,files&limit=1`,
  );
  if (row === null) {
    return null;
  }

  const parsed = ApplicationRow.parse(row);

  // Null on any row written before the content column existed. Refused with a
  // sentence rather than rendered as an empty document.
  if (parsed.content === null || parsed.content === undefined) {
    throw new StoredShapeError(
      'application',
      'it carries no generated content, so there is nothing to render',
    );
  }

  const application = applicationSchema.safeParse(parsed.content);
  if (!application.success) {
    throw new StoredShapeError('application', shapeDetail(application.error));
  }

  return {
    id: parsed.id,
    application: application.data,
    tier: parsed.tier,
    company: parsed.company,
    role: parsed.role,
    files: parsed.files,
  };
}

/**
 * Renders stored and indexed on a row that already exists.
 *
 * Safe to run more than once against the same application, which is the whole
 * point of splitting the two routes (SLICE-10 non-negotiable 5). The object
 * keys are derived from the id and the kind, so a second run overwrites the
 * same objects rather than accumulating them, and `x-upsert` is what makes that
 * an overwrite instead of a 409. The `files` column is replaced rather than
 * appended to, so a retry cannot leave the row indexing each file twice.
 *
 * Files first, then the column, for the reason `saveProfile` gives: an orphaned
 * object is overwritten by the next attempt, but a column written first would
 * index objects that never arrived.
 */
export async function attachFiles(
  userId: string,
  applicationId: string,
  files: RenderedFile[],
): Promise<StoredFile[]> {
  const owner = z.uuid().parse(userId);
  const id = z.uuid().parse(applicationId);

  if (files.length === 0) {
    throw new Error('An application with no rendered files is not saved.');
  }

  const stored: StoredFile[] = [];
  for (const file of files) {
    // `${kind}.${format}`, not the display filename: the object key should not
    // change because somebody typed a different company name.
    const path = `${owner}/${id}/${file.kind}.${file.format}`;
    await request('storage upload', `/storage/v1/object/outputs/${path}`, {
      headers: {
        'content-type': CONTENT_TYPES[file.format],
        // A retry writes the same keys. Without this the second run is a 409,
        // and the retry this whole split exists to make cheap would fail.
        'x-upsert': 'true',
      },
      // `BodyInit` will not take a view over an arbitrary buffer. Copying once
      // per file is cheaper than a cast that stops the compiler checking here.
      body: new Uint8Array(file.bytes),
    });
    stored.push({
      kind: file.kind,
      format: file.format,
      path,
      bytes: file.bytes.byteLength,
    });
  }

  await request(
    'application files update',
    `/rest/v1/applications?id=eq.${id}&user_id=eq.${owner}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files: stored }),
    },
  );

  return stored;
}

/** The columns are nullable, and an empty string is not a company name. */
function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

async function request(
  operation: string,
  path: string,
  init: {
    method?: string;
    headers: Record<string, string>;
    body: BodyInit;
  },
): Promise<void> {
  await supabaseRequest(operation, path, init);
}

/**
 * Every server-side call to PostgREST and Storage goes through here: the secret
 * key, a timeout, no redirect, and no reading of a failed response.
 *
 * Exported because `api-keys.ts` and `account.ts` make the same call with a
 * different method, and three copies of the header line is how one of them ends
 * up without `redirect: 'error'`.
 *
 * Returns the response so a caller that asked for rows can read them. A failure
 * never gets that far.
 */
export async function supabaseRequest(
  operation: string,
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit;
  } = {},
): Promise<Response> {
  const key = secretKey();

  const response = await fetch(`${baseUrl()}${path}`, {
    method: init.method ?? 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, ...init.headers },
    body: init.body,
    // A redirect would carry the secret key to a second, unchecked host.
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    // The body is not read. It is the one place the key could come back.
    throw new SupabaseError(operation, response.status);
  }

  return response;
}

function baseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set.');
  }
  return url.replace(/\/$/, '');
}

/** Reads the server-side secret. Never include its value in an error. */
function secretKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) {
    throw new Error('SUPABASE_SECRET_KEY is not set.');
  }
  return key;
}
