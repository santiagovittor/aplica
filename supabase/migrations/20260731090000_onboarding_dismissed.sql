-- Whether onboarding has been shown all the way through, so the post-auth
-- redirect (SLICE-12 decision 5) stops sending an account back into it.
--
-- Not "onboarding complete": a user can dismiss it having skipped the key and
-- the CV step, and this column does not pretend otherwise. What is actually
-- missing (name, key, CV) stays honestly visible on /account and in the
-- generation route's own refusals, per SLICE-12's just-in-time answer to its
-- own "blocked on you" question 2 -- a skip that reasserts itself every
-- sign-in is not a skip, and it fights the product's own progressive-profiling
-- principle (PROJECT.md section 5b).
--
-- Existing rows are backfilled to true: they predate onboarding entirely, and
-- are not "fresh" accounts that should suddenly be walked through it.

alter table public.users
  add column onboarding_dismissed boolean not null default false;

update public.users set onboarding_dismissed = true;

comment on column public.users.onboarding_dismissed is
  'True once the account has reached the end of the onboarding flow (finished or skipped through), so the post-auth redirect stops sending it back. Not a claim that language/key/CV are all set -- see users.display_name, api_keys, and profiles for what is actually on file.';
