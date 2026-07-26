# Aplica — Build Spec (v1 MVP)

Working name: **Aplica** (later: Postulate, or a catchier name). Open-core,
bring-your-own-key, bilingual (EN/ES). This document is the source of truth for
the MVP. Build only what's in "v1 scope." Everything else is v2.

## 1. What it is, in one line

Paste a job posting, get a resume and cover letter tailored to it, in your real
voice, that does not sound like AI.

## 2. Why it exists (the wedge)

The market is full of resume tools (Jobscan, Teal, Rezi, Kickresume, Simplify) and
the honest reviews of all of them say the same thing: the output is generic, treat
it as an assistant, review before sending. In the Spanish-first market it's worse:
mostly generic CV builders and how-to articles, no tool built around voice and
honesty. That's the opening.

Aplica wins on four things the incumbents don't do:
1. **Anti-slop by construction.** A reviewer pass strips AI tells (em dashes,
   corporate filler), and output is anchored to the user's own writing voice.
2. **Honesty.** It scores fit and will tell you to skip a bad-fit role. It never
   fabricates a skill.
3. **Bilingual, Spanish-first friendly.** Full EN/ES from onboarding on.
4. **Cheap and open.** BYO-key means near-zero inference cost, so it can be $12/yr
   or free to self-host. Open-core for reach and trust.

## 3. v1 scope (ruthless)

In:
- Auth (email + Google).
- Onboarding: pick language (EN/ES), paste a model API key, upload a CV (PDF/docx).
- One-time CV parse into a structured, source-tagged profile **plus a per-user
  keyword bank** (see section 7). The bank is the smart layer; it ships in v1.
- Apply screen: paste a job description (primary input) or a job URL
  (best-effort; see section 9), pick a tier (Basic / Standard / Full), generate.
- Generation pipeline: draft, then a reviewer pass, then a fabrication and slop
  check. Output tailored resume (+ cover letter per tier) as downloadable PDF (and
  DOCX for Full).
- A simple list of past applications with fit score and download links.
- Account/settings: manage or delete the API key (one-click), change language,
  delete account, sign out.
- Model-agnostic provider layer chosen by the user: **Anthropic, OpenAI, Google,
  plus one `openai_compatible` endpoint** for any OpenAI-shaped host the user
  points at (NVIDIA NIM, Ollama local or cloud, OpenRouter, vLLM). The three
  named providers each get a recommended cheap default model, so a new user isn't
  asked to pick one. The compatible endpoint takes a user-supplied base URL and
  model name, since only the host knows what it serves. One adapter, no
  per-vendor code.

**Billing is deliberately v2, not forgotten — but the price structure is decided
now.** BYO-key means there is no inference cost forcing us to charge, so v1
launches free (and self-hostable). When billing arrives, it is **annual-only:
$12/year**, never $1/month. The math forces this: Lemon Squeezy charges 5% +
$0.50 per transaction as merchant of record, which is $0.55 of every $1 charge
(55%) but only ~$1.10 of a $12 charge (~9%). Same psychological price, six times
the net revenue. Design the schema so a `plan` field (values like `free`,
`annual`) can be added later without a rewrite, and don't design anything that
forbids a future metered "use our key" option for non-technical users — that's
the likely v2+ bridge for the Spanish-first audience that BYO-key walls out.

Out (v2): subscription/billing, job-board scraping, interview prep, mock
interviews, team features, analytics dashboards, autofill browser extension,
salary tools, the just-in-time micro-interview and the voice-diff loop (see 5b).

## 4. Stack

- **Framework:** Next.js (App Router) + TypeScript. React Server Components for the
  shell, server actions / route handlers for generation.
- **Styling:** no Tailwind, no shadcn (their defaults are the generic look). Use
  CSS Modules + hand-authored CSS custom properties (design tokens). For accessible
  interactive parts (dialog, select, toggle) use unstyled Radix UI primitives and
  style them yourself. Zero default look to regress into.
- **Motion:** Motion (framer-motion) for UI transitions; GSAP + Lenis reserved for
  the landing page's signature moments. Self-host a distinctive variable display
  font via next/font. Never Inter.
