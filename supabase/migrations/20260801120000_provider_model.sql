-- openai_compatible has no DEFAULT_MODELS entry (only the host knows what it
-- serves, defaults.ts's own comment), so the model name has to come from the
-- user rather than a constant. SLICE-15 decision 3: persisted on the account
-- row, the same shape as base_url, because parseCv needs a model too and runs
-- at CV upload -- before the apply screen, and any per-application override,
-- ever exists in the user's journey. /apply pre-fills from this default and
-- can override it per application; this column is only ever the default.
--
-- Nullable for the three named providers, required for openai_compatible,
-- same pairing rule as base_url (20260726153343).

alter table public.api_keys
  add column model text;

alter table public.api_keys
  add constraint api_keys_model_matches_provider
  check ((provider = 'openai_compatible') = (model is not null));

comment on column public.api_keys.model is
  'Only for provider = openai_compatible. The account default; /apply can override it per application. Treated as untrusted input handed to a user-supplied host: length-capped and shape-checked in TypeScript, never interpolated into a URL. See src/lib/api-keys.ts.';
