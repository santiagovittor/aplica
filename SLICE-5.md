# Slice 5 — the CV parse flow and the profile schema

Paste this into a fresh Claude Code session in the repo root. It is written to be
self-contained: everything below is either checked into this repo or stated here.

---

Step 5 of KICKOFF.md. Steps 1, 2, 3 and 4 are done and committed.

## State of the repo

- Next 16.2.11 App Router, React 19.2.4, TypeScript `strict`, next-intl with
  `[locale]` prefix routing (en/es, Accept-Language detection in `src/proxy.ts`).
  Fraunces + Source Sans 3 via next/font, MotionConfig `reducedMotion="user"`.
- Step 2 built the design system: `src/ui/tokens.css`, five hand-styled base
  components in CSS Modules (Button, Card, Input, Textarea, Steps), an approved
  `/styleguide` page. All copy goes through `messages/en.json` and
  `messages/es.json`.
- Step 3 built the data floor. Local Supabase runs from `supabase/config.toml`.
  Three migrations, all applied **locally and on hosted**, verified by
  `supabase migration list` (local == remote on all three) and by
  `supabase db diff --linked` reporting no drift on `public`, `storage` and
  `auth`:
  - `20260724223958_init.sql` — `users`, `profiles`, `api_keys`,
    `applications`, `usage_counters`, and the private `cvs` storage bucket.
  - `20260726153343_provider_base_url.sql` — widens the `api_keys.provider`
    check to include `openai_compatible` and adds a nullable `base_url`.
  - `20260726184046_cvs_bucket_private.sql` — forces `storage.buckets.public`
    to false for `cvs`. The init migration's `on conflict (id) do nothing`
    asserted nothing, so a pre-existing public bucket would have stayed public.
  `supabase/tests/rls.sql` asserts isolation, both provider constraints, and
  that the bucket is private, and passes.

  Known cosmetic noise: `supabase db push` prints a
  `failed to cache migrations catalog` warning about a missing
  `pgdelta-target-ca.crt` on the first push after a `supabase db reset`, because
  the reset wipes `supabase/.temp/pgdelta/`. It is a local caching artefact of
  CLI 2.109.1, never touches the migration apply, and a second push is silent.
  Do not chase it.
- Step 4 built the model layer:
  - `src/providers/` — one `Provider` interface (`generate(messages, opts)`,
    request/response, no token streaming) with adapters for Anthropic, OpenAI,
    Google and `openai_compatible`, plus a **MockProvider** that every test uses.
    `createProvider(config)` takes the key as an argument and never reads the
    environment. `Provider.supportsSearch` is derived from `SEARCH_MODELS`.
    Plain `fetch`, Zod on every response, `ProviderError` carries provider and
    status and never the response body.
  - `src/core/url-guard.ts` — the SSRF guard for a user-supplied `base_url`.
  - `src/core/slop.ts` — `BANNED_WORDS_EN`, `BANNED_WORDS_ES`,
    `findEmDashes`, `findBannedWords`, `isSlopFree`. Pure functions, no LLM.
  - `src/prompts/` — `voice.ts`, `parse.ts`, `draft.ts`, `reviewer.ts`, ported
    from the Claude Code originals and generalised off one person.
- 276 tests across 5 files. `npm test` passes with every provider environment
  variable unset. Scripts all clean: `dev`, `build`, `start`, `lint`, `test`,
  `typecheck`, `format`, `format:check`.
- Dependencies: `next`, `react`, `react-dom`, `next-intl`, `motion`, `zod`. That
  is the whole runtime list. No Supabase client library yet, no auth screens, no
  route handlers, no PDF or DOCX library.
- Commits: 81e06d8, ecb5ecb, 9635acd, 83a88a5, ad3fdc4, 1a1a4b8, 5f67740.

## Plan mode first

State the plan, get my agreement, then execute.

## Read only this

- `PROJECT.md` sections 3, 5 (flow 1 only), 5b and 11. Section 5b is the
  no-invention contract and the evidence-score rule; it is the spec for this
  step more than anything else.