- **i18n:** next-intl. All copy in `messages/en.json` and `messages/es.json` from
  day one. No hardcoded strings.
- **Auth + DB + storage:** Supabase (Postgres, Auth, Storage for CV files).
- **Payments (v2):** Lemon Squeezy (merchant of record, handles global sales tax;
  still operating independently under Stripe as of 2026). Annual-only per
  section 3. Gate only the hosted convenience, never the core, since it's open
  source.
- **PDF/DOCX generation:** server-side, web-native, no pandoc. Default to
  `@react-pdf/renderer` for PDF: the templates are deliberately simple and
  ATS-safe (real text, no images-as-text, standard fonts), so a headless browser
  is unnecessary weight. Puppeteer (`@sparticuz/chromium` on Vercel) is the
  fallback only if the templates outgrow react-pdf. `docx` npm package for the
  Word file.
- **Deploy:** Vercel. Generation and rendering are **separate route handlers**
  (see section 5). The generation route streams progress via SSE and declares an
  explicit `maxDuration` sized to the plan tier we deploy on; never assume the
  default timeout survives a three-call LLM pipeline.
- **License:** MIT on the engine. Hosted app config stays private.

## 5. Architecture

Three flows, all model-agnostic through one `Provider` interface
(`generate(messages, opts)`), with adapters for Anthropic, OpenAI, and Google —
plus `openai_compatible`, the OpenAI adapter parameterised by a base URL, which
reaches every OpenAI-shaped host without a fourth code path.

1. **Parse CV -> profile.** On upload, extract text, then one model call turns it
   into a structured, source-tagged profile (experience, projects, skills, STAR
   stories) **and the per-user keyword bank** (real experience mapped to the
   vocabulary each field uses for it). This is the `/expand` logic from the
   Claude Code version, ported to a server routine. Store the profile as JSON in
   Postgres. Never send the raw CV to employers; always draw from the profile.
2. **Apply.** Input: job text + tier + profile. Two model calls:
   - Draft call: system prompt = the writing-voice rules + the apply rules
     (extract keywords, score fit, tailor with keywords in summary and first
     bullets, 60-80% natural coverage, relevance-weighted cutting, never
     fabricate). Consumes the keyword bank to mirror the posting's vocabulary
     honestly. Returns fit score, recommendation, and drafts.
   - Reviewer call: fresh context, system prompt = the reviewer rules. Critiques
     for missed keywords, weak framing, slop, em dashes, unsupported claims.
     **The v1 reviewer researches the company when the provider can.** The
     `Provider` interface carries a `supportsSearch` capability flag, derived
     from whether that adapter has a model it is documented to search with, and
     each capable adapter uses its vendor's own server-side search tool. The
     reviewer prompt has two modes selected by a `researchAvailable` parameter:
     with research it opens on company notes, without it states plainly that it
     has no web access. The critique format is identical either way, so the
     revision pass does not care which ran. Search costs the user real money on
     top of tokens, so it is a visible toggle with an honest cost line (step 7),
     defaulting to on where it is available.
   - Then a revision pass applies the critique. This whole flow runs in one
     streaming route handler (SSE) that drives the calm progress sequence.
3. **Render + store.** A separate route handler renders the approved drafts to
   PDF/DOCX per tier, saves outputs to Supabase Storage, and writes an
   application row (company, role, fit score, tier, created_at, file links).
   Splitting generation from rendering keeps each request short, makes retries
   cheap (re-render without re-generating), and keeps the progress UI honest.

All the domain intelligence lives in prompt files under `src/prompts/`, so the app
is a thin shell around the same prompts proven in the Claude Code version.

## 5b. Profile and voice engine (the anti-generic core)

This is where competitors turn generic: vague user input, and the model fills the
gap with filler. Solve it at the input, not only with the output reviewer.

Each item below is tagged **[v1]** or **[v2]** so a build session never has to
guess the scope.

- **[v1] Start fast, deepen lazily (progressive profiling).** Onboarding is only
  language, key, CV. The profile grows over time, never a big upfront
  questionnaire. That's how it stays "flexible, not tiring."
