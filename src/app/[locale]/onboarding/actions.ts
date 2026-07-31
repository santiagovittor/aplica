'use server';

import { z } from 'zod';
import { redirect } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { requireUser } from '@/lib/session';
import { saveDisplayName } from '@/lib/supabase';

/**
 * The `language` step's own action (SLICE-12 decision 1): saves the name if
 * one was typed, then advances to `key`. A blank name is not an error and is
 * not saved -- `saveDisplayName` already treats one as "no answer" -- so
 * submitting with nothing typed behaves exactly like the step's own skip
 * link, just from the primary button instead.
 */

export interface NameFormState {
  error?: string;
}

const Form = z.object({
  name: z.string(),
  locale: z.enum(routing.locales),
});

export async function saveNameAndContinue(
  _previous: NameFormState,
  form: FormData,
): Promise<NameFormState> {
  const user = await requireUser();

  const parsed = Form.safeParse({
    name: form.get('name') ?? '',
    locale: form.get('locale') ?? undefined,
  });
  if (!parsed.success) {
    return { error: 'unknown' };
  }
  const { name, locale } = parsed.data;

  try {
    await saveDisplayName(user.id, name);
  } catch {
    return { error: 'unknown' };
  }

  redirect({ href: '/onboarding/key', locale });
  throw new Error('Unreachable: redirect did not throw.');
}
