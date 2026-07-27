# Slice 6 — the apply flow

## Context

Step 5 closed flow 1: a CV becomes a validated, grounded, source-tagged profile
in `profiles.data`. Nothing reads it yet. This step closes flow 2 (PROJECT.md
section 5):

**job posting + profile + tier -> draft call -> reviewer call in a fresh context
-> revision pass -> a validated application, gated.**

The three prompts already exist and are tested as strings (`draft.ts`,
`reviewer.ts`, `prompts.test.ts`). Nothing calls them. This step is the pipeline
that does, plus the gate that decides whether its output is allowed to exist.

**The gate is the point of the slice.** CLAUDE.md section 5 names three CI gates
as "the product's soul as a test": zero em dashes, zero banned words, and no line
absent from the profile. `findEmDashes` and `findBannedWords` cover the first
two and are unused. The third does not exist yet.

Framework-free, like step 5: `src/core`, tested against `MockProvider`, proved by
a script. No route handler, no SSE, no screens.

## Decisions taken (say so if any is wrong)

1. **Scope is flow 2 only.** Flow 3 (render to PDF/DOCX, store an application
   row) is a separate slice. Splitting them is PROJECT.md's own reasoning:
   generation and rendering are split so a retry can re-render without paying for
   the model again. Building them together would fuse what the spec deliberately
   separates.
2. **The cheap default model, not the parse model.** Apply runs on every job;
   parse runs once. `PARSE_MODELS` stays untouched and the apply path uses
   `DEFAULT_MODELS`. This is the other half of the decision you already took.
3. **The reviewer's critique is passed through opaquely.** It is text in a
   FIXES / HARD FAILS / VERDICT block, not JSON. The pipeline checks it is
   non-empty and hands it to the revise call verbatim. No critique parser: the
   prompt already guarantees the format is identical with or without research,
   and a parser would be a second thing to keep in sync with the prompt for no
   gain.
4. **Company research follows `provider.supportsSearch`,** defaulting on where
   available, with an explicit override parameter. The visible toggle and its
   cost line are step 7's, per PROJECT.md section 5.
5. **The posting comes in as text.** The script takes a file path or stdin. No
   URL fetching: that is the same SSRF surface as the enrichment slice, and it is
   specced there, not here.

## Blocked on you

1. **The applicant's name.** `VoiceProfile` needs `name` and `profileSchema` has
   no name field, deliberately. It cannot be derived from the profile without
   inventing it. Proposal: a `--name` flag on the script now, from the auth
   session in step 7. Confirm, or name another source.
2. **How the profile reaches the prompt.** `draftUserMessage` takes a string.
   Your profile measured 20,337 characters, and it is sent on all three calls.
   Proposal: `JSON.stringify(profile)`, no indentation, nothing dropped. It keeps
   every `source` and `evidence` tag, which the prompts explicitly reason about
   ("an entry marked `evidence: weak` stays weak"). Roughly 15,000 input tokens
   per call, about 45,000 for a full apply, which on the cheap model is cents.
   The alternative is a trimmed markdown rendering: cheaper, and it throws away
   the tags the no-invention rule runs on. I recommend the JSON.
3. **A real job posting** for the proof run, as a text file. Ideally one you
   would actually apply to, and ideally one where the honest answer is `skip`, so
   the fit scoring gets tested on something other than a flattering case.
4. **Tier for the proof run.** `basic` is resume only; `standard` and `full` add
   a cover letter. I suggest `standard`, because it exercises the cover-letter
   path and both documents then go through the gate.

## The marker collision is now the first problem, not a footnote

Step 5 hit this once and routed around it. Slice 6 has three system prompts
instead of one, and they are about each other, so the collision surface is much
worse. `createMockProvider` picks its canned answer by the **longest** response
key found in the lowercased system prompt.

Measured against the real prompt sources:

| candidate marker | appears in |
| --- | --- |
| `draft` | draft, revise, reviewer **and** parse |
| `reviewer` | draft, revise **and** reviewer |
| `revise` | draft, revise **and** reviewer ("revises once") |
| `critique` | draft, revise and reviewer |
| `# apply` | draft only |
| `# revise` | revise only |
| `# reviewer` | reviewer only |

`reviseSystemPrompt` contains the sentence "a **reviewer** critiqued them", so a
fixture keyed `reviewer` (8 characters) beats one keyed `revise` (6) on the
revise call, and the revise step silently receives the critique fixture. The
failure surfaces as a JSON parse error three steps away from its cause.

So the markers are the headings: `'# apply'`, `'# revise'`, `'# reviewer'`, next
to step 5's `'parse a cv'`.

**This gets its own commit, first, and its own test:** build all four system
prompts, and assert every marker appears in exactly one of them. A matrix, not
four separate assertions, because the thing that breaks is a pair. Written first
because every other test in the slice depends on the fixtures routing correctly.

Note the surface is **system prompts only**. `reviseUserMessage` contains the
heading "## Reviewer critique", which is harmless: the mock never looks at user
messages.

## The third gate: line provenance

The one CLAUDE.md requires and nothing implements.

**Not `groundProfile`.** Its signature is `(Profile, sourceText)` and it corrects
a profile against a CV. This checks generated prose against a profile. Different
inputs, different output, same rule underneath.

**Not exact substring matching.** A resume line is *supposed* to be reworded:
that is the keyword bank's entire function. An exact test would reject the
feature the product is built on.

**Not a similarity threshold, and not an LLM judge.** Both were measured and
rejected in step 5 with the numbers written into `docs/grounding.md`. Nothing
about this input makes them work better here.

So: the same rule that survived. **Every number and every capitalised entity in
the drafts must appear in the profile text.** A fabricated metric, a company the
profile never names, a tool never listed: all capitalised or numeric, all caught.
A rewording of a real claim passes untouched.

Implementation goes **in `grounding.ts`**, not a new module. `numbersIn` and
`entitiesIn` are already there and private; a second exported function beside
them reuses both without widening the API, and keeps one file as the place where
"is this claim real" is answered. `docs/grounding.md` gains the second half.

Two things that need deciding when the code is written, and are cheap to get
wrong:

- The drafts contain the **company's own name**, from the posting, which is
  correctly absent from the profile. The posting text has to be a second
  permitted source for entities. Not for numbers: a number in the posting is
  their requirement, not the applicant's evidence, and letting it through is how
  "5 years experience" becomes the applicant's.
- Section headings the drafter writes ("Experience", "Skills") are capitalised
  and are not claims. Same shape as `DOCUMENT_TERMS` in `grounding.ts`.

The gate is a Vitest test running the whole pipeline against `MockProvider`, so
a failure fails the build with no key and no network.

## Files

| File | What |
| --- | --- |
| `src/core/application.ts` | the Zod schema for the draft/revise JSON, and `ApplicationError` |
| `src/core/application.test.ts` | schema behaviour, including a rejected `recommendation` |
| `src/core/apply.ts` | the pipeline: draft -> review -> revise |
| `src/core/apply.test.ts` | against `MockProvider`, including the gate |
| `src/core/grounding.ts` | `+ groundDraft(text, { profile, posting })` |
| `src/core/grounding.test.ts` | the reworded-claim case, and the company-name case |
| `src/prompts/prompts.test.ts` | the marker containment matrix |
| `scripts/apply.mts` | the proof runner |
| `package.json` | `+ "apply"` script |
| `docs/grounding.md` | the draft-side half of the rule |

Nothing in `src/providers/`, `src/prompts/*.ts` (the prompts themselves),
`src/ui/`, `src/app/` or `messages/*.json` is touched. No new dependency.

## `src/core/apply.ts`

```ts
applyToPosting(provider, { posting, profile, name, tier, language?,
  salaryFloor?, timezone?, research?, model?, signal? }): Promise<ApplyResult>
```

Three calls in order, each validated at its boundary:

1. `draftSystemPrompt` + `draftUserMessage` -> JSON -> `applicationSchema`.
2. `reviewerSystemPrompt` + `reviewerUserMessage` -> text. Non-empty or it
   throws. **A fresh message array**, not a continuation: the reviewer judging
   its own draft is the failure the second call exists to prevent.
3. `reviseSystemPrompt` + `reviseUserMessage` -> JSON -> `applicationSchema`.

Returns the revised application, the critique, and the gate findings. The
critique is returned rather than swallowed because step 7 shows the user what
was fixed.

`ApplyResult` carries `slop: SlopFinding[]` and `ungrounded: GroundingFinding[]`
rather than throwing on them. The pipeline reports; the gate test and, later, the
route decide what a finding means. A finding after the revision pass is a prompt
failure worth seeing, not an exception to swallow.

**`APPLY_MAX_TOKENS` is explicit and marked unmeasured.** `DEFAULT_MAX_TOKENS` is
4096 and a two-page resume plus a cover letter inside that JSON shape will exceed
it, exactly as 8192 truncated the profile in step 5. I will set a number with
headroom, and the first real run measures the true one, which then goes in the
comment. No guessed number ships unlabelled.

Errors carry paths and stage names, never the posting text, the drafts or the
profile. Same rule as `ProfileParseError`: an error reaches logs, and all three
are personal data.

## Commits

1. `test(prompts): prove each stage's mock marker is unique`
2. `feat(core): validate an application the model returned`
3. `feat(core): draft an application from a profile and a posting`
4. `feat(core): critique in a fresh context, then revise`
5. `feat(core): fail the build on slop or an unsupported claim`
6. `chore: add the apply script`

Every git command scoped with
`-C "C:\Users\user-1\Documents\Personal Projects\aplica"`.

## Verification

Measured and pasted, not asserted.

- `typecheck`, `lint`, `format:check`, `build`, `test`, plus the suite with every
  provider environment variable unset.
- A real posting run end to end on your Gemini key: fit score, recommendation,
  keyword coverage, and both documents in full.
- **The gate run over that real output**: em dashes, banned words, and every
  number and entity that does not trace to the profile, listed rather than
  summarised.
- The three keyword-bank terms that actually reached the resume, next to the
  posting lines that pulled them in. That is the mechanism working or not.
- A fixture where the reviewer demands a claim the profile cannot support, and
  proof the revise call refuses it and flags it instead.
- Blunt verdict on whether the drafts are sendable, before the step is called
  done.

## Not built

No route handler, no SSE, no streaming, no `maxDuration`. No PDF or DOCX render,
no `applications` row, no Storage write for outputs. No screens, no copy in
`messages/*.json`, no auth. No `usage_counters` increment: PROJECT.md section 11
ties rate limiting to a generation request, which is a route and session concern,
so it belongs with the route. Naming it here so it is not lost. No enrichment,
no change to `src/providers/` or the prompts themselves.

---

# Carried over from step 5

Step 5 wrote everything below. Each is a thing step 5 found and could not act on
inside its own scope.

## Landmine: the MockProvider marker `draft` also matches the parse prompt

`createMockProvider` picks its canned answer by finding the **longest** key of
its response table inside the lowercased system prompt, with ties broken by
insertion order (`src/providers/mock.ts`).

`src/prompts/parse.ts` contains the phrase "the drafting step" twice, in the
provenance and voice-anchor sections. So:

- the marker `draft` (5 characters) **matches the parse prompt**;
- the obvious fixture key `parse` is also 5 characters;
- `draft` is declared first in `MOCK_RESPONSES`, so on a tie it wins.

The failure is silent. A parse test keyed on `parse` gets the draft stage's
prose back, `JSON.parse` fails, and the error says the model returned something
that is not JSON, which points at the wrong thing entirely.

**Use a marker that is longer than 5 characters and unique to the prompt.**
Step 5 uses `'parse a cv'` (10 characters, from the prompt's first heading
"# Parse a CV into a source-tagged profile"), and `src/core/parse-cv.test.ts`
carries the same explanation:

```ts
const MARKER = 'parse a cv';
createMockProvider({ responses: { [MARKER]: profileJson() } });
```

Step 5 did not change `src/providers/` to fix this, because SLICE-5 forbade it.
If step 6 wants the collision gone rather than routed around, the fix is in the
mock's marker table, not in the prompt: renaming anything in `parse.ts` to dodge
a test fixture would be the tail wagging the dog.

## Spec for a later slice: enrichment from GitHub and a portfolio URL

**Not part of slice 6.** It is specced here because step 5 found it; it lands
after the apply flow, and it is blocked on the GitHub token decision below.

Deferred from step 5 deliberately. It is not a small addition, and the
reason is structural rather than a matter of effort: it changes the provenance
model that step 5's schema and grounding check are built on. Building it on top
of them is clean; building it alongside would have meant rewriting both.

### Why `supportsSearch` is the wrong gate

The instinct is to gate this on `Provider.supportsSearch`. That flag describes
whether a **provider** can run its own server-side web search tool as part of a
model call. Fetching a GitHub profile or a personal site is something **our
server** does with plain `fetch`, before the model call, and it needs no provider
capability at all. Gating on that flag would deny the feature to providers that
handle it perfectly well, including every `openai_compatible` host, which is
exactly the audience this feature matters most to.

The real gates are: the user supplied a URL, and the URL passed the SSRF check.

### The provenance model changes: `sourceRef`

Today every claim carries `source: "extracted"` and `groundProfile` checks it
against one text. With three inputs that is no longer enough, because "extracted"
stops identifying anything.

```
sourceRef: 'cv' | `github:<owner>/<repo>` | `site:<url>`
```

Every entry gains it, and grounding becomes per-source: a claim citing
`github:santiagovittor/canvass` is checked against **that README's** text, not
against the union of everything. Checking against the union is the failure mode
to avoid, because it lets a claim borrow credibility from a document it has
nothing to do with.

Consequences to plan for, not discover:

- `profiles.source_text` becomes insufficient. It needs to be one text per
  source: a `profile_sources` table keyed by `(user_id, ref)`, or a jsonb map.
  A table is the better bet, because a README is large and a profile read should
  not drag every source with it.
- `groundProfile` takes a map of sources rather than one string, and a claim with
  an unknown `sourceRef` is a validation failure, not a pass.
- `parse.ts` has to keep the refs straight across several documents, which is a
  materially harder instruction than the single-source prompt it is now.

### The fetch-and-clean stage

A new stage before the model call, with its own failure modes. Each of these is
a real case, not a hypothetical:

- **GitHub, unauthenticated, is 60 requests per hour per IP.** A hosted app on
  Vercel shares egress IPs across all users, so this budget is shared and will be
  exhausted by a handful of parses. Either the user supplies a token (another
  credential to encrypt, which is section 6 territory) or the app holds one
  (5,000/hour, but now it is our credential and our rate limit). **This is a
  decision, not an implementation detail.** Do not start until it is made.
- READMEs are not prose. Badge walls, HTML blocks, tables of contents, embedded
  base64 images. A 200 KB README is normal. Clean to text, cap the size the way
  `MAX_CV_BYTES` does, and cap the number of repos.
- A personal site may be a client-rendered app whose HTML contains no text at
  all. That fails honestly, like a scanned PDF: a specific code and a message.
- Anything fetched must be cached per parse. Re-fetching a README because a
  retry happened is how a rate limit gets burned.

### SSRF is a first-class item here, not a footnote

`assertSafeBaseUrl` in `src/core/url-guard.ts` exists and is the right guard to
reuse, but a user-supplied base URL in a settings form and an arbitrary URL
pasted into an onboarding field are not the same surface. Before any of this
ships, review at minimum:

- https only, no credentials in the URL, and every resolved address checked, not
  just the first.
- Redirects refused rather than followed, because a redirect walks a second
  unchecked host past the guard.