- **[v1] Score every claim for specificity.** On parse, each CV bullet gets an
  evidence score; vague ones ("improved processes") are flagged as low-signal.
- **[v2] Just-in-time micro-interview.** Don't cold-quiz. When the user applies
  to a real job and the profile is thin on what that job needs, ask one sharp,
  context-tied question then. Real postings produce real answers; cold forms
  don't. (v1 behavior on a thin profile: the gap stays a gap, per the
  no-invention contract.)
- **[v1] No-invention contract (core mechanic).** Every fact carries a source and
  confidence: verbatim (user's words), extracted (CV), or inferred (model guess).
  Only verbatim and extracted may appear in output. On a gap the model has exactly
  three legal moves: omit it, keep the user's vaguer-but-true wording, or ask. It
  may never smooth a gap into a specific-sounding claim.

  **The contract is enforced by grounding, not by the tag.** A source tag is a
  claim the model makes about itself, and a real parse proved it worthless on its
  own: it returned an invented STAR situation carrying `source: "extracted"`, and
  schema validation passed it because the label was legal. So the parsed text of
  the CV is stored (`profiles.source_text`) and every claim's prose is checked
  against it by `src/core/grounding.ts`: a voice anchor must be a verbatim quote,
  and a claim's numbers and named entities must appear in the source. An
  ungrounded claim is downgraded to weak and reported in `gaps`, never silently
  kept and never silently deleted. The check is a pure function, never an LLM
  judge. Its measured limits are recorded in `/docs/grounding.md`; whole-sentence
  overlap scoring was tried and rejected because it cannot tell a paraphrase from
  a fabrication.
- **[v1] Vagueness triggers a flag, not a beautification.** Low-confidence items
  aren't foregrounded and are surfaced on the result as honest flags. (The
  STAR-style probing conversation is part of the v2 micro-interview.)
- **[v1, minimal] Voice from real samples, never self-description.** v1 extracts
  voice anchors from the CV and offers the optional 10-second "which sounds more
  like you?" calibration at onboarding. Never ask "what's your tone."
- **[v2] Compounding voice loop (the moat).** Diff every user edit of a draft
  against the model's version and fold the difference into their voice profile.
  It sounds more like them each use. No competitor does this well. Needs
  edit-tracking UI that v1 doesn't have; do not attempt it early.
- **[v1, minimal] Stay the author, visibly.** The result card shows honest flags
  (low-confidence claims, coverage gaps). Full per-claim provenance display is
  v2.
- **[v2] Metrics hunting, gently.** Specifically seek one real impact number per
  role, and accept "don't have it" without ever fabricating one.

## 6. BYO-key security (non-negotiable)

The user's API key is a credential. Get this right or the product loses trust.
- Encrypt at rest with **symmetric AES-256-GCM** (Node `crypto`), encryption key
  in a server-side env secret — or use Supabase Vault, which is the same idea
  managed. (Not a libsodium sealed box: sealed boxes are asymmetric, the server
  would hold the private key anyway, so the extra machinery buys nothing over
  AES-GCM and is harder to audit.) Encrypted-at-rest is preferred over
  session-only so the user doesn't re-paste every visit, behind a clear consent
  line.
- Never log the key. Never send it to the client after save. Never include it in
  error messages, analytics, test fixtures, or CI logs.
- Calls to model providers happen server-side only. The key never touches the
  browser network tab.
- Show the user, in plain language, where their key is stored and how to delete it.
  One-click "remove my key."
- A user-supplied `base_url` (the `openai_compatible` provider, section 3) is
  fetched **by the server**, which makes it an SSRF surface. Validate it before
  every request: `https` only, no credentials in the URL, no loopback, private,
  link-local, CGNAT, or cloud-metadata address, DNS resolved with every returned
  address checked, and redirects refused. Self-hosters who genuinely need
  `http://localhost:11434` for Ollama set `ALLOW_PRIVATE_PROVIDER_HOSTS=true`; it
  is off by default and never on in the hosted app.

## 7. Prompt port

