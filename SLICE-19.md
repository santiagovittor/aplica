# Slice 19 — the voice calibration, onboarding's still-open v1 item

## Start here (this runs in a fresh session)

Nothing from slice 18 carries over except its outcome (merged or not — check
`gh pr list`). Read this section first.

**Read:** this file, PROJECT.md section 5b in full (the profile and voice
engine) and section 9 screen 2, `src/core/profile.ts` (the `profileSchema`
and its comments on `voiceAnchors` and `Source`), `src/prompts/voice.ts`,
`src/app/[locale]/onboarding/[step]/layout.tsx` and `page.tsx`,
`src/app/[locale]/onboarding/actions.ts`, `src/app/[locale]/cv/CvUpload.tsx`
(its `done` state, roughly the last 60 lines), and `src/lib/supabase.ts`'s
`loadProfile`/`saveProfile`.
**Do not** read SLICE-1 through SLICE-17, and do not load the repo
wholesale.

**Repo state.** As of writing, three slices are open and unmerged — check
`gh pr list` before branching, same discipline as every slice since 10:
PR #12 (`slice-15-16-provider-fetch-and-applications`), PR #13
(`slice-17-legal`), and PR #14 (`slice-18-motion-polish`). This slice does
not depend on any of them merging first — onboarding's step route and the
CV parse both predate all three — but branch from wherever `main` actually
is by the time this runs, and if slice 18 has merged, the step-transition
wrapper this slice's new step sits inside is already there to reuse, not
rebuild.

**Why this slice exists.** PROJECT.md section 5b tags every item **[v1]**
or **[v2]** precisely so a build session never has to guess scope. One
**[v1, minimal]** item has code behind half of it and no UI behind the other
half:

> Voice from real samples, never self-description. v1 extracts voice
> anchors from the CV and offers the optional 10-second "which sounds more
> like you?" calibration at onboarding. Never ask "what's your tone."

Section 9's screen list is explicit about where it lives: "language -> API
key -> upload CV -> a 10-second optional voice calibration." Checked against
the code: extraction is done and already load-bearing —
`src/prompts/parse.ts` emits `voiceAnchors`, `src/core/grounding.ts` grounds
each one against the stored CV text before it is trusted, and
`src/core/apply.ts` already builds a `VoiceProfile` from them and hands it to
`src/prompts/voice.ts`, which lists them verbatim in the draft prompt as
"real sentences to match." The pipe from CV to generated output is real and
tested (`profile.test.ts`, `grounding.test.ts`, `apply.test.ts`). What was
never built is the onboarding screen itself: `ONBOARDING_STEPS` in
`[step]/layout.tsx` is `['language', 'key', 'cv']`, three steps, no fourth.
`src/core/profile.ts`'s own comment on the `Source` enum says as much in
passing — `verbatim` "arrives with the voice calibration ... Widening this
then is one line, with these tests already pinning the behaviour" — written
as a forward reference to work that has not happened yet.

This is the one remaining **[v1]**-tagged screen in PROJECT.md with no code
behind it at all. Everything else in section 5b's **[v1]** list
(progressive profiling, specificity scoring, the no-invention contract,
vagueness flags, "stay the author") already has working code, per the
files above. The **[v2]** items (just-in-time micro-interview, the
compounding voice loop, metrics hunting) are correctly untouched and stay
that way here.

## Context

**What "calibration" produces is underspecified in PROJECT.md, and this is
the one real open design question.** The prose says a user is shown two (or
more) candidates and picks the one that "sounds more like them," but it
never states what the product does with the pick. Two honest options, not
one obvious answer:

1. **Trust-building only.** The picker shows the mechanism working —
   proof the product draws from the user's real words, not a generic
   voice — and has no technical effect on generation. Every extracted
   anchor still reaches `voice.ts` regardless of what was picked.
2. **Filtering.** The anchor(s) not picked are dropped from what
   `voice.ts` receives, so the pick actually narrows what the draft call
   is told to match.

Option 1 is less work and cannot make an honest CV's own voice anchors
*worse* (there is no ranking consumer in `voice.ts` today — every anchor is
rendered as an unordered bullet list, so a "pick" has nothing to plug into
without new code in `voice.ts` itself). Option 2 requires widening
`profileSchema` or adding a sibling column, a migration, and a change to
`voice.ts`'s rendering, for a benefit PROJECT.md never actually asks for
(it asks for the *offer* of calibration, not for calibration to change
scoring). **Decision 1, below, takes option 1** — flag it if that reading is
wrong.

**Where the step lives is a real seam, not a free choice.** Calibration
needs at least two `voiceAnchors` to compare, which only exist after a CV
is uploaded and parsed. `CvUpload.tsx` (reused as-is inside `cv`, unaware
of onboarding, per SLICE-12 decision 2) hardcodes its own `done` state's
link to `/account` — the flow's real finish today. Decision 2 below adds a
fourth step after `cv` and changes that one link, which means touching a
component SLICE-12 deliberately kept onboarding-unaware. That is flagged
there rather than done silently.

**This is not a fourth slot on the `Steps` indicator.** Calibration is
conditional (needs a parsed CV with 2+ anchors) and optional in the sense
every onboarding step already is, but unlike `language`/`key`/`cv` it is not
guaranteed to ever apply — a user who skips the CV step, or whose CV yields
zero or one usable anchor, never sees it. Adding a permanent fourth
"Voice" entry to `ONBOARDING_STEPS` would show a step most sessions never
fill, which is exactly the kind of indicator PROJECT.md's Zeigarnik framing
(DESIGN.md section 6) warns against: progress chrome that lies about what
is actually left. Decision 3 keeps the existing three-entry indicator
unchanged and treats calibration as a bonus screen the flow passes through,
not a fourth tracked step.

