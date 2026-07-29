-- The generated application itself, so the render route has something to render.
--
-- SLICE-10 decision 1 splits the pipeline in two: generation writes the row,
-- render fills in its files, and a failed render retries without re-running
-- generation. That only works if the generated documents survive the first
-- route. The row as the init migration wrote it carries `files`, `tier`,
-- `fit_score`, `company` and `role`, and none of those is the resume text, so
-- the second route had nothing to work from.
--
-- The alternative the decision rules out is handing the application back to the
-- browser and having the browser post it to the render route. That is worse
-- twice over: the server would be rendering a document body the client could
-- have edited, and a retry would depend on the client still holding it.
--
-- Nullable, because `saveApplication` has written rows since step 6 and a row
-- from before this column is a legal row that simply cannot be re-rendered.
-- `loadApplication` refuses one with its own sentence rather than rendering
-- something empty.
--
-- Shape is `applicationSchema` in `src/core/application.ts`, validated on read
-- for the same reason `profiles.data` is: the database does not constrain
-- jsonb, so the Zod schema is the only definition that exists.
alter table public.applications
  add column content jsonb;

comment on column public.applications.content is
  'The validated Application the generation route produced: fit, strengths, gaps, resume, coverLetter, flags. Shape is applicationSchema in src/core/application.ts, not enforced here. Null on rows written before the render route existed. Read by the render route so a re-render never re-spends the user''s tokens.';
