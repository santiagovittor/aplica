# Slice 12 — Onboarding, so signing up ends with a working account

## Start here (this runs in a fresh session)

Nothing from the slice 11 session carries over. Read this section first.

**Read:** this file, `PROJECT.md` sections 3, 5b and 9, **`DESIGN.md` in full**
(this slice is screens, and its checklist runs at the end of every one), and
the modules being touched (`src/app/[locale]/(auth)/`, `src/app/[locale]/cv/`,
`src/app/[locale]/account/`, `src/lib/locale.ts`, `src/lib/supabase.ts`).
**Do not** read SLICE-4 through SLICE-10, and do not load the repo wholesale.

**Repo state.** `main` carries slice 11 (PR #8), CV upload and parse now has a
screen and a route, both on Vercel Hobby. CI (`.github/workflows/ci.yml`)
runs two jobs, `ci` and `rls`, neither holding a secret. Work on a branch and
open a PR; that is how every slice so far has landed. The suite was 680 tests
in 23 files at the end of slice 11; expect more.

**Environment notes carried forward, hard-won in slice 11 and worth not
rediscovering:**

- **This sandbox's Node is 20.20.2, and two things need Node 22+:**
  `@supabase/supabase-js`'s realtime client wants a native `WebSocket`
  (`NODE_OPTIONS=--experimental-websocket` fixes it for any command that
  constructs a Supabase client — tests, dev scripts, ad hoc verification),
  and `scripts/parse-cv.mts`'s `--experimental-transform-types` flag flatly
  does not exist on Node 20. A second Node was installed via `nvm` at
  `C:\Users\user-1\AppData\Local\nvm\v24.18.1\node.exe` last session and
  should still be there; invoke it by full path for anything that needs it
  rather than switching the active `nvm` version; **switching the active
  version broke system-wide `node`/`npm` resolution for the rest of that
  session** (the junction `nvm` manages, `C:\nvm4w\nodejs`, did not get
  recreated, apparently a permissions issue with this shell) and had to be
  repaired by hand with `New-Item -ItemType Junction` in PowerShell. If
  `node`/`npm` stop resolving in this shell for no visible reason, that is
  almost certainly it, and the fix is the same.
- **This sandbox's only browser automation path (headless Edge via
  `playwright-core`, since neither `chromium-cli` nor a full Playwright
  install with bundled Chromium is available) never completes React
  hydration**, in dev or in a production build, on unmodified pre-existing
  code as much as on anything new. Confirmed by checking for
  `__reactFiber$...` properties directly on DOM nodes: absent, on every page
  tried. Server-rendered HTML can still be inspected directly (`fetch` the
  page with a real session cookie, read the streamed RSC payload) and is a
  reliable way to prove a screen's static output is correct; a real
  interactive click-through needs an actual browser, not this sandbox's
  automation. Do not burn an hour rediscovering this the way slice 11 did.
- **`vitest.config.ts` now resolves the `@/*` alias** (it did not before
  slice 11's `(auth)/callback/route.test.ts`-adjacent work; nothing under
  `app/` had ever had a test that imported anything using `@/` until then).
  Should not need touching again.
- `npx supabase start --ignore-health-check` for local Supabase (API
  `:54321`, Studio `:54323`, Mailpit `:54324`); the `vector` container still
  restarts forever on this machine and that is still fine. Apply migrations
  with `npx supabase migration up --local`, never `db push` (targets the
  linked remote). **Test a new migration against real Postgres before
  trusting it**: slice 11's own migration had a genuine bug (a PL/pgSQL
  parameter name colliding with a column name inside `on conflict`, which
  made the function silently uncallable) that `npx supabase db reset` +
  `docker exec -i supabase_db_aplica psql -v ON_ERROR_STOP=1 -U postgres -d
  postgres < supabase/tests/rls.sql` caught and a read of the SQL did not.
- The GitHub CLI (`gh`) is now installed and authenticated as
  `santiagovittor` (`C:\Program Files\GitHub CLI\gh.exe`, not yet on PATH in
  a fresh shell — use the full path or `gh` may resolve once the shell picks
  up the updated system PATH).
