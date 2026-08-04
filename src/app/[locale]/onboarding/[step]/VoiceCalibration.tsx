'use client';

import { useActionState, useState } from 'react';
import { recordVoiceCalibration } from '@/app/[locale]/onboarding/actions';
import { Button } from '@/ui/Button';
import styles from '../onboarding.module.css';

/**
 * The `voice` step's own action (SLICE-19 decision 1): picking a card or
 * clicking "Skip for now" both just mark calibration answered -- neither
 * changes what `voice.ts` sends the model -- so both buttons submit the same
 * action and it never needs to know which anchor, if either, was picked.
 */
export function VoiceCalibration({
  locale,
  anchors,
  labels,
}: {
  locale: string;
  anchors: [string, string];
  labels: {
    prompt: string;
    continueLabel: string;
    skipLabel: string;
    error: string;
  };
}) {
  const [state, action, pending] = useActionState(recordVoiceCalibration, {});
  const [picked, setPicked] = useState<number | null>(null);

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="locale" value={locale} />

      <fieldset className={styles.anchors}>
        <legend className={styles.groupLabel}>{labels.prompt}</legend>
        {anchors.map((line, index) => (
          <label
            key={index}
            className={styles.anchorCard}
            data-selected={picked === index || undefined}
          >
            <input
              type="radio"
              name="pick"
              value={index}
              checked={picked === index}
              onChange={() => setPicked(index)}
              className="visually-hidden"
            />
            <span className={styles.anchorText}>&ldquo;{line}&rdquo;</span>
          </label>
        ))}
      </fieldset>

      {state.error ? (
        <p className={styles.error} role="alert">
          {labels.error}
        </p>
      ) : null}

      <div className={styles.actions}>
        <Button
          type="submit"
          variant="primary"
          loading={pending}
          disabled={picked === null}
        >
          {labels.continueLabel}
        </Button>
        <Button type="submit" variant="quiet">
          {labels.skipLabel}
        </Button>
      </div>
    </form>
  );
}
