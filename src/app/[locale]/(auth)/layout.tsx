import type { ReactNode } from 'react';
import styles from './auth.module.css';

/** One calm column, nothing else on the page. DESIGN.md §3 and §6 (Hick). */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className={styles.shell}>
      <div className={styles.panel}>{children}</div>
    </main>
  );
}
