-- Whether the onboarding voice calibration (SLICE-19, PROJECT.md section 5b's
-- "which sounds more like you?" moment) has already been shown, so it is
-- offered once and never again.
--
-- Lives on `profiles`, not `users`: calibration only ever applies to a parsed
-- CV's own voice anchors, so it belongs next to `data` and `source_text`
-- rather than beside account-level facts like `display_name`. This also means
-- a re-upload's `saveProfile` upsert (`on_conflict=user_id`,
-- `resolution=merge-duplicates`) leaves this column untouched, since that
-- payload never includes it -- a re-parsed CV does not silently reopen a
-- moment the user already answered.
--
-- Nullable, defaulting to null: unset means never offered (including every
-- row that predates this column, which is the honest reading for an account
-- that has never seen the screen).
alter table public.profiles
  add column voice_calibrated_at timestamptz;

comment on column public.profiles.voice_calibrated_at is
  'When the onboarding voice-calibration screen was answered (picked an anchor or skipped), so it is offered at most once. Null means never shown. Same RLS coverage and account-deletion cascade as every other profiles column.';
