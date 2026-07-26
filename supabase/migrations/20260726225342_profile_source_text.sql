-- The text the profile was parsed from, kept so grounding can be verified after
-- the fact rather than only at parse time.
--
-- PROJECT.md section 5b says only verbatim and extracted content may reach an
-- output document. Until now nothing enforced that: `source: "extracted"` was a
-- label the model wrote about itself, and a real parse produced an invented STAR
-- situation carrying that label. Checking prose against its source needs the
-- source, and re-deriving it from the stored PDF on every check would mean
-- re-running the extractor to answer a question about a row.
--
-- Nullable: profiles written before this column existed have no source text, and
-- a profile whose CV predates grounding is honest about that rather than
-- pretending to a verification that never ran.
--
-- This holds the applicant's CV text, so it is as sensitive as `data` and
-- inherits exactly the same protections, by construction rather than by
-- promise:
--   * Row-level security. The `profiles owner full access` policy from the init
--     migration is a table policy over all columns, so a new column is covered
--     the moment it exists. There are no column-level grants on this table
--     beyond the table grants already made, and nothing is granted to `anon`.
--   * Account deletion. `profiles.user_id` references `public.users` on delete
--     cascade, and `public.users.id` references `auth.users` on delete cascade,
--     so deleting the auth user removes this text with the row. Storage objects
--     are the only thing that does not cascade, which `supabase/tests/rls.sql`
--     already asserts and pins.
alter table public.profiles
  add column source_text text;

comment on column public.profiles.source_text is
  'The plain text extracted from the CV, as parsed. The evidence every claim in `data` is checked against by groundProfile in src/core/grounding.ts. Same sensitivity as `data`: covered by the same RLS policy and removed by the same account-deletion cascade.';
