-- The daily generation limit, spent atomically (PROJECT.md section 11).
--
-- The init migration documents the increment as raw SQL. PostgREST cannot run
-- raw SQL, and its one upsert mechanism does not do this: `Prefer:
-- resolution=merge-duplicates` writes the columns in the payload, so an upsert
-- of `count: 1` sets the counter to 1 on every request and the limit never
-- fires. A limit that silently always passes is worse than no limit, because
-- nobody goes looking for it. So the statement lives here, where it can be one
-- round trip and one atomic statement, and the server calls it as an RPC.
--
-- The limit is an argument rather than a column, so changing it stays a
-- TypeScript change and never needs a migration, exactly as the init migration
-- said.
--
-- Atomicity comes from `on conflict do update`, which takes a row lock. Two
-- concurrent requests for the last slot serialise on it: the first commits the
-- increment, the second re-evaluates the `where` against the committed row and
-- matches nothing, so it updates no row and returns null. Neither reads a count
-- and writes it back, which is the race this exists to close.
--
-- Returns the new count, or null when the request is refused. Null is the
-- refusal rather than a boolean because the caller wants to say how many were
-- spent, and because a function that returns false on refusal and true on
-- success cannot also report the count without a second query.
--
-- Not refunded on failure, by decision: a failed generation still spent the
-- user's tokens, and a limit that refunds on error is a limit that a crafted
-- failure walks straight through.
create function public.spend_generation(spender uuid, daily_limit integer)
returns integer
language plpgsql
-- Not `security definer`. Only `service_role` may execute this, and that role
-- already holds `grant all` on the table and bypasses row-level security, so
-- definer rights would add privilege without adding reach.
set search_path = ''
as $$
declare
  spent integer;
begin
  -- The insert half of the upsert writes 1 unconditionally, so a limit below 1
  -- would be enforced on every request except the first one of the day. Refused
  -- here instead. The tests set the limit to 1 rather than 0, but a caller that
  -- passes 0 means "none", and this answers that honestly.
  if daily_limit < 1 then
    return null;
  end if;

  insert into public.usage_counters (user_id, day, count)
  values (spender, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update
    set count = usage_counters.count + 1
    where usage_counters.count < daily_limit
  returning count into spent;

  return spent;
end;
$$;

-- Postgres grants `execute` on a new function to `public` by default, and this
-- function writes the counter that stands between a stolen session and somebody
-- else's token bill. Revoked first, then granted to exactly one role.
revoke all on function public.spend_generation(uuid, integer) from public;
revoke all on function public.spend_generation(uuid, integer) from anon, authenticated;
grant execute on function public.spend_generation(uuid, integer) to service_role;
