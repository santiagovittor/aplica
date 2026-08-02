# Slice 17 — privacy and terms, the launch-readiness gap that isn't optional

## Start here (this runs in a fresh session)

Nothing from slice 16 carries over. Read this section first.

**Read:** this file, `PROJECT.md` section 6 (BYO-key security) and section 11
(launch readiness), `DESIGN.md` in full for tone/type/space tokens — this
slice has no precedent screen to copy layout from, so the tokens are all it
has to go on — `src/i18n/navigation.ts`, `src/ui/Header.tsx`, and
`messages/en.json`'s `Account` namespace (the existing plain-language lines
about the key and CV already written for onboarding/account — this slice's
copy should not contradict or duplicate them, it should link out to the full
version).
**Do not** read SLICE-4 through SLICE-16, and do not load the repo wholesale.

**Repo state.** As of writing, slice 16 (`/applications`) is either merged to
`main` or open as its own PR — check `gh pr list` first, same discipline as
every slice since 10.

**Why this slice exists.** PROJECT.md section 11, "Launch readiness (don't
skip)": **"Legal: a privacy page and terms page. State plainly what happens
to the CV and the API key. Non-negotiable when you hold both."** Grepped
clean: no `privacy`, no `terms`, no footer, no legal-page route anywhere in
`src/`. Every other launch-readiness item in that section already has code
behind it — rate limiting is `src/lib/usage.ts` and
`GenerationLimitReached`, password reset is already in `(auth)/actions.ts`,
provider-error handling is already in `ApplyForm.tsx` and the generate route.
This is the one line in section 11 with nothing built for it, and it is the
one guarding the two things this product asks a stranger to hand over: their
CV and their model API key.

This is also the reason it's a small slice, not a big one: the content is
almost entirely a plain restatement of decisions already made and already
built — AES-256-GCM encryption, server-side-only key use, one-click delete,
CV deletion on account delete (`DeleteAccount.tsx`) — not new policy to
invent. Writing the pages is translating what the code already does into two
sentences a stranger can read before they trust it with either file.

## Context

Nobody has designed a static content page in this app yet. Every existing
route is either a form, a list, or an auth gate — `/`, `/apply`, `/account`,
`/applications`, `/onboarding/*`, `(auth)/*`. This slice is the first screen
whose entire job is prose, and the first thing in the app that needs to be
reachable from **outside** the authenticated shell: a page not yet
signed up has to be able to read the privacy policy before they hand over an
email, let alone a CV or a key. `Header.tsx` renders nothing when
`!authenticated`, so there is currently no link to anything, anywhere, for a
signed-out visitor. That gap is this slice's second half.

## Decisions taken (say so if any is wrong)

1. **Two new routes, `/[locale]/privacy` and `/[locale]/terms`.** Static
   server components, no auth guard — a signed-out visitor must be able to
   open them. `setRequestLocale` + `getTranslations`, same as `/` (the one
   other unauthenticated page today).
2. **A minimal footer, new `src/ui/Footer.tsx`, rendered from the root
   `[locale]/layout.tsx` alongside `Header`.** Two links (privacy, terms),
   plain text, no chrome — same restraint `Header.tsx`'s own comment
   describes for nav links ("plain text links, no chrome, `--green` reserved
   for each screen's own primary action"). Rendered unconditionally
   (signed-in or not), unlike `Header`, since its whole reason to exist is
   reachability for a signed-out visitor.
3. **Content is one page each, no sub-sections requiring their own nav.**
   Privacy states: what's collected (email, CV file and its parsed text,
   model API key), why (to generate tailored applications), how the key is
   protected (AES-256-GCM at rest, server-side use only, PROJECT.md §6),
   how to delete either (one-click key delete in `/account`, full account
   delete removes the CV and profile too — `DeleteAccount.tsx`'s own copy
   already says this, this page says it in one place a visitor can read
   before signing up), and that the CV is never sent to an employer, only
   drawn from. Terms states: BYO-key means the user's own provider
   relationship and spend, MIT license on the engine (PROJECT.md §4), no
   warranty, and that this is a v1 product (no billing yet, so nothing about
   subscriptions to write). Keep both to what's true today; do not draft
   language for v2 billing that doesn't exist yet.
4. **No new legal review, no lawyer-authored text.** This is an indie,
   pre-revenue, BYO-key product; the bar is "state plainly," per section 11's
   own wording, not "survive outside counsel." If the user wants that bar
   raised later, that's a decision to take then, not to guess at now.
5. **Both pages share one CSS module, `legal.module.css`, not one per
   route.** They are the same layout (a title, dated-or-not prose, DESIGN.md
   type tokens) twice; a second file for identical rules would be the wrong
   abstraction on the first repeat, not the third.
6. **No "last updated" date in this slice.** A date implies a review
   cadence nothing in this project has committed to yet, and a wrong or
   stale one is worse than none. If that discipline gets adopted, it's a
   follow-up, not a guess made here.

## Files

| File | What |
| --- | --- |
| `src/app/[locale]/privacy/page.tsx` | new, static server component |
| `src/app/[locale]/terms/page.tsx` | new, static server component |
| `src/app/[locale]/legal.module.css` | new, shared by both, DESIGN.md tokens only |
| `src/ui/Footer.tsx` | new, two links, rendered unconditionally |
| root `src/app/[locale]/layout.tsx` | render `Footer` alongside `Header` |
| `messages/en.json`, `messages/es.json` | new `Privacy` and `Terms` namespaces (title + body paragraphs), new `Footer` namespace (the two link labels) |

## Verification

- `/en/privacy`, `/es/privacy`, `/en/terms`, `/es/terms` all render, signed
  in or signed out — check both, since this is the first page in the app
  that must work signed-out.
- The footer link is visible and reachable from `/`, from every
  authenticated screen, and from the `(auth)` sign-in/sign-up pages.
- Privacy's copy accurately describes what `src/lib/api-keys.ts` and
  `DeleteAccount.tsx` actually do today — read the code, don't restate
  PROJECT.md's aspirational language if the shipped behavior differs in any
  small way.
- No hardcoded strings; both locales complete.
- `typecheck`, `lint`, `format:check`, `build`, `test`, and the suite with
  every provider/Supabase variable unset, same as every slice.

## Definition of done

Anyone, signed in or not, can reach a privacy page and a terms page from a
visible link on every screen, and the privacy page states plainly, in
language that matches what the code actually does, what happens to a CV and
an API key handed to this product. PROJECT.md section 11's one
unimplemented launch-readiness line now has a route behind it.
