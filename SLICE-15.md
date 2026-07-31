# Slice 15 — the third input, the fourth provider, and the run that proves it

## Start here (this runs in a fresh session)

Nothing from the slice 13 session carries over. Read this section first.

**Read:** this file, `PROJECT.md` sections 5 and 6, `src/core/url-guard.ts` in
full, `src/lib/api-keys.ts`, `src/providers/openai.ts`, `src/providers/types.ts`,
`src/providers/defaults.ts`, `src/app/api/generate/route.ts`,
`src/app/[locale]/apply/` (the screen slice 13 built), `src/app/[locale]/account/`.
**Do not** read SLICE-4 through SLICE-13, and do not load the repo wholesale.

**Repo state.** As of writing, slice 13 (`/apply`) is either merged to `main` or
open as its own PR — check `gh pr list` first, same discipline as every slice
since 10. Playwright and `e2e/apply.spec.ts` may or may not have landed with it;
slice 13's own doc named that as a real risk (Playwright deferred five times
already) rather than let it drop silently. If it is still missing, that is not
this slice's problem to solve, only to not make worse.

**Why these three are one slice, still.** SLICE-13 decision 9 grouped them on
purpose: URL fetching, the `openai_compatible` provider UI, and the NIM
verification run have each been deferred since slice 9, individually, every
time, because each one alone looked too small to justify a session and too
easy to push one more slice. They share one root cause — a URL the server
fetches on a user's behalf is an SSRF surface, and `src/core/url-guard.ts` was
written once, generically, to guard exactly that shape of thing, for two
different callers (a job posting URL, and an `openai_compatible` base URL).
Building them together means the guard gets exercised by two real callers
instead of one speculative one, and the fourth provider gets a UI the same
session it gets a real host to prove it against.

## Context

PROJECT.md section 5 promises four providers behind one `Provider` interface:
Anthropic, OpenAI, Google, and `openai_compatible` — "the OpenAI adapter
parameterised by a base URL, which reaches every OpenAI-shaped host without a
fourth code path." Section 6 names the targets: NVIDIA NIM, Ollama, OpenRouter,
vLLM. The adapter code has existed since slice 6 (`src/providers/openai.ts`),
the SSRF guard has existed since slice 6 (`src/core/url-guard.ts`, layered:
literal-address check at save time, DNS-resolution check before the request,
and a pinned `guardedLookup` handed straight to `https.request` so the
approved address is the address the socket uses), and the database has been
ready since slice 6 (`api_keys.base_url`, nullable, with a check constraint
that it is set if and only if `provider = 'openai_compatible'`). **None of it
has a UI.** `KEY_PROVIDERS` in `src/lib/api-keys.ts` is `['anthropic', 'openai',
'google']` — the fourth is legal in the column and absent from every place a
user could pick it.

Screen 3 (PROJECT.md section 9) promises a URL field on `/apply` as a
"best-effort convenience," alongside the paste box, with a named failure mode:
"LinkedIn, Workday, and most ATS pages block automated fetching or sit behind
auth, so a failed fetch shows a calm 'that site won't let us read it, paste the
posting text instead' and focuses the paste box." Slice 13 built the paste box
and left this out on purpose (decision 9), so the empty state on `/apply` today
has no URL field at all.

**The NIM run has a real history worth reading before repeating it.**
SLICE-6.md's own "Owed verification" section, and SLICE-7.md's follow-up, both
tried this and both hit real walls — worth re-reading in full rather than
summarised here, but the short version: `GET /v1/models` always answered fast;
`POST /v1/chat/completions` queued indefinitely or timed out on the accounts
available at the time, for reasons neither slice could pin down further than
"capacity or credits on that account, not our code."

**Slice 13's own session took this further, unprompted, with a key handed over
for exactly this purpose, and the finding is new enough to record precisely.**
Run on 2026-07-31 against `https://integrate.api.nvidia.com/v1`, key
authorised for this repo's build and test use only:

```
GET  /v1/models                                         200, 0.66s, 102 models
POST /v1/chat/completions  short prompt, max_tokens 10    200, 1.07s, real content
POST /v1/chat/completions  short prompt, max_tokens 16384 200, 2.43s, finish_reason "stop"
POST /v1/chat/completions  ~23KB body,   max_tokens 16384 timeout, 0 bytes, twice, ~39-40s
POST /v1/chat/completions  ~23KB body,   max_tokens 200    200, 4.07s, real content
POST /v1/chat/completions  ~23KB body,   max_tokens 4096   200, 8.52s, real content
POST /v1/chat/completions  ~23KB body,   max_tokens 1000-2000  timeout, 0 bytes (40s cap)
```

Two things this settles that slice 6 left open. **First**, `max_tokens: 16384`
— named there as "the single most likely thing to fail" — is not the problem
by itself: a short prompt at that cap returns in 2.4 seconds. **Second**, the
failure is not connectivity, not our pinned-socket code, and not this repo's
`openai.ts` adapter: a plain `curl` with the same ~23KB body, no Node, no
SSRF guard, no `core/apply.ts` in the loop, times out identically. What
actually triggers it is a **large input combined with a large requested output
budget** — small input plus the full 16,384 cap works; the same large input at
`max_tokens: 200` works in 4 seconds; at `max_tokens: 4096` it worked once in
8.5 seconds; at 1000-2000 it timed out. That last pair does not resolve into a
clean threshold — free-tier NIM capacity is shared and evidently varies run to
run, which matches "capacity, not a bug" rather than a fixable number.

**What this means for the slice:** `src/core/apply.ts`'s `APPLY_MAX_TOKENS` is
`16_384`, fixed, with no per-provider override, and every draft/revise call
sends the full profile plus the posting — comfortably in the size range that
triggered the timeout above. An `openai_compatible` host on constrained
capacity (a free NIM key, a small self-hosted model, a personal Ollama box)
may not be able to complete a real generation at the app's current cap at all.
This is not this slice's problem to solve by lowering `APPLY_MAX_TOKENS`
globally — that number was set from a real Gemini measurement (`apply.ts`'s
own comment) and this slice has no equivalent measurement for a capable
provider. It is this slice's problem to **not build a UI that promises a
working generation on every `openai_compatible` host and then silently eats a
provider timeout with no useful message.** See decision 3.

## Decisions taken (say so if any is wrong)

1. **The URL field fetches a posting, not the account's provider endpoint.**
   Two different callers of the same guard, kept separate: `url-guard.ts`'s
   `assertSafeBaseUrl` / `assertResolvesSafely` / `guardedLookup` are already
   generic over "a URL the server is about to fetch," so the posting-fetch
   path reuses them with `HostPolicy.allowPrivate` always `false` (there is no
   self-hosting story for a job board). A new, small server-side fetch — not a
   route the client hits directly, but a step inside `/api/generate` before
   the `posting` it already validates, so the SSRF guard runs before a single
   token is spent, matching every other precondition that route already
   checks in order.
2. **The failure mode is exactly what PROJECT.md already promises: a calm
   redirect to the paste box, never a blocked-product feeling.** A blocked or
   failed fetch is not a `key_missing`-style hard refusal; the URL field's own
   error state says the site would not let us read it and focuses the paste
   box, per screen 3's own copy. The user always has a second, unblockable way
   to get the posting in.
