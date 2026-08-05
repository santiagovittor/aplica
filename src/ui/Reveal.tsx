import styles from './Reveal.module.css';

/**
 * A scroll-triggered enter, per DESIGN.md §8: a --enter-rise translate plus a
 * fade. Nothing scales from zero, nothing spins.
 *
 * SLICE-25 §B: CSS, and therefore no longer a client component. It used
 * Motion's `whileInView`, which wraps `IntersectionObserver` and works
 * correctly -- but only once the bundle has arrived and hydrated, and its
 * `initial` state shipped in the SSR markup as an inline `opacity: 0`. The
 * observer was never the bug; making JS a precondition for the page being
 * legible was. `animation-timeline: view()` is the same reveal with the
 * default the other way round: visible unless a browser that supports scroll
 * timelines decides to animate it in. See Reveal.module.css for the range and
 * why there is no stagger.
 */
export function Reveal({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        className === undefined
          ? styles.reveal
          : `${styles.reveal} ${className}`
      }
    >
      {children}
    </div>
  );
}
