import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { projectUrl, publishableKey } from './lib/session';
import { routing } from './i18n/routing';

// Next 16 names this file `proxy.ts` (was `middleware.ts`).
const handleLocale = createMiddleware(routing);

/**
 * Two jobs on one response, in this order for a reason.
 *
 * next-intl decides the response first: it may redirect a bare `/` to `/es`, or
 * rewrite `/es/account` onto the route tree. Whatever it decides, the rotated
 * session cookies have to ride on **that** response object. Refreshing first
 * and then letting next-intl build a second response would drop the new tokens
 * on the floor, and the symptom would be a user who signs in and is silently
 * signed out on the next navigation.
 *
 * This is the only place a token is refreshed. A server component cannot write
 * a cookie, so without this an expired access token would never rotate.
 */
export default async function proxy(request: NextRequest) {
  const response = handleLocale(request);

  const supabase = createServerClient(projectUrl(), publishableKey(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          // Both halves matter: the request copy is what anything later in this
          // same pass reads, the response copy is what reaches the browser.
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // The call is the point, not the answer. `getUser` asks the auth server,
  // which is what rotates an expired access token through `setAll` above.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Everything except API routes, Next internals and files with an extension.
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
