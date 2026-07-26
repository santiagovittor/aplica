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

## Owed verification: the `openai_compatible` path against NVIDIA NIM

The self-hosting and free-tier story rests on `openai_compatible` (PROJECT.md
section 3: NVIDIA NIM, Ollama, OpenRouter, vLLM). It has unit tests and it has
the SSRF guard, but **no run against a real host has ever happened.** Tests
prove the adapter's shape; they do not prove a real OpenAI-shaped endpoint
answers it.

There is a real NIM key available for this. Prove it end to end the same way
step 5 proved Google:

```
APLICA_DEV_PROVIDER=openai_compatible \
APLICA_DEV_API_KEY=<the NIM key> \
  npm run parse:cv -- ./cv.pdf --base-url https://integrate.api.nvidia.com/v1 \
    --model <a model NIM actually serves>
```

`--base-url` and `--model` are both required there: only the host knows what it
serves, so `DEFAULT_MODELS` deliberately has no entry for this provider. Confirm
the base URL and the model string against NVIDIA's own current docs before
running; step 5's rule holds, no unverified model ID ships.

What a real run would catch that the tests cannot: whether NIM's
`/chat/completions` response actually satisfies the Zod schema in `openai.ts`,
whether it honours `max_tokens` at the size a full profile needs, and whether
the SSRF guard's DNS pinning survives a host behind a CDN.

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
