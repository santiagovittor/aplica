import { z } from 'zod';
import { currentUser } from '../../../lib/session';
import {
  attachFiles,
  loadApplication,
  loadDisplayName,
  StoredShapeError,
} from '../../../lib/supabase';
import { renderApplication, RenderError } from '../../../render/index';

/**
 * Flow 3 (PROJECT.md section 5): a stored application becomes the files an
 * applicant actually sends.
 *
 * The second half of the split, and the reason there is one. Nothing here calls
 * a model, reads a key, or touches the usage counter, so a render that fails
 * costs the user nothing to retry. Everything it needs is already in the row
 * the generation route wrote, which is why it can run again at all.
 *
 * Not idempotent by accident: the object keys are derived from the application
 * id and the document kind, so a second run overwrites the same objects, and
 * `attachFiles` replaces the `files` column rather than appending to it. Two
 * runs leave exactly what one run leaves.
 *
 * JSON in, JSON out. There is no progress to stream: rendering is fast and
 * local, and a stream that reported one stage would be theatre.
 */

/**
 * Rendering is CPU plus two uploads, and no model call at all.
 *
 * Measured over HTTP against this route, standard tier, a real stored
 * application: 1.36 seconds on the first request and 0.32 on the second, for a
 * 4,682 byte resume and a 3,021 byte cover letter. The `full` tier adds two
 * DOCX files to that.
 *
 * 60 for the same reason as the generation route: a wide margin, and legal on
 * both Vercel plans so a self-hosted deployment runs the same code.
 */
export const maxDuration = 60;

/** react-pdf and docx are Node libraries, so this cannot run on the edge. */
export const runtime = 'nodejs';

/**
 * The request body. No user id and no document text: the user comes from the
 * session, and the documents come from the row. A body carrying either is a
 * body somebody edits, and the second one would have the server render a
 * resume the client could have rewritten.
 */
const RenderRequest = z.object({ applicationId: z.uuid() });

function json(code: string, status: number, extra: object = {}): Response {
  return Response.json({ error: code, ...extra }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const user = await currentUser();
  if (user === null) {
    return json('unauthorized', 401);
  }

  const body = RenderRequest.safeParse(await readJson(request));
  if (!body.success) {
    return json('bad_request', 400, {
      fields: body.error.issues.map((issue) => issue.path.join('.') || 'body'),
    });
  }

  let stored;
  try {
    // Scoped to this user inside `loadApplication`. That read uses the secret
    // key, which bypasses row-level security, so the ownership filter is the
    // only thing between a guessed id and somebody else's resume.
    stored = await loadApplication(user.id, body.data.applicationId);
  } catch (error) {
    return error instanceof StoredShapeError
      ? json('application_unreadable', 409)
      : json('unexpected', 500);
  }

  // Not yours and does not exist get the same answer, deliberately: telling
  // them apart tells a caller which ids exist.
  if (stored === null) {
    return json('application_not_found', 404);
  }

  const name = await loadDisplayName(user.id);
  if (name === null) {
    return json('name_missing', 409);
  }

  try {
    const { files, findings } = await renderApplication(stored.application, {
      name,
      tier: stored.tier,
      ...(stored.company === null ? {} : { company: stored.company }),
    });

    const attached = await attachFiles(user.id, stored.id, files);

    return Response.json({
      applicationId: stored.id,
      files: attached,
      // The parser's complaints about the model's markdown. Reported rather
      // than thrown on: the files are what a human needs in order to judge a
      // finding, and refusing to produce them would answer nothing.
      findings,
    });
  } catch (error) {
    // A code, never the exception's message. `RenderError` names a stage and a
    // document and carries no line of either, but this does not rely on that:
    // anything thrown from inside a renderer is reported as a code.
    return error instanceof RenderError
      ? json('render_failed', 422, {
          stage: error.stage,
          document: error.document,
        })
      : json('unexpected', 500);
  }
}

/** A body that is not JSON is a bad request, not a crash. */
async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
