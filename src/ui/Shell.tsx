import { Footer } from './Footer';
import { Header } from './Header';
import styles from './Shell.module.css';

/**
 * SLICE-23 §5.1: the one frame every route renders inside.
 *
 * Three bands, the middle one absorbing the slack, so the footer closes the
 * viewport instead of floating at 60% of it under short content. See
 * Shell.module.css on why this is a flex column rather than the grid §5.1
 * writes out.
 *
 * The grain and edge falloff of DESIGN.md §5a live on this element's own
 * pseudo-elements, so they are rendered once for the whole app rather than
 * per screen, and cover the Stage ground as readily as the cream one.
 */
export function Shell({
  authenticated,
  children,
}: {
  authenticated: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.shell} data-shell>
      <Header authenticated={authenticated} />
      <div className={styles.main}>{children}</div>
      <div className={styles.footerRow}>
        <Footer />
      </div>
    </div>
  );
}
