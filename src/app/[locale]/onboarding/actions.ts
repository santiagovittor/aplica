'use server';

import { z } from 'zod';
import { redirect } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { requireUser } from '@/lib/session';
import { saveDisplayName, saveVoiceCalibratedAt } from '@/lib/supabase';

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

/**
 * The `voice` step's own action (SLICE-19 decisions 1 and 5). Picking an
 * anchor and clicking "Skip for now" both submit this same action: the pick
 * itself has no technical effect (decision 1), so all that ever needs
 * recording is that the screen was answered, which is why this never reads a
 * `pick` field out of the form at all.
 */

export interface VoiceCalibrationState {
  error?: string;
}

const VoiceForm = z.object({
  locale: z.enum(routing.locales),
});

export async function recordVoiceCalibration(
  _previous: VoiceCalibrationState,
  form: FormData,
): Promise<VoiceCalibrationState> {
  const user = await requireUser();

  const parsed = VoiceForm.safeParse({
    locale: form.get('locale') ?? undefined,
  });
  if (!parsed.success) {
    return { error: 'unknown' };
  }
  const { locale } = parsed.data;

  try {
    await saveVoiceCalibratedAt(user.id);
  } catch {
    return { error: 'unknown' };
  }

  redirect({ href: '/account', locale });
  throw new Error('Unreachable: redirect did not throw.');
}