- `CLAUDE.md` sections 2, 3, 5 (already loaded automatically).
- `src/prompts/parse.ts` in full. It already defines the output contract in a
  fenced JSON block. **Transcribe the Zod schema from that block; do not
  re-derive a shape from prose.**
- `src/providers/types.ts` and `src/providers/index.ts` — the seam you call
  through and the MockProvider you test against.
- `src/core/crypto.ts` and `src/core/crypto.test.ts` — the house style for a
  `core` module, and how the user's key gets decrypted before a provider call.
- `supabase/migrations/20260724223958_init.sql`, the `profiles` table and the
  `cvs` bucket only.

Do **not** read DESIGN.md, the styleguide, any `src/ui/` file, `draft.ts` or
`reviewer.ts`. This step builds no UI and does not touch the apply pipeline.

## Build

The flow, end to end: **an uploaded CV file -> extracted text -> one provider
call using `parse.ts` -> a validated, source-tagged profile with its keyword
bank -> stored as `profiles.data` with the file in the `cvs` bucket.**

### 1. The profile schema (`src/core/profile.ts`)

Zod, transcribed from the fenced block in `parse.ts`. This is the first time the
profile shape is defined anywhere in TypeScript; `profiles.data` is `jsonb` and
the database deliberately does not constrain it.

Model output is an external boundary (CLAUDE.md section 2), so a parse that does
not validate is a failed parse, not a warning. Grounding you should not have to
re-derive:

- PROJECT.md section 5b: every fact carries a source (`verbatim`, `extracted`,
  `inferred`) and only `verbatim` and `extracted` may reach an output document.
  In v1 the CV is the only input, so `parse.ts` is instructed to emit
  `extracted` and nothing else. The schema should make an unexpected value a
  validation failure rather than something a later step has to filter.
- PROJECT.md section 5b: each bullet carries an evidence score, and vague ones
  are flagged as low signal rather than beautified.
- The keyword bank is the differentiating piece. `parse.ts` produces it as
  `keywordBank`; step 6's `draft.ts` consumes it by that name.

### 2. Text extraction

PDF and DOCX in, plain text out, framework-free and unit-testable. This needs a
dependency; see the questions below before adding one.

The unhappy path is the point here, not the happy one. A CV can be a scanned
image with no text layer, a password-protected PDF, a corrupt file, an
enormous file, or a file whose extension lies about its contents. Every one of
those has to fail with a message a person can act on.

### 3. The parse runner

Composes the pieces: text in, `parsePrompt` as the system prompt, one
`provider.generate` call, Zod on the way out, profile returned. Framework-free
so it can be tested against the MockProvider with no network and no key.

### 4. Storage

Write the profile to `profiles.data` and the original file to the `cvs` bucket
under `<user_id>/`, setting `profiles.cv_path`. One profile per user, replaced on
re-parse (the table has a unique constraint on `user_id`).

Only `SUPABASE_SECRET_KEY` can reach these rows server-side. The bucket is
private and there are no public URLs.

### 5. The proof

KICKOFF step 5 says: **show me the parsed profile for my own CV.** So there has
to be a way to run the real thing against a real file with a real key, outside
the test suite, without a UI existing yet. Propose the smallest thing that does
that.

## Ask me before deciding

1. **The `profiles.data` shape conflicts with itself.** The step-3 migration
   comment says the intended top-level keys are `facts` (each with source,
   confidence, evidence), `keyword_bank`, `voice_anchors`. The step-4
   `parse.ts` prompt actually emits `voiceAnchors`, `experience`, `projects`,
   `skills`, `starStories`, `keywordBank`, `gaps`. These are different shapes and
   different casing conventions. Tell me which wins before you write the schema,
   and update whichever of the two is wrong so they agree.
2. **PDF and DOCX extraction: which dependency, and can either be avoided?**
   CLAUDE.md rule 7 says every package is permanent uncontrolled code. Give me
   the real options with their costs, including whether one library covers both
   and whether a provider that accepts a PDF directly would let us skip text
   extraction for that path entirely. Do not add anything before I answer.
