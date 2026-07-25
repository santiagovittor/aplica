# Security: the user's model API key

Aplica is bring-your-own-key. That means the app holds a live credential that can
spend the user's money. This file is the whole story of what happens to it.
PROJECT.md section 6 is the spec; this is the implementation.

## Where the key lives

The key is encrypted before it reaches the database, with AES-256-GCM
(`src/core/crypto.ts`). The encryption key is a 32-byte secret in
`API_KEY_ENCRYPTION_KEY`, held server-side only and never in the database, so a
stolen database dump is not a stolen key.

The ciphertext is stored in `public.api_keys.ciphertext`, packed as
`v1.<iv>.<tag>.<ciphertext>` in base64url. Each encryption uses a fresh random
initialisation vector, so the same key encrypted twice produces two different
rows. The `v1` prefix is there so the encryption key can be rotated later without
a migration.

We chose an env secret over Supabase Vault. Vault would put the same decryption
capability behind the same server-side credential, so the trust boundary is
identical, but it cannot be unit-tested without a running database and it welds
key storage to Supabase.

## Who can read it

`public.api_keys` is shut three ways. It grants nothing to `anon` or
`authenticated` (every other table grants explicitly; this one is simply left
out). It carries an explicit `revoke all ... from anon, authenticated` so a
future change to Supabase's default privileges cannot hand out access by
accident. And it has row-level security enabled with **no policies at all**, so
even a role that somehow held the grant would match zero rows.

There is no query a browser can make that reaches that table, not even to count
its rows. Only code holding `SUPABASE_SECRET_KEY` can touch it, and that env var
is server-side only.

`supabase/tests/rls.sql` asserts this rather than claiming it: it signs in as two
different users and as an anonymous visitor, and every attempt to read
`api_keys` must be refused. It passes today, and a deliberately broken
assertion was confirmed to fail it, so a green run means something.

## What never happens

- The key is never returned to the client after it is saved. The UI shows which
  provider is configured, never the key or a fragment of it.
- The key never appears in an error. `decrypt` catches the underlying failure and
  throws its own message, and `crypto.test.ts` asserts that on every failure path
  neither `error.message` nor `error.stack` contains the plaintext or the
  encryption key.
- The key is never logged. Provider calls happen server-side, so it never reaches
  the browser network tab.
- No real key exists in tests, fixtures, or CI. Tests generate their own random
  key in-process, and the whole test suite runs against the MockProvider
  (CLAUDE.md section 5), so CI never holds a credential to leak.

## Deleting it

One click, and the row is deleted outright rather than blanked.

Deleting the whole account cascades from `auth.users` through `public.users` to
every table here: the encrypted key, the profile, the applications, the usage
counter. **It does not remove the uploaded CV.** Storage objects have no cascade
from `auth.users`, so the account-deletion path has to delete the file from the
`cvs` bucket itself. That is a step 7 obligation, and `supabase/tests/rls.sql`
asserts the current behaviour so this paragraph cannot go quietly stale.

## The CV

Uploaded CVs go to the private `cvs` storage bucket under a `<user_id>/` prefix.
The bucket is private, so there are no public URLs; the storage policy grants a
user access only to objects whose first path segment is their own id.
