# Slice 21 — merging the fork: four branches, one main

## Start here (this runs in a fresh session)

Nothing from any prior slice session carries over. Read this section first.

**The one fact that matters more than anything else in this file:** `main` has
not moved since PR #11 (`c4fc462`, slice 13). Four branches forked from that
same commit, independently, and none of them has merged since:

| PR | Branch | Base | CI | What it is |
| --- | --- | --- | --- | --- |
| #12 | `slice-15-16-provider-fetch-and-applications` | `main` | `rls` **failing** | `openai_compatible` provider UI, posting-URL fetch, company research, the Applications list screen (SLICE-15 + the deferred screen 4) |
| #13 | `slice-17-legal` | `slice-15-16-...` (stacked on #12) | `rls` **failing** | Privacy and terms pages (SLICE-17) |
| #14 | `slice-18-motion-polish` | `main` | clean | Onboarding step-transition motion (SLICE-18) |
| #15 | `slice-19-voice-calibration` | `main` | now green (see below) | Voice calibration (SLICE-19) + the SLICE-20 design system rework (dark stage, one-primary rule, honest waiting state, the reveal, the text motif) |

Every one of these is finished, working code on its own branch — this slice is
**not** "build the Applications list" or "build the legal pages," both of
those already exist. This slice is integration: four divergent histories of
the same core files need to become one `main`. Skipping this and building
more features on a fifth branch only makes the eventual merge worse.

**Read:** this file, `gh pr view 12/13/14/15` for the current state (numbers
may have shifted — check `gh pr list` first), and the diff of each PR
(`gh pr diff <n> --name-only` at minimum) before touching anything. Do not
assume the file lists below are still accurate; branches move.

## Why this happened (context, not blame — CLAUDE.md is blameless on purpose)

CLAUDE.md section 6 calls for trunk-based flow, small PRs, merged often, one
task in progress. That discipline held through slice 13. After it, four
independent sessions each branched from the same commit and each ran a full
slice to completion without any of them landing first — SLICE-15/16 and
Applications (#12), legal (#13, stacked on #12 rather than main), motion
polish (#14), and voice calibration + the SLICE-20 design pass (#15, this
branch). The result is a real WIP violation: four full slices of unlanded
work sitting in parallel instead of one at a time. The fix is not process
commentary, it's landing them — carefully, one at a time, oldest first.

## The known blocker: a real constraint bug, not a flaky test

Both #12 and #13 fail the `rls` CI job with the same root cause (`rls.sql`
runs before `#13`'s own tests in that job, so `#13` inherits `#12`'s failure
by being stacked on it):

```
ERROR:  new row for relation "api_keys" violates check constraint
"api_keys_model_matches_provider"
DETAIL:  Failing row contains (..., openai_compatible, v1.aaa.bbb.ccc, ...,
https://integrate.api.nvidia.com/v1, null).
```