3. **Supabase client now, or keep this step storage-agnostic?** SLICE-4 recorded
   the client libraries as step 7 work, alongside auth. Either this step adds
   `@supabase/supabase-js` for a server-side write, or it defines a narrow
   storage interface and step 7 implements it. Recommend one and say what it
   costs the other way.
4. **A CV with no text layer.** A scanned PDF extracts to nothing. Options: fail
   loudly and tell the person to upload a text PDF, or send the file to a
   vision-capable model, or OCR. PROJECT.md v1 scope does not mention OCR and the
   Provider interface has no vision capability. Confirm: fail loudly in v1?
5. **Does a parse count against the daily limit?** `usage_counters` exists with a
   fixed UTC day and the limit lives in TypeScript. Parse is once per user, apply
   is repeated. Say whether parse increments it.
6. Anything in the parsed profile for my CV that looks wrong, thin, or invented.
   Show me the profile before you call the step done.

## Carried over from step 4, still open

These are not step 5's job. Do not start them, but do not let them get lost:

- **OpenAI cannot do company research.** Its `web_search` tool runs on the
  Responses API; our adapter speaks `/chat/completions` because that is what the
  OpenAI-compatible hosts speak. `supportsSearch` is `false` for OpenAI with the
  reason recorded in `openai.ts`. The fix is a second request shape in that
  adapter, and it is a scope decision I have not made.
- **Anthropic's search model is `claude-opus-5`,** because Anthropic's docs never
  enumerate which models support web search and every example uses that one.
  Haiku 4.5 is unconfirmed rather than unsupported. The Models API returns a
  `capabilities` object per model and would settle it in one call, which needs a
  live key. If you have a key in hand during this step, that check is cheap and
  worth about 5x on the reviewer call.
- **The Spanish banned-word list has known collisions** documented in
  `src/core/slop.test.ts`: `dinámica` as a noun, `panorama` in ordinary register,
  and `potencia` / `impulso` / `desbloqueo` colliding with conjugations. I am
  curating the list; nobody removes an entry without me.

## Do not build

- No screens, no upload UI, no auth, no copy in `messages/*.json`. Step 7.
- No apply pipeline, no reviewer call, no SSE, no `maxDuration`. Step 6.
- No PDF or DOCX **generation**. That is the render half of step 6.
- No OCR, no vision, no re-parse merge. v1 replaces the profile wholesale.
- No changes to `src/providers/` or `src/prompts/` beyond consuming them. If
  this step needs the seam to change, stop and say so first.
- No new provider capability, and no touching the SSRF guard.

## Verification I expect

Measure, do not assert. Same bar as step 4.

- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`,
  `npm test` — all clean, output pasted.
- The suite passes with every provider environment variable explicitly unset,
  output pasted. CI holds no key.
- **The parsed profile for my real CV, printed in full**, plus: the count of
  entries in `keywordBank`, and for three of them the profile line that proves
  the mapping.
- Proof that every entry carries `source: "extracted"`, and that a fixture whose
  model output claims `verbatim` or `inferred` is rejected by the schema rather
  than filtered later.
- Proof a thin CV degrades honestly: gaps reported, `voiceAnchors` empty rather
  than invented, no fabricated employer detail.
- Proof each unhappy path in the extractor fails with a usable message: no text
  layer, wrong file type, corrupt file.
- If a migration is added, `supabase db reset` plus `supabase/tests/rls.sql`
  green, output pasted, and the migration shown before it is applied to hosted.

## Commit

One commit per coherent piece, at the pause points. Every git command scoped with
`-C "C:\Users\user-1\Documents\Personal Projects\aplica"`.

This step stores the user's CV and everything derived from it, so run tight per
CLAUDE.md section 7: small diffs, every line reviewable, no improvisation. The
profile is the thing every later step draws from, and a shape decided carelessly
here is a rewrite at steps 6 and 7.
