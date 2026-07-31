'use server';

import { cookies } from 'next/headers';
import { redirect as externalRedirect } from 'next/navigation';
import { z } from 'zod';
import { redirect } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { requestOrigin, serverClient } from '@/lib/session';
import {
  loadLocale,
  loadOnboardingDismissed,
  saveLocale,
} from '@/lib/supabase';

/**
 * The auth flows, all server-side (SLICE-9 decision 3). The browser posts a
 * form and gets a session cookie back; it never holds a token itself and never
 * talks to the auth server directly.
 *
 * Every failure comes back as a message **key**, never as the provider's own
 * error text. An auth error can carry an address or a token fragment, and this
 * value is rendered into a page.
 */

/** The one shape every form in this folder returns. */
export interface FormState {
  error?: string;
}

const Locale = z.enum(routing.locales);

const Credentials = z.object({
  email: z.email(),
  // Longer than Supabase's own floor of 6, and said out loud in the hint.
  password: z.string().min(8),
  locale: Locale,
});

const EmailOnly = z.object({ email: z.email(), locale: Locale });
const PasswordOnly = z.object({
  password: z.string().min(8),
  locale: Locale,
});

export async function signIn(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const parsed = Credentials.safeParse(fields(form));
  if (!parsed.success) {
    return { error: shapeError(parsed.error) };
  }
  const { email, password, locale } = parsed.data;

  const supabase = await serverClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    return { error: authError(error.code, error.status) };
  }

  // The account's own stored preference wins over whatever locale the
  // sign-in page happened to be on (SLICE-11 decision 7's other half): a
  // returning Spanish user should land on /es, not wherever a stale link or
  // Accept-Language detection put the sign-in form. Detection for an
  // anonymous visitor is untouched; this only runs once a session exists.
  const preferred = await loadLocale(data.user.id);
  if (preferred !== locale) {
    (await cookies()).set('NEXT_LOCALE', preferred, {
      path: '/',
      sameSite: 'lax',
    });
  }

  // SLICE-12 decision 5: an account that has never been shown onboarding
  // lands there instead of /account. `loadOnboardingDismissed` is the only
  // check needed -- it is set the moment an account reaches the end of the
  // flow, so a returning, already-onboarded user is unaffected.
  const destination = (await loadOnboardingDismissed(data.user.id))
    ? '/account'
    : '/onboarding/language';

  redirect({ href: destination, locale: preferred });
  throw new Error('Unreachable: redirect did not throw.');
}

export async function signUp(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const parsed = Credentials.safeParse(fields(form));
  if (!parsed.success) {
    return { error: shapeError(parsed.error) };
  }
  const { email, password, locale } = parsed.data;

  const supabase = await serverClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: await callbackUrl(locale, `/${locale}/account`),
    },
  });
  if (error) {
    return { error: authError(error.code, error.status) };
  }

  // The trigger that creates the public.users row runs synchronously on the
  // auth.users insert, ahead of email confirmation, so the row already exists
  // here. Guarded by `identities`, not just `data.user`: Supabase's own
  // enumeration-masking for an already-registered address still returns a
  // `user` object, with an empty `identities` array as the one documented
  // signal that nothing new was created. Without this check, resubmitting the
  // sign-up form for someone else's address would silently overwrite their
  // stored language preference with no authentication at all.
  if (data.user && data.user.identities && data.user.identities.length > 0) {
    await saveLocale(data.user.id, locale);
  }

  // Deliberately the same destination whether or not that address already had
  // an account. Supabase hides the difference in its own response for the same
  // reason: a sign-up form that says "taken" is an account enumeration oracle.
  redirect({ href: '/check-email', locale });
  throw new Error('Unreachable: redirect did not throw.');
}

export async function requestPasswordReset(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const parsed = EmailOnly.safeParse(fields(form));
  if (!parsed.success) {
    return { error: shapeError(parsed.error) };
  }
  const { email, locale } = parsed.data;

  const supabase = await serverClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: await callbackUrl(locale, `/${locale}/new-password`),
  });
  if (error) {
    return { error: authError(error.code, error.status) };
  }

  redirect({ href: '/check-email', locale });
  throw new Error('Unreachable: redirect did not throw.');
}

export async function setNewPassword(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const parsed = PasswordOnly.safeParse(fields(form));
  if (!parsed.success) {
    return { error: shapeError(parsed.error) };
  }
  const { password, locale } = parsed.data;

  // The recovery link already exchanged its code for a session, so this is an
  // update by an authenticated user rather than a token being spent here.
  const supabase = await serverClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { error: 'link' };
  }

  const updated = await supabase.auth.updateUser({ password });
  if (updated.error) {
    return { error: authError(updated.error.code, updated.error.status) };
  }

  redirect({ href: '/account', locale });
  throw new Error('Unreachable: redirect did not throw.');
}

export async function signInWithGoogle(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const locale = Locale.safeParse(form.get('locale'));
  if (!locale.success) {
    return { error: 'unknown' };
  }

  const supabase = await serverClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: await callbackUrl(locale.data, `/${locale.data}/account`),
    },
  });
  if (error || !data.url) {
    return { error: 'unknown' };
  }

  // Google's own domain, so this is the plain redirect rather than the
  // locale-aware one.
  externalRedirect(data.url);
}

function fields(form: FormData): Record<string, unknown> {
  return {
    email: form.get('email') ?? undefined,
    password: form.get('password') ?? undefined,
    locale: form.get('locale') ?? undefined,
  };
}

/** Which field Zod refused, as a message key. */
function shapeError(error: z.ZodError): string {
  const path = error.issues[0]?.path[0];
  if (path === 'password') return 'weakPassword';
  if (path === 'email') return 'invalidEmail';
  return 'unknown';
}

/**
 * Supabase's error code, mapped to one of our own strings. The provider's
 * `message` is never returned: it reaches a rendered page, and it is the field
 * most likely to carry back something the user typed.
 */
function authError(
  code: string | undefined,
  status: number | undefined,
): string {
  switch (code) {
    case 'invalid_credentials':
    case 'email_not_confirmed':
      return 'invalidCredentials';
    case 'user_already_exists':
    case 'email_exists':
      return 'emailTaken';
    case 'weak_password':
      return 'weakPassword';
    case 'validation_failed':
      return 'invalidEmail';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'rateLimited';
    default:
      return status === 429 ? 'rateLimited' : 'unknown';
  }
}

/**
 * Where the provider sends the browser after it has verified the link.
 *
 * Built from the request's own host (`requestOrigin`) so the session written by
 * the callback lands on the origin the browser is actually using. Both forms of
 * the dev host are on `additional_redirect_urls` in supabase/config.toml; an
 * address that is not on that list bounces to `site_url` instead of failing
 * loudly.
 */
async function callbackUrl(locale: string, next: string): Promise<string> {
  const origin = await requestOrigin();

  return `${origin}/${locale}/callback?next=${encodeURIComponent(next)}`;
}
