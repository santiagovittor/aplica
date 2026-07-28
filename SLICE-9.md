# Slice 9 — auth and the encrypted key vault

## Context

Slice 7 refused to build a route handler, and gave the reason: *"without a
session there is no user id and no decrypted key, so a generation route today
would be a stub with a hard-coded id, which is worse than no route."* That is
still true, and this slice is what makes it stop being true.

The proof runs so far have papered over it. `npm run parse:cv -- --save <id>`
and `npm run apply -- --save <id>` take a user id as a command-line argument
from a person who typed it, and the model key comes from `APLICA_DEV_API_KEY`
in a shell. Both are dev-script scaffolding. Neither is how a user works, and
the real user id in the database today belongs to `dev@aplica.local`, an
account created by an admin API call because no sign-up path exists.

**What already exists, and is already tested.** This slice is smaller than it
looks because step 3 built the hard half:

- `src/core/crypto.ts` — AES-256-GCM, packed `v1.<iv>.<tag>.<ciphertext>`,
  key as a parameter so tests never touch real key material. Its tests assert
  that no failure path puts the plaintext or the encryption key into
  `error.message` or `error.stack`.
- `public.api_keys` — no grant to `anon` or `authenticated`, an explicit
  `revoke all`, and RLS enabled with **zero policies**, so even a role holding
  the grant matches no rows. `supabase/tests/rls.sql` asserts this by signing in
  as two users and as an anonymous visitor, and a deliberately broken assertion
  was confirmed to fail it.
- The cascade from `auth.users` → `public.users` → every table.

What is missing is everything above them: a session, a sign-up and sign-in path,
a screen that accepts a key, the server-side read that decrypts it at the moment
of use, and an account deletion that actually finishes the job.

**Read DESIGN.md in full for this slice.** Slice 7 explicitly excused it, because
a rendered PDF is not app UI. This slice builds screens, so DESIGN.md's tokens
and scales are the only pixel and colour values allowed, and its checklist plus
`avoid-ai-design` at zero P0/P1 is part of done.

## Your non-negotiables, recorded verbatim

Stated up front so they are not discoveries later. Each one names the test that
proves it, because "prove it with a test, not an assertion" is the instruction.

1. **The key is never returned to the client after save, never logged, never in
   an error message, never in a test fixture or CI log.**
2. **RLS on `api_keys` stays as built in step 3**: no grant to `anon` or
   `authenticated`, only `SUPABASE_SECRET_KEY` reaches it.
3. **Delete account actually deletes**: profile, `source_text`, the CV file in
   storage, the `api_keys` row, applications. *(This slice adds: the rendered
   files in the `outputs` bucket, which slice 7 created and named as an orphan
   nobody had cleaned up yet. Same class of problem, same fix, so it belongs
   here rather than being left for a later slice to rediscover.)*

   Note for whoever builds this: `dev@aplica.local` is the only user id the
   `--save` scripts currently work against, so proving deletion by removing it
   strands any later manual run. Sign up through the real flow first and use
   that account for the rest of the session.
4. **Email verification, password reset, and a working sign-out are in scope**
   (PROJECT.md section 11 auth hygiene), not deferred.
5. **Decryption happens server-side only, at the moment of use, never eagerly.**

Run tight, per CLAUDE.md section 7: small diffs, every line reviewable, pause
before anything irreversible. You read this diff line by line.

## Decisions taken (say so if any is wrong)

1. **`@supabase/ssr` and `@supabase/supabase-js` are added. Approved, with the
   reasoning recorded here per rule 7. Everything else stays hand-written.**
   Every Supabase call in the repo today is a hand-written `fetch` against
   PostgREST and Storage, deliberately, and that was right: those are two REST
   calls with a bearer token and an SDK would have been a dependency for
   nothing. **Auth is not that.** The cookie-based session flow is PKCE, an
   authorization-code exchange, refresh-token rotation, and cookie chunking for
   tokens that exceed 4 KB — security-critical protocol code where a subtle bug
   is a session-fixation hole, not a 500. That is exactly the "permanent,
   uncontrolled code" rule 7 says to buy rather than write. The existing
   hand-rolled `fetch` helpers in `src/lib/supabase.ts` **stay as they are**;
   this is not a licence to rewrite them through the SDK.
2. **The SDK is confined to `src/lib/` and `src/app/`.** `core` imports nothing
   from it, the same fence `render` and `providers` live behind. If a session
   type ever needs to reach `core`, it reaches it as a `string` user id.
3. **Server-side session only.** Route handlers and server components read the
   session; the browser gets a session cookie and never a provider key. This is
   the mechanism behind non-negotiable 1, not a separate policy.
