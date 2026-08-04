import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import {
  BREAKPOINTS,
  checkContrast,
  checkFooter,
  checkGrain,
  checkHover,
  checkMotif,
  checkWordmark,
  type Finding,
} from './audit';

/**
 * SLICE-23 §1: the verification harness. Claude in Chrome was not adequate for
 * this work, and reading one's own CSS is not verification at all.
 *
 * Every screen is captured at 1440x900 and 390x844 into a gitignored
 * `.shots/`, and the acceptance checks of §6 run in the same pass against the
 * rendered page. Flow screens are captured at three moments -- arrival,
 * mid-run, result -- because a screen that looks fine on arrival and dead
 * mid-run has failed.
 *
 * Run it with `npm run shots`. Like `e2e/apply.spec.ts`, it drives the real
 * app against a real provider and so is never wired into CI, whose own rule is
 * that no job may hold a model API key.
 */

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(ROOT, '..', '.shots');
const CV_FIXTURE = path.join(ROOT, 'fixtures', 'cv.pdf');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const providerApiKey = process.env.APLICA_DEV_API_KEY;
const provider = process.env.APLICA_DEV_PROVIDER ?? 'anthropic';

mkdirSync(SHOTS, { recursive: true });

/** Everything the whole run found, printed once at the end. */
const findings: (Finding & { screen: string })[] = [];

const POSTING = `Senior Backend Engineer, Remote (LatAm timezones)

We are a fast-growing fintech platform building payments infrastructure for
small businesses across Latin America. We are looking for a Senior Backend
Engineer to join our platform team.

What you'll do: design and build scalable, reliable services in Node.js and
TypeScript; own the reliability of our payment processing pipeline; mentor
junior engineers and review code.

What we're looking for: 5+ years of backend engineering experience; strong
experience with Node.js, TypeScript, and PostgreSQL; clear written
communication in English.`;

/**
 * Captures one screen at both breakpoints and runs every static check against
 * it. `checks` is opt-out rather than opt-in: a screen that skips a check
 * should have to say which and why.
 */
async function capture(
  page: Page,
  name: string,
  options: {
    hover?: boolean;
    motif?: boolean;
    wordmark?: boolean;
    contrast?: boolean;
  } = {},
): Promise<void> {
  for (const breakpoint of BREAKPOINTS) {
    await page.setViewportSize({
      width: breakpoint.width,
      height: breakpoint.height,
    });
    // Back to the top first. `checkHover` drives a real cursor, and hovering
    // an element scrolls it into view, so without this the capture after the
    // first breakpoint is of wherever the footer link happened to be.
    await page.evaluate(() => window.scrollTo(0, 0));
    // Let the reveal animations and the drawn annotation settle, or the
    // capture is of a page mid-transition rather than of the design.
    await page.waitForTimeout(1600);

    const screen = `${name}.${breakpoint.name}`;
    await page.screenshot({ path: path.join(SHOTS, `${screen}.png`) });

    const found: Finding[] = [
      ...(await checkGrain(page)),
      ...(options.contrast === false ? [] : await checkContrast(page)),
      ...(options.motif === false ? [] : await checkMotif(page)),
      ...(options.wordmark === false ? [] : await checkWordmark(page)),
    ];

    // Only at the desktop breakpoint: §6.2 states the footer rule at
    // 1440x900, and hover is not a thing a 390px touch viewport has.
    if (breakpoint.name === 'desktop') {
      found.push(...(await checkFooter(page)));
      if (options.hover !== false) {
        found.push(...(await checkHover(page)));
      }
    }

    findings.push(...found.map((f) => ({ ...f, screen })));
  }
}

