import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The download route: everything privileged here stays server-side
 * (SLICE-13), so the tests that matter most are the ones that prove a
 * guessed or borrowed application id gets exactly the same 404 a real one
 * would if it belonged to someone else, and that the object key served is
 * always one already recorded on the requester's own row, never one built
 * from the request.
 */

const USER = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const APPLICATION_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const NAME = 'Ada Lovelace';

const { currentUser } = vi.hoisted(() => ({ currentUser: vi.fn() }));
const { downloadOutputFile, loadApplication, loadDisplayName } = vi.hoisted(
  () => ({
    downloadOutputFile: vi.fn(),
    loadApplication: vi.fn(),
    loadDisplayName: vi.fn(),
  }),
);

vi.mock('../../../../../../lib/session', () => ({ currentUser }));
vi.mock('../../../../../../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../../lib/supabase')>()),
  downloadOutputFile,
  loadApplication,
  loadDisplayName,
}));

const { GET } = await import('./route');
const { StoredShapeError } = await import('../../../../../../lib/supabase');

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function get(
  applicationId: string,
  kind: string,
  format: string,
): Promise<Response> {
  return GET(new Request(`http://localhost/api/files/${applicationId}`), {
    params: Promise.resolve({ applicationId, kind, format }),
  });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: APPLICATION_ID,
    application: {},
    tier: 'standard' as const,
    company: 'Cooperativa del Norte',
    role: 'Operations analyst',
    files: [
      {
        kind: 'resume',
        format: 'pdf',
        path: `${USER}/${APPLICATION_ID}/resume.pdf`,
        bytes: BYTES.byteLength,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.mockResolvedValue({ id: USER });
  loadApplication.mockResolvedValue(row());
  loadDisplayName.mockResolvedValue(NAME);
  downloadOutputFile.mockResolvedValue(BYTES.buffer);
});

describe('the download route', () => {
  it('serves the owner their file', async () => {
    const response = await get(APPLICATION_ID, 'resume', 'pdf');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
  });

  it('reads the path the row already carries, not one built from the request', async () => {
    await get(APPLICATION_ID, 'resume', 'pdf');

    expect(downloadOutputFile).toHaveBeenCalledWith(
      `${USER}/${APPLICATION_ID}/resume.pdf`,
    );
  });

  it('names the file from the account and the row, sanitised', async () => {
    loadApplication.mockResolvedValue(
      row({ company: 'Acme "Reviews"; DROP TABLE' }),
    );

    const response = await get(APPLICATION_ID, 'resume', 'pdf');
    const disposition = response.headers.get('content-disposition') ?? '';

    expect(disposition).toContain(
      'filename="Ada Lovelace - Resume - Acme Reviews DROP TABLE.pdf"',
    );
    expect(disposition).not.toContain('"; DROP');
  });

  it('carries the exact name in filename* for non-ASCII characters', async () => {
    loadDisplayName.mockResolvedValue('José Núñez');

    const response = await get(APPLICATION_ID, 'resume', 'pdf');
    const disposition = response.headers.get('content-disposition') ?? '';

    expect(disposition).toContain(
      `filename*=UTF-8''${encodeURIComponent('José Núñez - Resume - Cooperativa del Norte.pdf')}`,
    );
    expect(disposition).toContain(
      'filename="Jos_ N__ez - Resume - Cooperativa del Norte.pdf"',
    );
  });
});

describe('the download route refuses', () => {
  it('an anonymous request', async () => {
    currentUser.mockResolvedValue(null);

    const response = await get(APPLICATION_ID, 'resume', 'pdf');

    expect(response.status).toBe(401);
    expect(loadApplication).not.toHaveBeenCalled();
  });

  it('an application id that is not a UUID', async () => {
    const response = await get('not-a-uuid', 'resume', 'pdf');

    expect(response.status).toBe(400);
    expect(loadApplication).not.toHaveBeenCalled();
  });

  it('an unrecognised kind or format', async () => {
    const badKind = await get(APPLICATION_ID, 'transcript', 'pdf');
    const badFormat = await get(APPLICATION_ID, 'resume', 'txt');

    expect(badKind.status).toBe(400);
    expect(badFormat.status).toBe(400);
    expect(loadApplication).not.toHaveBeenCalled();
  });

  it('an application belonging to somebody else, as a plain 404', async () => {
    // Not yours and does not exist get the same answer: telling them apart
    // tells a caller which ids exist.
    loadApplication.mockResolvedValue(null);

    const response = await get(APPLICATION_ID, 'resume', 'pdf');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'application_not_found' });
    expect(downloadOutputFile).not.toHaveBeenCalled();
  });

  it('a document this application was never rendered with, as the same 404', async () => {
    loadApplication.mockResolvedValue(row({ files: [] }));

    const response = await get(APPLICATION_ID, 'cover-letter', 'docx');

    expect(response.status).toBe(404);
    expect(downloadOutputFile).not.toHaveBeenCalled();
  });

  it('a row written before the content column existed', async () => {
    loadApplication.mockRejectedValue(
      new StoredShapeError('application', 'nothing to render'),
    );

    const response = await get(APPLICATION_ID, 'resume', 'pdf');

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'application_unreadable',
    });
  });

  it('a storage read that fails, without leaking anything', async () => {
    downloadOutputFile.mockRejectedValue(new Error('storage unreachable'));

    const response = await get(APPLICATION_ID, 'resume', 'pdf');
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).toBe(JSON.stringify({ error: 'unexpected' }));
  });
});
