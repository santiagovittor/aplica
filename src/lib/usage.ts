import { z } from 'zod';
import { supabaseRequest } from './supabase';

/**
 * The daily generation limit (PROJECT.md section 11).
 *
 * Even with the user's own key, a stolen session on a loop spends somebody
 * else's money all night, and neither we nor they find out until the bill does.
 * So a generation is spent before a token is, not after.
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

/** Postgres answers the RPC with the new count, or null when it refused. */
const Spent = z.number().int().nullable();

/**
 * Takes one generation off today's allowance, or refuses.
 *
 * One request, and the decision is the database's. A version that read the
 * counter, compared it here and wrote it back would be two requests with a race
 * between them, and the race is exactly what a script hammering this endpoint
 * would win. `spend_generation` does it in a single statement whose
 * `on conflict do update` takes a row lock, so two requests for the last slot
 * serialise and the second one updates nothing.
 *
 * The day is not sent. It is `(now() at time zone 'utc')::date` inside the
 * statement, because a day this process names is a day a caller could name, and
 * a caller who can name yesterday gets a fresh twenty.
 *
 * Called **before** the first model call and never refunded on failure. A
 * generation that failed halfway still spent the user's tokens, and a limit
 * that refunds on error is a limit a crafted failure walks straight through.
 *
 * Returns how many have been spent today, including this one.
 */
export async function spendGeneration(
  userId: string,
  limit: number = DAILY_GENERATION_LIMIT,
): Promise<number> {
  const spender = z.uuid().parse(userId);

  const response = await supabaseRequest(
    'generation spend',
    '/rest/v1/rpc/spend_generation',
    {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spender, daily_limit: limit }),
    },
  );

  const spent = Spent.parse(await response.json());
  if (spent === null) {
    throw new GenerationLimitReached(limit);
  }

  return spent;
}
