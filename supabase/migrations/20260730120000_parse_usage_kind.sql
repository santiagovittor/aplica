-- Generalises the daily spend counter to more than one kind (SLICE-11
-- decision 4): parse gets its own 3/day budget instead of sharing generation's
-- 20/day, so a user re-uploading a CV three times doesn't cost three
-- applications. `spend_generation` is replaced rather than kept alongside a
-- new function, because the two would otherwise drift and one of them would be
-- dead code the day someone forgets to check both.
--
-- Existing rows backfill as 'generation': every row written before this
-- migration was a generation spend, since generation was the only kind that
-- existed.

alter table public.usage_counters
  add column kind text not null default 'generation'
    check (kind in ('generation', 'parse'));

alter table public.usage_counters drop constraint usage_counters_pkey;
alter table public.usage_counters add primary key (user_id, day, kind);

drop function public.spend_generation(uuid, integer);

-- Identical shape to spend_generation, parameterised by kind. See that
-- function's original comment (20260729001600_spend_generation.sql) for why
-- this is one atomic statement rather than a read-then-write: `on conflict do
-- update ... where usage_counters.count < daily_limit` takes a row lock, so
-- two concurrent requests for the last slot serialise on it rather than both
-- reading a stale count.
--
-- The parameter is `usage_kind`, not `kind`: measured against real Postgres
-- (`supabase test db`), a parameter named `kind` makes the `on conflict
-- (user_id, day, kind)` target list ambiguous between the column and the
-- plpgsql variable, and Postgres refuses to guess. `spend_generation` never
-- hit this because none of its parameters shared a name with a column.
create function public.spend_usage(spender uuid, usage_kind text, daily_limit integer)
returns integer
language plpgsql
-- Not `security definer`, for the same reason as spend_generation: only
-- service_role may execute this, and it already bypasses row-level security,
-- so definer rights would add privilege without adding reach.
set search_path = ''
as $$
declare
  spent integer;
begin
  -- The insert half of the upsert writes 1 unconditionally, so a limit below 1
  -- would be enforced on every request except the first one of the day for
  -- that kind. Refused here instead.
  if daily_limit < 1 then
    return null;
  end if;

  insert into public.usage_counters (user_id, day, kind, count)
  values (spender, (now() at time zone 'utc')::date, usage_kind, 1)
  on conflict (user_id, day, kind) do update
    set count = usage_counters.count + 1
    where usage_counters.count < daily_limit
  returning count into spent;

  return spent;
end;
$$;

-- Postgres grants `execute` on a new function to `public` by default, and this
-- function writes the counter that stands between a stolen session and
-- somebody else's token bill. Revoked first, then granted to exactly one role.
revoke all on function public.spend_usage(uuid, text, integer) from public;
revoke all on function public.spend_usage(uuid, text, integer) from anon, authenticated;
grant execute on function public.spend_usage(uuid, text, integer) to service_role;
