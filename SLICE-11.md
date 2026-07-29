# Slice 11 — CV upload and parse, end to end in the product

## Start here (this runs in a fresh session)

Nothing from the slice 10 session carries over, so everything that session
learned the hard way is written down here. Read this section first.

**Read:** this file, `PROJECT.md` sections 5, 5b and 9, **`DESIGN.md` in full**
(this slice builds the first product screen since the styleguide, so its tokens
and its checklist are not optional), and the modules being touched
(`src/core/extract-text.ts`, `src/core/parse-cv.ts`, `src/core/grounding.ts`,
`src/lib/*`). **Do not** read SLICE-4 through SLICE-10, and do not load the repo
wholesale.

**Repo state.** `main` carries slice 10 (PR #6, both CI jobs green, merged as
eight commits rather than a squash so that the three commits touching the key
and the rate limit stay revertable one at a time). The remote is
`github.com/santiagovittor/aplica` and it is **public** — never commit an env
file, and assume anything pushed is permanently retrievable. CI
(`.github/workflows/ci.yml`) runs **two jobs**: `ci` (format, lint, typecheck,
test, build) and `rls` (Postgres only, running `supabase/tests/rls.sql`).
Neither carries a secret and both must stay that way. Work on a branch and open
a PR; that is how #1 to #6 landed. The suite is 634 tests in 21 files.

**Local environment:**

- Supabase runs locally: API `http://127.0.0.1:54321`, Studio `:54323`, Mailpit
  `:54324`. `npx supabase start` if it is down.
- **`npx supabase start` needs `--ignore-health-check` on this machine.** The
  `vector` container restarts forever because analytics on Windows wants the
  Docker daemon on `tcp://localhost:2375`. Everything that matters comes up
  healthy; verify with `docker ps` rather than trusting the CLI's verdict.
- **Apply migrations with `npx supabase migration up --local`.**
  `npx supabase db push` targets the *linked remote* and silently does nothing
  locally. Verify with `npx supabase migration list --local`. A remote project
  **is** linked (`oyrkhwuvmxpqivfobvup`); the slice 10 migrations are applied
  locally only.
- `.env.local` holds real values. Never read or print them. To use one in a
  command without it entering the transcript:
  `set -a; . ./.env.local; set +a` and then reference `$APLICA_DEV_API_KEY`
  by name only.
- `APLICA_DEV_API_KEY` is a **Google** key and `APLICA_DEV_PROVIDER` is not set,
  so it defaults to `anthropic` and fails. Export `APLICA_DEV_PROVIDER=google`.
  Plain calls work; the search model `gemini-3.5-flash-lite` returns **429** on
  this account's free tier, so pass `--no-research` to anything that reviews.
- `npm run <script> > file` captures npm's banner. Use `npm run --silent`.
  **`next dev`'s own output never reaches a redirect on this machine**, so a
  grep of that file proves nothing.
- **The `rtk` shell wrapper compresses command output.** `npx vitest run` comes
  back as `PASS (n) FAIL (n)` with no failure detail, and `grep` is proxied and
  sometimes mangles output. Use `rtk proxy npx vitest run` when you need to read
  a real failure, and prefer the editor's own search tools over shell `grep`.
- `core.autocrlf=true` here, so `npm run format:check` warns about roughly
  thirty files git checked out. Their committed bytes are LF and prettier-clean;
  CI on Linux passes. Confirm with
  `git show HEAD:<file> | npx prettier --stdin-filepath <file> | diff - -`
  before believing a local formatting failure. Check your **own** new files the
  same way rather than trusting `prettier --check` on the working tree.

**Existing data.**

- `ada@aplica.local` (`6048cc84-3b42-4891-bad7-5003620dbd48`) has a stored
  Google key, a parsed profile, `display_name` `Santiago Vittor`, one
  `applications` row with two rendered PDFs in the `outputs` bucket, and a
  `usage_counters` row. Its password was set to `aplica-dev-only-password`
  during slice 10 so a session cookie could be built for `curl`. It is a
  throwaway local account.
- `santi@aplica.local` (`a7db4121-97f1-436f-9824-e048f81c5eeb`) has nothing.
  Useful as the empty-state account, which this slice needs.
- The CV to test with is always
  `C:\Users\user-1\Desktop\CV2026\AI\CV_Santiago_Vittor_EN.pdf`.

To get a session cookie for `curl` without a browser: sign in against
`/auth/v1/token?grant_type=password` with the publishable key, then feed the
tokens to `createServerClient` from `@supabase/ssr` with a capturing `setAll`
and read back the cookie it writes. The local cookie name is
`sb-127-auth-token`. That worked in slice 10 and took about ten minutes to
work out, so do not rediscover it.