4. **`getDecryptedKey(userId)` lives in `src/lib/` and returns the plaintext
   in-process to a server caller.** It is the only function in the repo that
   ever produces a plaintext key. It reads with `SUPABASE_SECRET_KEY`, decrypts
   with `encryptionKey()`, and its return value is never serialised, never put
   in a response body, and never passed to anything that logs. It is called at
   the moment of a provider request and the result is not cached.

   **The save path is the second place a plaintext key exists**, and pretending
   otherwise would make the two claims here unreadable. `saveApiKey` receives the
   plaintext from the form, validates it (decision 5), encrypts it, and stores
   the ciphertext. It is bounded: the plaintext never leaves that function, never
   reaches the database, never reaches a log, and never reaches a response. Those
   are the two paths, they are the only two, and the verification below greps for
   both rather than for one.
5. **The key is validated before it is stored.** A saved key that does not work
   fails later, inside a paid generation, as an opaque provider error — the
   worst possible place. One cheap authenticated call per provider (for Google,
   `GET /v1beta/models` with the key in the `x-goog-api-key` **header**, which
   returned 200 and 50 models when this was measured by hand this session)
   answers it for free before anything is written. **This is the only place the
   key is used outside a generation**, and that sentence belongs in
   `docs/security.md`. Say if you would rather store unvalidated and fail late.
6. **A wrong key is reported as "that key did not work", never with the
   provider's response body.** A provider's 401 body can echo the key back.
   `ProviderError` already carries a status and no body, for exactly this
   reason, and the validation path uses the same discipline.
7. **Account deletion is one server-side function with a documented order:**
   storage objects first (`cvs`, then `outputs`), then the `auth.users` delete
   that cascades every table. Storage has no foreign key to cascade through, so
   deleting the auth user first would orphan the files permanently with no row
   left to find them from. `docs/security.md` already flags the `cvs` half as an
   obligation; this closes it and the `outputs` half slice 7 opened.
8. **Deletion is confirmed by typing, not by a checkbox.** It is irreversible
   and it destroys a paid-for profile. A `confirm()` dialog is also out —
   the browser-modal ban in this repo's own tooling notes applies to users too,
   and a native dialog is the least calm thing on the page.
9. **The `usage_counters` increment is still not built here.** It is a
   generation-route concern, it has been deferred twice for that reason, and
   deferring it a third time with the same reason is more honest than smuggling
   it into an auth slice.

## Blocked on you

1. **Google OAuth redirect URLs.** `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and
   `..._SECRET` are already in `.env.local`, so the credential exists. What I
   cannot know is which redirect URIs are registered in the Google Cloud console
   for it. The two authorised redirect URIs to add, exactly:

   - local: `http://127.0.0.1:54321/auth/v1/callback`
   - hosted: `https://<project-ref>.supabase.co/auth/v1/callback`

   `<project-ref>` is the subdomain of the hosted project's URL. It does not
   exist yet — `NEXT_PUBLIC_SUPABASE_URL` currently points at
   `http://127.0.0.1:54321` — so the hosted URI is addable only once a Supabase
   project is created. Both go in **Authorised redirect URIs** on the OAuth 2.0
   client, not Authorised JavaScript origins: the browser never lands on our own
   origin during the exchange, Supabase's `/auth/v1/callback` receives the code.
   Adding a URI there is a change to a real Google account and it is your click,
   not mine.
2. **Email delivery in local Supabase.** Verification and password reset are
   in scope per non-negotiable 4, and local Supabase captures mail in Inbucket
   rather than sending it. That is fine for proving the flow and it is **not**
   proof that a real provider will deliver.

   **Settled: Inbucket is acceptable proof for this slice**, on one condition —
   real SMTP deliverability on the hosted project becomes **its own item on the
   step 9 launch-readiness checklist**. Verification that works locally and
   fails in production is a launch-day failure, and writing it here is what
   stops the person building step 9 from having to rediscover it.
3. ~~Whether decision 5 (validate before storing) is in scope.~~ **Settled: it
   stays.** A dead key failing inside a paid generation is the worst place to
   discover it.
4. **A migration, if one turns out to be needed.** I do not expect one:
   `api_keys` and the cascade exist. If deletion or the session needs a schema
   change, kickoff step 3's rule holds and you see it before it is applied.
5. **Does `supabase/tests/rls.sql` join CI here?** Slice 8 deliberately left it
   out and said this slice is where it earns its keep, because this is the slice
   that touches auth, `api_keys` and deletion. It costs a `supabase start` in
   the job: Docker and a several-minute cold start on every push. I lean yes,
   as a **separate job** so the fast checks still report in under a minute.

## Files

