# Slice 4 — the Provider seam and the prompt port

Paste this into a fresh Claude Code session in the repo root. It is written to be
self-contained: everything below is either checked into this repo or stated here.

---

Step 4 of KICKOFF.md. Steps 1, 2 and 3 are done and committed.

## State of the repo

- Next 16.2.11 App Router, React 19.2.4, TypeScript `strict`, next-intl with
  `[locale]` prefix routing (en/es, Accept-Language detection in `src/proxy.ts`).
  Fraunces + Source Sans 3 via next/font, MotionConfig `reducedMotion="user"`.
- Step 2 built the design system: `src/ui/tokens.css`, five hand-styled base
  components in CSS Modules (Button, Card, Input, Textarea, Steps), an approved
  `/styleguide` page. All copy goes through `messages/en.json` and
  `messages/es.json`.
- Step 3 built the data floor. Local Supabase runs from `supabase/config.toml`;
  the hosted project is linked and the migration is pushed. Schema in
  `supabase/migrations/20260724223958_init.sql`:
  - `public.users` — account row, `locale`, `plan` (defaults `'free'`,
    unread in v1), trigger-created from `auth.users`.
  - `public.profiles` — `user_id` unique, `data jsonb`, `cv_path`. The JSON shape
    is deliberately undefined in SQL; a Zod schema defines it at step 5.
  - `public.api_keys` — `user_id`, `provider` (`anthropic`/`openai`/`google`),
    `ciphertext`. No grant to `anon` or `authenticated`, an explicit revoke, and
    RLS with zero policies. Only `SUPABASE_SECRET_KEY` reaches it.
  - `public.applications` — company, role, tier, fit_score, files.
  - `public.usage_counters` — `(user_id, day)` primary key, fixed UTC day. The
    limit number lives in TypeScript, not in SQL.
  - Private `cvs` storage bucket, objects under `<user_id>/`.
  - `supabase/tests/rls.sql` asserts all of the above and passes.
- `src/core/crypto.ts` — AES-256-GCM for the user's API key, packed as
  `v1.<iv>.<tag>.<ciphertext>` base64url. `encrypt(plaintext, key)`,
  `decrypt(packed, key)`, `encryptionKey()` reading `API_KEY_ENCRYPTION_KEY`.
  21 passing tests in `src/core/crypto.test.ts`, including assertions that no
  failure path leaks the plaintext or the key into `error.message` or
  `error.stack`. Read this file: it is the house style for a `core` module.
- Vitest is installed. `npm test` runs `vitest run`. No Testing Library, no
  jsdom, no Playwright yet.
- Zero Radix packages. Deferred to step 7 with the first dialog, select or
  toggle. Do not hand-roll those later.
- No Supabase client library yet (`@supabase/supabase-js`, `@supabase/ssr`), no
  auth screens, no route handlers. All step 7.
- Scripts, all clean at HEAD: `dev`, `build`, `start`, `lint`, `test`,
  `typecheck`, `format`, `format:check`.
- Commits: 25fa8f8, 942bc7e, 5005a53, b8603f5, 6353dbf, ae0c41b, 92b174a.

## Plan mode first

State the plan, get my agreement, then execute.

## Read only this

- `PROJECT.md` sections 4, 5, 5b and 7 in full. Section 7 is the port spec,
  section 5 defines the interface, 5b defines the no-invention contract.
- `CLAUDE.md` sections 2, 3, 5 (already loaded automatically).
- `src/core/crypto.ts` and `src/core/crypto.test.ts`, as the pattern to match.
- The four prompt files I paste you.

Do **not** read DESIGN.md, the styleguide, any `src/ui/` file, or the Supabase
migration. This step builds no UI and touches no database.

## Blocking: wait for my prompt files

PROJECT.md section 7 and KICKOFF step 4 both say it plainly: **do not write these
prompts from scratch.** I will paste four files from the Claude Code version:
`writing-voice`, `apply.md`, `reviewer.md`, `expand.md`.

If I have not pasted them when you reach that part of the work, stop and ask. Do
the Provider seam first, which does not depend on them.

## Build

### 1. The Provider seam (`src/providers/`)

One interface, per PROJECT.md section 5: `generate(messages, opts)`. Adapters for
Anthropic, OpenAI and Google behind it, plus a **MockProvider with deterministic
canned responses**.

Grounding you should not have to re-derive:

- CLAUDE.md section 3: dependencies point inward. `src/core/` imports nothing
  from `app`, `ui`, or a specific provider. Swapping models must not touch
  `core`.
