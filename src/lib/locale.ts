'use server';

import { z } from 'zod';
import { routing } from '../i18n/routing';
import { currentUser } from './session';
import { saveLocale } from './supabase';

/**
 * `LocaleToggle` lives in `ui/` and renders on both the account page and the
 * signed-out home page, so its server action lives here rather than in
 * `account/actions.ts`: `ui/` depending on a specific route's actions would
 * point the dependency the wrong way (CLAUDE.md section 3).
 */

const Locale = z.enum(routing.locales);

/**
 * Persists the language a signed-in user just switched to (SLICE-11 decision
 * 7's other half: `users.locale` has to be real data before the CV route can
 * trust it).
 *
 * A graceful no-op for an anonymous visitor, not `requireUser`'s redirect:
 * `LocaleToggle` renders while signed out too, and an anonymous visitor's
 * language keeps coming from `Accept-Language` detection alone, unaffected by
 * this action existing.
 */
export async function setLocale(locale: string): Promise<void> {
  const parsed = Locale.safeParse(locale);
  if (!parsed.success) {
    return;
  }

  const user = await currentUser();
  if (user === null) {
    return;
  }

  await saveLocale(user.id, parsed.data);
}
