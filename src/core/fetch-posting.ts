import { request } from 'node:https';
import {
  assertResolvesSafely,
  assertSafeBaseUrl,
  guardedLookup,
} from './url-guard';

/**
 * The URL field on `/apply` is best-effort convenience (PROJECT.md section 9):
 * paste a link instead of the posting text, and the server fetches it. That
 * makes the server the one making an outbound request on the user's behalf,
 * the exact SSRF shape `url-guard.ts` exists for (SLICE-15 decision 1) -- the
 * same guard the `openai_compatible` base URL goes through, with
 * `allowPrivate` always false: there is no self-hosting story for a job
 * board.
 *
 * Framework-free, like the rest of `core`, so it runs in the unit suite with
 * no network.
 */

const FETCH_TIMEOUT_MS = 10_000;

/**
 * A generous cap on the raw HTML read off the wire, before it is stripped
 * down to text. A hostile or merely careless host is free to answer with
 * gigabytes; this is the one place that stops mattering.
 */
const MAX_RESPONSE_BYTES = 2_000_000;

/**
 * Below this, the fetch "worked" in the HTTP sense but returned nothing worth
 * tailoring against: a login wall, a JS-only shell with no server-rendered
 * text, a block page. Treated the same as a hard failure -- PROJECT.md
 * section 9's own naming of LinkedIn, Workday and most ATS pages blocking
 * automated fetching is exactly this case with a 200 status.
 */
const MIN_POSTING_CHARS = 200;

/**
 * Every way this can fail collapses to one outcome (SLICE-15 decision 2): the
 * calm "that site won't let us read it" fallback, never a hard refusal. The
 * caller does not need to know which of these it was, so nothing about the
 * cause is carried on the error.
 */
export class PostingFetchFailed extends Error {
  constructor() {
    super('Could not read a job posting from that URL.');
    this.name = 'PostingFetchFailed';
  }
}

/**
 * Fetches `rawUrl` and returns readable text, truncated to `maxChars`.
 * Throws `PostingFetchFailed` for anything short of that -- an unsafe or
 * unresolvable address, a non-2xx response, a redirect, a timeout, or a page
 * that yielded too little text to be a posting.
 */
export async function fetchPosting(
  rawUrl: string,
  maxChars: number,
): Promise<string> {
  let endpoint;
  try {
    endpoint = assertSafeBaseUrl(rawUrl, { allowPrivate: false });
    await assertResolvesSafely(endpoint.hostname, { allowPrivate: false });
  } catch {
    throw new PostingFetchFailed();
  }

  let html: string;
  try {
    html = await getPinned(endpoint.url);
  } catch {
    throw new PostingFetchFailed();
  }

  const text = htmlToText(html);
  if (text.length < MIN_POSTING_CHARS) {
    throw new PostingFetchFailed();
  }
  return text.slice(0, maxChars);
}

/**
 * The GET half of what `postJsonPinned` (`src/providers/types.ts`) does for
 * POST. Not shared: that helper parses a JSON body and posts one, this reads
 * capped raw text off a GET, and the two calling contexts differ enough
 * (provider request vs. arbitrary page fetch) that forcing one shape on both
 * would be the wrong abstraction (CLAUDE.md section 4). What matters is
 * reused, not duplicated: `guardedLookup` is the same function, so the
 * address it approves here is the address this socket connects to, exactly
 * as it is for a provider call.
 */
function getPinned(url: string): Promise<string> {
  const target = new URL(url);

  return new Promise<string>((resolve, reject) => {
    const req = request(
      {
        protocol: target.protocol,
        hostname: target.hostname.replace(/^\[|\]$/g, ''),
        port: target.port === '' ? 443 : Number(target.port),
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers: { accept: 'text/html' },
        lookup: guardedLookup({ allowPrivate: false }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
      (response) => {
        const status = response.statusCode ?? 0;

        // A redirect would walk this past the guard to a second, unchecked
        // host, same reasoning as `postJsonPinned`'s own refusal.
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`posting fetch failed with status ${status}`));
          return;
        }

        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            response.destroy();
            reject(new Error('posting response exceeded the size cap'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
      },
    );

    req.on('error', reject);
    req.end();
  });
}

/**
 * A deliberately blunt HTML-to-text pass: drop script/style/comment blocks,
 * turn block-level tags into line breaks, strip everything else, decode the
 * handful of entities a posting is likely to contain, collapse whitespace.
 *
 * Not a readability algorithm -- a real one is a dependency and a maintenance
 * surface this "best-effort convenience" (PROJECT.md section 9) does not
 * justify (CLAUDE.md section 1, rule 7). A page that needs one -- heavy
 * client-side rendering, mostly chrome around the actual text -- is exactly
 * the shape `MIN_POSTING_CHARS` exists to catch and fall back from.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|p|div|li|tr|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
