# Claude Code kickoff prompt

Create an empty repo, drop `PROJECT.md` and `CLAUDE.md` in the root, open Claude
Code there, and paste the prompt below. (Claude Code reads `CLAUDE.md`
automatically, so the engineering rules bind every session.)

---

Read PROJECT.md. It is the source of truth. DESIGN.md is the binding design
system; read it in full before any UI step, and check every screen against its
final checklist. Scaffold the v1 MVP of Aplica exactly
to that scope, no more. Items tagged [v2] in PROJECT.md section 5b are out of
scope; do not build them or leave stubs for them. I'm a full-stack TypeScript
dev, so keep it clean and idiomatic, and stop to ask me before any irreversible
choice (paid services, schema I'll be stuck with).

Session and context discipline (this matters as much as the code):
- **One numbered step per session.** After I approve a step, I will /clear and
  start the next step fresh. Never carry a finished step's context forward.
- **Plan first.** Open each step in plan mode: state the plan and the files you
  intend to read, get my agreement, then execute.
- **Read only what the step needs.** Steps 1 and 3-6: PROJECT.md plus the
  modules being touched. Steps 2, 7, and 9: DESIGN.md in full plus the screens
  being built. Never load `applications/`-style bulk content or the whole repo.
- **Commit at every pause point** so any step can roll back cleanly.

Do this in order, and pause after each numbered step so I can review:

1. Scaffold Next.js (App Router) + TypeScript. No Tailwind, no shadcn. Styling is
   CSS Modules + CSS custom properties. Use unstyled Radix UI primitives for
   accessible interactive parts. Load a distinctive variable display font via
   next/font (never Inter). Set up next-intl with `messages/en.json` and
   `messages/es.json` and a language toggle; no hardcoded UI strings, ever. Add
   Motion (framer-motion) with a `prefers-reduced-motion` wrapper; add GSAP + Lenis
   only when we build the landing page.

2. Install the design skills first and use them; do not design from memory. Clone
   `avoid-ai-design` (github.com/funboy322/avoid-ai-design) and Anthropic's
   `frontend-design` into `.claude/skills/`; optionally also `hallmark`
   (github.com/Nutlope/hallmark) as a second slop audit. Use `frontend-design` to
   generate the design system against DESIGN.md (the tokens, scales, and laws
   are fixed there; do not invent alternatives) and PROJECT.md section 8 (the
   brief and the "never do these" list). Define it as CSS custom-property
   tokens plus a few hand-styled base components (Button, Card, Input, Textarea,
   Steps) in CSS Modules, no Tailwind. Build a `/styleguide` page, then run
   `avoid-ai-design` in detect mode over it and fix until zero P0/P1 tells. Show
   me the styleguide for approval before any screen is built.

3. Set up Supabase (auth with email + Google, Postgres, Storage). Schema: users,
   profiles (JSON, source-tagged, including the keyword bank), applications.
   Leave room for a `plan` field later (PROJECT.md section 3) without designing
   billing now. Add the API-key storage with the security rules in PROJECT.md
   section 6: AES-256-GCM encrypted at rest (or Supabase Vault), server-side
   only, never logged, one-click delete. Add the per-user rate-limit counter
   here too (section 11), so it's decided in the migration, not improvised
   later. Show me the migration before applying it.

4. Create `src/prompts/` and the model-agnostic Provider interface with adapters
   for Anthropic, OpenAI, and Google, **plus a MockProvider with deterministic
   canned responses that all tests and CI use** (no real key ever exists in CI).
   Give each real adapter a recommended cheap default model so users aren't
   forced to pick one. I will paste my existing prompt files (writing-voice,
   apply, reviewer, expand) for you to port into voice.ts, draft.ts, reviewer.ts,
   parse.ts. The port must include the keyword-bank logic from expand's Phase 4
   (parse.ts produces the bank, draft.ts consumes it) and must drop the
   reviewer's company-research step for v1, per PROJECT.md sections 5 and 7. Do
   not write these prompts from scratch; wait for mine.

5. Build the CV parse flow: upload -> extract text -> one provider call using
   parse.ts -> store a source-tagged profile with its keyword bank. Show me the
   parsed profile for my own CV as the test.

6. Build the Apply pipeline as two route handlers, per PROJECT.md section 5:
   a generation route (job text + tier + profile -> draft call -> reviewer call
   -> revision) that streams the calm progress sequence over SSE with an explicit
   `maxDuration`, and a separate render route that turns approved drafts into
   files. Render resume/cover letter to clean ATS-safe output: PDF via
   `@react-pdf/renderer` (Puppeteer only if the templates outgrow it; ask me
   first) and DOCX via the `docx` package, per tier. Save outputs and an
   application row. A render failure must retry without re-running generation.

7. Build the five screens in PROJECT.md section 9, matching the design system:
   onboarding (with the optional voice calibration), apply (the core, with the
   three tier cards and the paste box as primary input; the URL field is
   best-effort with the calm fallback from section 9), applications list, and
   account/settings (manage/delete key, language, delete account, sign out).
   Every screen gets real empty, loading, and error states, not just the happy
   path.

8. Verification: a seed test that runs the full apply flow against the
   MockProvider and asserts the output has no em dashes, no banned words, and no
   line absent from the profile. The slop checks are pure functions (regex +
   word list), not model calls. Wire it into CI; CI must pass with no API key
   configured.

9. Launch readiness (PROJECT.md section 11): privacy and terms pages; provider
   error handling (bad key, rate limit, timeout) with calm retry and no leaked
   key; the per-user rate limiting from step 3 enforced on the generation route;
   email verification, password reset, sign-out. Then a dedicated motion-polish
   pass: tune easing and timing, fix font loading so there's no flash of
   unstyled text, and honor `prefers-reduced-motion` everywhere. Run
   `avoid-ai-design` over every screen one final time.

Constraints to respect throughout:
- BYO-key: the app never ships its own model key; the user's key is used
  server-side only and handled per section 6. The key never appears in tests,
  fixtures, CI logs, or error traces.
- No Tailwind, no shadcn, no Inter, and none of the AI tells in PROJECT.md section
  8. Run `avoid-ai-design` in detect mode on every screen before calling it done.
- The UI copy must follow its own anti-slop rules: sentence case, no exclamation
  marks, no corporate filler, verb-first buttons.
- Keep it calm. If a screen feels busy, simplify it and tell me why.
- MIT license on the code. Add the LICENSE and a README that explains self-hosting
  with your own key.