import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAILY_GENERATION_LIMIT,
  GenerationLimitReached,
  spendGeneration,
} from './usage';

const SECRET = 'sb_secret_pretend-this-is-real';
const URL_BASE = 'http://127.0.0.1:54321';
const USER = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

interface Captured {
  url: string;
  method: string;
  body: unknown;
}

let calls: Captured[] = [];

/**
 * A stand-in for the one statement the database runs.
 *
 * It holds a count and applies the same condition the SQL does, so a caller
 * that tried to read the counter and write it back would be visible as two
 * requests rather than one. It cannot prove atomicity, and nothing in
 * TypeScript can: the lock is a row lock in Postgres. What it proves is that
 * this module never takes the decision into its own process, which is the part
 * that could be got wrong here. The lock itself is proved against real Postgres
 * in `supabase/tests/rls.sql`.
 */
function database({ start = 0 }: { start?: number } = {}) {
  const state = { count: start };

  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { daily_limit: number };
    calls.push({ url, method: init.method ?? 'POST', body });

    // The `where usage_counters.count < daily_limit` half of the upsert.
    if (state.count >= body.daily_limit || body.daily_limit < 1) {
      return Response.json(null);
    }
    state.count += 1;
    return Response.json(state.count);
  });

  return state;
}

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.SUPABASE_SECRET_KEY;

beforeEach(() => {
  calls = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_BASE;
  process.env.SUPABASE_SECRET_KEY = SECRET;
  database();
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

describe('spendGeneration', () => {
  it('returns the new count', async () => {
    expect(await spendGeneration(USER, 3)).toBe(1);
    expect(await spendGeneration(USER, 3)).toBe(2);
  });

  it('defaults to the limit the product ships with', async () => {
    expect(DAILY_GENERATION_LIMIT).toBe(20);

    await spendGeneration(USER);

    expect(calls[0].body).toMatchObject({ daily_limit: 20 });
  });

  it('spends in one server-side statement, never a read then a write', async () => {
    // The whole limit rests on this. A version that read the counter, compared
    // it here, and wrote it back would be two requests and a race between
    // them. One request is the property that makes the row lock reachable.
    await spendGeneration(USER, 20);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${URL_BASE}/rest/v1/rpc/spend_generation`);
    expect(calls[0].method).toBe('POST');
  });

  it('lets the database decide which UTC day it is', async () => {
    // A day sent from here is a day this process chose, and a caller that can
    // name the day can name yesterday and get a fresh twenty. The SQL uses
    // `(now() at time zone 'utc')::date` and nothing else.
    await spendGeneration(USER, 20);

    expect(calls[0].body).toEqual({ spender: USER, daily_limit: 20 });
  });
});

describe('spendGeneration refuses', () => {
  it('the request after the last slot is taken', async () => {
    database({ start: 0 });

    expect(await spendGeneration(USER, 2)).toBe(1);
    expect(await spendGeneration(USER, 2)).toBe(2);
    await expect(spendGeneration(USER, 2)).rejects.toBeInstanceOf(
      GenerationLimitReached,
    );
  });

  it('with the limit it was refused against', async () => {
    database({ start: 5 });

    let thrown: unknown;
    try {
      await spendGeneration(USER, 5);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GenerationLimitReached);
    expect((thrown as GenerationLimitReached).limit).toBe(5);
  });

  it('both of two concurrent requests for the last slot but one', async () => {
    // Non-negotiable 3. The database serialises them; what this pins is that
    // this module adds no cache and no optimistic pass of its own, so the
    // second caller sees the first caller's write.
    database({ start: 4 });

    const results = await Promise.allSettled([
      spendGeneration(USER, 5),
      spendGeneration(USER, 5),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(calls).toHaveLength(2);
  });

  it('a limit of zero, without writing a row', async () => {
    await expect(spendGeneration(USER, 0)).rejects.toBeInstanceOf(
      GenerationLimitReached,
    );
  });

  it('a user id that is not a UUID, before any request', async () => {
    await expect(spendGeneration('../../other-user')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('a refused generation leaks nothing', () => {
  it('not the secret key', async () => {
    // This error reaches a log and an SSE error event.
    database({ start: 20 });

    let thrown: unknown;
    try {
      await spendGeneration(USER, 20);
    } catch (error) {
      thrown = error;
    }

    const error = thrown as Error;
    for (const text of [error.message, error.stack ?? '', String(error)]) {
      expect(text).not.toContain(SECRET);
    }
  });
});

describe('spendGeneration fails fast', () => {
  it('when the secret key is missing', async () => {
    delete process.env.SUPABASE_SECRET_KEY;

    await expect(spendGeneration(USER, 20)).rejects.toThrow(
      /SUPABASE_SECRET_KEY is not set/,
    );
  });
});
