-- Proof that row-level security actually isolates two users.
--
-- Seeds Alice and Bob, then reads every table as each of them and asserts what
-- they can and cannot see. Any failed assertion aborts with a nonzero exit, so
-- this is a check, not a description.
--
-- Run against the local stack (the whole thing rolls back at the end):
--   docker exec -i supabase_db_aplica psql -v ON_ERROR_STOP=1 -U postgres \
--     -d postgres < supabase/tests/rls.sql

\set ON_ERROR_STOP on
\set alice '11111111-1111-1111-1111-111111111111'
\set bob   '22222222-2222-2222-2222-222222222222'

begin;

-- Alice signs in with a provider that sends a name, Bob with email and password
-- and no metadata at all. That pairing is what `handle_new_user` has to tell
-- apart, so it is seeded here rather than assumed.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  (:'alice', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice@example.test', '', now(), now(), now(), '{"full_name": "Alice Example"}'),
  (:'bob',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob@example.test',   '', now(), now(), now(), '{}');

-- The trigger should have made both account rows already.
--
-- Counted over the two seeded ids rather than over the whole table: this runs
-- against whatever database is to hand, and a developer account already sitting
-- in it is not a failure of the trigger.
do $$
begin
  assert (select count(*) from public.users
           where id in ('11111111-1111-1111-1111-111111111111',
                        '22222222-2222-2222-2222-222222222222')) = 2,
    'handle_new_user did not create an account row per auth user';

  -- The name the apply pipeline puts on the documents, taken from the OAuth
  -- profile so a Google user never types something we were already handed.
  assert (select display_name from public.users
           where id = '11111111-1111-1111-1111-111111111111') = 'Alice Example',
    'handle_new_user did not seed display_name from the OAuth metadata';

  -- And left null, not blank, for a sign-up that carried no name. The route
  -- refuses with its own sentence on null; an empty string would read as an
  -- answer and end up on a PDF.
  assert (select display_name from public.users
           where id = '22222222-2222-2222-2222-222222222222') is null,
    'handle_new_user invented a display_name for a user who has none';
end $$;

-- The two remaining branches of that expression, on a throwaway user so the
-- fixtures above are untouched.
do $$
declare probe uuid;
begin
  -- `name` when `full_name` is absent, which is the other key Google sends.
  probe := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
  values (probe, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', probe || '@example.test', '', now(), now(), now(), '{"name": "Carol Example"}');
  assert (select display_name from public.users where id = probe) = 'Carol Example',
    'handle_new_user ignored the name key when full_name was absent';
  delete from auth.users where id = probe;

  -- A provider that sends the key with nothing in it is saying it does not
  -- know, so that has to land as null rather than as whitespace.
  probe := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
  values (probe, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', probe || '@example.test', '', now(), now(), now(), '{"full_name": "   "}');
  assert (select display_name from public.users where id = probe) is null,
    'handle_new_user stored whitespace as a name';
  delete from auth.users where id = probe;
end $$;

insert into public.profiles (user_id, data) values
  (:'alice', '{"facts": []}'), (:'bob', '{"facts": []}');

insert into public.api_keys (user_id, provider, ciphertext) values
  (:'alice', 'anthropic', 'v1.aaa.bbb.ccc'), (:'bob', 'openai', 'v1.ddd.eee.fff');

-- The openai_compatible provider carries a base URL and the three named ones do
-- not. That pairing is a check constraint, so this asserts the constraint holds
-- rather than trusting the application to respect it. Alice's row is borrowed
-- and put back; a failed statement inside a plpgsql exception block rolls back
-- to its own savepoint, so the successful ones before it survive.
do $$
declare rejected boolean;
begin
  update public.api_keys
     set provider = 'openai_compatible', base_url = 'https://integrate.api.nvidia.com/v1'
   where user_id = '11111111-1111-1111-1111-111111111111';
  assert (select base_url from public.api_keys
           where user_id = '11111111-1111-1111-1111-111111111111') is not null,
    'openai_compatible with a base URL was rejected';

  rejected := false;
  begin
    update public.api_keys set base_url = null
     where user_id = '11111111-1111-1111-1111-111111111111';
  exception when check_violation then rejected := true;
  end;
  assert rejected, 'openai_compatible without a base URL was accepted';

  rejected := false;
  begin
    update public.api_keys set provider = 'anthropic'
     where user_id = '11111111-1111-1111-1111-111111111111';
  exception when check_violation then rejected := true;
  end;
  assert rejected, 'a named provider was allowed to keep a base URL';

  rejected := false;
  begin
    update public.api_keys set provider = 'llamafile', base_url = null
     where user_id = '11111111-1111-1111-1111-111111111111';
  exception when check_violation then rejected := true;
  end;
  assert rejected, 'an unknown provider was accepted';

  update public.api_keys set provider = 'anthropic', base_url = null
   where user_id = '11111111-1111-1111-1111-111111111111';
end $$;

insert into public.applications (user_id, company, role, tier, fit_score) values
  (:'alice', 'Acme', 'Engineer', 'full', 80), (:'bob', 'Globex', 'Analyst', 'basic', 40);

-- The same expression `spend_generation` writes, not `current_date`. The two
-- agree only while the server runs in UTC, and a fixture that disagreed with
-- the function would put the seeded row on one day and the spend on another,
-- which fails somewhere around midnight and nowhere else.
insert into public.usage_counters (user_id, day, count) values
  (:'alice', (now() at time zone 'utc')::date, 3),
  (:'bob',   (now() at time zone 'utc')::date, 7);

insert into storage.objects (bucket_id, name, owner) values
  ('cvs', :'alice' || '/cv.pdf', :'alice'), ('cvs', :'bob' || '/cv.pdf', :'bob');

-- The bucket's visibility is row data, not schema, so `supabase db diff` cannot
-- see it and a drift check will never catch this. A public cvs bucket would
-- serve every uploaded CV over the public route with no token.
do $$
begin
  assert (select not public from storage.buckets where id = 'cvs'),
    'the cvs bucket is public; uploaded CVs are readable without a token';
end $$;

-- Everything below runs as a signed-in user, not as the superuser.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

do $$
begin
  assert (select auth.uid()) = '11111111-1111-1111-1111-111111111111',
    'the impersonation itself is broken; every assertion below would be meaningless';

  -- users: own row only, and no way to delete it or forge another.
  assert (select count(*) from public.users) = 1, 'alice can see another account row';
  assert (select count(*) from public.users where id = auth.uid()) = 1, 'alice cannot see her own account row';

  -- profiles: own CV data only.
  assert (select count(*) from public.profiles) = 1, 'alice can see another profile';
  assert (select user_id from public.profiles) = auth.uid(), 'alice sees the wrong profile';

  -- applications: own history only.
  assert (select count(*) from public.applications) = 1, 'alice can see another application';
  assert (select company from public.applications) = 'Acme', 'alice sees the wrong application';

  -- usage counters: own counter only.
  assert (select count(*) from public.usage_counters) = 1, 'alice can see another usage counter';
  assert (select usage_counters.count from public.usage_counters) = 3, 'alice sees the wrong usage counter';

  -- storage: own CV file only.
  assert (select count(*) from storage.objects where bucket_id = 'cvs') = 1, 'alice can see another CV file';
  assert (select name from storage.objects where bucket_id = 'cvs') like '11111111%', 'alice sees the wrong CV file';

  -- The policies have to let the app work, not only keep strangers out.
  update public.profiles set data = '{"facts": [1]}' where user_id = auth.uid();
  assert (select data from public.profiles) = '{"facts": [1]}',
    'alice cannot update her own profile';
end $$;

-- The encrypted keys are unreachable, not merely filtered.
do $$
declare denied boolean := false;
begin
  begin
    perform 1 from public.api_keys;
  exception
    when insufficient_privilege then denied := true;
  end;
  assert denied, 'a signed-in user can read the api_keys table';
end $$;

-- Writes a client must not be able to make.
do $$
declare blocked boolean := false;
begin
  begin
    insert into public.applications (user_id, tier, fit_score) values (auth.uid(), 'full', 100);
  exception
    when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a signed-in user can forge an application row';
end $$;

-- A missing grant raises, while a missing policy is a silent no-op. Either is
-- fine, so this asserts the effect rather than the mechanism.
do $$
begin
  begin
    update public.usage_counters set count = 0 where user_id = auth.uid();
  exception
    when insufficient_privilege then null;
  end;
  assert (select usage_counters.count from public.usage_counters) = 3,
    'a signed-in user can reset their own rate-limit counter';
end $$;

do $$
declare blocked boolean := false;
begin
  begin
    insert into public.users (id) values ('33333333-3333-3333-3333-333333333333');
  exception
    when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a signed-in user can create an account row directly';
end $$;

-- Same story from Bob's side, so the isolation is not an accident of ordering.
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

do $$
begin
  assert (select count(*) from public.profiles) = 1, 'bob can see another profile';
  assert (select user_id from public.profiles) = auth.uid(), 'bob sees the wrong profile';
  assert (select company from public.applications) = 'Globex', 'bob sees the wrong application';
  assert (select count from public.usage_counters) = 7, 'bob sees the wrong usage counter';
  assert (select name from storage.objects where bucket_id = 'cvs') like '22222222%', 'bob sees the wrong CV file';
end $$;

-- An anonymous visitor sees nothing at all. Back to the session role first:
-- `authenticated` is not a member of `anon` and cannot switch to it directly.
reset role;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';

-- anon holds no grant on any of these, so the query is refused outright rather
-- than filtered down to nothing. Either outcome is a pass; what matters is that
-- no row comes back.
do $$
declare
  table_name text;
  rows_seen bigint;
begin
  foreach table_name in array array[
    'public.users', 'public.profiles', 'public.applications',
    'public.usage_counters', 'public.api_keys'
  ] loop
    begin
      execute format('select count(*) from %s', table_name) into rows_seen;
      assert rows_seen = 0, format('anon can read %s', table_name);
    exception
      when insufficient_privilege then null;
    end;
  end loop;

  assert (select count(*) from storage.objects where bucket_id = 'cvs') = 0,
    'anon can read CV files';
end $$;

reset role;

-- The daily generation limit, against the real statement rather than a mock.
--
-- `spendGeneration` in src/lib/usage.ts is unit-tested against a stand-in, and
-- a stand-in cannot prove a row lock. This runs the actual function on actual
-- Postgres in CI: the boundary, the refusal, and the fact that a refusal writes
-- nothing. The lock itself is proved by racing concurrent connections, which
-- needs more than one session and so lives in the slice report rather than
-- here.
-- Alice is seeded above with three already spent today and Bob with seven, so
-- these count on from there rather than from zero.
do $$
declare spent integer;
begin
  assert public.spend_generation('11111111-1111-1111-1111-111111111111', 6) = 4,
    'the counter did not climb from what was already spent today';
  assert public.spend_generation('11111111-1111-1111-1111-111111111111', 6) = 5,
    'the counter did not climb';
  assert public.spend_generation('11111111-1111-1111-1111-111111111111', 6) = 6,
    'the last slot was refused';

  spent := public.spend_generation('11111111-1111-1111-1111-111111111111', 6);
  assert spent is null,
    'the limit did not hold: a seventh generation passed a limit of six';

  -- The refusal must not move the counter. A refusal that still incremented
  -- would push the row further past the limit on every rejected attempt, so the
  -- day the limit was raised the user would still be locked out.
  assert (select count from public.usage_counters
           where user_id = '11111111-1111-1111-1111-111111111111'
             and day = (now() at time zone 'utc')::date) = 6,
    'a refused generation still moved the counter';

  -- Bob is untouched by any of that: the allowance is per user.
  assert (select count from public.usage_counters
           where user_id = '22222222-2222-2222-2222-222222222222') = 7,
    'one user spending moved another user''s counter';
  assert public.spend_generation('22222222-2222-2222-2222-222222222222', 9) = 8,
    'the counter is not per user';

  -- A limit of none means none, including the first request of a day. The
  -- insert half of the upsert writes 1 unconditionally, so a user with no row
  -- yet is the one case the `where` clause cannot catch. Bob's row is cleared
  -- to put him in exactly that state; nothing after this reads it.
  delete from public.usage_counters
   where user_id = '22222222-2222-2222-2222-222222222222';

  spent := public.spend_generation('22222222-2222-2222-2222-222222222222', 0);
  assert spent is null, 'a limit of zero granted a generation';
  assert (select count(*) from public.usage_counters
           where user_id = '22222222-2222-2222-2222-222222222222') = 0,
    'a refused generation still created a counter row';
end $$;

-- The counter stands between a stolen session and somebody else's token bill,
-- so no client role may move it. `usage_counters` grants only `select`, and the
-- function is granted to `service_role` alone.
do $$
declare denied boolean;
begin
  denied := false;
  set local role authenticated;
  begin
    perform public.spend_generation('11111111-1111-1111-1111-111111111111', 99);
  exception when insufficient_privilege then denied := true;
  end;
  reset role;
  assert denied, 'an authenticated user can spend generations directly';

  denied := false;
  set local role anon;
  begin
    perform public.spend_generation('11111111-1111-1111-1111-111111111111', 99);
  exception when insufficient_privilege then denied := true;
  end;
  reset role;
  assert denied, 'an anonymous caller can spend generations directly';
end $$;

reset role;

-- What deleting an account actually removes. The four public tables cascade
-- from auth.users; storage.objects does not, so the uploaded CV outlives the
-- account unless the deletion path removes it from Storage explicitly. That is
-- what `deleteAccount` in src/lib/account.ts does, and this pins the database
-- half of the contract so the day Supabase changes it, this assertion says so
-- instead of the doc quietly going stale.
--
-- Scoped to Alice rather than counted over the table, for the reason the
-- trigger assertion gives.
do $$
begin
  delete from auth.users where id = '11111111-1111-1111-1111-111111111111';

  assert (select count(*) from public.users
           where id = '11111111-1111-1111-1111-111111111111') = 0,
    'the account row survived deletion';
  assert (select count(*) from public.profiles
           where user_id = '11111111-1111-1111-1111-111111111111') = 0,
    'the profile survived deletion';
  assert (select count(*) from public.api_keys
           where user_id = '11111111-1111-1111-1111-111111111111') = 0,
    'the encrypted key survived deletion';
  assert (select count(*) from public.applications
           where user_id = '11111111-1111-1111-1111-111111111111') = 0,
    'the applications survived deletion';
  assert (select count(*) from public.usage_counters
           where user_id = '11111111-1111-1111-1111-111111111111') = 0,
    'the usage counter survived deletion';

  assert (select count(*) from storage.objects where name like '11111111%') = 1,
    'storage now cascades from auth.users; docs/security.md and the account-deletion path can be simplified';
end $$;

do $$
begin
  raise notice 'RLS: every assertion passed';
end $$;

rollback;
