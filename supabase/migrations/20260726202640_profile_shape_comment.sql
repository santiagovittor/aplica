-- The init migration guessed at the profile shape before `parse.ts` existed and
-- named keys that were never built: `facts`, `keyword_bank`, `voice_anchors`.
-- What `src/prompts/parse.ts` actually emits is seven camelCase keys, and step 6
-- consumes `keywordBank` by that name. The comment is documentation, not a
-- constraint, but a wrong comment on the one column whose shape lives outside
-- SQL is worse than none: it is the first thing anyone reads.
--
-- `init.sql` is already applied locally and on hosted, so this corrects the
-- comment in a new migration rather than by editing an applied file.
comment on column public.profiles.data is
  'Source-tagged profile, validated by profileSchema in src/core/profile.ts before it is written. Top-level keys: voiceAnchors, experience, projects, skills, starStories, keywordBank, gaps. Every entry that carries a source carries exactly "extracted" in v1 (PROJECT.md section 5b); the schema rejects any other value rather than leaving a later step to filter it.';
