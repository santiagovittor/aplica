# Slice 10 — the apply pipeline as two route handlers

## Start here (this runs in a fresh session)

Nothing from the slice 9 session carries over, so everything that session
learned the hard way is written down here. Read this section first.

**Read:** this file, `PROJECT.md` sections 5, 9 and 11, and the modules being
touched (`src/core/apply.ts`, `src/render/index.ts`, `src/lib/*`). **Do not**
read SLICE-4 through SLICE-9, and do not load the repo wholesale. **DESIGN.md is
not needed:** this slice builds no screens. If you find yourself writing a
component, stop, because you have left the slice.

**Repo state.** `main` carries slice 9 (PR #4, both CI jobs green). The remote is
`github.com/santiagovittor/aplica` and it is **public** — never commit an env
file, and assume anything pushed is permanently retrievable. CI
(`.github/workflows/ci.yml`) now runs **two jobs**: `ci` (format, lint,
typecheck, test, build) and `rls` (Postgres only, running
`supabase/tests/rls.sql`). Neither carries a secret and both must stay that way.
Work on a branch and open a PR; that is how #1 to #4 landed.

**Local environment:**

- Supabase runs locally: API `http://127.0.0.1:54321`, Studio `:54323`, Mailpit
  `:54324`. `npx supabase start` if it is down.
- **`npx supabase start` needs `--ignore-health-check` on this machine.** The
  `vector` container restarts forever because analytics on Windows wants the
  Docker daemon on `tcp://localhost:2375`, and `studio` and `storage` are slow
  enough to trip the CLI's own timeout and roll the whole start back. Everything
  that matters comes up healthy; verify with `docker ps` rather than trusting
  the CLI's verdict. That cost the slice 9 session twenty minutes.
- **Apply migrations with `npx supabase migration up --local`.**
  `npx supabase db push` targets the *linked remote* and silently does nothing
  locally. Verify with `npx supabase migration list --local`.
- `.env.local` holds real values. Never read or print them. To get a real key
  into a browser form without it entering the transcript:
  `set -a; . ./.env.local; set +a; printf '%s' "$APLICA_DEV_API_KEY" | clip.exe`
  then paste with ctrl+v, then `printf '' | clip.exe`. That worked in slice 9.
- `APLICA_DEV_API_KEY` is a **Google** key and `APLICA_DEV_PROVIDER` is not set,
  so it defaults to `anthropic` and fails. Export `APLICA_DEV_PROVIDER=google`.
  Plain calls work; the search model `gemini-3.5-flash-lite` returns **429** on
  this account's free tier, so pass `--no-research`.
- `npm run <script> > file` captures npm's banner into the file too. Use
  `npm run --silent`. **`next dev`'s own output never reaches a redirect on this
  machine**, so a grep of that file proves nothing; do not build a verification
  step on it.
- `core.autocrlf=true` here, so `npm run format:check` warns about three files
  git checked out (`ci.yml`, `docs/setup.md`, `src/render/pdf.ts`). Their
  committed bytes are LF and prettier-clean; CI on Linux passes. Confirm with
  `git show HEAD:<file> | npx prettier --stdin-filepath <file> | diff - -`
  before believing a local formatting failure.

**Existing data, and what is missing.**

- `ada@aplica.local` (`6048cc84-3b42-4891-bad7-5003620dbd48`) has a stored
  Google key and no profile.
- `santi@aplica.local` (`a7db4121-97f1-436f-9824-e048f81c5eeb`) is the account
  the `--save` scripts should target. No key, no profile.
- **`public.profiles` is empty and both storage buckets are empty.** Slice 9's
  deletion proof removed the only profile there was. Before anything in this
  slice can run end to end, seed one:
  `npm run parse:cv -- <cv.pdf> --save a7db4121-97f1-436f-9824-e048f81c5eeb`.
  That is a real model call on a real key, so budget for it once, not per test.

## Context

Slice 9 exists so this slice can stop being impossible. There is now a session,
a user id that came from a cookie rather than a command line, and
`getDecryptedKey(userId)` — which slice 9 shipped, tested, and left **with no
caller in the repo**. This is the slice that gives it one.

`src/core/apply.ts` already does the hard part. `applyToPosting(provider,
options)` runs the draft call, the reviewer call and the revision pass, validates
the result against `applicationSchema`, and returns the application plus the
critique, the slop findings and the grounding findings. It is framework-free and
tested against the MockProvider. `src/render/index.ts` already turns an
`Application` into `RenderedFile[]` per tier, and `saveApplication` in
`src/lib/supabase.ts` already writes the files and the row.

So this slice is plumbing, and the plumbing is where the money and the
credentials are. What is missing is the two route handlers PROJECT.md section 5
describes, and four things they need that do not exist yet: a way to read a
profile back out of the database, a name to put on the documents, an honest
progress stream, and the rate-limit counter that has now been deferred three
times.

## Your non-negotiables, recorded verbatim

Each one names the test that proves it, because "prove it with a test, not an
assertion" is the instruction.

1. **The user's key never reaches the client, the SSE stream, a log, or an
   error event.** `getDecryptedKey` is called at the moment of the provider
   request and its result is not cached, not stored on the request object, and
   not closed over by anything that outlives the call. A test asserts the key
   appears in no event of a full stream, including the error events.
2. **The user id comes from the session, never from the request body.** A body
   that carries a `user_id` is a body somebody edits. `requireUser()` or the
   route does not run.
3. **The rate limit is checked and incremented before a single token is spent**,
   atomically, in the statement the init migration already documents. A test
   proves that two concurrent requests cannot both pass the last slot.
4. **A provider failure is reported without the provider's response body**
   (PROJECT.md section 11). Bad key, rate limit and timeout each get their own
   calm sentence and a retry that does not re-spend what was already paid for.
5. **A render failure retries without re-running generation.** That is the whole
   reason there are two routes, and it is only true if the generated application
   survives the first route. A test proves the second route can run twice.

**Nobody is going to read this diff.** The only reviewer this slice gets is the
test suite and CI, so the same two rules as slice 9 hold:

- **Every non-negotiable above is a failing test first.** Write the test that
  proves the key leaks, or that the counter double-spends, watch it fail, then
  close it. Slice 9's method worked: after the tests passed, the code was
  deliberately mutated to reintroduce the bug and the tests were confirmed to go
  red. Do that here and paste both outputs.
- **A claim with no command behind it does not go in the report.**

Pause before anything irreversible: applying a migration, deleting anything,
pushing to `main`.

## Decisions taken (say so if any is wrong)

1. **The generation route writes the `applications` row; the render route fills
   in its files.** The alternative is for generation to hand the application
   back to the browser and for the browser to post it to the render route, and
   that is worse twice over: the server would be rendering a document body the
   client could have edited, and a retry would depend on the client still
   holding it. `applications.files` already defaults to `'[]'::jsonb`, so a row
   with no files yet is a legal row and no migration is needed. Non-negotiable 5
   falls out of this for free: render reads the row by id and can run again.
2. **Progress stages come from a callback on `applyToPosting`, not from
   splitting it.** `ApplyOptions` gains one optional
   `onStage?: (stage: ApplyStage) => void`. This touches `core`, which the fence
   normally forbids, so the reasoning is recorded: a callback taking a string
   union is not a framework, `core` still imports nothing, and the function stays
   testable with no callback at all. The alternative — exporting the three phases
   and orchestrating them in the route — moves domain sequencing into `app/`,
   which is the actual fence violation.
3. **SSE, not a websocket and not polling.** One `text/event-stream` response
   from the generation route, `ReadableStream` in a route handler, an event per
   stage, then a terminal `done` or `error` event. The stages are the stages
   that actually ran (DESIGN.md §2: nothing pretends to think).
4. **The rate limit is a per-user, per-UTC-day counter in Postgres**, using the
   exact upsert the init migration comments already carry, and the limit lives in
   TypeScript so changing it never needs a migration. It is checked **before** the
   first model call and is not refunded on failure: a failed generation still
   spent the user's tokens, and a limit that refunds on error is a limit that a
   crafted failure walks straight through.
5. **`maxDuration` is measured, not guessed.** Time a real three-call run first
   and set the number from it with headroom, then say in a comment what it was
   measured against and on which Vercel plan the number is legal. A default
   timeout that quietly kills a paid pipeline at 15 seconds is the failure this
   exists to prevent.
6. **The posting is text only.** No URL fetching in this slice. PROJECT.md
   section 9 offers a URL field as best-effort convenience, and fetching a
   user-supplied URL server-side is an SSRF surface that belongs in the same
   slice as `openai_compatible`'s base URL, behind the guard that already exists
   in `src/core/url-guard.ts`. Say if you would rather have it now.
7. **`loadProfile(userId)` is added to `src/lib/supabase.ts`**, hand-written like
   its neighbours, reading with `SUPABASE_SECRET_KEY` and validating with
   `profileSchema` at the boundary. A profile that no longer matches the schema
   is a refused request with a clear sentence, not a model call on garbage.

## Blocked on you

1. **Where the applicant's name comes from.** `profileSchema` deliberately has
   no name field, deriving one from a CV would be an invention, and
   `applyToPosting` requires one. `scripts/apply.mts` takes `--name` from a
   person who typed it. The three options:

   - a nullable `display_name` on `public.users`, set during onboarding, which
     is **a migration and therefore your call**;
   - a field on the apply form, retyped every time;
   - `auth.users.raw_user_meta_data->>'full_name'`, which Google fills in and
     email sign-up leaves empty, so it works for some users and not others.

   I lean the first, with the route returning a specific "we need your name"
   error rather than a generic 400 when it is null. It is one column and the
   apply flow cannot ship without it.
2. **The daily generation limit.** PROJECT.md section 11 says "basic per-user
   rate limiting" and names no number. It has to be a number in this slice. I
   lean **20 per UTC day**: high enough that no honest user meets it, low enough
   that a loop with a stolen session cannot spend a fortune of somebody else's
   money overnight. Say if you want a different one.
3. **The Vercel plan `maxDuration` has to be legal on.** Hobby caps a function
   at 60 seconds, Pro at 300 by default. Decision 5 measures the real duration,
   but which cap it has to fit under is a billing fact only you have.
4. **A migration, if the name decision needs one.** Kickoff step 3's rule holds:
   you see it before it is applied.

## Files

| File                                   | What                                                          |
| -------------------------------------- | ------------------------------------------------------------- |
| `src/core/apply.ts`                    | one optional `onStage` callback, and nothing else              |
| `src/core/apply.test.ts`               | that the stages fire in order, and that omitting the callback changes nothing |
| `src/lib/supabase.ts`                  | `loadProfile`, and `startApplication` / `attachFiles` for decision 1 |
| `src/lib/supabase.test.ts`             | the new reads and writes, including a malformed stored profile |
| `src/lib/usage.ts`                     | `spendGeneration(userId)`: the atomic upsert, the limit, the refusal |
| `src/lib/usage.test.ts`                | the boundary, the day rollover, and the concurrent case        |
| `src/app/api/generate/route.ts`        | the SSE route, `maxDuration`, `requireUser`, the key at the moment of use |
| `src/app/api/generate/route.test.ts`   | the event sequence, and that no event carries the key          |
| `src/app/api/render/route.ts`          | reads the row, renders per tier, attaches the files            |
| `src/app/api/render/route.test.ts`     | that it is safe to run twice                                   |
| `messages/en.json`, `messages/es.json` | the progress stage labels and the error sentences              |
| `docs/security.md`                     | `getDecryptedKey` now has a caller; say where and for how long |

Nothing in `src/prompts/`, `src/providers/` or `src/render/` is touched. The
prompts stay fenced. `src/core/apply.ts` gets exactly the one callback in
decision 2 and no other change.

Note that `/api/*` is excluded from the proxy matcher in `src/proxy.ts`, so
these routes never pass through the locale middleware. They read the session
directly, which works, and they return JSON and SSE rather than a redirect when
there is no user.

## Not built

No screens. The apply screen, the applications list and onboarding are step 7's
and they are the next slice; this one is verified with `curl` and a script. No
URL fetching (decision 6). No `openai_compatible` in the provider picker, and no
base-URL field: that is its own slice with the SSRF guard reviewed properly, and
it is also where the NVIDIA NIM run proves the compatible path end to end. No
retry or backoff inside the provider adapters. No privacy or terms page, no
motion pass, no billing.

## Verification

Measured and pasted, not asserted. Every item is a command with output.

- **Both CI jobs green on the branch** before this is called done.
- **A full run end to end**, with a real key and a real posting, driven by
  `curl` against the running app with a real session cookie: the SSE events in
  order, then the rendered files in the `outputs` bucket and the
  `applications` row, both queried afterwards.
- **The stream's own timing**, so decision 5's `maxDuration` is a measurement
  and not a guess. Paste the wall clock per stage.
- **The key appears in no event of that stream**, proved by piping the whole
  stream to a file and grepping it against `$APLICA_DEV_API_KEY` without
  printing the key.
- **A render retry**: run the render route twice against the same application id
  and show that the second run succeeds, does not duplicate the row, and does
  not make a model call.
- **The rate limit**, proved by setting the limit to 1 for the run: the second
  request is refused before any provider call, and the counter is queried and
  pasted.
- **A wrong key mid-pipeline**: delete the stored key or store a bad one, run
  the route, and show the error event carries neither the key nor the provider's
  body.
- `typecheck`, `lint`, `format:check`, `build`, `test`, and the suite with every
  provider and Supabase variable unset.

## Commits

1. `feat(core): report which stage the apply pipeline is on`
2. `feat(lib): read a stored profile back out`
3. `feat(lib): spend one generation against the daily limit`
4. `feat(api): the generation route, streaming honest progress`
5. `feat(api): the render route, retryable on its own`
6. `test(api): the key never reaches the stream`
7. `docs(security): getDecryptedKey has a caller now`

Seven, and fine-grained for the same reason as last time: commits 3, 4 and 6
touch a plaintext credential and the user's money, and keeping them separate is
what makes a single `git revert` possible when one of them turns out to be
wrong.

Every git command scoped with
`-C "C:\Users\user-1\Documents\Personal Projects\aplica"`.

## Definition of done

A signed-in user with a stored key and a parsed profile can post a job posting
to the generation route, watch honest progress arrive over SSE, get a validated
application row, then call the render route and find real PDF and DOCX files in
the `outputs` bucket — with their key never leaving the server, their daily
limit enforced before a token is spent, and a failed render costing them
nothing to retry. The slice after this one can then put a screen on top of it.
