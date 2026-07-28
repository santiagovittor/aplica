# Local setup

Everything here runs on your machine. No hosted Supabase project is needed until
step 7, when there is a sign-in screen to point at one.

## Once

Docker Desktop has to be running; the local Supabase stack is containers.

```bash
npm install
cp .env.example .env.local
```

Generate the encryption key yourself and paste it into `.env.local`. Do not let a
tool generate it for you: anything it prints lands in a log or a transcript.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

## Every session

```bash
npx supabase start     # first run pulls a few GB of images
```

It prints the API URL and keys. Copy them into `.env.local`:
`API URL` into `NEXT_PUBLIC_SUPABASE_URL`, the publishable (anon) key into
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, the secret (service_role) key into
`SUPABASE_SECRET_KEY`.

```bash
npx supabase status    # print them again later
npx supabase stop      # containers keep their data between runs
```

Useful local addresses: Studio at http://127.0.0.1:54323, and Mailpit at
http://127.0.0.1:54324, which catches every confirmation and password-reset mail
so nothing is actually sent.

## Applying schema changes

```bash
npx supabase db reset  # drops, recreates, replays every migration from scratch
```

Verify the security rules still hold:

```bash
docker exec -i supabase_db_aplica psql -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/rls.sql
```

It seeds two users, reads every table as each of them and as an anonymous
visitor, and asserts what each can and cannot see. It rolls itself back, so it is
safe to run against a database you care about.

## The checks

`.github/workflows/ci.yml` runs these on every push to `main` and every pull
request, in this order. Running the same five locally is the whole of it:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

CI runs them with **no environment variables at all** — no Supabase URL, no
keys, no `APLICA_DEV_API_KEY`. That is deliberate: the test suite runs against
the MockProvider, so no real credential ever exists in CI to leak (CLAUDE.md
section 5). If you want to reproduce exactly what CI does, unset them:

```bash
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    -u SUPABASE_SECRET_KEY -u API_KEY_ENCRYPTION_KEY \
    -u APLICA_DEV_PROVIDER -u APLICA_DEV_API_KEY \
    sh -c 'npm run typecheck && npm test && npm run build'
```

A step failing does not stop the ones after it, so one red run tells you
everything that is wrong rather than the first thing.

`supabase/tests/rls.sql` is **not** in CI. It needs a live Postgres, which means
starting the whole Supabase stack in the job. Run it locally after any migration
(above). Adding it to CI is a decision for the slice that next changes an RLS
policy.

## Google sign-in (browser work, only you can do it)

Email sign-in works out of the box. Google needs credentials that only you can
create, and the handshake cannot be exercised until step 7 builds the callback
route.

1. In the Google Cloud Console, create a project, then **APIs & Services >
   Credentials > Create credentials > OAuth client ID**, type _Web application_.
2. Authorised redirect URI, for local: `http://127.0.0.1:54321/auth/v1/callback`.
   Add the hosted one (`https://<project-ref>.supabase.co/auth/v1/callback`) when
   the hosted project exists.
3. Put the client ID and secret into `.env.local` as
   `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and
   `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`.
4. Set `enabled = true` under `[auth.external.google]` in `supabase/config.toml`,
   then `npx supabase stop && npx supabase start`.

On the hosted project the same pair goes into **Authentication > Providers >
Google** in the dashboard instead.

## The hosted project (step 7, not now)

```bash
npx supabase login                       # opens a browser
npx supabase link --project-ref <ref>    # after creating the project at supabase.com
npx supabase db push                     # applies the same migrations
```

The migration files are identical either way, so nothing done locally has to be
redone.
