'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { removeKey, saveKey } from './actions';
import styles from './account.module.css';

/**
 * The key lives here and is never shown again. The field is a password field
 * and posts to a server action: the value is in the DOM for as long as it takes
 * to submit, and nowhere else. Nothing renders it back.
 *
 * Error text is chosen against the provider currently selected, because "that
 * is not a Google key" is the most useful thing a refusal can say.
 */
export function KeyCard({
  locale,
  screen = 'account',
  providers,
  saved,
  labels,
  errors,
}: {
  locale: string;
  /** Which screen this is mounted on, so `saveKey`/`removeKey` revalidate
   *  the page that is actually showing it (SLICE-12: also used by the
   *  onboarding `key` step). */
  screen?: 'account' | 'onboardingKey';
  providers: { value: string; label: string }[];
  saved: string | null;
  labels: Record<string, string>;
  errors: Record<string, Record<string, string>>;
}) {
  const [saveState, save, saving] = useActionState(saveKey, {});
  const [removeState, remove, removing] = useActionState(removeKey, {});
  // Controlled, unlike the rest of this form's fields: whether the base-url
  // and model inputs show at all depends on which provider is picked, so
  // there has to be somewhere in React to read that from before submit.
  const [provider, setProvider] = useState(providers[0].value);

  const failure = saveState.error ?? removeState.error;
  // The provider the server actually called, once there has been a submit;
  // the live selection otherwise, so a refusal before any submit still names
  // the provider on screen rather than always the first option in the list.
  const messages = errors[saveState.provider ?? provider] ?? {};
  const showEndpoint = provider === 'openai_compatible';

  return (
    /* SLICE-23 §5.5: the fields group inside one --paper panel. Removing the
       card wrapper was right for `/apply`, where a card wrapped an entire
       screen; it is wrong for a settings form, where the grouping carries the
       information that these fields are one thing. */
    <div className={styles.panel}>
      <div className={styles.status}>
        <p className={saved ? styles.saved : styles.none}>
          {saved ?? labels.none}
        </p>
        {saved ? <p className={styles.body}>{labels.replace}</p> : null}
      </div>

      <form action={save} className={styles.form}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="screen" value={screen} />
        <div className={styles.fields}>
          <Select
            id="provider"
            name="provider"
            label={labels.provider}
            options={providers}
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
          />
          {showEndpoint && (
            <Input
              id="baseUrl"
              name="baseUrl"
              autoComplete="off"
              required
              label={labels.endpointLabel}
              placeholder={labels.endpointPlaceholder}
              hint={labels.endpointHint}
            />
          )}
          {showEndpoint && (
            <Input
              id="model"
              name="model"
              autoComplete="off"
              required
              label={labels.modelLabel}
              placeholder={labels.modelPlaceholder}
              hint={labels.modelHint}
            />
          )}
          <Input
            id="key"
            name="key"
            // A password field, so it is not shoulder-surfable and no password
            // manager or autofill offers to remember it.
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            label={labels.label}
            placeholder={labels.placeholder}
            hint={labels.hint}
          />
        </div>

        {failure ? (
          <p className={styles.error} role="alert">
            {messages[failure] ?? messages.unknown}
          </p>
        ) : null}

        <div className={styles.row}>
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            loadingLabel={labels.saving}
          >
            {labels.save}
          </Button>
        </div>
      </form>

      {saved ? (
        <form action={remove} className={styles.remove}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="screen" value={screen} />
          <Button
            type="submit"
            variant="quiet"
            loading={removing}
            loadingLabel={labels.deleting}
          >
            {labels.delete}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
