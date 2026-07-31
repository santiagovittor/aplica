# Slice 13 — Apply, the screen the whole product has been pointing at

## Start here (this runs in a fresh session)

Nothing from the slice 12 session carries over. Read this section first.

**Read:** this file, `PROJECT.md` sections 5, 5b, 8, and 9, **`DESIGN.md` in
full** (this slice is a screen, and its checklist runs at the end of it), and
the modules being touched: `src/app/api/generate/route.ts`,
`src/app/api/render/route.ts`, `src/core/apply.ts`, `src/core/application.ts`,
`src/render/index.ts`, `src/providers/defaults.ts`, `src/app/[locale]/cv/`
(the phase-machine pattern this slice reuses), `src/app/[locale]/account/`,
`messages/en.json`'s existing `Apply` namespace. **Do not** read SLICE-4
through SLICE-11, and do not load the repo wholesale.

**Repo state.** As of writing, `main` carries slice 11 (PR #8). Slice 12
(onboarding) is open as PR #9 on branch `slice-12-onboarding`, not yet
merged — **check `gh pr view 9` first**; if it landed, branch slice 13 off
`main`, otherwise branch off `slice-12-onboarding` and rebase onto `main`
once #9 merges, same as any other stacked PR. CI (`.github/workflows/ci.yml`)
runs `ci` and `rls`, neither holding a secret. The suite was 686 tests in 23
files at the end of slice 12; expect more. Work on a branch and open a PR;
that is how every slice so far has landed.

**The single most load-bearing fact for this slice:** the entire backend is
already built and was never exercised by any screen. `src/app/api/generate/route.ts`
and `src/app/api/render/route.ts` are complete, tested (`route.test.ts` next
to each), and have been sitting there since slice 10 — full SSE staging
(`draft` / `review` / `revise` / `saving`), tier support, EN/ES output
language, the research toggle, rate limiting via `spendGeneration`, and the
exact `key_missing` / `name_missing` / `profile_missing` / `provider_*`
refusal codes that `messages/en.json`'s `Apply` namespace already has
sentences for. `src/app/[locale]/page.tsx` is still the scaffold placeholder
from the very first KICKOFF step ("The shell is running…"). **No screen
anywhere calls either route.** This slice is almost entirely UI, wired to
machinery that already works — the same shape slice 11 had with the CV route,
and slice 12 had with `KeyCard`/`CvUpload`.

**Environment notes carried forward, hard-won across slices 10-12 and worth
not rediscovering:**

- **Node 20 needs `NODE_OPTIONS=--experimental-websocket`** for anything that
  constructs a Supabase client — tests, dev scripts, ad hoc verification. A
  second Node was installed via `nvm` at
  `C:\Users\user-1\AppData\Local\nvm\v24.18.1\node.exe` as of slice 11 and
  should still be there for `scripts/parse-cv.mts`, which needs
  `--experimental-transform-types` (not on Node 20 at all). Invoke it by full
  path; do not switch the active `nvm` version (it broke system-wide
  `node`/`npm` resolution once already — see slice 11's own notes if it
  happens again, the fix is `New-Item -ItemType Junction` on
  `C:\nvm4w\nodejs`).
- **`format:check` on this machine flags nearly every file in the repo** —
  CRLF checkout vs. Prettier's LF default, not real formatting issues. Verify
  changed files by piping them through `sed 's/\r$//' | npx prettier
  --stdin-filepath <path> --check`; anything that still flags after that is a
  real issue, fix it with `prettier --write` and re-typecheck/lint (Prettier's
  own rewrite can touch semantics-adjacent formatting, so treat it as a code
  change, not a no-op).
- **Resolved this session, and it reconciles slices 11 and 12's conflicting
  notes: hydration does complete, but the first interaction attempt right
  after a fresh navigation can race it and silently no-op.** Checking
  `__reactFiber$...` immediately after `navigate` can read as "not
  hydrated," and a click thrown at the same moment can land with no visible
  effect and no error — `get_page_text` right after even shows stale
  content. Both a property check and a real click, retried a couple of
  seconds later on the same element, then succeed and show the fiber
  present. Slice 11's "never completes hydration" was almost certainly this
  same race read as a permanent failure. **The fix is procedural, not
  environmental:** after any `navigate`, wait (or poll) before the first
  interaction or hydration check on that page; do not conclude "broken" from
  one immediate read. This is the single most expensive-to-get-wrong finding
  from slice 12 given how client-heavy this screen is — verify it still
  holds at the start of this slice rather than trusting this paragraph.
- `npx supabase start --ignore-health-check` for local Supabase (API
  `:54321`, Studio `:54323`, Mailpit `:54324`); apply migrations with
  `npx supabase migration up --local`, never `db push`. Test a migration
  against real Postgres before trusting it:
  `docker exec -i supabase_db_aplica psql -v ON_ERROR_STOP=1 -U postgres -d
  postgres < supabase/tests/rls.sql`.
- Docker Desktop is not always already running in this sandbox; if
  `docker info` fails to connect, launch
  `"/c/Program Files/Docker/Docker/Docker Desktop.exe"` and poll
  `docker info` until it answers before touching Supabase.
- No local test accounts persist between sandbox sessions. Sign up fresh
  ones the documented way: `POST /auth/v1/signup`, read the confirmation
  link out of Mailpit's API (`GET :54324/api/v1/messages`, then
  `GET :54324/api/v1/message/<id>` for the full body — the list endpoint
  truncates the link), follow it, then either drive the real UI signed in
  through that session, or for a scripted check,
  `POST /auth/v1/token?grant_type=password` and feed the tokens to
  `createServerClient` from `@supabase/ssr` with a capturing `setAll` to get
  the `sb-127-auth-token` cookie value.