## Context

Slice 10 built the two route handlers that turn a posting into files. It left
the product with a hole underneath it: **`parseCv` and `saveProfile` have no
caller anywhere in `src/app/`.** The only way to get a profile into this product
is `scripts/parse-cv.mts`, from a terminal, with a key exported by hand. A user
cannot reach the feature that the entire rest of the product is built on.

This slice closes that. It is the last piece of plumbing before screens, and it
is the one with a genuinely hard constraint attached, which is why the
measurement below comes before the requirements rather than after them.

Most of the hard parts already exist and must not be rebuilt:

- `extractCvText` in `src/core/extract-text.ts` already validates the file by
  its own first bytes and fails with one of seven codes: `empty`, `too_large`
  (10 MB), `unsupported_type`, `legacy_or_encrypted_office`, `encrypted_pdf`,
  `corrupt`, `no_text_layer`. Each already carries a plain sentence that sends
  the person to a different fix. The scan-with-no-text-layer case is
  `no_text_layer`, and it already fails loudly rather than sending an empty
  string to a model. **Wire these up. Do not write new validation.**
- `parseCv` in `src/core/parse-cv.ts` already makes the model call, validates
  against `profileSchema`, and runs `groundProfile`.
- `saveProfile` in `src/lib/supabase.ts` already writes the CV file and the row
  including `source_text`.
- `spendGeneration` and the `spend_generation` RPC in `src/lib/usage.ts` already
  enforce a per-user, per-UTC-day limit atomically.

## The measurement, and the decision it forces

**Read this before planning anything.** Decision 5 of slice 10 was "measure
`maxDuration`, do not guess it." That was done for this slice up front, because
the answer changes its shape.

A full parse, `gemini-3.6-flash` (the `PARSE_MODELS` entry, deliberately not the
cheap default), on the real CV above, run locally with no HTTP overhead:

```
CV: 71,495 bytes  ->  4,498 characters of extracted text
  extract text                 0.14s
  parseCv (model + grounding) 55.16s
  saveProfile (upload + row)   0.21s
  TOTAL                       55.52s
  -> 3 roles, 34 skills, 12 keywords
  -> profile JSON 15,387 characters
  -> grounding findings 0, dropped anchors 0
```

**It does not fit 60 seconds in any way worth relying on.** 55.52s against a
60s cap is an 8% margin on a *one-page* CV. The call is output-bound: it emits
roughly 15,000 characters of profile JSON at about 90 tokens per second, so a
two-page CV scales it straight past the cap. And a cap breach is the worst
possible failure here, because Vercel kills the function mid-call: the user is
billed by Google for the tokens and gets nothing back.

So the honest answer to "does it fit Hobby" is **no**. One run fit, by luck and
by brevity.

### The shapes that would fit

1. **Pro-only for this one route.** `maxDuration = 300` on the parse route,
   everything else stays at 60 and stays Hobby-legal. One line, no
   restructuring, honest. Cost: a Hobby or self-hosted deployment has no CV
   upload, and falls back to `scripts/parse-cv.mts`. **This is the
   recommendation.**
2. **Split the parse across two requests.** The prompt's output has natural
   halves: experience, projects and education in one; skills, keyword bank,
   STAR stories and voice anchors in the other. Each is roughly 25-30 seconds,
   which fits 60 with real margin, and the client makes two calls that the
   server assembles into one profile. Cost: it restructures
   `src/prompts/parse.ts`, which is fenced, is the product's soul, and would
   need its quality re-measured against the current one-call output (the
   existing note in `defaults.ts` records that a weaker parse cost keyword bank
   entries 14 -> 10 and skills 34 -> 3). It also resends the CV text in both
   calls, so it costs more in input tokens.
3. **Parse on the cheap model.** Rejected already, in writing, in
   `src/providers/defaults.ts`: it was measured and it was materially worse,
   including output that failed schema validation outright.
4. **A background worker.** No free primitive on Vercel, and Supabase Edge
   Functions carry their own caps. New infrastructure for one call.

Shape 1 unless told otherwise, with the measurement above recorded in a comment
on the route so the number is revisitable rather than folklore. Shape 2 is
written down here so that the day Hobby compatibility matters, the work is
already scoped.

### What the length means for the screen

Fifty-five seconds is long enough that the screen is the hard part, not the
route. DESIGN.md section 6 (Doherty) requires acknowledgment within 400ms and
honest progress after it, and DESIGN.md section 2 forbids anything that pretends
to think.

