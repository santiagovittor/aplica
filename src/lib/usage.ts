import { z } from 'zod';
import { supabaseRequest } from './supabase';

/**
 * The daily spend limits, one per kind (PROJECT.md section 11, SLICE-11
 * decision 4).
 *
 * Even with the user's own key, a stolen session on a loop spends somebody
 * else's money all night, and neither we nor they find out until the bill does.
 * So a spend is checked and incremented before a token is, not after.
 */

/**
 * Twenty a day, per user, per UTC day.
 *
 * High enough that no honest job search meets it, low enough that a loop with a
 * stolen session cannot spend a fortune of somebody else's money overnight.
 *
 * It lives here rather than in a column because the init migration promised it
 * would: changing it is a TypeScript change and never a migration.
 */
export const DAILY_GENERATION_LIMIT = 20;

/**
 * Three a day, per user, per UTC day (SLICE-11 decision 4).
 *
 * A parse costs roughly five times a generation and normally happens once
 * ever, so it gets its own budget rather than a share of the twenty: a user
 * re-uploading a CV three times to fix it should not cost three applications.
 * Three leaves room to fix a bad CV and try again without leaving the loop
 * cheap for a stolen session.
 */
export const DAILY_PARSE_LIMIT = 3;

/**
 * The limit was reached, so nothing was spent and nothing was generated.
 *
 * Carries the limit and nothing else. It reaches a log and an SSE error event,
 * so it holds no key, no posting and no line of anybody's documents.
 */
export class GenerationLimitReached extends Error {
  constructor(readonly limit: number) {
    super(
      `That is ${limit} generations today, which is the daily limit. It resets at midnight UTC.`,
    );
    this.name = 'GenerationLimitReached';
  }
}

/** Same shape as `GenerationLimitReached`, for the parse counter. */
export class ParseLimitReached extends Error {
  constructor(readonly limit: number) {
    super(
      `That is ${limit} CV parses today, which is the daily limit. It resets at midnight UTC.`,
    );
    this.name = 'ParseLimitReached';
  }
}

/** Postgres answers the RPC with the new count, or null when it refused. */
const Spent = z.number().int().nullable();

/**
 * Takes one spend of `kind` off today's allowance for that kind, or refuses.
 *
 * One request, and the decision is the database's. A version that read the
 * counter, compared it here and wrote it back would be two requests with a race
 * between them, and the race is exactly what a script hammering this endpoint
 * would win. `spend_usage` does it in a single statement whose
 * `on conflict do update` takes a row lock, so two requests for the last slot
 * serialise and the second one updates nothing.
 *
 * The day is not sent. It is `(now() at time zone 'utc')::date` inside the
 * statement, because a day this process names is a day a caller could name, and
 * a caller who can name yesterday gets a fresh allowance.
 *
 * Called **before** the first token is spent and never refunded on failure. A
 * call that failed halfway still spent the user's tokens, and a limit that
 * refunds on error is a limit a crafted failure walks straight through.
 *
 * `kind` partitions the counter (`usage_counters`'s primary key is
 * `(user_id, day, kind)`), so a generation spend and a parse spend never share
 * a budget even for the same user on the same day.
 *
 * Returns how many of `kind` have been spent today, including this one.
 */
async function spend(
  kind: 'generation' | 'parse',
  userId: string,
  limit: number,
): Promise<number> {
  const spender = z.uuid().parse(userId);

  const response = await supabaseRequest(
    `${kind} spend`,
    '/rest/v1/rpc/spend_usage',
    {
      headers: { 'content-type': 'application/json' },
      // `usage_kind`, matching the RPC's own parameter name (see the
      // migration's comment: `kind` collided with the column of the same
      // name inside the function's `on conflict` clause).
      body: JSON.stringify({ spender, usage_kind: kind, daily_limit: limit }),
    },
  );

  const spent = Spent.parse(await response.json());
  if (spent === null) {
    throw kind === 'generation'
      ? new GenerationLimitReached(limit)
      : new ParseLimitReached(limit);
  }

  return spent;
}

export function spendGeneration(
  userId: string,
  limit: number = DAILY_GENERATION_LIMIT,
): Promise<number> {
  return spend('generation', userId, limit);
}

export function spendParse(
  userId: string,
  limit: number = DAILY_PARSE_LIMIT,
): Promise<number> {
  return spend('parse', userId, limit);
}
