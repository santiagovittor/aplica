import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from '../../../core/application';

/**
 * The render route, whose one job beyond rendering is being safe to run twice.
 *
 * That is the whole reason generation and rendering are two routes
 * (SLICE-10 non-negotiable 5), so the tests that matter most here are the ones
 * that run it again and check that nothing doubled and no model was called.
 */

const USER = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const APPLICATION_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const NAME = 'Ada Lovelace';

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
  resume: '# Ada Lovelace\n\nOperations analyst who runs the financial close.',
  coverLetter: 'I ran the month-end close at Cooperativa del Sur.',
  flags: [],
};

const { currentUser } = vi.hoisted(() => ({ currentUser: vi.fn() }));
const { attachFiles, loadApplication, loadDisplayName } = vi.hoisted(() => ({
  attachFiles: vi.fn(),
  loadApplication: vi.fn(),
  loadDisplayName: vi.fn(),
}));
const { createProvider } = vi.hoisted(() => ({ createProvider: vi.fn() }));

vi.mock('../../../lib/session', () => ({ currentUser }));
vi.mock('../../../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/supabase')>()),
  attachFiles,
  loadApplication,
  loadDisplayName,
}));
// Not used by this route at all, which is the point: it is mocked purely so a
// test can assert that nothing here ever reaches for a model.
vi.mock('../../../providers/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../providers/index')>()),
  createProvider,
}));

const { POST } = await import('./route');
const { StoredShapeError } = await import('../../../lib/supabase');

function post(body: unknown): Request {
  return new Request('http://localhost/api/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: APPLICATION_ID,
    application: APPLICATION,
    tier: 'standard' as const,
    company: 'Cooperativa del Norte',
    role: 'Operations analyst',
    files: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.mockResolvedValue({ id: USER });
  loadApplication.mockResolvedValue(row());
  loadDisplayName.mockResolvedValue(NAME);
  attachFiles.mockImplementation(
    async (
      _userId: string,
      applicationId: string,
      files: { kind: string; format: string; bytes: Uint8Array }[],
    ) =>
      files.map((file) => ({
        kind: file.kind,
        format: file.format,
        path: `${USER}/${applicationId}/${file.kind}.${file.format}`,
        bytes: file.bytes.byteLength,
      })),
  );
});