- DNS pinned between check and connect, which is what `postJsonPinned` exists
  for. A plain `fetch` cannot do it and would reopen the rebinding window.
- A response size cap and a timeout, so a slow or endless body cannot hold a
  serverless function open.
- `ALLOW_PRIVATE_PROVIDER_HOSTS` must **not** be reused to widen this. A
  self-hoster pointing a model endpoint at their own Ollama is a deliberate
  choice about their own machine; it is not consent to fetch arbitrary internal
  URLs.

### Cost, measured

Against the real CV as the baseline:

```
system prompt   4,547 chars   ~1,137 tokens
CV text         4,499 chars   ~1,125 tokens
current input                 ~2,262 tokens
current output               ~17,400 tokens (measured, enumerating)
```

Five READMEs at ~2 KB of cleaned text add roughly 2,500 input tokens; a portfolio
page adds 500 to 1,500. Input roughly doubles. That fits one call inside Gemini's
context with room to spare, so **no second model call is needed for capacity**.
The output grows too, because there is more to enumerate, and output is where the
money is: on `gemini-3.6-flash` at $7.50 per million output tokens, the parse is
already about $0.14 and this could push it past $0.20. Still once per user.

### Scope fence

In: user-pasted GitHub profile or repo URLs, and one personal site URL. Out:
crawling, link-following, discovery, job-board scraping, anything the user did
not explicitly hand over.

## Owed verification: the `openai_compatible` path against NVIDIA NIM

The self-hosting and free-tier story rests on `openai_compatible` (PROJECT.md
section 3: NVIDIA NIM, Ollama, OpenRouter, vLLM). It has unit tests and it has
the SSRF guard, but **no run against a real host has ever happened.** Tests prove
the adapter's shape; they do not prove a real OpenAI-shaped endpoint answers it.

There is a real NIM key available with many models. Prove it end to end the same
way step 5 proved Google:

```
APLICA_DEV_PROVIDER=openai_compatible \
APLICA_DEV_API_KEY=<the NIM key> \
  npm run parse:cv -- ./cv.pdf --base-url https://integrate.api.nvidia.com/v1 \
    --model <a model NIM actually serves>
```

`--base-url` and `--model` are both required: only the host knows what it serves,
so `DEFAULT_MODELS` and `PARSE_MODELS` deliberately have no entry for this
provider. Confirm both strings against NVIDIA's own current docs first; step 5's
rule holds, no unverified model ID ships.

### Attempted, and what it found

Run on 2026-07-27 against `https://integrate.api.nvidia.com/v1`. It found one
real bug and then hit a wall on NVIDIA's side.

**Bug found and fixed (`6a9bc48`).** `guardedLookup` called back with a string
address. Node turns on `autoSelectFamily` by default from 20 onward, so a socket
asks for `{ all: true }` and reads `addresses[0].address` off the answer; against
a string that is `undefined`, and **every pinned request died before it left the
machine** with `Invalid IP address: undefined`. The suite missed it because every
test called the lookup the way the module expected rather than the way node does.
This is the entire justification for the run: the adapter had unit tests and had
never opened a socket.

**Then NIM stopped answering.** Measured, same key throughout:

```
GET  /v1/models                              200, instant, 102 models
POST /v1/chat/completions  bad key           403 in 0.6s
POST /v1/chat/completions  max_tokens 32768  504 after 302s   (one-word prompt)
POST /v1/chat/completions  max_tokens 512    no response at 90s
POST /v1/chat/completions  nemotron-nano-8b  no response at 60s
POST /v1/chat/completions  deepseek-v4-flash no response at 60s
```

A bad key is refused in under a second, so the endpoint is reachable and the
model IDs are real (they came from `/v1/models`, which is a better authority than
the docs). The real key is accepted and then inference queues indefinitely. That
is capacity or credits on that account, not our code and not the cap: a 504 after
five minutes on a one-word prompt is a timeout, not a rejection.

**So `max_tokens: 32768` remains untested.** It is still the single most likely
thing to fail, and the run did not settle it.

