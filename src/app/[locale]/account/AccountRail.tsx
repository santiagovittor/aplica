'use client';

import { useEffect, useState } from 'react';
import styles from './account.module.css';

/**
 * SLICE-23 §5.5: the 4/12 sticky rail. This is the asymmetric grid finally
 * doing its job -- before this, `/account` was text and inputs floating on a
 * flat field with no grouping and a two-column split whose columns had wildly
 * unequal length.
 *
 * The current section is marked with a `--green` rule, which is legal here for
 * the same reason an active step marker is (DESIGN.md §5: --green carries the
 * system of choice, and a rule is not a button).
 *
 * `IntersectionObserver` rather than a scroll handler doing arithmetic:
 * PROJECT.md §4 names it for exactly this, and the browser does the work off
 * the main thread. `rootMargin` biases the "current" section towards the top
 * third of the viewport, so the mark moves when a section reaches reading
 * position rather than when it first peeks in from the bottom.
 */
export function AccountRail({
  label,
  sections,
}: {
  label: string;
  sections: readonly { id: string; label: string }[];
}) {
  const [current, setCurrent] = useState(sections[0]?.id ?? '');

  useEffect(() => {
    const elements = sections
      .map(({ id }) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);

    if (elements.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        if (visible !== undefined) {
          setCurrent(visible.target.id);
        }
      },
      { rootMargin: '-10% 0px -60% 0px', threshold: 0 },
    );

    for (const element of elements) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav aria-label={label} className={styles.rail}>
      <p className={styles.railLabel}>{label}</p>
      <ul className={styles.railList}>
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className={styles.railLink}
              data-current={section.id === current || undefined}
              aria-current={section.id === current ? 'true' : undefined}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