- No local test accounts persist between sandbox sessions; the ones slice 11
  created (`screen-check-*@aplica.local`, `e2e-*@aplica.local`,
  `ratelimit-*@aplica.local`) are throwaway and still in the local database
  if this session reuses the same container, otherwise sign up fresh ones the
  same way: `POST /auth/v1/signup`, read the confirmation link out of
  Mailpit's API (`GET :54324/api/v1/messages`), follow it, then
  `POST /auth/v1/token?grant_type=password` and feed the tokens to
  `createServerClient` from `@supabase/ssr` with a capturing `setAll` to get
  the `sb-127-auth-token` cookie value. Documented in slice 10 and reused in
  slice 11; do not rederive it a third time.
- The CV to test with, if this session has access to it: `CV_Santiago_Vittor_EN.pdf`,
  71,495 bytes, one page, measured at 55.52s to parse for real
  (`gemini-3.6-flash`). Its exact filesystem path moved between slice 10 and
  slice 11's sandboxes; ask rather than assume it is still where the last
  slice found it.

## Context

Slice 11 closed the last hole under the product: a signed-in user with a
stored key can upload a CV and get a working profile. But nothing gets them
to "signed in with a stored key" in the first place except three separate,
undiscoverable trips: sign up, find the account screen, paste a key there,
find `/cv`, upload a CV there. PROJECT.md section 9 has always called for
one guided flow — "soft steps, language -> API key -> upload CV... a
progress that feels light. Skippable, resumable" — and every piece it needs
now exists as a component: `LocaleToggle`-adjacent locale persistence
(slice 11), `KeyCard` (slice 9), `CvUpload` (slice 11, and slice 11's own
decision 5 built it *for* this: "onboarding embeds this same component
later"). This slice is the wiring, not new machinery.

**`display_name` rides along, on purpose.** Slice 10 added the column and
seeded it from OAuth metadata; slice 11 confirmed the generation route still
hard-refuses with `name_missing` for anyone it cannot seed one for, which is
every email sign-up, permanently, with no field anywhere that lets them type
one in. Slice 11's own session explicitly promoted this into onboarding
rather than fixing it standalone: "it's promoted into the onboarding slice,
not this one." PROJECT.md's own onboarding step list does not mention a name
field, which is worth noticing rather than smoothing over — see "Blocked on
you" below for where it should actually sit.

## Decisions taken (say so if any is wrong)

1. **Its own route, `/[locale]/onboarding/[step]`**, `step` one of `language`,
   `key`, `cv`. A path segment, not query-state or client-only state,
   because DESIGN.md section 6's Zeigarnik rule ("onboarding progress is
   visible and resumable") means a reload or a bookmark has to land back on
   the right step, and only the URL survives both.
2. **`CvUpload` is reused unmodified**, imported into the `cv` step exactly as
   it already renders on `/[locale]/cv`. It does not know it is inside
   onboarding and does not need to: it already has its own empty/uploading/
   working/error/done states, and onboarding's job is only to say what comes
   next after `done`.
3. **Each step is skippable**, a quiet text action next to (not styled as) the
   step's own primary button, per DESIGN.md's one-accent-per-screen rule and
   PROJECT.md's "skippable, resumable." Skipping the `key` step is not the
   same as never having a key: it means "not now," and the account screen
   still shows "no key yet" honestly rather than pretending onboarding never
   happened.
4. **`Steps` (the existing component, already used for the CV screen's stage
   indicator) drives the progress indicator**, three entries instead of four,
   labelled `language` / `key` / `cv`. Same component, same rule it already
   follows: order and position, never an invented percentage.
5. **The redirect into onboarding happens at the two places a session is
   first established**: `signIn`'s and `(auth)/callback/route.ts`'s existing
   post-auth redirects (both touched already in slice 11 for the
   locale-preference fix). A brand-new account — no key, no profile, no
   name, checked the same way slice 11's account page already checks
   `hasProfile` — lands on `/onboarding/language` instead of `/account`.
   Everyone else lands on `/account` exactly as today. This is a **narrow**
   extension of code slice 11 already had reason to touch twice; it is not
   reopening those files cold.

## Blocked on you

1. **Where `display_name` actually goes.** PROJECT.md's own onboarding list
   is language / key / CV, no name field. Candidates: (a) fold it into the
   `language` step as a second, small field ("what should we call you on
   your documents?"), since that step is otherwise a two-button locale
   choice with room to spare; (b) its own fourth step; (c) leave it off
   onboarding entirely and instead make the *first* generation attempt after
   onboarding the trigger — the existing `name_missing` refusal, but with the
   apply screen (not yet built) sending the user to fill it in right then,
   which is arguably the most honest "just in time" version of this and
   costs onboarding nothing. Recommendation is (a): it is the cheapest fix
   for the actual bug (an email sign-up is *permanently* stuck without it,
   today, right now), and "just in time at first generation" is real work
   that belongs to whichever slice builds the apply screen, not a reason to
   leave this broken until then.
2. **Whether landing in onboarding is a hard redirect or a dismissible
   banner.** Decision 5 above is a hard redirect for a fresh account with
   nothing set up yet. The open question is what happens to a user who skips
   every step: do they get redirected to `/onboarding` on *every* subsequent
   sign-in until they complete or explicitly finish it, or does skipping all
   three write some "seen it" marker so it never nags again? The former is
   more honest to "you still don't have a key" but risks feeling like a wall
   for someone who genuinely wants to look around first. No column exists
   for "onboarding dismissed" today; adding one is a small migration if you
   want that behaviour.
3. **The optional voice calibration.** PROJECT.md section 5b lists a
   "10-second optional voice calibration" ('which of these sounds more like
   you?') as part of onboarding, `[v1, minimal]`. It needs voice anchors to
   already exist, which only happens after the CV step's parse completes, so
   it would be a fourth step gated on the third — real, scoped work, not a
   trivial add. Recommendation: **defer it**, same shape as slice 11
   deferred shape 2 and the NIM run — named here so it does not evaporate,
   not built this slice unless you want it.
4. **Whether a partially-onboarded user (say, key saved, CV skipped) can
   re-enter onboarding from `/account` to finish the skipped step, or only
   ever reaches `/cv` directly the way slice 11 already wired it.** The
   account screen already links to `/cv` for "no CV on file"; whether it
   *also* offers "finish onboarding" is a UX call, not an engineering one.

## Files

| File | What |
| --- | --- |
| `src/app/[locale]/onboarding/[step]/page.tsx` | the three-step flow, `Steps` progress, skip actions |
| `src/app/[locale]/onboarding/[step]/layout.tsx` or a shared component | whatever holds the progress indicator across steps without re-fetching it three times |
| `src/app/[locale]/onboarding/actions.ts` | per-step "mark skipped" / "advance" actions, if decision 2 above needs one |
| `src/app/[locale]/(auth)/actions.ts` | `signIn`'s post-auth redirect gains the fresh-account branch |
| `src/app/[locale]/(auth)/callback/route.ts` | same branch for Google sign-in and email-confirmation links |
| `src/app/[locale]/account/page.tsx` | reflects a `display_name` now settable somewhere (decision pending); possibly a "finish onboarding" link (open question 4) |
| `src/lib/supabase.ts` | `saveDisplayName`, mirroring `saveLocale`'s shape, if decision 1 lands on (a) or (b) |
| `messages/en.json`, `messages/es.json` | a new `Onboarding` namespace |
| `supabase/migrations/*` | only if open question 2 needs an "onboarding dismissed" column |

Nothing in `src/prompts/`, `src/providers/`, `src/render/`, or the CV/generate
routes themselves is touched. This slice is screens and redirects around
work slices 9-11 already built.

## The screen(s)

DESIGN.md is binding, same as every slice since the styleguide. Specific to
this one:

- **One primary action per step** (Hick's law, DESIGN.md section 6): the
  step's own button is the one `--green` element; "skip for now" is plain
  text or an ink outline, never a second green control.
- **The `Steps` progress indicator is the whole "where am I" story.** No
  invented percentage, no "2 of 3 complete" language beyond what the
  component already renders.
- **Empty, loading, and error states still apply to every step**, not just
  the `cv` step (which already has all five from slice 11). The `language`
  and `key` steps are simpler but still need a real error state for the key
  step (reuses `KeyCard`'s own error handling, already built) and a designed
  empty state, not a bare form dropped on the page.
- **The motif is not this slice's to spend.** DESIGN.md section 7 names
  three homes for it — landing hero, empty states, result reveal — and
  onboarding's own steps are closer to a form flow than an empty state or a
  reveal. Reusing `CvUpload` inside the `cv` step already brings its empty
  state (which does use the motif, per its own three-homes allowance) along
  for free; do not add a second, separate onboarding-specific use of it.
- **`avoid-ai-design` in detect mode, zero P0/P1**, same bar as every screen
  since slice 11 made it non-negotiable rather than a preference.

## Deferred, and recorded so it does not evaporate

Carried forward from slice 11, still true:

1. **Playwright and the apply-flow end-to-end test.** Still not installed.
   Still the largest gap in the testing story, and it is about to get larger:
   onboarding is the first *multi-step* flow in the product, which unit and
   component tests cover less naturally than a real end-to-end click-through
   would.
2. **Privacy and terms pages.** Still non-negotiable per PROJECT.md section
   11, still not built. `docs/security.md` already has the true behaviour
   written down; this is a writing job on existing facts, not research.
3. **URL fetching plus `openai_compatible`.** Deferred four times now (was
   three as of slice 11). Still behind the already-written, already-tested
   `src/core/url-guard.ts`.
4. **The NIM verification run.** Paired with item 3, still unproven against
   a real host.
5. **The Spanish gate's first real-world test.** Slice 11's real end-to-end
   run (a genuine achievement — a real account, a real key, a real CV, a
   real 47.74s parse) was still English. Half the product's intended market
   has still never exercised the no-invention gate for real. Onboarding
   ships in both locales like everything else, but that is copy parity, not
   this.

New to this slice:

6. **The optional voice calibration** (Blocked-on-you item 3 above).
7. **"Onboarding dismissed" state, if open question 2 lands on a persistent
   marker rather than a redirect-forever.**

## Verification

Measured and pasted, not asserted, same discipline as slices 10 and 11.

- Both CI jobs green on the branch before this is called done.
- A fresh account, signed up for real (email confirmation through Mailpit,
  same technique as slice 11), driven through all three onboarding steps for
  real: language picked, a real key saved (checked against the real
  provider, same as `saveApiKey` already does), a real CV uploaded through
  the reused `CvUpload`. End state queried afterward: `users.locale`,
  `api_keys`, `profiles` all reflect what onboarding actually did, not what
  the UI merely displayed.
- The skip path for each step, proving a skipped step leaves its own table
  untouched (no key row, no profile row) rather than writing a placeholder.
- The redirect-on-fresh-account behaviour, both from `signIn` and from the
  callback route (a Google sign-in, if a Google client is configured
  locally; otherwise an email sign-up is sufficient since both call sites
  are touched).
- A returning, already-onboarded account signing in and landing on
  `/account` directly, not onboarding — the negative case matters as much as
  the positive one.
- DESIGN.md section 10's checklist, by measurement, on every step.
  `avoid-ai-design` detect mode, zero P0/P1, on every step.
- `typecheck`, `lint`, `format:check` (checked against committed blobs per
  the CRLF caveat both slice 11 and this file repeat), `build`, `test`, and
  the suite with every provider/Supabase variable unset.
- If a migration lands (open question 2), the same real-Postgres discipline
  slice 11's migration needed: applied locally, `supabase/tests/rls.sql`
  extended and run against the real database before it is trusted.

## Definition of done

A brand-new sign-up reaches a working account — language set, a checked key
saved, a parsed profile on file, a name on the documents — without ever
finding the account screen or the `/cv` route by accident, and without ever
being forced through a step they chose to skip. A returning, already-set-up
account never sees onboarding again. `name_missing` stops being a permanent
dead end for an email sign-up. Nothing here touches the model pipeline, the
CV route, or the render pipeline; it is the front door the rest of the
product has been missing since slice 9.
