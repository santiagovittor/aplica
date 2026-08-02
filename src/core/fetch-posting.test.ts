import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPosting, PostingFetchFailed } from './fetch-posting';

/**
 * The URL field's server-side fetch (SLICE-15 decision 1), against a stubbed
 * transport. No real socket opens and no real DNS resolves: `node:dns/promises`
 * and `node:https` are both replaced, the same discipline
 * `providers.test.ts` and `url-guard.test.ts` already use for the two pieces
 * this module is built from.
 */

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn((hostname: string) =>
    Promise.resolve(
      hostname.includes('private')
        ? [{ address: '10.0.0.5', family: 4 }]
        : [{ address: '203.0.113.10', family: 4 }],
    ),
  ),
}));

vi.mock('node:https', () => ({ request: vi.fn() }));

interface StubbedRequest {
  options: Record<string, unknown>;
}

function stubHttps({
  status = 200,
  body = '',
}: { status?: number; body?: string } = {}): StubbedRequest[] {
  const calls: StubbedRequest[] = [];

  vi.mocked(httpsRequest).mockImplementation(((
    options: Record<string, unknown>,
    callback: (response: Readable & { statusCode: number }) => void,
  ) => {
    calls.push({ options });

    const response = Object.assign(Readable.from([Buffer.from(body)]), {
      statusCode: status,
    });
    queueMicrotask(() => callback(response));

    return {
      on: () => undefined,
      end: () => undefined,
    };
    // The shim covers only what `fetchPosting` touches, same as
    // `providers.test.ts`'s equivalent for `postJsonPinned`.
  }) as unknown as typeof httpsRequest);

  return calls;
}

afterEach(() => {
  vi.mocked(httpsRequest).mockReset();
});

const POSTING_HTML = `<html><head><style>.x{color:red}</style></head><body>
  <script>console.log('nope')</script>
  <h1>Senior Product Designer</h1>
  <p>We are looking for someone with 5+ years of experience in product design.
  You will work closely with engineering &amp; research to ship features that
  matter. Requirements include a strong portfolio, excellent communication,
  and comfort with ambiguity in a fast-moving team.</p>
  <p>Benefits include health coverage, a home office stipend, and unlimited
  time off. We are an equal opportunity employer and value diverse teams.</p>
</body></html>`;

describe('fetchPosting', () => {
  it('rejects a literal private address before any request', async () => {
    await expect(
      fetchPosting('https://169.254.169.254/posting', 50_000),
    ).rejects.toBeInstanceOf(PostingFetchFailed);
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it('rejects a public hostname that resolves privately', async () => {
    await expect(
      fetchPosting('https://private.example.com/posting', 50_000),
    ).rejects.toBeInstanceOf(PostingFetchFailed);
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it('returns readable text stripped of tags, scripts and styles', async () => {
    stubHttps({ body: POSTING_HTML });

    const text = await fetchPosting('https://jobs.example.com/posting', 50_000);

    expect(text).toContain('Senior Product Designer');
    expect(text).toContain('research to ship features');
    expect(text).not.toContain('<p>');
    expect(text).not.toContain('console.log');
    expect(text).not.toContain('color:red');
    // Entities decoded, not left as literal markup.
    expect(text).toContain('engineering & research');
  });

  it('pins the lookup, the same guard both SSRF callers share', async () => {
    stubHttps({ body: POSTING_HTML });
    await fetchPosting('https://jobs.example.com/posting', 50_000);

    const [options] = vi.mocked(httpsRequest).mock.calls[0];
    expect(typeof (options as unknown as Record<string, unknown>).lookup).toBe(
      'function',
    );
  });

  it('truncates to the caller-supplied cap', async () => {
    stubHttps({ body: POSTING_HTML });

    const text = await fetchPosting('https://jobs.example.com/posting', 50);

    expect(text.length).toBeLessThanOrEqual(50);
  });

  it('rejects a non-2xx response, the shape LinkedIn and Workday answer with', async () => {
    stubHttps({ status: 403, body: 'blocked' });

    await expect(
      fetchPosting('https://jobs.example.com/posting', 50_000),
    ).rejects.toBeInstanceOf(PostingFetchFailed);
  });

  it('rejects a redirect rather than following it past the guard', async () => {
    stubHttps({ status: 302, body: '' });

    await expect(
      fetchPosting('https://jobs.example.com/posting', 50_000),
    ).rejects.toBeInstanceOf(PostingFetchFailed);
  });

  it('rejects a page with too little readable text, a JS-only shell', async () => {
    stubHttps({
      body: '<html><body><div id="root"></div><script>boot()</script></body></html>',
    });

    await expect(
      fetchPosting('https://jobs.example.com/posting', 50_000),
    ).rejects.toBeInstanceOf(PostingFetchFailed);
  });

  it('rejects on a transport error rather than throwing something else', async () => {
    vi.mocked(httpsRequest).mockImplementation((() => ({
      on: (event: string, handler: (error: Error) => void) => {
        if (event === 'error') {
          queueMicrotask(() => handler(new Error('ECONNRESET')));
        }
      },
      end: () => undefined,
      // The shim covers only what `fetchPosting` touches; node's own types
      // describe the whole ClientRequest surface.
    })) as unknown as typeof httpsRequest);

    await expect(
      fetchPosting('https://jobs.example.com/posting', 50_000),
    ).rejects.toBeInstanceOf(PostingFetchFailed);
  });
});
