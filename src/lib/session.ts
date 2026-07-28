import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { redirect } from '../i18n/navigation';

/**
 * The server-side session (SLICE-9 decision 3).
 *
 * Route handlers, server actions and server components read the session here.
 * The browser holds a session cookie and nothing else: no provider key ever
 * reaches it, which is the mechanism behind the key never leaving the server
 * rather than a policy written next to it.
 *
 * This client carries the **publishable** key, so every query it makes is
 * subject to row-level security. `public.api_keys` grants it nothing, so this
 * client cannot read a stored key even if somebody asks it to. The secret key
 * lives in `supabase.ts` and `api-keys.ts` and nowhere else.
 */

/**
 * Reads the request's cookies and writes any the SDK rotates.
 *
 * `setAll` is wrapped because a server component renders after the response
 * headers are decided and cannot write a cookie. That is not a failure: the
 * proxy refreshes the session on every request, so the rotated token is already
 * on its way to the browser by the time a component asks for the user.
 */
export async function serverClient(): Promise<SupabaseClient> {
  const store = await cookies();

  return createServerClient(projectUrl(), publishableKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options);
          }
        } catch {
          // Rendering a server component. The proxy already wrote these.
        }
      },
    },
  });
}

/**
 * The signed-in user, or null.
 *
 * `getUser` and not `getSession`: the session cookie is data the browser sends,
 * so trusting it without asking the auth server is trusting the client. The
 * error is deliberately swallowed rather than logged. An expired token, a
 * tampered cookie and no cookie at all are the same answer to the only question
 * being asked, and an auth error is a place a token could reach a log.
 */
export async function currentUser(): Promise<User | null> {
  const supabase = await serverClient();
  const { data, error } = await supabase.auth.getUser();

  return error ? null : data.user;
}

/**
 * The user, or a redirect to sign in. Every page and action behind auth starts
 * here, so "signed out" is never a branch a caller can forget to write.
 *
 * The redirect keeps the reader's language: being bounced to sign in is bad
 * enough without also being bounced into another language.
 */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (user) {
    return user;
  }

  redirect({ href: '/sign-in', locale: await getLocale() });
  // next-intl's redirect throws, the same as Next's own. Its return type does
  // not say so, and this is cheaper than asserting one that lies.
  throw new Error('Unreachable: redirect did not throw.');
}

/**
 * The origin the browser actually asked for, taken from the request headers.
 *
 * Not `request.url`, and not an env var. Next's `request.url` reports the
 * server's own idea of its origin, which in dev is `localhost` even when the
 * browser typed `127.0.0.1`. Those are two origins as far as cookies are
 * concerned, so redirecting to the wrong one hands the browser a page it has no
 * session for; the symptom is a confirmation link that "works" and lands on
 * sign-in anyway. An env var would have the matching failure on preview
 * deploys, sending everyone to production.
 */
export async function requestOrigin(): Promise<string> {
  const header = await headers();
  const host = header.get('x-forwarded-host') ?? header.get('host');
  if (!host) {
    throw new Error('No host header, so the request origin is unknown.');
  }

  return `${header.get('x-forwarded-proto') ?? 'http'}://${host}`;
}

/** The project URL. Public by design; it is in the browser bundle already. */
export function projectUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set.');
  }
  return url.replace(/\/$/, '');
}

/**
 * The publishable key. Safe in the browser: it carries no privileges of its
 * own, row-level security does the protecting.
 */
export function publishableKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set.');
  }
  return key;
}
