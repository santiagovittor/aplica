# CLAUDE.md — Aplica engineering guide

This file loads into every session, so it stays short. It is a router plus the
rules. Read only what the current task needs; never load the whole repo.

**Context router (read on demand, not by default):**
- Product scope, architecture, security spec -> `PROJECT.md`
- Any UI work (screens, components, styling, motion, copy) -> `DESIGN.md`,
  in full. Its tokens are the only pixel/color values allowed in UI code.
- Prompt work -> the file in `src/prompts/` being changed, nothing else.
- Deep detail as it accumulates -> `/docs`. Link to it, do not paste it.

The product's promise is "no slop." The code holds itself to the same bar: nothing
generic, nothing unearned, nothing left half-done.

## 0. How to work here (read first)

- One task at a time. State the plan, get it agreed, then code.
- Small, surgical diffs. Every changed line traces to the task.
- A change is not done until a test proves it, the types pass, and the diff is
  reviewed.
- Keep context lean. Prefer reading one module over ten. Link to `/docs`, do not
  paste it.

## 1. The ten rules (non-negotiable)

Adapted from Karpathy's CLAUDE.md. These come first because they prevent the
most expensive failures.

1. **Think before coding.** State assumptions, surface ambiguity, ask instead of
   guessing. No code until the goal is clear.
2. **Simplicity first.** Write the minimum that solves the stated problem. No
   speculative abstractions, no unrequested features.
3. **Surgical changes.** Do not touch code adjacent to the task. If it needs a
   wider change, stop and say so first.
4. **Goal-driven execution.** Turn vague asks into checkable outcomes before
   starting. "Add validation" becomes "a blank or malformed email shows a specific
   error, and both cases have passing tests." Multi-step work gets a written plan
   first.
5. **Verification.** To fix a bug: write a test that reproduces it, fix the code,
   run the test. It is fixed when the test passes, not when it "feels" fixed.
6. **Debugging discipline.** Read the full error and stack trace. Reproduce before
   fixing. Change one variable at a time. No confident guesses at the cause.
7. **Dependencies.** Every package is permanent, uncontrolled code. Ask if the
   standard library or a few lines cover it first. If you add one, document why.
8. **Communication.** "I'm not sure this supports streaming" is useful. "I think
   this should work" is not. State uncertainty plainly; never dress a guess as
   fact.
9. **Recognize and stop on these failure modes:**
   - Kitchen sink: asked to fix a faucet, you renovate the kitchen.
   - Wrong abstraction: the same logic in three places, un-extracted.
   - Optimistic path: only the happy case, ignoring bad input and failures.
   - Runaway refactor: one file becomes ten because nothing stopped the cascade.
   The moment you notice one, stop and check in.
10. **Leave it better.** Boy-scout rule. But fix root causes in their own commit,
    never smuggle a refactor into a feature diff.

## 2. Stack (all free but the tokens)

- Next.js (App Router) + TypeScript in `strict` mode. No `any` without a written
  reason.
- Styling: CSS Modules + CSS custom-property tokens. No Tailwind, no shadcn.
- Accessible primitives: unstyled Radix UI, styled by us.
- Validation: Zod at every external boundary (forms, API, model output).
- Data/auth/storage: Supabase (free tier).
- Tests: Vitest + Testing Library (unit/component), Playwright (the apply flow).
- Lint/format: ESLint + Prettier (or Biome). CI: GitHub Actions. Deploy: Vercel.
- All free tiers. The only spend is model tokens, and those are the user's own key.

## 3. Structure and seams

Design for seams: clear boundaries you can test and swap. (Legacy Code's core
lesson, applied from day one so this never becomes legacy.)

```
src/
  app/           # routes, thin. No business logic here.
  core/          # domain logic, framework-free, unit-tested. The heart.
  providers/     # model adapters behind one Provider interface (Anthropic/OpenAI/Google)
  prompts/       # voice.ts, draft.ts, reviewer.ts, parse.ts (ported from the CC repo)
  ui/            # presentational components + the CSS-module design system
  lib/           # small shared helpers, no domain knowledge
```

