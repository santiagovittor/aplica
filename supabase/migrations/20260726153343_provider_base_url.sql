-- The provider layer gains a fourth kind: any OpenAI-shaped endpoint the user
-- points us at (NVIDIA NIM, Ollama, OpenRouter, vLLM). PROJECT.md sections 3
-- and 5. One adapter serves all of them, so the only new state is where to send
-- the request.
--
-- base_url is null for the three named providers and required for
-- openai_compatible. SQL can enforce that pairing and nothing more: it cannot
-- resolve a hostname, so the SSRF rules in PROJECT.md section 6 are enforced in
-- TypeScript before the URL is ever fetched. See src/core/url-guard.ts.

alter table public.api_keys
  drop constraint api_keys_provider_check;

alter table public.api_keys
  add constraint api_keys_provider_check
  check (provider in ('anthropic', 'openai', 'google', 'openai_compatible'));

alter table public.api_keys
  add column base_url text;

-- Equality between two booleans is the whole rule: exactly one provider carries
-- a base URL, and it must carry one.
alter table public.api_keys
  add constraint api_keys_base_url_matches_provider
  check ((provider = 'openai_compatible') = (base_url is not null));

comment on column public.api_keys.base_url is
  'Only for provider = openai_compatible. https origin plus path, SSRF-checked server-side before every request. See src/core/url-guard.ts.';