There is exactly **one** model call, so there are no sub-stages inside it to
report. The honest stages are `uploading`, `reading`, `parsing`, `checking`,
`saving`, and `parsing` is fifty of the fifty-five seconds. Therefore:

- **No progress bar and no percentage.** A bar that fills over 55 seconds is
  inventing information the server does not have. That is exactly the tell
  DESIGN.md section 2 rules out.
- An elapsed-seconds counter is honest, because elapsed time is a fact.
- The copy must say what is actually happening and set the expectation up front:
  reading a CV properly takes about a minute, said once, calmly, before it
  starts rather than as an apology after 30 seconds.

## Your non-negotiables

Each names the test that proves it.

1. **The user id comes from the session, never from the request.** Same rule as
   slice 10, same failure if broken: a body somebody edits writes into somebody
   else's profile. A test posts a body naming another real user and asserts
   every read and write stays on the session's user.
2. **The key never reaches the client, the stream, a log, or an error event.**
   `getDecryptedKey` is called at the moment of the provider request and its
   result is not cached and not closed over by anything that outlives the call,
   exactly as `keyedProvider` does it in the generation route. A test greps the
   whole serialised stream for the key, including on every error path.
3. **The rate limit is checked and incremented before a single token is spent**,
   atomically, and is not refunded on failure. A parse costs roughly five times
   a generation, so this matters more here than it did in slice 10.
4. **A file that is not a readable CV never reaches a model.** Every one of the
   seven `CvExtractionCode` cases is refused before the provider is touched, and
   a test asserts zero provider calls for each. The scan case (`no_text_layer`)
   gets its own test with a real image-only PDF, because it is the one a real
   user actually hits.
5. **A grounding finding is shown to the user, never silently dropped.**
   `parseCv` currently returns `groundProfile(...).profile` and throws away
   `findings` and `droppedAnchors`. A voice anchor dropped for not being an
   exact quote is the user's own words being discarded; they have to be told. A
   test asserts a profile with an ungrounded claim produces a response the user
   can see it in.

**Nobody is going to read this diff.** The only reviewer this slice gets is the
test suite and CI, so the same two rules as slice 10 hold:

- **Every non-negotiable above is a failing test first.** Write the test, watch
  it fail, then close it. Then deliberately mutate the code to reintroduce the
  bug and confirm the test goes red. Paste both outputs. Slice 10 did this five
  times and it caught a real defect each time.
- **A claim with no command behind it does not go in the report.** Slice 10
  shipped a migration whose trigger had never once executed, and the only reason
  it was caught was this rule.

Pause before anything irreversible: applying a migration, deleting anything,
pushing to `main`.

## Decisions taken (say so if any is wrong)

1. **One route, not two.** `POST /api/cv`, `multipart/form-data`, answering with
   SSE. Unlike generation and render, there is nothing here worth retrying
   separately: the expensive step is the first one, and re-running extraction is
   free. Splitting would add a stored-upload state for no gain.
2. **The size ceiling is enforced twice.** `extractCvText` already refuses over
   `MAX_CV_BYTES` (10 MB), but it does so *after* the bytes are in memory. The
   route additionally refuses on `content-length` before reading the body, so a
   500 MB upload is rejected at the door rather than buffered first. The two
   limits come from the same constant.
3. **`parseCv` returns its grounding result instead of swallowing it.** Its
   return type becomes `{ profile, findings, droppedAnchors }`. This is a `core`
   change and a breaking one for `scripts/parse-cv.mts` and
   `src/core/parse-cv.test.ts`, both of which get updated. `groundProfile`
   already writes its corrections into `profile.gaps`; that stays, and the
   findings are additionally reported so the screen can say what happened.
4. **Parse gets its own daily limit, not a share of the generation limit.**
   Charging a parse against the same twenty would mean a user who re-uploads a
   CV three times loses three applications, and the two operations have
   different costs and different frequencies. This needs `usage_counters` to
   grow a `kind` column and the primary key to become `(user_id, day, kind)`,
   with `spend_generation` generalised to `spend_usage(spender, kind,
   daily_limit)`. **That is a migration and therefore your call** (see below).
5. **The screen is its own route, `/[locale]/cv`.** Not a card on the account
   screen: a fifty-five second operation with five states needs a page, and
   onboarding will embed the same component later. The account screen gets a
   quiet "CV on file" line and a link, nothing more.
6. **The upload input is a real `<input type="file">`, styled.** Drag-and-drop
   is added only if it costs nothing on top, and never as the only affordance.
   DESIGN.md section 6 (Jakob): conventional bones, novel skin.