3. **`openai_compatible` gets a real UI, with an honest ceiling stated up
   front, not discovered by a timeout.** The account (and onboarding key step)
   key form gains a fourth provider option; choosing it reveals a base URL
   field (through `assertSafeBaseUrl` before the live check, so a private
   address is refused before a network call happens at all) and a model name
   field, both required — `DEFAULT_MODELS` has no entry for this provider on
   purpose (`defaults.ts`'s own comment: "only the host knows what it
   serves"), so this is the one provider where the account form, not a
   constant, supplies the model. `Apply.errors.provider_timeout` already
   exists and already fires on `AbortError`/timeout from `failure()` in
   `generate/route.ts` — confirm it reads honestly for this case rather than
   inventing new copy, and confirm the Apply screen does not represent this
   provider as equivalent to the three fast ones (a one-line note near the
   provider picker: response times vary by host).
4. **No change to `APPLY_MAX_TOKENS` or a per-provider cap.** One measured
   account on one day is not a basis for a global constant, the same
   discipline `apply.ts`'s own comment already holds itself to. If this
   surfaces as a real problem once the UI exists, that is a future slice's
   measurement to take, not a number invented here.

## Files

| File | What |
| --- | --- |
| `src/core/url-guard.ts` | no change expected — reused, not modified. If a second caller reveals a shape the guard cannot express, stop and say so before widening it |
| `src/app/api/generate/route.ts` | gains the posting-URL fetch step, guarded, before the existing key/name/profile/spend checks; `GenerateRequest` gains a `postingUrl` (or equivalent) field and a `model` field for `openai_compatible` |
| `src/core/apply.ts` | `ApplyOptions.model` is already there ("Required for `openai_compatible`") — confirm the route actually threads it through; today's `GenerateRequest` schema has no `model` field at all |
| `src/lib/api-keys.ts` | `KEY_PROVIDERS` gains `openai_compatible`; `saveApiKey` gains a base-url parameter and an `assertSafeBaseUrl` call before `assertKeyWorks`; `KEY_CHECKS` gains a fourth entry (a cheap authenticated `GET`, same discipline as the other three — check what NIM/Ollama/OpenRouter/vLLM actually offer for this, do not assume `/models` behaves identically to the three named hosts) |
| `src/app/[locale]/account/KeyCard.tsx` | gains the conditional base-url + model fields when `openai_compatible` is selected |
| `src/app/[locale]/apply/ApplyForm.tsx`, `page.tsx` | URL field alongside the paste box; a model field when the account's provider is `openai_compatible`; the timeout-variance note from decision 3 |
| `messages/en.json`, `messages/es.json` | new copy for the URL field, its failure state, the base-url/model fields, and the honest ceiling note. `Apply.errors.provider_timeout` likely does not need new copy, confirm rather than assume |
| `supabase/migrations/` | none expected — the schema has been ready since slice 6 |

## Verification

- The SSRF guard, exercised for real by both callers: a posting URL pointed at
  `169.254.169.254` and at `localhost` are both refused before any fetch; an
  `openai_compatible` base URL pointed at the same is refused at save time.
- A real posting URL that actually works (a public, fetchable page) end to
  end through `/apply`, and a real one that blocks automated fetching (most
  ATS pages, per PROJECT.md's own naming) showing the calm redirect, not an
  error page.
- The NIM run, continued rather than repeated from zero: same key, through
  the new UI this time, standard tier, and — given what this session already
  found — deliberately try a `full` tier or a longer posting to see whether
  the real UI's own request size reproduces the timeout, and report the
  result plainly either way. If it does reproduce, that is not a blocker for
  shipping the UI (decision 3 already treats a slow or failing host as an
  honest, expected outcome), but it is a fact worth one more line in this
  file before it closes.
- `typecheck`, `lint`, `format:check`, `build`, `test`, and the suite with
  every provider/Supabase variable unset, same as every slice.

## Definition of done

A user can add an `openai_compatible` key (NIM, Ollama, OpenRouter, vLLM, or
anything else OpenAI-shaped) through the account screen, with its base URL
and model validated and SSRF-guarded before anything is stored, and generate
against it from `/apply` the same way they would against the three named
providers — succeeding when the host has the capacity, and failing with an
honest, specific message when it does not, never a silent hang. A user can
paste a job posting's URL instead of its text, succeeding when the site
allows automated fetching and falling back to the paste box, calmly, when it
does not. Nothing in `src/providers/`, `src/core/apply.ts`'s token budget, or
`src/core/url-guard.ts` itself needed to change to get here — this slice is
UI and wiring around three things that were already built and already
waiting.
