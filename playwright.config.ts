import { defineConfig } from '@playwright/test';

/**
 * The golden-path end-to-end test (SLICE-13 decision 8), local-only.
 *
 * Not wired into `.github/workflows/ci.yml` on purpose: `ci.yml`'s own
 * comment is explicit that no job there may hold or need a model API key,
 * and this suite's one test spends real tokens against a real provider by
 * design (npm run apply already spends real tokens the same way, for the
 * same reason: some things only a real call proves). Run it locally with
 * `APLICA_DEV_API_KEY` set, the same variable `npm run apply` reads.
 *
 * **Runs against a production build (`next build && next start`), not
 * `next dev`.** Measured directly: against the Turbopack dev server, the CV
 * parse's SSE stream reaches the browser correctly server-side (the route
 * handler logs a normal 200 in ~25s) but the page never renders past
 * "Sending your file" -- the dev server buffers the stream despite the
 * route's own `x-accel-buffering: no`. The identical flow against a
 * production build streams the same stages live, in real time, and finishes
 * correctly. This is a `next dev`-only artifact, not a bug in `src/lib/sse.ts`
 * or either route: real users hit a production build (or Vercel's
 * equivalent), never `next dev`, so this test proves the path they actually
 * take.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3005',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run start -- -p 3005',
    url: process.env.E2E_BASE_URL ?? 'http://localhost:3005',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
