-- Aplica initial schema: accounts, CV profiles, encrypted provider keys,
-- applications, and the generation rate-limit counter.
--
-- Every table has row-level security on. Where a table has no policy for an
-- action, that action is impossible for the anon and authenticated roles and is
-- reachable only by the server's secret key.
--
-- Grants are written out per table rather than inherited. Supabase no longer
-- exposes new tables to the API roles automatically (see auto_expose_new_tables
-- in config.toml), so a table with no grant is invisible even to its owner's
-- session. Nothing is granted to anon anywhere in this file.

-- Account row. One per auth user, created by the trigger at the end of this
-- file. `plan` exists so billing can arrive later (PROJECT.md section 3) without
-- a rewrite; v1 never reads it.
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  locale text not null default 'en' check (locale in ('en', 'es')),
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

grant select, update on public.users to authenticated;
grant all on public.users to service_role;

create policy "users read own row"
  on public.users for select
  to authenticated
  using (auth.uid() = id);

create policy "users update own row"
  on public.users for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- The parsed CV. One profile per user, replaced on re-parse.
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  data jsonb not null,
  cv_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.data is
  'Source-tagged profile. Shape is defined by the Zod schema in src/core, not by the database, because parse.ts still has to earn it (step 5). Intended top-level keys: facts (each with source verbatim|extracted|inferred, confidence, evidence score), keyword_bank, voice_anchors.';

comment on column public.profiles.cv_path is
  'Object path in the private cvs storage bucket, always prefixed with the owner user id.';

alter table public.profiles enable row level security;

grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;

create policy "profiles owner full access"
  on public.profiles for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The user's model API key, encrypted with AES-256-GCM before it ever reaches
-- Postgres (PROJECT.md section 6). RLS is on and there are deliberately no
-- policies, so no client role can read a row. The revoke below removes the
-- column privileges Supabase grants by default, so this is shut at both the row
-- and the column level rather than resting on RLS alone.
create table public.api_keys (
  user_id uuid primary key references public.users (id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai', 'google')),
  ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.api_keys.ciphertext is
  'Packed v1.<iv>.<tag>.<ciphertext>, base64url. Never leaves the server. See src/core/crypto.ts.';

alter table public.api_keys enable row level security;

grant all on public.api_keys to service_role;
-- Belt and braces: nothing was granted above, and this removes anything a
-- future default-privilege change might hand out.
revoke all on public.api_keys from anon, authenticated;

-- One row per generated application. Written by the server, so there is no
-- insert or update policy: a client cannot forge a fit score or a file link.
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  company text,
  role text,
  tier text not null check (tier in ('basic', 'standard', 'full')),
  fit_score smallint check (fit_score between 0 and 100),
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index applications_user_created_idx
  on public.applications (user_id, created_at desc);

alter table public.applications enable row level security;

grant select, delete on public.applications to authenticated;
grant all on public.applications to service_role;

create policy "applications read own"
  on public.applications for select
  to authenticated
  using (auth.uid() = user_id);

create policy "applications delete own"
  on public.applications for delete
  to authenticated
  using (auth.uid() = user_id);

-- Per-user generation counter, one row per user per UTC day (PROJECT.md section
-- 11). Fixed UTC window, decided here rather than at step 9. The limit itself
-- stays in TypeScript so changing it never needs a migration. The server
-- increments with:
--   insert into usage_counters (user_id, day, count)
--   values ($1, (now() at time zone 'utc')::date, 1)
--   on conflict (user_id, day) do update set count = usage_counters.count + 1
--   returning count;
create table public.usage_counters (
  user_id uuid not null references public.users (id) on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (user_id, day)
);

alter table public.usage_counters enable row level security;

grant select on public.usage_counters to authenticated;
grant all on public.usage_counters to service_role;

create policy "usage read own"
  on public.usage_counters for select
  to authenticated
  using (auth.uid() = user_id);

-- Private bucket for uploaded CVs. Objects are stored as <user_id>/<file>, and
-- the policies below are the only way in; there are no public URLs.
insert into storage.buckets (id, name, public)
values ('cvs', 'cvs', false)
on conflict (id) do nothing;

create policy "cvs owner full access"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- Give every new auth user an account row. security definer because the signing
-- user has no rights on public.users yet; the empty search_path stops any
-- shadowing of the names used below.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