What is proven: the adapter builds the request, the SSRF guard resolves and pins
the address, TLS connects, the request is sent, and the host's real status comes
back as a `ProviderError`. What is not: that a 200 body from NIM satisfies the
Zod schema in `openai.ts`, and that a non-Gemini model can hold the enumerated
profile shape.

Retry needs a working NIM account, or any other OpenAI-shaped host: Ollama on
this machine would prove the same path for free, and would settle the cap
question on a small model, which is the harsher test anyway.

The old checklist stands. What a real run catches that no test can:

- whether NIM's `/chat/completions` response satisfies the Zod schema in
  `openai.ts`;
- **whether it accepts `max_tokens: 32768`.** Step 5 raised `PARSE_MAX_TOKENS`
  to that after measuring a full profile at ~17,400 output tokens. Some hosts
  reject a cap above their model's limit rather than clamping it, and a small
  self-hosted model may cap far lower. This is the single most likely thing to
  fail, and it is recorded in a `ponytail:` comment in `src/core/parse-cv.ts`;
- whether the SSRF guard's DNS pinning survives a host behind a CDN;
- whether a model that is not Gemini or Claude can hold the enumerated profile
  shape at all, which the cheap Gemini model intermittently could not.

## Still open from step 4, untouched by step 5

- **OpenAI cannot do company research.** Its `web_search` tool runs on the
  Responses API; the adapter speaks `/chat/completions` because that is what the
  OpenAI-compatible hosts speak. `supportsSearch` is `false` for OpenAI with the
  reason recorded in `openai.ts`. The fix is a second request shape in that
  adapter, and it is an unmade scope decision.
- **Anthropic's search model is `claude-opus-5`** because the docs never
  enumerate which models support web search. Haiku 4.5 is unconfirmed rather
  than unsupported. The Models API `capabilities` object would settle it in one
  call, which needs a live Anthropic key. **Step 5 could not check this: there is
  no Anthropic API key available, only a Claude Code subscription.** It stays
  open until someone has a key in hand.
- **The Spanish banned-word list has known collisions** documented in
  `src/core/slop.test.ts`. The list is curated by hand; nobody removes an entry
  unilaterally.

## What step 5 leaves step 6 to build on

- `profileSchema` and `Profile` in `src/core/profile.ts`. `source` is
  `z.literal('extracted')`, not an enum: when the step 7 voice calibration
  introduces `verbatim`, widening that literal is the one-line change, and the
  tests that pin the current behaviour are already in `profile.test.ts`.
- `keywordBank` entries are `{ ownTerm, fieldTerms[], provenBy, source }`. No
  `evidence` field, because a mapping is proven by `provenBy` rather than graded.
  `draft.ts` consumes this shape.
- `parseCv(provider, cvText, { locale, model, signal })` in
  `src/core/parse-cv.ts` raises `maxTokens` to `PARSE_MAX_TOKENS` (32768,
  measured from a real 17,400-token profile). The 4096 provider default truncates
  a full profile into unparseable JSON, so whatever the apply pipeline sets, do
  not assume the default is enough.
- `groundProfile(profile, sourceText)` in `src/core/grounding.ts` runs inside
  `parseCv`, so a profile is already grounded before anything downstream sees it.
  Its rules and its measured blind spots are in `docs/grounding.md`.
- `saveProfile(userId, profile, cvBytes, sourceText)` in `src/lib/supabase.ts`
  writes `profiles.source_text` alongside the profile, over
  plain `fetch` with `SUPABASE_SECRET_KEY`. No Supabase SDK exists in the repo
  yet; step 7 adds one for auth and can either keep these fifty lines or replace
  them.
- `npm run parse:cv -- <file>` runs the whole real flow with no UI. It reads
  `APLICA_DEV_PROVIDER` and `APLICA_DEV_API_KEY`, and `--env-file-if-exists`
  means `.env.local` works as well as a shell export. It rides on
  `--experimental-transform-types` because `src/` uses constructor parameter
  properties, which Node's strip-only mode refuses.