7. **Locale for the parse comes from the user's `users.locale` column**, not
   from the file and not from a guess. `parseCv` takes `locale` and it changes
   the prompt; getting it wrong produces a profile in the wrong language.

## Blocked on you

1. **Which shape** from the section above. The recommendation is 1 (Pro-only,
   `maxDuration = 300`, Hobby falls back to the CLI). Shape 2 is real work on a
   fenced prompt and wants its own slice if you want it.
2. **The `usage_counters` migration for decision 4**, or a decision to share the
   generation limit instead. Kickoff step 3's rule holds: you see the migration
   before it is applied.
3. **The daily parse limit.** The recommendation is **3 per UTC day**: a parse
   is roughly $0.14 of the user's money, it normally happens once ever, and 3
   leaves room to fix a bad CV and try again without leaving a loop cheap.
4. **Whether the screen lives behind onboarding or stands alone for now.**
   Decision 5 assumes it stands alone at `/[locale]/cv` and onboarding embeds it
   in a later slice.

## Files

| File                                     | What                                                             |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `src/core/parse-cv.ts`                   | return the grounding result rather than dropping it, and nothing else |
| `src/core/parse-cv.test.ts`              | the new return shape, and that a dropped anchor is reported      |
| `src/lib/usage.ts`                       | `spendParse`, sharing the RPC that `spendGeneration` uses        |
| `src/lib/usage.test.ts`                  | the parse limit, and that the two counters do not share a budget |
| `src/app/api/cv/route.ts`                | the SSE route, `maxDuration`, `currentUser`, the key at the moment of use |
| `src/app/api/cv/route.test.ts`           | the event sequence, every refusal, and that no event carries the key |
| `src/app/[locale]/cv/page.tsx`           | the screen: empty, uploading, parsing, error, done               |
| `src/app/[locale]/cv/CvUpload.tsx`       | the client component that drives the stream                      |
| `src/app/[locale]/cv/cv.module.css`      | DESIGN.md tokens only; a value outside section 1 is a bug        |
| `src/app/[locale]/account/page.tsx`      | one quiet "CV on file" line and a link                           |
| `messages/en.json`, `messages/es.json`   | the stages, the seven extraction sentences, the grounding copy   |
| `supabase/migrations/*`                  | `usage_counters.kind`, if decision 4 is approved                 |
| `supabase/tests/rls.sql`                 | the parse counter is per user and per kind, and unreachable by any client role |
| `scripts/parse-cv.mts`                   | updated for the new `parseCv` return                             |
| `docs/security.md`                       | `getDecryptedKey` has a second caller; say where and for how long |

Nothing in `src/prompts/`, `src/providers/` or `src/render/` is touched. The
prompts stay fenced; that is what makes shape 2 a separate decision rather than
something to slip in here.

## The screen

DESIGN.md is the constitution and its checklist runs at the end. The parts that
this screen will get wrong if they are not written down:

- **Empty state invites** (DESIGN.md section 9). "Upload your CV to begin", the
  motif is permitted here (section 7: empty states are one of its three homes),
  and the next action is right there. Not a dashed rectangle with a cloud icon.
- **Loading is calm paper-value placeholders, never a bare spinner**, and the
  honest-progress rule above: stages, elapsed seconds, no invented percentage.
- **Errors are `--clay` on `--paper` with plain words** (section 5), never a
  bright red and never a toast that vanishes. Each of the seven extraction codes
  has its own sentence already written in `extract-text.ts`; those sentences are
  good and their tone is right, so translate them rather than rewriting them.
- **One `--green` element** (section 5, Von Restorff): the upload button. The
  file picker and any secondary action are ink outlines or plain text.
- **Between-group spacing at least two steps larger than within-group**
  (section 3). This is the rule that kills the uniform-gap tell.
- **No em dashes anywhere, including UI copy** (section 4). The catalogue parity
  test added in slice 10 already fails the build on one.
- **`prefers-reduced-motion`** swaps every animation for instant states.
- The checklist in section 10 is run by **measurement on the rendered page**,
  not by reading the CSS, and `avoid-ai-design` in detect mode must show zero
  P0/P1 tells.

The grounding result needs a designed home, not an alert. A parse that dropped
two voice anchors and downgraded one bullet is a normal, honest outcome, and the
screen should say so in the product's voice: what was kept, what was softened
and why, with the user's own words quoted back where they were dropped.

## Deferred, and recorded so it does not evaporate

None of this is built in this slice. It is written here because it is the
complete list of what stands between the product and a launch, and because
things that are not written down stop existing.

