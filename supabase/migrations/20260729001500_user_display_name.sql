-- The applicant's name, which the apply pipeline requires and the profile
-- deliberately does not carry.
--
-- `profileSchema` has no name field on purpose (src/core/profile.ts): deriving a
-- name from a CV would be an invention, and the no-invention contract is the
-- product. So the name is a fact the account holds, not a fact a model produced.
--
-- Nullable, because it genuinely is unknown for an email sign-up until somebody
-- types it. The generation route refuses with its own sentence when it is null
-- rather than inventing one or failing generically.

alter table public.users
  add column display_name text;

comment on column public.users.display_name is
  'The applicant''s own name, as it goes on their documents. Never derived from the CV: profileSchema has no name field, and inventing one would break the no-invention contract. Null until the user supplies it.';

-- Seed it from the OAuth profile where the provider already told us.
--
-- Google sends `full_name` and `name` in the identity payload, so a Google user
-- never types a name we were handed at sign-up. Email sign-up sends neither, and
-- that user is asked once. `nullif(trim(...), '')` because a provider that sends
-- the key with an empty value is saying it does not know, and an empty string
-- stored here would read as an answer.
--
-- `create or replace`, so the trigger created in the init migration keeps
-- pointing at this function and no trigger is dropped or recreated.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, display_name)
  values (
    new.id,
    nullif(
      trim(
        coalesce(
          new.raw_user_meta_data ->> 'full_name',
          new.raw_user_meta_data ->> 'name',
          ''
        )
      ),
      ''
    )
  );
  return new;
end;
$$;
