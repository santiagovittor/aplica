import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Resolves the `@/*` -> `src/*` alias tsconfig.json declares (and Next's own
 * bundler already understands) so vitest can too. Nothing needed this before:
 * every tested module under `core/`, `lib/` and `providers/` uses relative
 * imports, and no file under `app/` had a test until SLICE-11's locale-fix
 * commit added one for `(auth)/callback/route.ts`, which imports via `@/`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // `e2e/*.spec.ts` is Playwright's, not vitest's (SLICE-13 decision 8):
    // both tools default to matching `*.spec.ts`, and vitest picking it up
    // fails on Playwright's own `test.skip`, which needs Playwright's context.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
