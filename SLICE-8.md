# Slice 8 — the CI plumbing

## Context

The repo has 494 passing tests, a typechecker, a linter, a formatter and a build,
and **nothing runs any of them unless a person types the command**. `.github`
does not exist. Every gate this project has written about itself so far is a gate
on the honour system.

The next slice is auth and the encrypted key vault, which is the highest-stakes
code in the repo. It should not be the one piece of work that no gate ever
watched. That ordering is the whole reason this slice is separate and first.

**Scope is the plumbing and only the plumbing.** A GitHub Actions workflow that
runs `typecheck`, `lint`, `format:check`, `build` and `test` on every push and
every pull request, against the MockProvider, with no API key anywhere in the
environment.

The full "product's soul" gate from KICKOFF step 8 — no em dashes, no banned
words, no line absent from the profile — **is not in this slice**. It needs the
apply pipeline behind a route to assert against, and today the only thing that
runs the pipeline end to end is `scripts/apply.mts`, which needs a real key and
real money. Wiring a gate to a script that CI cannot run would be a green badge
over nothing. The pure functions underneath it (`findEmDashes`,
`findBannedWords`, `groundDraft`) are already covered by the suite this workflow
runs, and `src/render/render.test.ts` already runs the whole gate over rendered
bytes offline. That is the honest amount of soul-gate available today, and it is
already inside `npm test`.

## Decisions taken (say so if any is wrong)

1. **One workflow, one job, sequential steps.** Not a matrix and not five
   parallel jobs. `npm ci` dominates the wall clock, and five jobs means five
   installs of the same lockfile for checks that take seconds each. One job
   installs once. If the suite ever grows past a couple of minutes this splits
   cleanly, and it does not need to be designed for that today.
2. **`npm ci`, not `npm install`.** `package-lock.json` is committed at
   lockfileVersion 3. `ci` fails loudly when the lockfile and `package.json`
   disagree, which is the failure worth catching, and `install` would silently
   resolve a different tree than the one anyone tested.
3. **Node 24, pinned in the workflow, matching the local `v24.14.0`.** The
   scripts depend on Node's own type stripping (`--experimental-transform-types`)
   and on `registerHooks`, both of which are version-sensitive. There is no
   `.nvmrc` and no `engines` field today; this slice adds the pin in one place
   (the workflow) rather than three, and names the omission rather than
   pretending the repo has always been explicit about it.
4. **No secrets in the workflow. Not even dummy ones.** This is the assertion,
   not an oversight: CLAUDE.md section 5 says CI must never hold or need a model
   key, and the way to prove it is for the workflow to have no `env:` block and
   no `secrets.*` reference at all. Every `process.env` read in `src/` sits
   inside a function (`crypto.ts:74`, `url-guard.ts:290`, `supabase.ts:227`
   and `:236`) rather than at module scope, so nothing is read at import time
   and `next build` should not need a single variable. **That is a claim this
   slice must prove locally before the workflow is written**, not assume — see
   Verification.
5. **A failing step does not hide the steps after it.** Later steps carry
   `if: ${{ !cancelled() }}` so one formatting slip does not mask a type error
   and cost a second round trip. The job still fails; it just reports everything
   it found. This is the one piece of YAML in the file that is not obvious, so
   it gets a comment.
6. **Order is cheapest-first, then most valuable:** `format:check`, `lint`,
   `typecheck`, `test`, `build`. Formatting fails in seconds and is the most
   common miss. `build` runs last because it is the slowest and the least likely
   to be the thing that broke.
7. **`concurrency` cancels superseded runs on the same ref.** Free-tier minutes,
   and nobody wants the result of the commit before the one they just pushed.
   `main` is excluded from cancellation so the trunk's history of green stays
   complete.
8. **`permissions: contents: read`.** The default token is broader than this job
   needs and this job needs nothing but a checkout. Least privilege on a
   workflow costs one line.
9. **`cache: 'npm'` on `actions/setup-node`.** One line, keyed on the lockfile,
   and it is the difference between a 90-second job and a 20-second one.

## Blocked on you

1. **Branch protection is yours, not mine.** A workflow that reports red on a
   pull request still merges unless the repo requires the check. I cannot set
   that and would not want to: it is a GitHub setting on your account, and
   turning it on is the moment CI stops being advisory. Once the first run is
   green, the setting is Settings → Branches → require the `ci` check. Say if
   you want it and I will name the exact check string in the docs; flipping it
   is still your click.