- **This slice needs a real, working provider key to verify anything past
  the empty state.** Slices 10-12 ran with no provider key available in the
  sandbox at all (slice 12's own key-step verification only ever exercised
  the rejection path). If this session has no key either, say so plainly in
  the PR rather than claiming the generate/render pipeline was verified —
  the route-level tests already prove the code paths against the
  `MockProvider`; only a real run proves wall-clock time, real token spend,
  and that a real model's output survives the slop/grounding gates.
- The CV to test with, if this session has access to it:
  `CV_Santiago_Vittor_EN.pdf`, 71,495 bytes, one page. Ask rather than assume
  its filesystem path carried over.

## Context

PROJECT.md's one-line pitch is "paste a job posting, get a resume and cover
letter tailored to it." Every slice through 12 has built toward that without
ever letting anyone reach it: auth (9), the apply *pipeline* as two backend
routes (10), CV upload (11), and the front door that gets a fresh account
signed in with a key and a profile (12). Nobody who finishes onboarding today
has anywhere to go — `/account` and `/cv` are the only two screens, and
neither pastes a job posting. This slice is the payoff.

PROJECT.md section 9, screen 3, describes it exactly: "CV chip, EN/ES toggle,
paste box, three tier cards (Basic = CV PDF, Standard = CV + cover letter,
Full = both as PDF + DOCX), one primary button... After generate: the calm
progress sequence, then a result card with fit score, a preview, honest
flags, and downloads." `render/index.ts`'s own `TIER_FILES` map is that same
tier table, already implemented — the UI is describing what the backend
already does, not inventing a new contract.

## Decisions taken (say so if any is wrong)

1. **`/[locale]/apply`, one screen, not a wizard.** Reuses the exact
   phase-machine `CvUpload` proved out in slice 11:
   `empty → uploading-equivalent → staged work → error | done`, all in one
   client component (`ApplyForm.tsx`) driven by `/api/generate`'s SSE
   events. The stages map directly: `draft` / `review` / `revise` are the
   three model calls, `saving` is the row write — identical shape to the CV
   route's `reading` / `parsing` / `checking` / `saving`. Same `Steps`
   component, same discipline.