## Decisions taken (say so if any is wrong)

1. **Calibration is trust-building only, per Context above.** The pick is
   recorded (so it is never asked twice — see decision 5) but does not
   change what `voice.ts` receives. No change to `profileSchema`, no
   migration, no change to `voice.ts`'s rendering.
2. **A new route, `/onboarding/voice`, becomes the CV step's real finish.**
   `CvUpload.tsx`'s hardcoded `href="/account"` in its `done` state becomes
   a prop (`nextHref: string`), defaulting to `/account` so the standalone
   `/cv` page's behaviour is unchanged, with onboarding's `page.tsx` passing
   `/onboarding/voice`. This is the one line outside onboarding's own files
   this slice needs to touch, and it is a prop addition, not a rewrite —
   `CvUpload` still does not know it is inside onboarding, it just knows
   where "done" goes.
3. **`ONBOARDING_STEPS` stays `['language', 'key', 'cv']`, unchanged, per
   Context above.** `/onboarding/voice` is a real route, gated by
   `isOnboardingStep`-style logic of its own, but it is not one of the
   three tracked, indicator-visible steps. Reaching it with fewer than two
   `voiceAnchors` (skipped CV, thin CV, or already-calibrated per decision
   5) redirects straight through to `/account` — invisibly, the same way a
   user who never uploads a CV never sees a calibration screen at all.
4. **The two anchors shown are the first two `profile.voiceAnchors` in
   parse order.** `parse.ts` has no ranking signal to prefer one anchor
   over another, and picking by length or any other heuristic would be
   inventing a signal PROJECT.md does not ask for. First two, in the order
   the model returned them, keeps this honest and simple. If a profile has
   more than two, the rest are simply not shown — this is a 10-second
   moment, not a review of every anchor.
5. **The pick is stored so calibration is never asked twice.** A new
   `profiles.voice_calibrated_at timestamptz null` column (migration,
   alongside the existing `profiles` table) is set when the user answers.
   `/onboarding/voice` checks it first: already set, or fewer than two
   anchors, and the route redirects to `/account` without rendering
   anything — the same instant, invisible skip as decision 3's gate. This
   also means a user who re-uploads a CV later (from `/account` or `/cv`
   directly) is not re-prompted; re-calibration on a new CV is a
   reasonable future ask but is not in section 5b's v1 line and is left
   alone here.
6. **No new provider call.** The two anchors are the CV's own sentences,
   already extracted; this step reads the stored profile and asks a plain
   preference question. No model call, no token spend, no new latency —
   consistent with "10-second."
7. **The motion here reuses slice 18's `StepTransition`, not a new
   pattern.** If slice 18 has merged, `/onboarding/voice` sits inside the
   same `OnboardingLayout` and gets the same fade/rise for free by virtue
   of the `step` param changing. If slice 18 has not merged yet, this
   slice does not depend on it or attempt to reimplement it — the screen
   simply renders un-animated until slice 18 lands, same as every other
   step did before it.

## Files

| File | What |
| --- | --- |
| `src/app/[locale]/onboarding/[step]/layout.tsx` | `ONBOARDING_STEPS`/`isOnboardingStep` stay 3-entry (decision 3); `voice` is handled as a step-shaped route that is not in that tuple, so it needs its own guard, not an addition to the tuple |
| `src/app/[locale]/onboarding/[step]/page.tsx` | new `voice` branch: loads the profile, gates per decisions 3 and 5, renders the two-anchor picker or redirects through |
| `src/app/[locale]/onboarding/[step]/VoiceCalibration.tsx` | new, client component: two anchor cards, pick one, submit |
| `src/app/[locale]/onboarding/actions.ts` | new `recordVoiceCalibration` action: sets `voice_calibrated_at`, redirects to `/account` |
| `src/app/[locale]/cv/CvUpload.tsx` | `done` state's link becomes a `nextHref` prop, default `/account` (decision 2) |
| `src/app/[locale]/cv/page.tsx` | passes no `nextHref` (keeps default) so the standalone route is unchanged |
| `src/lib/supabase.ts` | `loadProfile` already returns `voiceAnchors`; add a small read/write pair for `voice_calibrated_at` next to the existing profile helpers |
| `supabase/migrations/<new>.sql` | `alter table profiles add column voice_calibrated_at timestamptz null` |
| `messages/en.json`, `messages/es.json` | new `Onboarding.voice.*` copy: title, lead, the two-option prompt, skip label |

## Verification

- A fresh account with a CV that yields 2+ voice anchors: finishing the
  `cv` step lands on `/onboarding/voice`, not `/account`; picking either
  anchor advances to `/account` and sets `voice_calibrated_at`.
- The same account, re-entering onboarding or hitting `/onboarding/voice`
  directly a second time, is redirected straight to `/account` without
  seeing the picker again.
- An account that skips the `cv` step entirely, or whose CV yields fewer
  than two anchors, never sees `/onboarding/voice` — `cv`'s own skip link
  and a thin-profile `voice` visit both land on `/account` directly.
- The `Steps` indicator still shows exactly three entries throughout —
  confirms decision 3 didn't leak a fourth into the UI.
- The standalone `/cv` page (outside onboarding) still finishes on
  `/account` exactly as before — confirms `nextHref`'s default didn't
  change existing behaviour.
- `typecheck`, `lint`, `format:check`, `build`, `test`, and the suite with
  every provider/Supabase variable unset, same as every slice.

## Definition of done

PROJECT.md section 5b's **[v1]** list is fully checked off — the only item
that had no code behind it now does. A user with a real CV gets the "which
sounds more like you" moment section 9 promises, once, and the product's
central honesty claim (the writing voice is theirs, not the model's) is
demonstrated in the product itself, not just in the prompts working behind
the scenes.