Copy these from the Claude Code repo into `src/prompts/` as the system prompts:
- `writing-voice` -> `voice.ts` (the anti-slop rules; keep the banned-word list and
  the no-em-dash rule verbatim).
- `apply.md` phases 1-4, 6 -> `draft.ts`.
- `reviewer.md` -> `reviewer.ts`, **including Step 1 (company research)**, per
  section 5. Port the critique structure, the slop scan, and the output format
  intact. Research is conditional on the provider: one prompt with two modes,
  chosen by parameter, with the same output format in both.
- `expand.md` -> `parse.ts` (CV -> profile), **including the Phase 4 keyword-bank
  logic**: `parse.ts` must produce the per-user keyword bank (experience mapped
  to each field's vocabulary), and `draft.ts` must consume it. This is the most
  differentiating piece of the port; do not drop it.
The voice profile is per-user here (built from their CV), not hardcoded to one
person. Store voice anchors extracted from their own CV.

**The banned-word list is bilingual.** The app ships EN and ES, and a Spanish
application would otherwise pass a gate that only knows English words. Both lists
are authored, not translated: the Spanish list has its own idioms
(`cabe destacar`, `un antes y un después`) that have no English counterpart, and
the English list has words with no Spanish equivalent. The gate runs the **union
of both lists on every output regardless of language**, since one document can
mix them and the cost of an extra check is nil. The no-em-dash rule is universal.
Matching handles each language's morphology (English `-ing`/`-ed`, Spanish gender,
number and verb stems) so the lists stay verbatim.

## 8. Design direction: the maker's desk (warm & grounded)

Reject both dominant SaaS camps (neon dashboard, cream-serif editorial); both now
read as sameness. Commit instead to one idea applied everywhere: a calm workshop
where you craft your application by hand. It signals authorship and care, the
opposite of mass-produced slop. Chosen personality: warm & grounded.

- **Signature motif:** a slop line transforming into a real, human line. Reuse it
  on the landing hero, empty states, and the result reveal. One motif, repeated, is
  the brand memory.
