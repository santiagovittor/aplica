# Slice 6 — carried over from step 5

Step 5 wrote this section. Everything below is a thing step 5 found and could
not act on inside its own scope. The rest of this file is yours to write.

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

## Spec: optional enrichment from GitHub and a portfolio URL

Deferred here from step 5 deliberately. It is not a small addition, and the
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

What a real run catches that no test can:

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
  `src/core/parse-cv.ts` raises `maxTokens` to `PARSE_MAX_TOKENS` (8192). The
  4096 provider default truncates a full profile into unparseable JSON, so
  whatever the apply pipeline sets, do not assume the default is enough.
- `saveProfile(userId, profile, cvBytes)` in `src/lib/supabase.ts` writes over
  plain `fetch` with `SUPABASE_SECRET_KEY`. No Supabase SDK exists in the repo
  yet; step 7 adds one for auth and can either keep these fifty lines or replace
  them.
- `npm run parse:cv -- <file>` runs the whole real flow with no UI. It reads
  `APLICA_DEV_PROVIDER` and `APLICA_DEV_API_KEY`, and `--env-file-if-exists`
  means `.env.local` works as well as a shell export. It rides on
  `--experimental-transform-types` because `src/` uses constructor parameter
  properties, which Node's strip-only mode refuses.
