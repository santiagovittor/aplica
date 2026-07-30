import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

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
});
