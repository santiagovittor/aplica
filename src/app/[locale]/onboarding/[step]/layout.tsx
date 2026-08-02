import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireUser } from '@/lib/session';
import { Steps, type Step } from '@/ui/Steps';
import styles from '../onboarding.module.css';
import { StepTransition } from './StepTransition';

/**
 * SLICE-12 decision 4: three entries, order and position only -- never a
 * computed percentage, and never actual completion state. A step a user
 * skipped is still "complete" here in the sense that matters to this
 * indicator: they passed through it, per decision 3's "skip is not the same
 * as never having."
 */
export const ONBOARDING_STEPS = ['language', 'key', 'cv'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function isOnboardingStep(value: string): value is OnboardingStep {
  return (ONBOARDING_STEPS as readonly string[]).includes(value);
}

/**
 * The shell every step shares (SLICE-12 decision 1 and 4): gates on a
 * session, 404s an unknown step segment, and drives the `Steps` progress
 * indicator purely from where the current step sits in `ONBOARDING_STEPS`.
 */
export default async function OnboardingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; step: string }>;
}) {
  const { locale, step } = await params;
  setRequestLocale(locale);
  await requireUser();

  if (!isOnboardingStep(step)) {
    notFound();
  }

  const t = await getTranslations('Onboarding');
  const currentIndex = ONBOARDING_STEPS.indexOf(step);
  const steps: Step[] = ONBOARDING_STEPS.map((entry, index) => {
    const status =
      index < currentIndex
        ? 'complete'
        : index === currentIndex
          ? 'current'
          : 'incomplete';
    return {
      label: t(`steps.${entry}`),
      status,
      statusLabel: t(`stepStatus.${status}`),
    };
  });

  return (
    <main className={styles.shell}>
      <nav className={styles.stepsNav}>
        <Steps steps={steps} label={t('progressLabel')} />
      </nav>
      <StepTransition step={step}>{children}</StepTransition>
    </main>
  );
}