2. **Missing key, name, or CV is not a gate on the screen itself.** The
   paste box, tier cards, and button render unconditionally. Hitting
   "generate" without one of the three surfaces the exact `key_missing` /
   `name_missing` / `profile_missing` sentence the route already returns —
   the same just-in-time stance slice 12 landed on for onboarding
   (`/onboarding/[step]`'s own skip paths, and the "finish onboarding" link
   rather than a forced redirect). A user who wants to read the screen
   before setting anything up gets to.
3. **Generate auto-triggers render only on a favourable verdict — corrected
   per review.** `applicationSchema.recommendation` (`src/core/application.ts`)
   is a clean two-value enum, `z.enum(['apply', 'skip'])`, so there is no
   threshold to invent: the model itself already says which case this is.
   `done`'s SSE payload from `/api/generate` carries `recommendation`
   directly. So: `recommendation === 'apply'` fires `/api/render`
   automatically with the returned `applicationId`, same as originally
   proposed. `recommendation === 'skip'` shows the fit score, the reason,
   and the honest flags first, with the download as an explicit button the
   user clicks if they still want the files — never auto-spent. This is
   PROJECT.md section 2's own second differentiator, "it will tell you to
   skip a bad-fit role," made real rather than a formality: auto-rendering a
   `skip` would spend tokens producing documents the product just said not
   to send. Section 10's five-minute promise still holds either way — the
   reveal is immediate, and the download is one click, automatic or not.
