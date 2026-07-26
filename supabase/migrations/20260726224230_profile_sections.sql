-- The profile gained education, certifications and languages. All three are in
-- every CV and none of them had anywhere to live, so a resume rendered from the
-- profile could not have an Education section at all.
--
-- Nothing structural changes: `profiles.data` is jsonb and deliberately
-- unconstrained. Only the comment naming the top-level keys goes stale, and a
-- wrong comment on the one column whose shape lives outside SQL is worse than
-- none.
comment on column public.profiles.data is
  'Source-tagged profile, validated by profileSchema in src/core/profile.ts before it is written. Top-level keys: voiceAnchors, experience, projects, skills, starStories, education, certifications, languages, keywordBank, gaps. Every entry that carries a source carries exactly "extracted" in v1 (PROJECT.md section 5b); the schema rejects any other value rather than leaving a later step to filter it.';