async function createConfirmedUser(
  email: string,
  password: string,
): Promise<void> {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: supabaseSecretKey as string,
      authorization: `Bearer ${supabaseSecretKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!response.ok) {
    throw new Error(
      `Could not provision the shots account: ${response.status}.`,
    );
  }
}

test.describe('public screens', () => {
  test('landing, auth and legal', async ({ page }) => {
    await page.goto('/en');
    await capture(page, 'landing');

    await page.goto('/en/sign-in');
    await capture(page, 'sign-in', { motif: false });

    await page.goto('/en/privacy');
    await capture(page, 'privacy', { motif: false });

    await page.goto('/en/styleguide');
    // The styleguide is a catalog, not a screen (DESIGN.md §10's own
    // exemption). It shows forced hover, focus and disabled states side by
    // side as specimens -- a `[data-force~='active']` button measures 1.09:1
    // because it is a picture of a pressed button, not a control anyone is
    // meant to read. Its contrast and hover results are not this harness's
    // business; the screens that use those components are.
    await capture(page, 'styleguide', {
      hover: false,
      motif: false,
      contrast: false,
    });
  });
});

test.describe('the real flow', () => {
  test.skip(
    !providerApiKey || !supabaseUrl || !supabaseSecretKey,
    'APLICA_DEV_API_KEY and the local Supabase vars are not set. This run ' +
      'drives a real parse and a real generation against a real provider.',
  );

  test('onboarding, cv parse, apply run, account', async ({ page }) => {
    test.setTimeout(420_000);

    const email = `shots-${Date.now()}@example.com`;
    const password = 'a-long-enough-password-1';
    await createConfirmedUser(email, password);

    await page.goto('/en/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/onboarding\/language/);

    // §6.4 names this screen specifically: the step nav is where the previous
    // slice shipped a contrast failure into the first screen a new user sees.
    await capture(page, 'onboarding-language', { motif: false });

    await page
      .getByLabel('Your name')
      .fill('Shots Account', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/onboarding\/key/);
    await capture(page, 'onboarding-key', { motif: false });

    await page.getByLabel('Provider').selectOption(provider);
    await page.getByLabel('API key').fill(providerApiKey as string);
    await page.getByRole('button', { name: 'Save my key' }).click();
    await expect(page.getByText(/key is saved/)).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('link', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/onboarding\/cv/);
    await capture(page, 'onboarding-cv-arrival', { motif: false });

    // The parse: arrival, mid-run, result. Mid-run is the moment §0 says was
    // never verified, and §6.6 measures it rather than trusting the capture.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('input[type="file"]').setInputFiles(CV_FIXTURE);
    await page.getByRole('button', { name: 'Upload CV' }).click();

    const liveness = await watchLiveness(page, 20_000);
    await capture(page, 'cv-midrun', { motif: false, hover: false });

    await expect(
      page.getByRole('heading', { name: 'Your profile is ready' }),
    ).toBeVisible({ timeout: 120_000 });
    await capture(page, 'cv-result');

    if (liveness.regionChanges < 6) {
      findings.push({
        screen: 'cv-midrun',
        check: 'liveness',
        detail: `progress text changed ${liveness.regionChanges} times in 20s, expected >= 6`,
      });
    }
    if (liveness.counterChanges < 15) {
      findings.push({
        screen: 'cv-midrun',
        check: 'liveness',
        detail: `elapsed counter changed ${liveness.counterChanges} times in 20s, expected >= 15`,
      });
    }

    // The apply run: arrival, mid-run, result.
    await page.goto('/en/apply');
    await expect(page.getByText('Your CV is on file.')).toBeVisible();
    await capture(page, 'apply-arrival', { motif: false });

    const research = page.getByRole('checkbox', {
      name: 'Research the company',
    });
    if (await research.count()) {
      await research.uncheck();
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByLabel('The job posting').fill(POSTING);
    await page.getByText('Standard', { exact: true }).click();
    await page.getByRole('button', { name: 'Tailor my application' }).click();

    const applyLiveness = await watchLiveness(page, 20_000);
    await capture(page, 'apply-midrun', { motif: false, hover: false });

    await expect(
      page.getByRole('heading', {
        name: /Worth sending|Worth a second look first/,
      }),
    ).toBeVisible({ timeout: 150_000 });
    await page.waitForTimeout(3000);
    await capture(page, 'apply-result', { hover: false });

    if (applyLiveness.regionChanges < 4) {
      findings.push({
        screen: 'apply-midrun',
        check: 'liveness',
        detail: `progress text changed ${applyLiveness.regionChanges} times in 20s, expected >= 4`,
      });
    }

    await page.goto('/en/account');
    await capture(page, 'account', { motif: false });

    await page.goto('/en/applications');
    await capture(page, 'applications', { motif: false });
  });
});

/**
 * §6.6: a mutation observer over a real run. Counts how many times the text
 * inside the progress region actually changes, and how many times the elapsed
 * counter re-renders, because "it looks alive" is not a measurement.
 */
async function watchLiveness(
  page: Page,
  windowMs: number,
): Promise<{ regionChanges: number; counterChanges: number }> {
  return page.evaluate((ms) => {
    return new Promise<{ regionChanges: number; counterChanges: number }>(
      (resolve) => {
        let regionChanges = 0;
        let counterChanges = 0;

        const observer = new MutationObserver((records) => {
          for (const record of records) {
            const target =
              record.target.nodeType === Node.TEXT_NODE
                ? record.target.parentElement
                : (record.target as Element);
            if (target === null) continue;
            if (target.closest('[data-elapsed]') !== null) {
              counterChanges += 1;
            } else if (target.closest('[role="status"]') !== null) {
              regionChanges += 1;
            }
          }
        });

        observer.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
        });

        window.setTimeout(() => {
          observer.disconnect();
          resolve({ regionChanges, counterChanges });
        }, ms);
      },
    );
  }, windowMs);
}

test.afterAll(() => {
  if (findings.length === 0) {
    return;
  }
  const byScreen = new Map<string, Finding[]>();
  for (const { screen, ...rest } of findings) {
    byScreen.set(screen, [...(byScreen.get(screen) ?? []), rest]);
  }
  const report = [...byScreen.entries()]
    .map(
      ([screen, list]) =>
        `\n  ${screen}\n${list.map((f) => `    [${f.check}] ${f.detail}`).join('\n')}`,
    )
    .join('');
  throw new Error(`SLICE-23 §6 acceptance findings:${report}\n`);
});