describe('the render route', () => {
  it('renders the tier the row was generated for', async () => {
    const response = await POST(post({ applicationId: APPLICATION_ID }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.applicationId).toBe(APPLICATION_ID);
    expect(
      body.files.map((file: { kind: string; format: string }) => [
        file.kind,
        file.format,
      ]),
    ).toEqual([
      ['resume', 'pdf'],
      ['cover-letter', 'pdf'],
    ]);
  });

  it('renders real bytes, not empty files', async () => {
    await POST(post({ applicationId: APPLICATION_ID }));
    const files = attachFiles.mock.calls[0][2] as { bytes: Uint8Array }[];

    for (const file of files) {
      expect(file.bytes.byteLength).toBeGreaterThan(500);
    }
  });

  it('takes the name from the account and the company from the row', async () => {
    // Both go in the filename a recruiter reads. Neither comes from the body:
    // the row is what the generation route wrote, so a retry uses the same
    // company rather than whatever the client sends the second time.
    await POST(post({ applicationId: APPLICATION_ID }));
    const files = attachFiles.mock.calls[0][2] as { filename: string }[];

    expect(files[0].filename).toBe(
      'Ada Lovelace - Resume - Cooperativa del Norte.pdf',
    );
  });
});

describe('the render route is safe to run twice', () => {
  it('and the second run succeeds', async () => {
    // Non-negotiable 5. A render failure has to retry without re-running
    // generation, and that is only true if running it again is legal.
    const first = await POST(post({ applicationId: APPLICATION_ID }));
    const second = await POST(post({ applicationId: APPLICATION_ID }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
  });

  it('and writes the same object paths both times', async () => {
    await POST(post({ applicationId: APPLICATION_ID }));
    await POST(post({ applicationId: APPLICATION_ID }));

    const firstPaths = attachFiles.mock.calls[0][2].map(
      (file: { kind: string; format: string }) => `${file.kind}.${file.format}`,
    );
    const secondPaths = attachFiles.mock.calls[1][2].map(
      (file: { kind: string; format: string }) => `${file.kind}.${file.format}`,
    );

    expect(secondPaths).toEqual(firstPaths);
    expect(attachFiles).toHaveBeenCalledTimes(2);
  });

  it('and never makes a model call, on either run', async () => {
    // The whole point of the split: a retry costs the user nothing. If this
    // route ever reaches a provider, the retry is no longer free.
    await POST(post({ applicationId: APPLICATION_ID }));
    await POST(post({ applicationId: APPLICATION_ID }));

    expect(createProvider).not.toHaveBeenCalled();
  });

  it('and re-renders a row that already has files', async () => {
    // The realistic retry: the first attempt uploaded some files and then
    // failed, so the row is not empty when the second attempt starts.
    loadApplication.mockResolvedValue(
      row({
        files: [
          {
            kind: 'resume',
            format: 'pdf',
            path: `${USER}/${APPLICATION_ID}/resume.pdf`,
            bytes: 900,
          },
        ],
      }),
    );

    const response = await POST(post({ applicationId: APPLICATION_ID }));

    expect(response.status).toBe(200);
    expect((await response.json()).files).toHaveLength(2);
  });
});

describe('the render route refuses', () => {
  it('a request with no session', async () => {
    currentUser.mockResolvedValue(null);

    const response = await POST(post({ applicationId: APPLICATION_ID }));

    expect(response.status).toBe(401);
    expect(loadApplication).not.toHaveBeenCalled();
  });

  it('an application id that is not a UUID', async () => {
    const response = await POST(post({ applicationId: 'not-a-uuid' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'bad_request',
      fields: ['applicationId'],
    });
  });

  it('an application belonging to somebody else, as a plain 404', async () => {
    // Not yours and does not exist get the same answer: telling them apart
    // tells a caller which ids exist.
    loadApplication.mockResolvedValue(null);

    const response = await POST(post({ applicationId: APPLICATION_ID }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'application_not_found' });
  });

  it('a row written before the content column existed', async () => {
    loadApplication.mockRejectedValue(
      new StoredShapeError('application', 'nothing to render'),
    );

    const response = await POST(post({ applicationId: APPLICATION_ID }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'application_unreadable',
    });
  });

  it('a user whose name we do not have', async () => {
    loadDisplayName.mockResolvedValue(null);

    const response = await POST(post({ applicationId: APPLICATION_ID }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'name_missing' });
    expect(attachFiles).not.toHaveBeenCalled();
  });

  it('a tier and an application that disagree', async () => {
    // The basic tier is resume only. An application carrying a cover letter is
    // a bug upstream, and it is caught before any file is stored.
    loadApplication.mockResolvedValue(row({ tier: 'basic' }));

    const response = await POST(post({ applicationId: APPLICATION_ID }));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: 'render_failed',
      stage: 'tier',
    });
    expect(attachFiles).not.toHaveBeenCalled();
  });
});

describe('a render failure carries no document text', () => {
  it('only the stage and which document', async () => {
    loadApplication.mockResolvedValue(
      row({
        tier: 'basic',
        application: { ...APPLICATION, coverLetter: 'A secret paragraph.' },
      }),
    );

    const response = await POST(post({ applicationId: APPLICATION_ID }));
    const text = await response.text();

    expect(text).not.toContain('A secret paragraph.');
    expect(text).not.toContain(APPLICATION.resume);
  });

  it('and an unexpected failure is not forwarded at all', async () => {
    attachFiles.mockRejectedValue(
      new Error(`upload failed for ${APPLICATION.resume}`),
    );

    const response = await POST(post({ applicationId: APPLICATION_ID }));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).toBe(JSON.stringify({ error: 'unexpected' }));
  });
});