Rules: dependencies point inward toward `core`. `core` imports nothing from
`app`, `ui`, or a specific provider. Swapping models or the web framework must not
touch `core`. This is orthogonality: a change in one axis does not ripple across
others.

The Provider seam earns its keep twice: it swaps vendors, and it swaps in the
**MockProvider** that tests and CI run against (section 5). If a test needs a
real API key, the seam is broken; fix the seam, not the test.

## 4. Code style

- Names carry intent. A reader should not need a comment to understand a name.
  Comments explain *why*, never *what*.
- Functions are small and do one thing. If you need "and" to describe it, split it.
- DRY, but do not abstract on the first repeat. Extract on the third, when the
  shape is real. A wrong abstraction costs more than a little duplication.
- No broken windows: no dead code, no commented-out blocks, no `TODO` graveyards,
  no `console.log` left in. Delete or fix, do not leave rot.
- Handle the unhappy path. Bad input, dropped connection, provider error, empty
  result. The optimistic path is a bug.
- Errors fail fast and loud with a clear message. Never swallow.

## 5. Testing

- Test behavior, not implementation. Tests should survive a refactor.
- Before changing untested code, write a characterization test that pins current
  behavior, then change it.
- Bugs get a failing test first (rule 5). No test, no fix.
- Fast is a feature: your loop throughput equals your verification speed, so keep
  the unit suite quick and run it constantly.
- **All tests and CI run against a `MockProvider`** with deterministic canned
  responses. CI never holds, needs, or spends a real model API key. The mock
  lives behind the same Provider interface as the real adapters.
- **The slop gate is a pure function, not an LLM judge.** Em-dash and banned-word
  checks are regex plus a word list over the output text: fast, deterministic,
  free. The no-invention check is line-provenance against the stored profile.
- Required CI gates, the product's soul as a test: the apply flow output contains
  zero em dashes, zero banned words, and no line absent from the profile (the
  no-invention contract). If that test fails, the build fails.

## 6. Flow and delivery (the three ways)

- **Flow:** small batches, trunk-based. Short-lived branches, small PRs, merge
  often. Limit work in progress to one task.
- **Feedback:** CI runs on every push. Preview deploy per PR. Broken build is the
  top priority, fix before new work.
- **Continual learning:** when something breaks, fix the root cause and add the
  test that would have caught it. Blameless. The system improves, not the blame.
- Make work visible: keep the task list current so state is never in someone's head.

## 7. Context and loop discipline (Software 3.0)

- Keep this file and every source file small enough to reason about. Big files
  blow the attention budget and quality drops.
- Generation then verification. Generate a change, then verify it fast (types,
  test, a look). Optimize for how quickly a change can be checked, not how much
  gets written per turn.
- Autonomy slider: run tight on anything touching money, auth, secrets, or the
  database (review every line). Run looser on styling and copy. Match the leash to
  the stakes.
- Set a token budget for any long autonomous run, and a stop condition, before
  starting. Unbounded loops burn money and drift.
- Use checkpoints before risky edits so a bad run rolls back cleanly.
- This file is context, not an enforced rule. It shapes behavior, it does not
  guarantee it. That is another reason to keep it short and sharp.

## 8. Definition of done

A task is done when: it meets the goal's checkable outcomes; tests cover it and
pass; types and lint are clean; the unhappy path is handled; the diff is minimal
and reviewed; no dead code or stray logs; and, for anything user-facing, the
DESIGN.md checklist passes and the `avoid-ai-design` audit shows zero P0/P1
tells. DESIGN.md's tokens and scales are the only pixel values allowed in UI
code; a value outside them is a bug.

## 9. Security quick-reference

- The user's model API key is a credential: encrypted at rest (AES-256-GCM, key
  in a server-side env secret, or Supabase Vault), server-side only, never
  logged, never returned to the client, one-click delete. See `/docs/security.md`.
- The key must never appear in test fixtures, CI logs, error traces, analytics
  events, or Playwright recordings. Tests use the MockProvider (section 5), so
  no real key ever exists in the test environment at all.
- Never commit secrets. Validate and sanitize every external input with Zod.
- New dependencies are reviewed (rule 7); prefer fewer, well-known packages.