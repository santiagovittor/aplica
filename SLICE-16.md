# Slice 16 — the fourth screen: a quiet list of past runs

## Start here (this runs in a fresh session)

Nothing from the slice 15 session carries over. Read this section first.

**Read:** this file, `PROJECT.md` sections 5 and 9, `src/lib/supabase.ts` in
full, `src/core/application.ts`, `src/ui/FitScore.tsx`, `src/ui/Header.tsx`,
`src/app/api/files/[applicationId]/[kind]/[format]/route.ts`,
`src/app/[locale]/apply/ApplyForm.tsx` (the result reveal, for how it already
renders a `FitScore` and download links — this slice reuses both), `DESIGN.md`
section 7 (Tufte fit-score brief) and whatever section covers list/table
layout.
**Do not** read SLICE-4 through SLICE-14, and do not load the repo wholesale.

**Repo state.** As of writing, slice 15 (`openai_compatible` UI, posting-URL
fetch) is either merged to `main` or open as its own PR — check `gh pr list`
first, same discipline as every slice since 10. Slice 15's own task 10 (a real
NIM run through the finished UI) may still be open; that is slice 15's loose
end, not this one's.

**Why this slice exists.** PROJECT.md section 9 names five v1 screens. Four
have a route today: Onboarding, Apply, Account, and the `(auth)` group. The
fifth — **"Applications: a quiet list of past runs with fit score and
files"** — has no route at all. It is not a gap in the plan, it is a gap in
the build: everything the screen needs already exists and is unused.

- The table: `public.applications` (`20260724223958_init.sql`) already has
  `company`, `role`, `tier`, `fit_score`, `files`, `created_at`, is already
  indexed `(user_id, created_at desc)` for exactly this query, already has RLS
  `applications read own`, and already has a `delete` policy nothing has
  called yet.
- The component: `src/ui/FitScore.tsx`'s own comment says it is "shared
  rather than apply-specific markup (SLICE-13 decision 6): **the Applications
  list needs the identical display for every row.**" It has sat unused for
  that stated purpose since slice 13.
- The downloads: `/api/files/[applicationId]/[kind]/[format]` already serves
  a resume or cover letter PDF/DOCX by id, scoped to the owner, from
  `loadApplication`. A list row needs nothing more than a link to it.
- The nav: `src/ui/Header.tsx` links to `/apply` and `/account` only.
  `Header.tsx`'s links array is a two-line change once the route exists.

What is missing is the one piece nothing else provides: a query that lists
every row for a user, and the page that renders it. That is the whole slice.

## Context

A user who has run `/apply` more than once today has no way back to a past
result except re-generating it. `saveApplication` and `startApplication` both
compute `fit_score` before insert (`fitScore()` in `supabase.ts`), so every
row — even one whose render step never completed — carries a real score from
the moment it exists. `files` defaults to `'[]'::jsonb` and is filled in by
`attachFiles`, possibly on a later request than the one that inserted the
row, so **a row with zero files is a real, expected state**, not corruption:
it is a generation whose render step hasn't run yet, or failed and hasn't
been retried. The list has to show that state honestly rather than pretend
the row doesn't exist or silently omit it.

The per-user daily generation counter (`GenerationLimitReached`, PROJECT.md
section 11) bounds how many rows one user accumulates per day, which is why
this slice does not need to solve pagination to be done — see decision 4.

## Decisions taken (say so if any is wrong)

1. **One new read function, `listApplications(userId)`, in `src/lib/supabase.ts`,
   next to `loadApplication`.** Selects `id, company, role, tier, fit_score,
   files, created_at` (not `content` — a list row never needs the full
   resume/cover-letter text, and `content` can be large), ordered by
   `created_at desc`, filtered to `user_id = owner`, same `SUPABASE_SECRET_KEY`
   + explicit filter discipline `loadApplication` already uses since RLS is
   bypassed at that key. Returns `StoredApplication` minus `application`, or a
   new narrower type if the shape diverges enough to earn one — decide once
   in the code, not here.
2. **The route is `/[locale]/applications`, matching PROJECT.md's own name
   for the screen.** A server component: `currentUser()` for the redirect
   guard (same pattern as `/account`), `listApplications` for the data, no
   client-side fetch and no loading spinner for the initial list — the data
   is already there when the page renders, same discipline `/account` and
   `/apply`'s server-rendered shell already use.