`supabase/tests/rls.sql`'s own fixture sets `provider = 'openai_compatible'`
and `base_url` without a `model`, and the migration's check constraint
(`20260801120000_provider_model.sql`) requires one whenever the provider is
`openai_compatible` — the same requirement SLICE-15 decision 3 states in
prose ("this is the one provider where the account form, not a constant,
supplies the model"). The constraint is doing exactly its job; the test
fixture just predates it. **Fix the fixture, not the constraint** — find
the exact statement in `rls.sql` that sets this row and add the missing
`model` column, then confirm the constraint still rejects a genuinely
model-less `openai_compatible` row (a second, deliberately-failing fixture
case, if `rls.sql` doesn't already assert both directions). This is a
one-line diagnosis away from being a one-line fix; do not touch the
constraint itself without first confirming the fixture is the actual bug.

## Decisions taken (say so if any is wrong)

1. **Merge order: #12, then #13, then #14, then rebase #15 last.** #12 is the
   largest and most foundational (it's what #13 is already stacked on); #14
   is small, independent, and already CI-clean, so it costs nothing to land
   third; #15 carries the widest diff (2,584 additions, the SLICE-20 design
   rework touches nearly every screen) and will have the most conflicts
   against the other three, so it goes last, once the target it's rebasing
   onto is stable.
2. **Fix #12's `rls` failure on its own branch before merging it**, not as a
   follow-up commit on `main`. A red CI check merging to `main` is exactly
   what CLAUDE.md section 6 calls the top priority to avoid — "broken build
   is the top priority, fix before new work."
3. **No new features in this slice.** Every merge conflict gets resolved by
   keeping both sides' intent (SLICE-20's dark-stage/one-primary rules
   applied to whatever new UI #12 and #14 introduce, not by picking one
   branch's version wholesale and discarding the other's work). If a
   conflict can't be resolved that way — the two branches made genuinely
   incompatible design decisions about the same screen — stop and say so
   rather than silently choosing one.
4. **Rebase #15 onto the new `main`, don't merge `main` into #15.** Keeps
   the branch's own history linear and matches how every prior slice in
   this repo has landed (a rebase-then-merge PR, per the git log). Expect
   real conflicts, not just line-noise ones, in the files listed below —
   budget time for them; do not resolve a conflict by guessing which side
   "wins" without reading both.

## Files (known overlap between the four branches, from `gh pr diff --name-only`)

| File | Touched by |
| --- | --- |
| `messages/en.json`, `messages/es.json` | #12, #13, #15 — three-way conflict on nearly every key range |
| `src/app/[locale]/apply/ApplyForm.tsx`, `apply.module.css` | #12 (Applications list linkage, research toggle), #15 (dark stage, reveal restructure) |
| `src/app/[locale]/cv/CvUpload.tsx` | #12, #15 |
| `src/app/[locale]/account/page.tsx` | #12 (Applications link, KeyCard changes), #15 (danger button variant, section heading sizes) |
| `src/app/[locale]/layout.tsx` | #13 (Footer wiring), #15 (Fraunces `SOFT` axis) |
| `src/ui/Header.tsx` | #12 (Applications nav link — SLICE-13's own header comment already names this as owed), #15 (dark variant may or may not have landed here — check) |
| `src/ui/FitScore.tsx` | #12 (Applications list reuse — the component's own comment already anticipates this), #15 (the loud dark-stage reveal styling) |
| `src/app/api/cv/route.ts`, `route.test.ts` | #12, #15 (SSE detail payload) |
| `src/app/api/generate/route.ts`, `route.test.ts` | #12, #15 (motif payload) |
| `src/ui/Steps.module.css` | #14, #15 (both restyle it — #15's rewrite to a vertical dark-ground list is the larger change) |
| `vitest.config.ts`, `vitest.setup.ts` | #12 only, should be a clean pickup |

Anything not listed here is presumed branch-local; verify rather than assume
once the actual diffs are in front of you.

## Verification

- After **each** merge step (not just at the end): `typecheck`, `lint`,
  `format:check` (LF-normalized per the CRLF caveat every slice since 13 has
  carried — verify changed files with
  `sed 's/\r$//' | npx prettier --stdin-filepath <path> --check` before
  trusting a local flag), `test`, and both CI jobs (`ci`, `rls`) green on
  GitHub, not just locally.
- The `rls` fixture fix verified against real Postgres before trusting it
  (`docker exec -i supabase_db_aplica psql -v ON_ERROR_STOP=1 -U postgres -d
  postgres < supabase/tests/rls.sql`), same discipline as every migration
  change since slice 6.
- Once #15 is rebased: a full manual pass through `/apply`, `/cv`,
  `/account`, and the new `/applications` and `/privacy`/`/terms` screens in
  a real browser, since this is the first time SLICE-20's dark-stage rework
  and the Applications-list/legal work exist in the same tree — neither was
  ever visually verified against the other.
- `avoid-ai-design` detect mode on any file whose merge resolution touched
  visible markup or CSS, not just files this slice originated.

## Definition of done

One `main` branch carries all four branches' work: the Applications list,
`openai_compatible` + posting-URL fetch, the legal pages, the onboarding
motion polish, the voice calibration, and the SLICE-20 presence rework — CI
green on `main` itself, not just on the feature branches. No PR left open
from this reconciliation. This is the actual gate on PROJECT.md section 10's
launch readiness (section 11): every item that section lists as
non-negotiable already has working code sitting on a branch; none of it is
live until this slice lands it.