1. **Playwright and the apply-flow end-to-end test.** CLAUDE.md section 2 names
   Playwright as the tool for the apply flow. It is **not installed**: there is
   no dependency, no config and no test. The whole 634-test suite is unit and
   component level. This is the largest single gap in the testing story and it
   grows every slice.
2. **The `display_name` settings field.** Slice 10 added the column, seeded it
   from OAuth metadata at sign-up, and had the routes refuse with a specific
   `name_missing` when it is null. Nothing lets an email sign-up ever fill it
   in, so that user is permanently stuck. It is one field on the account screen
   and it should go in the same slice as onboarding.
3. **Privacy and terms pages.** PROJECT.md section 11 calls these
   non-negotiable, and it is right: this product holds a CV, a parsed profile,
   generated documents and an encrypted model key. `docs/security.md` and the
   deletion assertions in `rls.sql` already describe the true behaviour
   precisely, so the pages are a writing job on top of facts that exist, not a
   research job.
4. **URL fetching plus `openai_compatible`, in one slice.** Both are the same
   SSRF surface and both go behind `src/core/url-guard.ts`, which is already
   written and tested. Deferred three times now. It brings the posting URL field
   PROJECT.md section 9 promises, and the base-URL field the provider picker is
   missing.
5. **The NIM verification run.** `openai_compatible` has never been proved
   against a real host. NVIDIA NIM is the intended target and it belongs in the
   same slice as item 4, because that path has adapters, a guard and a base URL
   that have all been tested only against mocks.
6. **The Spanish gate's first real-world test.** Every run so far has been
   English. `findBannedWords` and `findEmDashes` have Spanish coverage in the
   unit suite, and `groundProfile` carries Spanish month names, but no real
   Spanish CV has ever been parsed and no Spanish application has ever been
   generated against a real posting. The no-invention gate is the product's
   soul, and half of its intended market has never exercised it.

## Verification

Measured and pasted, not asserted. Every item is a command with output.

- **Both CI jobs green on the branch** before this is called done.
- **A real upload end to end**, driven by `curl` against the running app with a
  real session cookie and the real CV: the SSE events in order, then the
  `profiles` row and the `cvs` bucket object queried afterwards.
- **The wall clock per stage**, so the `maxDuration` choice stays a measurement.
  Compare it against the 55.52s recorded above and say whether it moved.
- **The key appears in no event of that stream**, proved by piping the whole
  stream to a file and grepping it against `$APLICA_DEV_API_KEY` without
  printing the key.
- **Every one of the seven extraction failures**, each as its own request, each
  shown to produce its own code and to make zero provider calls. Build the
  fixtures: an empty file, an oversized file, a JPEG named `.pdf`, a real `.doc`,
  a password-protected PDF, a truncated PDF, and **a real scanned image-only
  PDF**. That last one is the case a real user hits.
- **A grounding finding surfaced**, by parsing a CV and showing the response
  carries the findings and dropped anchors rather than swallowing them.
- **The parse limit**, proved by setting it to 1 for the run: the second request
  is refused before any provider call, the counter is queried and pasted, and
  the generation counter is shown to be untouched.
- **The screen**, at both locales, with all five states captured, plus the
  DESIGN.md section 10 checklist run by measurement and the `avoid-ai-design`
  audit showing zero P0/P1.
- `typecheck`, `lint`, `format:check`, `build`, `test`, and the suite with every
  provider and Supabase variable unset.

## Commits

1. `feat(core): report what grounding changed instead of swallowing it`
2. `feat(lib): spend one parse against its own daily limit`
3. `feat(api): the CV route, upload to stored profile`
4. `test(api): a file that is not a CV never reaches a model`
5. `feat(ui): the CV upload screen`
6. `docs(security): getDecryptedKey has a second caller`

Six, fine-grained for the same reason as last time: commits 2, 3 and 4 touch a
plaintext credential and the user's money, and keeping them separate is what
makes a single `git revert` possible when one of them turns out to be wrong.
Merge with a merge commit rather than a squash so that stays true on `main`.

Every git command scoped with
`-C "C:\Users\user-1\Documents\Personal Projects\aplica"`.

## Definition of done

A signed-in user with a stored key can open the CV screen, upload a PDF or docx,
watch honest progress for the minute it actually takes, and end with a parsed
profile in the database, their CV in the private bucket, and a plain account of
what the grounding check changed. A scan, an oversized file, a `.doc` and a
password-protected PDF each get their own calm sentence and cost zero tokens.
Their key never leaves the server, and their daily parse limit is enforced
before a token is spent.

At that point the product has no hole under it: a new user can go from signing
up to a downloaded, tailored application without ever opening a terminal. What
is left after this slice is screens on top of working routes, and the launch
list in the deferred section.