3. **Each row shows `FitScore` collapsed to just the number and bar, not the
   full verdict/flags block.** `FitScoreProps` already makes `flagsLabel`
   optional and `flags` an empty array is already a legal, silent input — so
   a list row passes `flags={[]}` and a short verdict (or omits the prop
   entirely if that requires widening the component; confirm rather than
   assume, and if it needs a second, list-specific display mode, say so
   before adding one to a component whose own comment calls it shared,
   unchanged, for this exact purpose).
4. **No pagination in this slice.** The per-user daily generation cap
   (section 11) keeps one user's row count small by construction; a `LIMIT`
   with no cursor, or no limit at all, is honest for v1. If this becomes a
   real problem once the screen ships, that is a future slice's measurement,
   not a number invented here — same discipline SLICE-15 held `APPLY_MAX_TOKENS`
   to.
5. **A row with no files yet shows a plain state, not a download link,
   and no error.** `files.find(...)` returning nothing is not `404`-worthy
   here the way it is in the download route (that route is reached by
   clicking a link that shouldn't have rendered in the first place) — the
   list is what decides whether the link renders at all. Copy: something
   truthful and calm ("still preparing your files" / equivalent), not a
   spinner promising progress the page has no way to track, and not a raw
   "no files."
6. **Deleting a row is out of scope.** PROJECT.md section 9's own line for
   this screen says "a quiet list of past runs with fit score and files" —
   nothing about removal. The RLS `delete` policy already exists in the
   database for whenever that is asked for; this slice does not add a UI
   trigger for it. Do not build it speculatively.
7. **Dates render with `Intl.DateTimeFormat`, locale-aware, no new
   dependency.** Grepped clean: nothing in `src/` formats a date today, so
   this slice sets the first precedent rather than following one — plain
   `Intl.DateTimeFormat(locale, { dateStyle: 'medium' })` is enough, per
   CLAUDE.md rule 7 (standard library before a package).
8. **The nav link goes in `Header.tsx`'s existing `links` array, third
   position, between Apply and Account.** Matches reading order (start a
   run, review past runs, manage the account) and needs no new component —
   `Header.tsx` already maps over the array generically.

## Files

| File | What |
| --- | --- |
| `src/lib/supabase.ts` | new `listApplications(userId)`, reusing the query and validation discipline `loadApplication` already established |
| `src/app/[locale]/applications/page.tsx` | new. Server component: auth guard, `listApplications`, empty state ("no runs yet" inviting toward `/apply`), one row per application |
| `src/app/[locale]/applications/applications.module.css` | new, DESIGN.md tokens only |
| `src/ui/Header.tsx` | `links` array gains the `/applications` entry |
| `src/ui/FitScore.tsx` | confirm whether the collapsed list-row display (decision 3) fits the existing props before touching it; if it does, no change; if it doesn't, the smallest change that lets a caller ask for the compact form |
| `messages/en.json`, `messages/es.json` | new `Header.applications` key, new `Applications` namespace (empty state, per-row labels, "preparing files" state, download link labels reusing `Apply`'s existing resume/cover-letter labels where they already exist rather than duplicating copy) |

## Verification

- A user with zero applications sees the empty state, not a blank page or an
  error.
- A user with several applications sees them newest first, each with its
  score, company/role (or an honest placeholder when either is null — both
  columns are nullable per the schema), and tier.
- A row whose render never completed (`files: []`) shows the "still
  preparing" state, not a broken link and not a 404 if clicked.
- A row with files shows working download links that hit the existing
  `/api/files/...` route and actually download the right document.
- Another user's applications never appear — exercise this for real, not by
  reading the RLS policy and assuming: sign in as a second account, confirm
  the list is empty or only theirs.
- The nav link is present on every authenticated screen except onboarding
  (matching `Header.tsx`'s existing exclusion), and marks itself current when
  on `/applications`.
- `typecheck`, `lint`, `format:check`, `build`, `test`, and the suite with
  every provider/Supabase variable unset, same as every slice.

## Definition of done

A signed-in user can open a screen that lists every application they have
generated, newest first, each showing its fit score, tier, and company/role,
with working downloads for whichever files have finished rendering and an
honest "not ready yet" state for whichever haven't. The screen is reachable
from the same nav as Apply and Account. Nothing in `src/core/`,
`src/providers/`, or the database schema needed to change to get here — the
table, the RLS, the fit-score component, and the download route were already
built and already waiting, since slice 13's own comment said so.