2. **Nothing else.** No new dependency, no service, no account, no cost.

## Not built, and the reasons

- **The `supabase/tests/rls.sql` run.** It needs a live Postgres, which in CI
  means `supabase start` in the job: Docker, a several-minute cold start, and a
  second failure surface. Today nothing in this slice changes an RLS policy, so
  the cost buys nothing. **Slice 9 is where it earns its keep** — that slice
  touches auth, `api_keys` and account deletion, which is exactly what
  `rls.sql` guards — so the decision to add a database job belongs there, with
  the work that makes it necessary.
- **The soul gate on a real pipeline run.** See Context. It arrives with the
  generation route.
- **Preview deploys.** Vercel does this from its own GitHub integration, not
  from a workflow. Wiring a duplicate deploy step here would fight it.
- **A matrix across OS or Node versions.** The product deploys to one runtime on
  Vercel. Testing Windows and macOS runners proves something nobody ships.
- **A coverage report, a badge, a bundle-size check, dependency review,
  CodeQL.** All defensible later; none of them is the thing standing between
  auth and a gate that watches it.

## Files

| File                       | What                                              |
| -------------------------- | ------------------------------------------------- |
| `.github/workflows/ci.yml` | the whole slice                                   |
| `docs/setup.md`            | `+` a short section: what CI runs and how to run the same thing locally |
| `package.json`             | possibly nothing; see decision 3 if a `check` script earns its place |

Nothing in `src/` is touched. If a check fails on code that is currently in
`main`, that is a finding to report and fix in **its own commit**, not something
to quietly paper over inside the workflow (CLAUDE.md rule 10).

## The workflow, in shape

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:
permissions: { contents: read }
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24', cache: 'npm' }
      - run: npm ci
      - run: npm run format:check
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

Actions are pinned to major tags rather than commit SHAs. SHA pinning is the
stricter supply-chain posture and it is a real argument; for a repo with no
secrets in the workflow and `contents: read`, a compromised action can read
public source and nothing else. Say if you want SHAs and it is a one-line
change per action.

## Verification

Measured and pasted, not asserted. A workflow is code nobody unit-tests, so the
proof is a run.

- **Before writing the YAML**, prove decision 4 locally: run `typecheck`, `lint`,
  `format:check`, `build` and `test` in a shell with `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_SECRET_KEY`, `API_KEY_ENCRYPTION_KEY`, `APLICA_DEV_PROVIDER` and
  `APLICA_DEV_API_KEY` all unset, and paste the result. If `next build` turns out
  to need a variable, that is a finding about the app, and it changes this slice.

  **Half of this is already measured**, when this spec was written: whole-repo
  `format:check` and `lint` with all six variables unset both exit 0, so slice 8
  does not open with a red on untouched code. `typecheck`, `test` and `build`
  were run this session with `.env.local` present, so the unset case for those
  three is still genuinely unproven, and `build` is the one that could
  plausibly break.
- **Prove `npm ci` works from the committed lockfile**, in a clean clone or with
  `node_modules` moved aside. A lockfile that only resolves against an existing
  tree is a green local and a red CI.
- **A real run on a branch, with its URL and its per-step outcome pasted.**
  Reading the YAML is not evidence.
- **The gate must be seen to fail.** Same principle `src/render/render.test.ts`
  applies to the slop gate: a check that has never fired is not known to work.
  Push one commit that breaks exactly one thing (a stray unformatted line),
  confirm the run is red and that decision 5 held — that the steps after it
  still reported — then revert. Paste both runs.
- The total wall clock of a green run, so the "one job" decision is measured
  rather than argued.

## Commits

1. `ci: run the checks on every push and pull request`
2. `docs(setup): what CI runs, and running it locally`

Two, unless the pre-flight finds something in `main` that fails a check, in
which case that fix is its own commit before either of these and gets named in
the report.

Every git command scoped with
`-C "C:\Users\user-1\Documents\Personal Projects\aplica"`.

## Definition of done

The workflow exists, a real run is green on a branch, a deliberately broken
commit was seen to turn it red with all steps still reporting, `docs/setup.md`
says what runs, and slice 9 does not start until this is committed on `main`.
