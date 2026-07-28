import { NextResponse, type NextRequest } from 'next/server';
import { requestOrigin, serverClient } from '@/lib/session';

/**
 * Where every link and every OAuth handshake lands: the sign-up confirmation,
 * the password reset link, and Google.
 *
 * All three arrive the same way. Supabase verifies the link on its own domain
 * and then redirects here with a PKCE `code`, which is exchanged for a session
 * and written to cookies. A route handler is used rather than a page because
 * this is the one place in the flow that must write cookies.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'), locale);

  // The header, not `request.url`. They differ, and a redirect to the other one
  // arrives at an origin that holds none of the cookies just written.
  const origin = await requestOrigin();

  if (!code) {
    return NextResponse.redirect(signInWithError(origin, locale));
  }

  const supabase = await serverClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // A spent link, an expired one, or one opened in a different browser from
    // the one that asked for it. The user gets one sentence and a way forward;
    // the provider's own message is not repeated.
    return NextResponse.redirect(signInWithError(origin, locale));
  }

  return NextResponse.redirect(new URL(next, origin));
}

/**
 * `next` decides where a freshly minted session lands, so an unchecked value
 * would hand that session to whatever origin a crafted link named. Only a path
 * on this site is allowed: `//host` and `https://host` are both URLs, and only
 * the first looks like a path.
 */
function safeNext(raw: string | null, locale: string): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//')
    ? raw
    : `/${locale}/account`;
}

function signInWithError(origin: string, locale: string): URL {
  return new URL(`/${locale}/sign-in?error=link`, origin);
}