4. **The research toggle is real, not deferred.** PROJECT.md section 5 calls
   it v1: "a visible toggle with an honest cost line... defaulting to on
   where it is available." It only appears when the account's saved
   provider is in `SEARCH_MODELS` (`anthropic`, `google` today — `openai`
   is architecturally absent, per that file's own comment). The cost line is
   a real, verified number as of this writing, not a vague warning or a
   number carried from a code comment: **Anthropic, $10 per 1,000 searches**
   (`platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool`,
   confirmed directly, matches `providers/defaults.ts`'s existing comment).
   **Google (`gemini-3.5-flash-lite`, the `SEARCH_MODELS` entry), $14 per
   1,000 requests, with 5,000 free requests per month shared across the
   whole Gemini 3.x family** (`ai.google.dev/gemini-api/docs/pricing`,
   confirmed directly — this number is not currently anywhere in the
   codebase; add it to `providers/defaults.ts`'s `SEARCH_MODELS` comment
   alongside the Anthropic figure while building this, not just in the UI
   copy). Re-verify both at build time regardless of the numbers printed
   here; prices move.
5. **No company/role fields this slice.** The `applications` row has columns
   for both and `/api/generate` already accepts them, but nothing displays
   them yet — the Applications list is screen 4, not this one. Asking for
   two fields with nowhere for the answer to show yet is premature; add them
   when the list screen that reads them exists.
6. **The Tufte fit-score display (DESIGN.md section 7) is a shared
   component**, `src/ui/FitScore.tsx`, not apply-specific markup: a large
   tabular number, one thin hairline bar, one-line verdict, honest flags as
   plain text — because the Applications list (next slice) needs the exact
   same display for every row in the list, and building it twice is the
   wrong abstraction slice 12's own retro would flag.
7. **A minimal shared header, this slice.** Every screen so far —
   `/account`, `/cv`, `/onboarding/*` — is a standalone `<main>` reached
   only by a specific contextual link from somewhere else. With `/apply`
   landing here and `/applications` next, going without any persistent way
   between four live authenticated screens stops being restraint and starts
   being an oversight. Plain text links only (`Apply` / `Account`, joined by
   `Applications` next slice), no chrome, authenticated screens only, and it
   must not introduce a second accent — the green stays on each screen's
   one primary action, never on a nav link.
8. **Playwright, and one golden-path end-to-end test, land this slice.**
   Deferred since slice 10 as "still not installed," named in slice 12 as
   "about to get larger" — it just became the actual money path, three
   model calls and two file downloads deep, the hardest thing here to trust
   from unit tests alone. One test: paste a real posting, pick standard,
   generate, download. It lands as **its own commit after the screen itself
   is green**, so a slow or flaky test setup never holds the screen's own
   quality hostage. If the slice is running long by the time the screen is
   done, stop and say so rather than either dropping this a third time or
   quietly shipping it thin.
9. **URL fetching as a second input is deferred a sixth time — on purpose,
   and scheduled rather than just pushed again.** `src/core/url-guard.ts` is
   already written and tested for exactly this, and PROJECT.md's own screen
   3 spec calls for it, but this slice already carries SSE reuse, the
   conditional render branch, the research toggle, the fit-score component,
   the shared header, and Playwright — a new SSRF-surfaced fetch feature on
   top risks the kitchen-sink failure mode CLAUDE.md rule 9 names. Rather
   than let it slip a seventh time as an unscheduled line item, `SLICE-15.md`
   gets written at the end of this slice (see Files), covering URL fetching,
   the `openai_compatible` provider UI, and the NIM verification run
   together — the three things that have been deferred in lockstep since
   slice 9.

## Files

| File | What |
| --- | --- |
| `src/app/[locale]/apply/page.tsx` | requires a session, loads the account's provider/CV state for the chip and the research toggle's visibility, renders `ApplyForm` |
| `src/app/[locale]/apply/ApplyForm.tsx` | the phase machine: empty (paste box, EN/ES, tier cards, research toggle) → working (`Steps`, SSE-driven) → error → done (fit score, flags, downloads) |
| `src/app/[locale]/apply/apply.module.css` | this screen's layout; DESIGN.md tokens only |
| `src/app/[locale]/apply/loading.tsx` | calm paper-value placeholder, matching `cv/loading.tsx` and `account/loading.tsx` |
| `src/ui/FitScore.tsx` (+ `.module.css`) | the shared Tufte-style score display, decision 6 |
| `src/app/[locale]/account/page.tsx` | gains a link to `/apply`, the first real entry point into it |
| `messages/en.json`, `messages/es.json` | `Apply` namespace grows: screen chrome (title, lead, CV chip, tier card copy, research toggle + cost line, result labels). Stages and errors already exist from slice 10 — do not re-derive them |
| `src/lib/supabase.ts` | none expected — `startApplication`/`attachFiles` already cover this screen's writes. If the fit-score component needs a read this screen doesn't already have, name it here rather than adding it silently |
| `src/ui/Header.tsx` (+ `.module.css`), wired into `src/app/[locale]/layout.tsx` | decision 7: minimal shared nav for authenticated screens |
| `playwright.config.ts`, `e2e/apply.spec.ts` | decision 8: the first real end-to-end test, own commit after the screen is green |
| `SLICE-15.md` | written at the end of this slice (decision 9): the spec for wiring `url-guard.ts`, the `openai_compatible` provider UI, and the NIM verification run together, so that work is scheduled rather than deferred a further time |

Nothing in `src/core/`, `src/prompts/`, `src/providers/`, `src/render/`, or
either route handler should need touching — this slice is the screen around
work slice 10 already built. If something there turns out to need a change,
stop and say so before widening the diff.

## The screen(s)

DESIGN.md is binding, same as every slice since the styleguide. Specific to
this one:

- **This is the peak-end moment DESIGN.md section 6 names explicitly**: "the
  result reveal and the download moment get most of the motion and polish
  budget. A beautiful settings page with a flat reveal is a failed
  allocation." Nothing built so far has earned that budget yet — CV
  upload's own `done` state was the closest, and this is the real one.
- **The motif has two legitimate homes on this one screen**: the empty
  paste-box state (an empty state, same allowance `CvUpload` already uses)
  and the result reveal (explicitly named in DESIGN.md section 7). Do not
  invent a third use elsewhere on the screen.
- **One primary action**: the single green "generate" button. Tier
  selection is not a second accent — style selection the way `Steps`
  signals current/complete, by weight and a rule, never a second green
  control.
- **The fit score, per DESIGN.md section 7**: "a large tabular number, one
  thin hairline bar, one-line verdict. No gauge, no ring, no gradient
  meter." Honest flags are plain text with a small marker, never
  traffic-light pills.
- **Every phase designs empty, loading, and error**, same five-state bar
  `CvUpload` already cleared: empty, working (SSE), error, done — plus this
  screen's own version of "no key yet" / "no CV yet" as calm inline
  messages rather than a blocked screen, per decision 2.
- **`avoid-ai-design` in detect mode, zero P0/P1**, same bar as every
  screen since slice 11.
- **The good case is the common case, same note as the last two slices.** A
  strong fit with a clean slop/grounding pass and no flags is the outcome
  most real postings should produce, and it is the easiest one to
  under-design because the flagged, complicated case is more interesting to
  build. Design the clean `apply`-with-no-flags result explicitly — a
  confident, finished-feeling reveal — not the absence of warnings on an
  otherwise empty card. Same applies to the `skip` result: a calm, honest
  "here's why, and here's the download if you still want it" is its own
  deliberate state, not a degraded version of the good one.

## Deferred, and recorded so it does not evaporate

Carried forward, still true:

1. **Privacy and terms pages.** Still non-negotiable per PROJECT.md section
   11, still not built. Unrelated to this slice's own scope; whoever picks
   up launch readiness should not assume this slice touched it.
2. **URL fetching, `openai_compatible`, and the NIM verification run.**
   Deferred a sixth time (decision 9) — but no longer an open line item:
   `SLICE-15.md`, written at the end of this slice, is where these three
   finally get scheduled and built, together.
3. **The optional voice calibration** (PROJECT.md section 5b, `[v1,
   minimal]`), deferred from slice 12, unrelated to this slice.
4. **The Applications list** (PROJECT.md section 9, screen 4). This slice's
   `FitScore` component and the `company`/`role` question from decision 5
   are both built with that screen in mind; it is the natural slice 14 —
   ahead of `SLICE-15.md` in the numbering, so build it before URL fetching
   unless there's a reason to reorder.
5. **The landing page** (PROJECT.md section 9, screen 1, explicitly marked
   "later"). Still later — `/[locale]/page.tsx` stays the scaffold
   placeholder until its own slice.

## Verification

Measured and pasted, not asserted, same discipline as every slice since 10.

- Both CI jobs green on the branch before this is called done.
- If a real provider key is available: one real generation in each language
  (English and Spanish — the first time the slop and no-invention gates run
  on Spanish output a human actually reads end to end, closing a gap named
  in slices 11 and 12), real wall clock measured and pasted (same discipline
  `/api/generate`'s own comment already sets — "measured, not guessed"),
  through the actual screen, standard tier, ending in a downloaded PDF
  resume and cover letter that actually open. Also confirm one real `skip`
  verdict shows the reveal-then-manual-download path from decision 3, not
  just the `apply` auto-render path. If no key is available, say that
  plainly rather than claiming any of this ran.
- Every refusal path exercised for real against a signed-in account missing
  the thing in question: no key, no name, no CV — each shows its own
  sentence on the screen itself, not a redirect.
- The rate limit: exhaust the daily generation count for a test account and
  confirm the screen shows `Apply.errors.rate_limited` with the real limit
  number, not a generic failure.
- A render failure retried without a second generation call (verify by
  watching the usage counter not move on the retry).
- The research toggle: present and defaulting on for an Anthropic or Google
  key, absent for OpenAI, with the real cost line rendered, not a
  placeholder.
- DESIGN.md section 10's checklist, by measurement on the rendered page
  (computed styles, not source), same as slice 12's own discipline.
  `avoid-ai-design` detect mode, zero P0/P1.
- `typecheck`, `lint`, `format:check` (checked against LF-normalized
  content per the CRLF caveat above), `build`, `test`, and the suite with
  every provider/Supabase variable unset.

## Definition of done

A signed-in user with a key, a name, and a CV on file can paste a real job
posting, pick a tier, and land on a downloaded resume (and cover letter, and
DOCX per tier) in one sitting, with an honest fit score and honest flags on
the way — PROJECT.md section 10's five-minute promise, finally reachable by
clicking through the product rather than only provable by hitting the API
directly. A user missing a prerequisite sees exactly what is missing on the
screen itself, never a wall. Nothing here touches the model pipeline, the
render pipeline, or the CV route's own code; it is the screen the rest of
the product has been built to hand off to since slice 10.