- CLAUDE.md section 5: all tests and CI run against the MockProvider. CI never
  holds, needs, or spends a real API key. If a test needs a real key, the seam is
  broken — fix the seam, not the test.
- PROJECT.md section 3 and 4: each real adapter gets a **recommended cheap
  default model**, so a new user is never asked to pick one. Cheap is the
  requirement here, not most-capable: it is the user's own key and their own
  money.
- PROJECT.md section 5: the SSE stream at step 6 carries **progress stages**
  (draft, review, revise), not model tokens. So `generate()` can be
  request/response. Do not build token streaming for a requirement that does not
  exist. Say so explicitly in the plan so step 6 is not surprised.
- CLAUDE.md section 2: Zod at every external boundary, and model output is an
  external boundary.
- PROJECT.md section 6: the key is server-side only, never logged, never in an
  error message. `src/core/crypto.ts` already has the tests that pin that
  property for storage; the adapters need the same discipline in flight.

### 2. The prompt port (`src/prompts/`)

Four files, ported from what I paste, per PROJECT.md section 7:

| Mine                     | Becomes       | Rule                                                                            |
| ------------------------ | ------------- | ------------------------------------------------------------------------------- |
| `writing-voice`          | `voice.ts`    | anti-slop rules. Keep the banned-word list and the no-em-dash rule **verbatim** |
| `apply.md` phases 1-4, 6 | `draft.ts`    | consumes the keyword bank                                                       |
| `reviewer.md`            | `reviewer.ts` | **minus Step 1, company research** — v1 does not web-research                   |
| `expand.md`              | `parse.ts`    | **including Phase 4, the keyword bank**                                         |

The keyword bank is the point. PROJECT.md section 7 calls it "the most
differentiating piece of the port; do not drop it." `parse.ts` produces it,
`draft.ts` consumes it.

The voice profile is per-user, built from their own CV. Not hardcoded to one
person. PROJECT.md section 7, last line.

Why reviewer loses company research, so you do not reintroduce it: search-tool
support differs across providers and it spends the user's tokens. It is a v2
provider capability. PROJECT.md section 5.

### 3. Tests

Whatever proves the seam works, run against the MockProvider. At minimum: the
same call through the mock is deterministic, and every adapter satisfies the
interface. `npm test` must pass with no API key present in the environment.

## Ask me before deciding

1. **SDKs or plain `fetch`?** Three official SDKs is three permanent
   dependencies for what is one POST each (CLAUDE.md rule 7). Give me your
   recommendation and the cost of each.
2. **The recommended cheap default model per provider.** Do not name these from
   memory — check current docs, models move. Tell me what you find and what you
   would pick.
3. **Do the slop-check pure functions land now or at step 8?** CLAUDE.md
   section 5 says they are regex plus a word list, never an LLM judge. The word
   list arrives with `voice.ts` in this step. KICKOFF step 8 wires the CI gate.
   Propose, do not assume.
4. **Do the Zod output schemas for draft and parse land now or with the flows
   that consume them** (steps 5 and 6)? The prompts define the output format, so
   there is an argument either way.
5. Anything in my pasted prompt files that contradicts PROJECT.md. Ask; do not
   silently pick one.

## Do not build

- No route handlers, no SSE, no `maxDuration`. Step 6.
- No screens, no components, no copy in `messages/*.json` for this step. Step 7.
- No CV upload, no text extraction, no database writes. Step 5.
- No provider capability that v1 does not use: no web search, no tool use, no
  vision, no token streaming.
- No `plan`/billing logic. PROJECT.md section 3 keeps the column, nothing reads
  it.

## Verification I expect

Measure, do not assert. DESIGN.md section 10 now requires this and the same
standard applies to non-UI work.

- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`,
  `npm test` — all clean, output pasted.
- Proof the MockProvider path needs no key: run the suite with the provider env
  vars explicitly unset and paste it.
- Proof the port is faithful: show me the banned-word list and the em-dash rule
  in `voice.ts` next to my original, and show me where `parse.ts` produces the
  keyword bank and `draft.ts` consumes it.
- Proof company research is gone from `reviewer.ts`.
- If any adapter can put an API key into an error or a log, show me the test that
  says it cannot.

## Commit

One commit at the pause point. Every git command scoped with
`-C "C:\Users\user-1\Documents\Personal Projects\aplica"`.

This step touches the user's credential in flight, so run tight per CLAUDE.md
section 7: small diffs, every line reviewable, no improvisation.
