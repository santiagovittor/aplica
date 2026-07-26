import { z } from 'zod';
import { cvFormat, type CvFormat } from '../core/extract-text';
import type { Profile } from '../core/profile';

/**
 * The two server-side writes the parse flow makes: the CV file into the private
 * `cvs` bucket, and the profile into `profiles.data`.
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
      // `merge-duplicates` writes only the columns in this payload, so the
      // column default never fires on the update half of the upsert.
      updated_at: new Date().toISOString(),
    }),
  });

  return path;
}

async function request(
  operation: string,
  path: string,
  init: { headers: Record<string, string>; body: BodyInit },
): Promise<void> {
  const key = secretKey();

  const response = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
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
