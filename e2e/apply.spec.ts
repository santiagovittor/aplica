import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * The golden path (SLICE-13 decision 8): a signed-in account with a key, a
 * name, and a CV pastes a real posting, picks standard, generates, and
 * downloads a real file. Own commit, after the screen itself was green, per
 * that same decision.
 *
 * Real tokens against a real provider, on purpose (see playwright.config.ts's
 * own comment on why this stays out of CI). Skips cleanly, the same
 * discipline `scripts/apply.mts` already holds itself to, when no key is
 * configured rather than failing loudly on a missing fixture.
 *
 * The account is provisioned fresh per run through Supabase's admin API
 * (`SUPABASE_SECRET_KEY`, already a local dev secret every route handler
 * reads) rather than through the sign-up/confirm-by-email flow: a real
 * mailbox is not this test's job to prove, `(auth)/actions.test.ts` and the
 * manual Mailpit flow already do.
 */

const CV_FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'cv.pdf',
);

const POSTING = `Senior Backend Engineer, Remote (LatAm timezones)

We are a fast-growing fintech platform building payments infrastructure for
small businesses across Latin America. We are looking for a Senior Backend
Engineer to join our platform team.

What you'll do: design and build scalable, reliable services in Node.js and
TypeScript; own the reliability of our payment processing pipeline; mentor
junior engineers and review code; collaborate closely with product and
design on new features.

What we're looking for: 5+ years of backend engineering experience; strong
experience with Node.js, TypeScript, and PostgreSQL; comfortable working
across timezones with a distributed team; clear written communication in
English.

What we offer: competitive salary paid in USD, fully remote with flexible
hours, and an annual learning budget.`;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const providerApiKey = process.env.APLICA_DEV_API_KEY;
const provider = process.env.APLICA_DEV_PROVIDER ?? 'anthropic';

test.skip(
  !providerApiKey || !supabaseUrl || !supabaseSecretKey,
  'APLICA_DEV_API_KEY (and the usual local Supabase vars) are not set. ' +
    'This test spends real tokens against a real provider and is not run ' +
    'without one, the same discipline npm run apply already holds.',
);

/** Confirmed at creation, so the test never touches Mailpit or a mailbox. */
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
      `Could not provision the e2e test account: ${response.status}.`,
    );
  }
}

test('paste a posting, pick standard, generate, download', async ({ page }) => {
  test.setTimeout(180_000);

  const email = `e2e-apply-${Date.now()}@example.com`;
  const password = 'a-long-enough-password-1';
  await createConfirmedUser(email, password);

  // Sign in. A fresh account has never dismissed onboarding, so `signIn`
  // lands it on /onboarding/language rather than /account.
  await page.goto('/en/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/onboarding\/language/);

  // Step 1: name.
  await page
    .getByLabel('Your name')
    .fill('E2E Test Account', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/onboarding\/key/);

  // Step 2: the model key. The live check is a real, cheap call to the
  // provider (a models list), already proven separately; this is the first
  // time it runs through the actual account form rather than a script.
  await page.getByLabel('Provider').selectOption(provider);
  await page.getByLabel('API key').fill(providerApiKey as string);
  await page.getByRole('button', { name: 'Save my key' }).click();
  await expect(page.getByText(/key is saved/)).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('link', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/onboarding\/cv/);

  // Step 3: the CV. A real parse, up to about a minute (SLICE-11's own
  // measurement), against the synthetic fixture rather than a personal file
  // so this test runs the same on any machine.
  await page.locator('input[type="file"]').setInputFiles(CV_FIXTURE);
  await page.getByRole('button', { name: 'Upload CV' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your profile is ready' }),
  ).toBeVisible({ timeout: 90_000 });

  // The screen itself: paste, pick standard, generate.
  await page.goto('/en/apply');
  await expect(page.getByText('Your CV is on file.')).toBeVisible();

  // Research costs money per search on top of tokens; off here keeps the
  // golden path itself cheap and fast without touching what it proves.
  const research = page.getByRole('checkbox', { name: 'Research the company' });
  if (await research.count()) {
    await research.uncheck();
  }

  await page.getByLabel('The job posting').fill(POSTING);
  // The tier radio is visually-hidden (apply.module.css .tierCard); a native
  // <label> click-through selects it, but a role-based locator's own click
  // targets the hidden input's own near-zero box, which the visible text
  // above it intercepts. The visible text is the real, native click target.
  await page.getByText('Standard', { exact: true }).click();
  await page.getByRole('button', { name: 'Tailor my application' }).click();

  // Three model calls, so the longest wait in this test.
  const revealed = page.getByRole('heading', {
    name: /Worth sending|Worth a second look first/,
  });
  await expect(revealed).toBeVisible({ timeout: 120_000 });

  // Decision 3: `skip` does not auto-render, so the download button is an
  // explicit extra step in that branch and not in the `apply` one.
  const downloadAnyway = page.getByRole('button', {
    name: 'Download it anyway',
  });
  if (await downloadAnyway.isVisible().catch(() => false)) {
    await downloadAnyway.click();
  }

  const resumeLink = page.getByRole('link', { name: /Resume \(PDF\)/ });
  await expect(resumeLink).toBeVisible({ timeout: 30_000 });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    resumeLink.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
});
