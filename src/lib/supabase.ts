import { z } from 'zod';
import type { Application } from '../core/application';
import { cvFormat, type CvFormat } from '../core/extract-text';
import type { Profile } from '../core/profile';
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

  const score = FitScore.safeParse(application.fit.score);
  if (!score.success) {
    throw new Error(
      `applications.fit_score is a smallint, so the fit score has to be a whole number from 0 to 100. This application carries ${application.fit.score}.`,
    );
  }

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
      fit_score: score.data,
      files: stored,
    }),
  });

  return { id, files: stored };
}

/** The columns are nullable, and an empty string is not a company name. */
function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

async function request(
  operation: string,
  path: string,
  init: { headers: Record<string, string>; body: BodyInit },
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