| File                                | What                                                        |
| ----------------------------------- | ----------------------------------------------------------- |
| `src/lib/session.ts`                | the server-side Supabase client and `requireUser()`          |
| `src/lib/session.test.ts`           | signed out, signed in, expired                               |
| `src/lib/api-keys.ts`               | `saveApiKey`, `getDecryptedKey`, `deleteApiKey`, `describeApiKey` |
| `src/lib/api-keys.test.ts`          | round trip, the leak tests for non-negotiable 1, wrong-key path |
| `src/lib/account.ts`                | `deleteAccount`, in the order decision 7 documents           |
| `src/lib/account.test.ts`           | every table and both buckets, proved rather than asserted    |
| `src/app/[locale]/(auth)/*`         | sign in, sign up, verify, reset, and the OAuth callback route |
| `src/app/[locale]/account/*`        | the settings screen: key, language, delete account, sign out |
| `src/ui/*`                          | only what the screens genuinely need; reuse Button/Card/Field/Input |
| `messages/en.json`, `messages/es.json` | every string; `Auth` and `Account` namespaces (today's file has only Meta, Home, LocaleToggle, Styleguide) |
| `docs/security.md`                  | decision 5's sentence, and the deletion path now that it is closed |
| `package.json`                      | the two dependencies from decision 1                          |

Nothing in `src/core/`, `src/prompts/`, `src/providers/` or `src/render/` is
touched. The prompts stay fenced. `src/lib/supabase.ts`'s existing hand-written
helpers stay hand-written (decision 1).

## Not built

No apply screen, no applications list, no onboarding flow — KICKOFF step 7's
five screens are their own slice, and this one builds only the two that auth
requires (the auth pages and account/settings). No generation route, no SSE, no
`maxDuration`: that is the next slice, and it is the one this exists to unblock.
No `usage_counters` increment (decision 9). No privacy or terms page, no landing
page, no motion-polish pass — all step 9. No billing, no `plan` field.

## Verification

Measured and pasted, not asserted. Every item here is a command with output, not
a claim.

- **Slice 8's CI green on the branch**, before this is called done. That was the
  entire argument for doing slice 8 first.
- **Sign up, verify, sign out, sign in, reset the password, sign in with the new
  one** — as a real sequence against local Supabase, with the Inbucket messages
  shown. Then the same for Google OAuth, or an explicit statement that it was
  not proved and why.
- **The leak tests, named individually in the report rather than as a count.**
  For each of: the save response body, `error.message` and `error.stack` on
  every failure path, the server log of a full save-then-generate cycle, and the
  test output itself — the assertion is that the plaintext key appears in none
  of them.
- **Plaintext exists in exactly two places, and a grep proves it.** The callers
  of `getDecryptedKey`, and the body of `saveApiKey`, both pasted (decision 4).
  Anything else holding a plaintext key is a finding.
- **`supabase/tests/rls.sql` rerun after any change**, with the pass shown. It
  is the thing that proves non-negotiable 2 and it already exists.
- **Delete the account, then prove the absence.** Query every table and list
  both buckets for that user id afterwards, and paste the empty results:
  `profiles`, `applications`, `api_keys`, `usage_counters`, `public.users`,
  `auth.users`, `cvs/<uid>/`, `outputs/<uid>/`. An empty result set is the
  evidence; a passing test that never inserted anything is not.
- **The dev leftovers from slice 7 are cleaned up as part of proving this**:
  `dev@aplica.local` and its application row and four objects are exactly the
  fixture the deletion path should be able to remove. If it cannot, that is the
  finding.
- **A wrong key is rejected at save time** with a message that contains neither
  the key nor the provider's body (decisions 5 and 6).
- **DESIGN.md's checklist on both screens, and `avoid-ai-design` in detect mode
  at zero P0/P1**, per CLAUDE.md section 8.
- `typecheck`, `lint`, `format:check`, `build`, `test`, and the suite with every
  provider and Supabase variable unset.

## Commits

1. `feat(lib): a server-side session and requireUser`
2. `feat(auth): sign up, sign in, sign out`
3. `feat(auth): email verification and password reset`
4. `feat(lib): store and read the user's model key`
5. `feat(account): the settings screen`
6. `feat(lib): delete an account and everything it owns`
7. `test(security): the key never leaves the server`
8. `docs(security): validation at save, and the deletion path closed`

Eight, and they are deliberately fine-grained: you said you read this diff line
by line, and commit 4 and commit 7 are the two you should read hardest.

Every git command scoped with
`-C "C:\Users\user-1\Documents\Personal Projects\aplica"`.

## Definition of done

A person can sign up, verify their email, paste a model key, see that it was
accepted without ever seeing it again, sign out, sign back in, and delete their
account and every byte it owned — with each of those proved by pasted output
rather than described. The next slice can then ask for a user id and a key and
get real ones.
