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

## When the key is used

Twice, and only twice.

**Once at save time, to check it works.** `saveApiKey` makes one cheap
authenticated GET against the provider before it encrypts anything: Anthropic's
`/v1/models`, OpenAI's `/v1/models`, Google's `/v1beta/models`. **This is the
only place the key is used outside a generation.** The alternative is storing a
key nobody has tried, which means the first thing that finds out it is dead is a
paid generation halfway through the pipeline, reported as an opaque provider
error. The check costs nothing and answers it on the settings screen instead.

The key travels in a request header on all three, never in a query string: a
query string ends up in access logs and proxy traces. A refusal is reported as
"that key did not work" with the status and nothing else, because a provider's
401 body can echo the key straight back. A 5xx or a dropped connection is
reported as "we could not check", which is a different sentence on purpose:
telling someone their key is wrong because a server they do not own fell over is
worse than admitting we do not know.

**Once at generation time**, by `getDecryptedKey`, which is the only function in
the repo that produces a plaintext key. It reads with `SUPABASE_SECRET_KEY`,
decrypts in process, and hands the value to the provider call. The result is not
cached: a key held in memory between requests is a key that can be read out of a
heap dump long after the request that needed it.

Those are the two functions that ever hold a plaintext key. `saveApiKey`
receives one from the form and lets it go; `getDecryptedKey` produces one and
never returns it to anything that serialises. Nothing else in the codebase sees
one.

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

## Deleting the whole account

`deleteAccount` in `src/lib/account.ts`, in one documented order:

1. every object under `cvs/<user_id>/`,
2. every object under `outputs/<user_id>/`, at any depth,
3. the `auth.users` row, which cascades to `public.users`, `profiles`,
   `api_keys`, `applications` and `usage_counters`.

The order is the design, not a preference. Storage has no foreign key to cascade
through, so deleting the auth user first would strand the files permanently with
no row left to find them from. If a storage delete fails, the whole thing throws
and the account survives: a live account with its files is recoverable, and a
deleted account with unreachable files is not.

The `outputs` listing recurses. Objects there are keyed
`<user_id>/<application_id>/<file>`, and Storage's `list` returns the objects
directly under a prefix plus one entry per subfolder, so a single flat call
returns folders. A delete built from that list removes nothing while looking
like it worked.

This closes both halves of what used to be an open obligation here: the `cvs`
files, and the `outputs` files that `20260728031935_outputs_bucket.sql` created
and named as an orphan. `supabase/tests/rls.sql` still pins the database half,
so the day Storage starts cascading from `auth.users` on its own, that assertion
says so rather than this page going quietly stale.

Deletion is confirmed by typing the account's own email address, compared on the
server against the session. Not a checkbox, which is one click away from
something that cannot be undone.

## The CV

Uploaded CVs go to the private `cvs` storage bucket under a `<user_id>/` prefix.
The bucket is private, so there are no public URLs; the storage policy grants a
user access only to objects whose first path segment is their own id.
