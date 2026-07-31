import { z } from 'zod';
import { currentUser } from '../../../../../../lib/session';
import {
  downloadOutputFile,
  loadApplication,
  loadDisplayName,
  StoredShapeError,
} from '../../../../../../lib/supabase';

/**
 * A rendered file's bytes, for the download button on the Apply screen's
 * result reveal (SLICE-13).
 *
 * Everything privileged in this app is server-side (SLICE-9 on), so this
 * stays a route handler reading with the secret key rather than a
 * browser-side Supabase client reading the private `outputs` bucket
 * directly. `loadApplication` already scopes the read to the requesting
 * owner and answers "not yours" and "does not exist" identically, so a
 * guessed id never confirms which ids are real.
 *
 * The object key is never built from the request: `applicationId`, `kind`
 * and `format` only select which entry of the row's own `files` array to
 * serve, and `downloadOutputFile` reads the `path` that entry already
 * carries, written by `attachFiles` at render time.
 */

export const runtime = 'nodejs';

const Params = z.object({
  applicationId: z.uuid(),
  kind: z.enum(['resume', 'cover-letter']),
  format: z.enum(['pdf', 'docx']),
});

const CONTENT_TYPES: Record<'pdf' | 'docx', string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const LABELS: Record<'resume' | 'cover-letter', string> = {
  resume: 'Resume',
  'cover-letter': 'Cover Letter',
};

function json(code: string, status: number): Response {
  return Response.json({ error: code }, { status });
}

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ applicationId: string; kind: string; format: string }>;
  },
): Promise<Response> {
  const user = await currentUser();
  if (user === null) {
    return json('unauthorized', 401);
  }

  const parsed = Params.safeParse(await params);
  if (!parsed.success) {
    return json('bad_request', 400);
  }
  const { applicationId, kind, format } = parsed.data;

  let stored;
  try {
    stored = await loadApplication(user.id, applicationId);
  } catch (error) {
    return error instanceof StoredShapeError
      ? json('application_unreadable', 409)
      : json('unexpected', 500);
  }

  // Not yours and does not exist get the same answer, same as /api/render:
  // telling the two apart tells a caller which ids exist.
  if (stored === null) {
    return json('application_not_found', 404);
  }

  const file = stored.files.find(
    (candidate) => candidate.kind === kind && candidate.format === format,
  );
  if (file === undefined) {
    // A real application that never had this document, or hasn't been
    // rendered yet. Same code as a guessed id: neither is worth telling apart
    // from the caller's side of a download button.
    return json('application_not_found', 404);
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await downloadOutputFile(file.path);
  } catch {
    return json('unexpected', 500);
  }

  const name = await loadDisplayName(user.id);
  const filename = filenameFor(kind, format, name ?? '', stored.company);

  return new Response(bytes, {
    headers: {
      'content-type': CONTENT_TYPES[format],
      'content-disposition': contentDisposition(filename),
      'content-length': String(bytes.byteLength),
    },
  });
}

const MAX_PART_CHARS = 60;

/**
 * A whitelist, not a blocklist, matching `render/index.ts`'s own
 * `filenameFor` in spirit but written fresh here: this route does not touch
 * `src/render/`, and a response header is a different concern from a
 * rendered document's own filename.
 */
function sanitizePart(part: string): string {
  return part
    .replace(/[^\p{L}\p{N} .,&()'_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PART_CHARS)
    .trim();
}

function filenameFor(
  kind: 'resume' | 'cover-letter',
  format: 'pdf' | 'docx',
  name: string,
  company: string | null,
): string {
  const parts = [
    sanitizePart(name),
    LABELS[kind],
    sanitizePart(company ?? ''),
  ].filter((part) => part !== '');
  return `${parts.join(' - ')}.${format}`;
}

/**
 * The sanitised filename is already a safe quoted-string (the whitelist
 * above has no `"` or control characters), but it can still hold non-ASCII
 * letters, which a bare `filename=` is not guaranteed to survive. Both forms
 * are sent: `filename` as an ASCII-safe fallback, `filename*` as the exact
 * name for anything that reads RFC 6266.
 */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
