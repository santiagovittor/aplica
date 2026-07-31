'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { redirect } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { deleteAccount } from '@/lib/account';
import {
  ApiKeyRejected,
  ApiKeyUnreachable,
  KEY_PROVIDERS,
  deleteApiKey,
  saveApiKey,
} from '@/lib/api-keys';
import { requireUser, serverClient } from '@/lib/session';

/**
 * The settings screen's four actions. Every one of them starts at
 * `requireUser`, so the user id comes from the session cookie and never from
 * the form: a hidden field carrying a user id is a field somebody edits.
 *
 * The key crosses the wire once, from the form to `saveApiKey`, and is never
 * returned, echoed back into the form, or put in the state this returns.
 */

export interface KeyState {
  error?: string;
  /**
   * Which provider the failure was about. Returned rather than read from the
   * form's own state in the browser, so the sentence names the provider the
   * server actually called.
   */
  provider?: string;
}

export interface DeleteState {
  error?: string;
}

const Locale = z.enum(routing.locales);

/**
 * `KeyCard` also renders inside the onboarding `key` step (SLICE-12), on a
 * different path than `/account`. `revalidatePath` needs the path that is
 * actually mounted, so the form names which screen it is on rather than
 * trusting a raw path from the client -- `screen` is a closed enum, so there
 * is nothing here for a tampered field to redirect a revalidation to.
 */
const Screen = z.enum(['account', 'onboardingKey']);

function screenPath(locale: string, screen: z.infer<typeof Screen>): string {
  return screen === 'account'
    ? `/${locale}/account`
    : `/${locale}/onboarding/key`;
}

const KeyForm = z.object({
  provider: z.enum(KEY_PROVIDERS),
  key: z.string(),
  locale: Locale,
  screen: Screen,
});

export async function saveKey(
  _previous: KeyState,
  form: FormData,
): Promise<KeyState> {
  const user = await requireUser();

  const parsed = KeyForm.safeParse({
    provider: form.get('provider') ?? undefined,
    key: form.get('key') ?? undefined,
    locale: form.get('locale') ?? undefined,
    screen: form.get('screen') ?? undefined,
  });
  if (!parsed.success) {
    return { error: 'unknown' };
  }
  const { provider, key, locale, screen } = parsed.data;

  if (key.trim() === '') {
    return { error: 'empty', provider };
  }

  try {
    await saveApiKey(user.id, provider, key);
  } catch (error) {
    // Mapped by type, never by message. The message is not shown and not
    // logged; what reaches the screen is one of our own sentences.
    if (error instanceof ApiKeyRejected) return { error: 'rejected', provider };
    if (error instanceof ApiKeyUnreachable) {
      return { error: 'unreachable', provider };
    }
    return { error: 'unknown', provider };
  }

  revalidatePath(screenPath(locale, screen));
  return {};
}

export async function removeKey(
  _previous: KeyState,
  form: FormData,
): Promise<KeyState> {
  const user = await requireUser();
  const locale = Locale.safeParse(form.get('locale'));
  const screen = Screen.safeParse(form.get('screen'));
  if (!locale.success || !screen.success) {
    return { error: 'unknown' };
  }

  try {
    await deleteApiKey(user.id);
  } catch {
    return { error: 'unknown' };
  }

  revalidatePath(screenPath(locale.data, screen.data));
  return {};
}

/** Plain form action: nothing to report, so there is no state to thread. */
export async function signOut(form: FormData) {
  const locale = Locale.safeParse(form.get('locale'));
  const supabase = await serverClient();
  await supabase.auth.signOut();

  redirect({ href: '/sign-in', locale: locale.success ? locale.data : 'en' });
  throw new Error('Unreachable: redirect did not throw.');
}

/**
 * Irreversible, and it destroys work the user paid a model to produce. So it is
 * confirmed by typing the account's own email address rather than by ticking a
 * box, and the comparison happens here rather than in the browser.
 */
export async function deleteMyAccount(
  _previous: DeleteState,
  form: FormData,
): Promise<DeleteState> {
  const user = await requireUser();
  const locale = Locale.safeParse(form.get('locale'));
  const typed = String(form.get('confirm') ?? '')
    .trim()
    .toLowerCase();

  if (!locale.success) {
    return { error: 'unknown' };
  }
  if (!user.email || typed !== user.email.toLowerCase()) {
    return { error: 'mismatch' };
  }

  try {
    await deleteAccount(user.id);
  } catch {
    return { error: 'unknown' };
  }

  // The account is gone, so there is nobody to sign out on the server. This
  // clears the cookies that are now pointing at a user who does not exist.
  const supabase = await serverClient();
  await supabase.auth.signOut({ scope: 'local' });

  redirect({ href: '/sign-in', locale: locale.data });
  throw new Error('Unreachable: redirect did not throw.');
}