- **Palette (warm & grounded, psychologically aimed):** the target user is
  ~30-35 and months deep in an ATS grind; blue/teal/indigo is the color of the
  system rejecting them (LinkedIn, Teal, Jobscan, Rezi all live there), so the
  product lives in the opposite register: a human desk. Warm oat base
  (#F3EEE5), paper cards (#FBF8F1), warm ink text (#26221B), one action accent
  = deep garden green (#3F5A3C; #5C7355 for large text and graphics), and one
  emotional color = terracotta (#B65C3F) reserved exclusively for the motif and
  the result reveal (the machine line is ink, the human line is warm). Errors
  are calm clay (#8F3D2E), never bright red: rejection-fatigued users get plain
  words, not alarms. Hairline #DED7C9. No SaaS blue, no pure black, no neon, no
  gradients. A whisper of paper texture and soft layered depth is welcome;
  never scrapbook-messy. Exact values, pairs, and usage law live in DESIGN.md;
  the palette is validated on real screens at the styleguide gate, not assumed.
- **Type:** a characterful humanist serif for headings (e.g. Fraunces) paired with
  a plain, highly legible body sans. Character up top, calm in the body.
- **Space:** ruthless whitespace. One primary action per screen. Progressive
  disclosure: never show a wall of options.
- **Motion (meaningful, never noise), via Motion library:**
  - Page and step transitions with gentle spring easing (soft, ~200-300ms, no
    bounce carnival).
  - `AnimatePresence` for the generation flow so draft -> review -> done feels like
    a calm, legible sequence, not a spinner.
  - Micro-interactions on the paste box, tier cards, and the primary button (subtle
    scale/opacity on hover and press).
  - The generation wait is an emotional moment: show reassuring, honest progress
    ("reading the posting", "matching your experience", "removing anything that
    sounds like AI") instead of a bare loader. Keep the words calm and true, never
    hypey. The SSE stream from the generation route (section 5) drives this, so
    the stages shown are the stages actually running.
- **Copy voice (the UI itself must not be slop):** sentence case everywhere, no
  exclamation marks, no "unlock/leverage/seamless", contractions, verb-first
  buttons ("Tailor my application", "Download PDF"). Warm and plain.
- **Accessibility:** honor `prefers-reduced-motion` (swap animations for instant
  states). WCAG AA contrast even on the cream palette.

- **Never do these (AI tells, enforced).** No Tailwind or shadcn defaults, no
  `rounded-2xl` on every surface, no icon-in-a-rounded-square, no purple/indigo
  gradient, no gradient headline text, no Inter/Roboto/system default font, no
  centered hero with three feature cards, no glassmorphism, no reflexive lucide
  `Sparkles`/`ArrowRight`, no uniform `gap`/`padding` without hierarchy, no
  left-border accent card. These are the patterns that read as AI on sight.
- **Toolkit.** Distinctive variable fonts (a display face plus a body face, never
  Inter), CSS Modules + custom properties, unstyled Radix primitives, Motion for
  UI, GSAP + Lenis for landing moments. Favor asymmetry and real spatial hierarchy
  over centered templates.
- **How the design actually gets made.** Do not hand-write the look from memory; it
  regresses to the generic mean. Generate it with the `frontend-design` skill
  against this section's constraints, then run `avoid-ai-design` in detect mode and
  fix until zero P0/P1 tells. Optionally run `hallmark` (Nutlope) as a second
  opinion during the styleguide phase; two independent slop audits catch more than
  one. The warm & grounded palette above is the starting brief, not the final
  pixels.

## 9. Screens (v1)

1. **Landing** (later): calm hero, one line, one CTA, a quiet before/after of a
   slop bullet vs a real one.
2. **Onboarding:** soft steps, language -> API key -> upload CV -> a 10-second
   optional voice calibration ("which of these sounds more like you?", per section
   5b). A progress that feels light. Skippable, resumable.
3. **Apply:** the core screen (see the mockup): CV chip, EN/ES toggle, paste box,
   three tier cards (Basic = CV PDF, Standard = CV + cover letter, Full = both as
   PDF + DOCX), one primary button. **The paste box is the primary input.** A URL
   field is offered as best-effort convenience: LinkedIn, Workday, and most ATS
   pages block automated fetching or sit behind auth, so a failed fetch shows a
   calm "that site won't let us read it, paste the posting text instead" and
   focuses the paste box. Never let a blocked URL feel like a broken product.
   After generate: the calm progress sequence, then a result card with fit score,
   a preview, honest flags, and downloads.
4. **Applications:** a quiet list of past runs with fit score and files.
5. **Account/settings:** manage or delete the API key (one-click), language, delete
   account, sign out.

Every screen needs real empty, loading, and error states, not just the happy path.
Empty states invite ("upload your CV to begin"), errors say what happened and what
to do, loading states are calm, never a bare spinner.

## 10. Success criteria for v1

- A user can go from signup to a downloaded, tailored, non-slop resume in under 5
  minutes, with their own API key.
- Output contains zero em dashes and no banned words, verified by a
  deterministic pure-function check (regex + word list), not an LLM judge.
- Nothing in the resume is absent from the parsed profile (no fabrication).
- Full EN and ES with no hardcoded strings.
- The whole thing feels calm. If a screen feels busy, cut something.

## 11. Launch readiness (don't skip)

- **Legal:** a privacy page and terms page. State plainly what happens to the CV
  and the API key. Non-negotiable when you hold both.
- **Motion polish pass:** one dedicated pass at the end tuning easing, timing, and
  font loading (no flash of unstyled text) so it reads premium, not rudimentary.
  Honor `prefers-reduced-motion` throughout.
- **Resilience:** handle provider errors (bad key, rate limit, timeout) with a
  clear, calm message and a retry. Never leak the raw error or the key. Because
  rendering is a separate step (section 5), a render failure retries without
  re-spending the user's tokens on generation.
- **Abuse guard:** basic per-user rate limiting on generation, even with BYO-key,
  to protect the app and the user's own token spend. Mechanism: a Postgres
  counter in Supabase (already in the stack; no new dependency) or Upstash Redis
  if it ever needs to be edge-fast. Decide once, in the migration.
- **Auth hygiene:** email verification, password reset, and a working sign-out.