import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import {
  BREAKPOINTS,
  checkComposite,
  checkContrast,
  checkFooter,
  checkGrain,
  checkGroundInversion,
  checkHover,
  checkImageStability,
  checkMotif,
  checkParallax,
  checkReveal,
  checkTokens,
  checkValueRange,
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
/**
 * `google` rather than `anthropic` as the default: every timing measurement
 * recorded in this repo (api/cv/route.ts, api/generate/route.ts) was taken
 * against a Gemini model, so it is the provider a local `.env.local` here
 * actually holds. Override with `APLICA_DEV_PROVIDER` for any other.
 */
const provider = process.env.APLICA_DEV_PROVIDER ?? 'google';

mkdirSync(SHOTS, { recursive: true });

/** Everything the whole run found, printed once at the end. */
const findings: (Finding & { screen: string })[] = [];

/**
 * A posting the CV fixture genuinely fits (reporting and analytics, which is
 * what `fixtures/cv.pdf` describes), not the backend role `apply.spec.ts`
 * uses.
 *
 * That is deliberate and it is not the harness flattering itself. A capture
 * run has to reach the result reveal to photograph it, and against a
 * mismatched posting the pipeline correctly returns `skip` and then dies:
 * `gemini-3.1-flash-lite` writes `"do not apply"` into `recommendation` on the
 * revise pass instead of the enum's `"skip"`, and `applicationSchema` refuses
 * it. Measured at 4 failures in 5 runs, deterministic for the negative
 * verdict, and it is a real product bug that predates this slice: three paid
 * model calls thrown away every time a user is told to skip a role. It is
 * reported rather than fixed here, because the fix belongs in
 * `src/prompts/draft.ts`'s revise contract and a prompt change is not a
 * design slice's to make quietly.
 */
const POSTING = `Reporting and Insights Analyst, Remote (LatAm timezones)

We are a logistics platform working with small businesses across Latin
America, and we are looking for an analyst to own our reporting.

What you'll do: own the weekly reporting cycle end to end; build and maintain
the pipelines that feed our data warehouse; reconcile carrier invoices against
shipment records and chase down billing errors; build dashboards the operations
team actually uses.

What we're looking for: strong SQL and Python; comfort with spreadsheet
modelling; someone who has owned a reporting pipeline rather than only queried
one; clear written communication in English.`;

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
    /**
     * SLICE-24: whether the footer's own check runs. Off for the two mid-run
     * captures, and nowhere else. That check now also reports a page that
     * scrolls by less than its footer's height, which is a statement about a
     * screen at rest; a working card grows by a line every time a stage
     * reports a real count, so on those two screens it measures whichever
     * instant the capture happened to land on rather than a layout. Measured
     * during a parse: 60px of overflow ten seconds in, and more by the end.
     */
    footer?: boolean;
    /**
     * SLICE-26: whether the pixels behind text over a photograph are read
     * back (`checkComposite`). Opt-in rather than opt-out, and the only
     * check here that is: DESIGN.md §7 is Editorial-only and §2 bans
     * photography from Tool screens outright, so a check that reports "no
     * image in <main>" would fire on every screen in the product that is
     * obeying the rules. Where there *is* an image, its own vacuity guards
     * apply in full.
     */
    composite?: boolean;
    /**
     * SLICE-24: whether the whole document is captured rather than the first
     * screenful. The default is the screenful, because the fold is part of
     * what is being judged -- §2.4's whole argument is about what sits above
     * it. It is turned on for the two screens whose subject is a control in
     * the middle of a long form: the tier cards, and the alert a failed run
     * puts above the submit button. Photographing the top of those is
     * photographing a screen that has nothing to do with the state named in
     * the filename.
     */
    fullPage?: boolean;
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
    await page.screenshot({
      path: path.join(SHOTS, `${screen}.png`),
      fullPage: options.fullPage === true,
    });

    const found: Finding[] = [
      ...(await checkGrain(page)),
      ...(options.contrast === false ? [] : await checkContrast(page)),
      ...(options.motif === false ? [] : await checkMotif(page)),
      ...(options.wordmark === false ? [] : await checkWordmark(page)),
      ...(options.composite === true
        ? await checkComposite(page, {
            requireSubjects: breakpoint.name === 'desktop',
          })
        : []),
    ];

    // Only at the desktop breakpoint: §6.2 states the footer rule at
    // 1440x900, and hover is not a thing a 390px touch viewport has.
    if (breakpoint.name === 'desktop') {
      if (options.footer !== false) {
        found.push(...(await checkFooter(page)));
      }
      if (options.hover !== false) {
        found.push(...(await checkHover(page)));
      }
    }

    findings.push(...found.map((f) => ({ ...f, screen })));
  }
}

/**
 * Whether the elapsed counter actually ticked once a second.
 *
 * §6.6 asks for "the elapsed counter's rendered text changes >= 50 times" over
 * a real 55s parse. That number is not portable and asserting it literally
 * measures the fixture rather than the product: `fixtures/cv.pdf` is a
 * one-page, 914-character CV that parses in about 30s, and the counter resets
 * to zero at each stage boundary because the screen reports time in the
 * current stage, not since the click. Measured directly, a healthy run reports
 * 25 changes and a highest reading of 25 -- the counter is at 1Hz throughout,
 * and the 50 was only ever a proxy for that.
 *
 * So the rate is asserted instead of the count: the counter must change at
 * least once for every second it displayed, and it must have ticked more than
 * once, which proves it advances rather than merely rendering. That holds on a
 * 30s parse and on a 55s one, and it still fails a counter that is frozen,
 * which is what §6.6 is for.
 *
 * The floor is 2 rather than anything higher because of the generation run:
 * its longest single stage measures about 4 seconds against this provider, so
 * a larger floor would be asserting how fast Gemini answers rather than
 * whether this screen is alive.
 */
function counterFindings(
  screen: string,
  measured: { counterChanges: number; counterReading: number },
): (Finding & { screen: string })[] {
  const { counterChanges, counterReading } = measured;

  if (counterReading < 2) {
    return [
      {
        screen,
        check: 'liveness',
        detail: `elapsed counter only reached ${counterReading}; it never advanced`,
      },
    ];
  }
  if (counterChanges < counterReading) {
    return [
      {
        screen,
        check: 'liveness',
        detail: `elapsed counter changed ${counterChanges} times but reached ${counterReading}: it is skipping seconds`,
      },
    ];
  }
  return [];
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
    // `motif: false` for as long as the landing has no motif on it. DESIGN.md
    // §9 moved its home from the hero to a section of this page and that
    // section does not exist yet, so the check's own vacuity guard is
    // currently correct and reporting a true fact. It goes back to the default
    // with the tile that replaces it.
    await capture(page, 'landing', { composite: true, motif: false });

    // SLICE-26, the Editorial checks, on the one Editorial screen that carries
    // a photograph. Each runs once rather than per breakpoint and each says
    // why in `audit.ts`: item 11 is stated at one viewport size and sets its
    // own, and the other two navigate. Sequentially and awaited one at a time,
    // because each of them moves the page under the next one's feet.
    findings.push(
      ...(await checkValueRange(page)).map((f) => ({
        ...f,
        screen: 'value-range',
      })),
    );
    findings.push(
      ...(await checkParallax(page, '/en')).map((f) => ({
        ...f,
        screen: 'parallax',
      })),
    );
    findings.push(
      ...(await checkImageStability(page, '/en')).map((f) => ({
        ...f,
        screen: 'image',
      })),
    );

    // DESIGN.md §1's index, resolved on the page rather than read out of the
    // stylesheet. Once, like the ground change: `:root` is the same on every
    // route, and this one sets the viewport to two widths of its own to see
    // whether the fluid steps answer them, so it cannot ride inside
    // `capture()` without changing what the next check measures. It restores
    // the viewport it found.
    findings.push(
      ...(await checkTokens(page)).map((f) => ({ ...f, screen: 'tokens' })),
    );

    // SLICE-25 §A/§B: the reveal contract, on both locales because the static
    // half reads the server's own bytes and each locale renders its own. Once
    // per locale rather than per screen, like the ground change above: it
    // navigates and throttles the CPU to measure, so it cannot ride along
    // inside `capture()` without changing what every other check sees.
    for (const locale of ['/en', '/es']) {
      findings.push(
        ...(await checkReveal(page, locale)).map((f) => ({
          ...f,
          screen: `reveal${locale}`,
        })),
      );
    }

    await page.goto('/en/sign-in');
    await capture(page, 'sign-in', { motif: false });

    // The ground change, once, not per screen: the chrome it measures belongs
    // to the shell and the mechanism it drives (`body[data-stage]`) is the
    // same on every route.
    //
    // SLICE-26 moved it off the landing, which is now the one route it cannot
    // run from. It resolves the ground under the chrome by reading
    // `document.body`'s own background, and the landing's header is
    // deliberately not on the body's ground any more: it is out of flow over a
    // full-bleed --ink-deep hero, carrying --on-dark ink for it. Sampled
    // there, a correct header measured 1.0:1 against a ground it is not
    // sitting on. `/sign-in` is an ordinary Desk screen whose chrome is on the
    // body ground, which is the situation this check is about.
    findings.push(
      ...(await checkGroundInversion(page)).map((f) => ({
        ...f,
        screen: 'ground-change',
      })),
    );

    // SLICE-24 §2.1: four screens the harness had never seen. Three of them are
    // the account recovery path, which is where a broken layout costs the most,
    // because whoever is reading it is already having a bad day. None is one of
    // DESIGN.md §9's three motif homes, so none runs `checkMotif`.
    //
    // `/new-password` is the fourth recovery screen and is not here: it sits
    // behind `requireUser`, so an unauthenticated visit redirects to sign-in
    // and this block would photograph sign-in twice under two names. It is
    // captured in the signed-in run below.
    await page.goto('/en/sign-up');
    await capture(page, 'sign-up', { motif: false });

    await page.goto('/en/reset');
    await capture(page, 'reset', { motif: false });

    await page.goto('/en/check-email');
    await capture(page, 'check-email', { motif: false });

    await page.goto('/en/privacy');
    await capture(page, 'privacy', { motif: false });

    await page.goto('/en/terms');
    await capture(page, 'terms', { motif: false });

    // SLICE-25 §C: the screen every bad URL reaches, which until now was
    // Next's own black-on-white 404 -- no shell, no wordmark, not this
    // product's page at all. DESIGN.md §10 names 404 and 500 as Editorial
    // screens, and an Editorial screen is one someone designed.
    //
    // The body's ground is asserted here rather than in a check of its own:
    // what is being proved is that the framework default was replaced, and
    // `--base` on `<body>` is the one measurement that says so. The wordmark
    // half of it is `checkWordmark`, which `capture()` already runs.
    //
    // Read *after* `capture()`, not before it. `page.goto` resolves at `load`,
    // and measured directly at that moment the body reports `rgba(0, 0, 0, 0)`
    // on a correctly styled page -- the stylesheet has not applied yet, and the
    // first version of this check reported the finished screen as "still the
    // framework's own 404". `capture()` already settles for 1600ms per
    // breakpoint, so by the time it returns the page is the one that was
    // photographed rather than one on its way there.
    for (const [locale, name] of [
      ['/en', 'not-found'],
      ['/es', 'es.not-found'],
    ]) {
      const response = await page.goto(`${locale}/nonexistent`);
      if (response?.status() !== 404) {
        findings.push({
          screen: name,
          check: 'not-found',
          detail: `${locale}/nonexistent answered ${response?.status()}, expected 404`,
        });
      }

      await capture(page, name, { motif: false });

      const ground = await page.evaluate(() => ({
        body: getComputedStyle(document.body).backgroundColor,
        base: getComputedStyle(document.documentElement)
          .getPropertyValue('--base')
          .trim(),
      }));
      const asRgb = (hex: string) => {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex);
        if (m === null) return hex;
        const n = parseInt(m[1], 16);
        return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
      };
      if (ground.base === '' || ground.body !== asRgb(ground.base)) {
        findings.push({
          screen: name,
          check: 'not-found',
          detail:
            `body background is ${ground.body}, expected --base ` +
            `(${ground.base === '' ? '--base is not even defined here' : asRgb(ground.base)}). ` +
            `This is not the app shell.`,
        });
      }
    }

    await page.goto('/en/styleguide');
    // The styleguide is a catalog, not a screen (DESIGN.md §11's own
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

  /**
   * SLICE-24 §2.2: Spanish, which no capture in this harness had ever
   * rendered. The product is Spanish-first in its own copy -- the wordmark's
   * tick was flattened in SLICE-23 because it read as an acute accent -- and
   * Spanish runs about a fifth longer than English for the same sentence, so
   * anything in a fixed row or a shared container is a candidate to wrap or
   * overflow.
   *
   * An explicit named set rather than a locale loop around `capture()`: a loop
   * would double every capture in the file, including the ones whose content
   * is model output rather than translated chrome.
   *
   * Chosen here, and why: the landing carries the display step, the CTA row and
   * the motif's two eyebrows, which is the tightest type on any screen;
   * `/sign-up` is the auth shape all four recovery screens share (two fields, a
   * hint, a divider, two buttons, a link row) with the longest copy of the
   * four. `/privacy` and `/terms` are excluded on purpose: they are prose in a
   * measure, and prose that runs longer in Spanish is prose, not a defect. The
   * signed-in arrival states are captured in the run below, where a session
   * exists.
   */
  test('the arrival states in Spanish', async ({ page }) => {
    await page.goto('/es');
    await capture(page, 'es.landing', { composite: true, motif: false });

    await page.goto('/es/sign-up');
    await capture(page, 'es.sign-up', { motif: false });
  });
});

test.describe('the real flow', () => {
  test.skip(
    !providerApiKey || !supabaseUrl || !supabaseSecretKey,
    'APLICA_DEV_API_KEY and the local Supabase vars are not set. This run ' +
      'drives a real parse and a real generation against a real provider.',
  );

  test('onboarding, cv parse, apply run, account', async ({ page }) => {
    // Two real model runs plus, since SLICE-24, the empty/error/loading states
    // and the signed-in half of the Spanish set. Every capture costs two
    // breakpoints of settle time and a hover pass; only the two runs cost
    // tokens.
    test.setTimeout(1_200_000);

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

    // SLICE-24 §2.2: the same screen in Spanish, taken here because this is
    // where the step labels and the language control live and both are chrome
    // that has to survive a longer word. The rest of the Spanish set is at the
    // end of this test, where a full account exists to render.
    await page.goto('/es/onboarding/language');
    await capture(page, 'es.onboarding-language', { motif: false });
    await page.goto('/en/onboarding/language');

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

    // Watching starts now and runs the length of a real parse. Deliberately
    // not awaited yet: the mid-run capture has to happen *inside* the window,
    // and a 20s sample of a 55s parse measures the quiet middle of it rather
    // than the run.
    const liveness = watchLiveness(page, 55_000);
    await page.waitForTimeout(10_000);
    await capture(page, 'cv-midrun', {
      motif: false,
      hover: false,
      footer: false,
    });

    await expect(
      page.getByRole('heading', { name: 'Your profile is ready' }),
    ).toBeVisible({ timeout: 120_000 });
    await capture(page, 'cv-result');

    // §6.6's own numbers, over the window it names.
    const parse = await liveness;
    if (parse.regionChanges < 6) {
      findings.push({
        screen: 'cv-midrun',
        check: 'liveness',
        detail: `progress text changed ${parse.regionChanges} times in 55s, expected >= 6`,
      });
    }
    findings.push(...counterFindings('cv-midrun', parse));

    // SLICE-24 §2.3, the empty state, captured before the run that fills it:
    // this is the last moment in the whole harness at which the account has no
    // applications, and DESIGN.md §10 asks every screen to design one.
    await page.goto('/en/applications');
    await expect(
      page.getByRole('heading', { name: 'No applications yet' }),
    ).toBeVisible();
    await capture(page, 'applications-empty');

    // SLICE-24 §2.3, a real rejected upload rather than a simulated one: four
    // bytes of plain text, which `/api/cv` refuses on type before any model is
    // called. Nothing here is stubbed and no tokens are spent.
    await page.goto('/en/cv');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'not-a-cv.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('nope'),
    });
    await page.getByRole('button', { name: 'Upload CV' }).click();
    await expect(page.locator('p[role="alert"]')).toBeVisible({
      timeout: 30_000,
    });
    await capture(page, 'cv-rejected', { motif: false });

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

    // The generation run is three model calls, measured at ~15s in this repo's
    // own timing notes rather than the parse's ~55s, so the window and the
    // floor are both scaled to it: five stages, each of which must show up.
    const applyLiveness = watchLiveness(page, 30_000);
    // Earlier than the parse's mid-run capture: the generation run finishes in
    // about 20s against this provider, and a capture at 7s reached the mobile
    // breakpoint after the reveal had already replaced the working card.
    await page.waitForTimeout(4000);
    await capture(page, 'apply-midrun', {
      motif: false,
      hover: false,
      footer: false,
    });

    await expect(
      page.getByRole('heading', {
        name: /Worth sending|Worth a second look first/,
      }),
    ).toBeVisible({ timeout: 150_000 });
    await page.waitForTimeout(3000);
    await capture(page, 'apply-result', { hover: false });

    const run = await applyLiveness;
    if (run.regionChanges < 6) {
      findings.push({
        screen: 'apply-midrun',
        check: 'liveness',
        detail: `progress text changed ${run.regionChanges} times in 30s, expected >= 6`,
      });
    }
    findings.push(...counterFindings('apply-midrun', run));

    await page.goto('/en/account');
    await capture(page, 'account', { motif: false });

    await page.goto('/en/applications');
    await capture(page, 'applications', { motif: false });

    // SLICE-24 §2.1: the fourth recovery screen, which lives behind
    // `requireUser` and so can only be photographed from inside a session. The
    // form it renders is the same whether the session came from a reset link
    // or from this sign-in; what is being looked at is the layout.
    await page.goto('/en/new-password');
    await capture(page, 'new-password', { motif: false });

    // SLICE-24 §2.3, the third state DESIGN.md §10 asks for and the harness had
    // never seen: a submitted run that failed. `generation_invalid` is the code
    // this codebase has actually produced in anger, and the only honest way to
    // reach it on demand is to answer the request with it -- the model cannot
    // be asked to fail. The route is the real one, the phase machine, the copy
    // and the layout are all real; only the server's answer is supplied here.
    await page.goto('/en/apply');
    await page.route('**/api/generate', (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'generation_invalid' }),
      }),
    );
    await page.getByLabel('The job posting').fill(POSTING);
    await page.getByRole('button', { name: 'Tailor my application' }).click();
    await expect(page.locator('p[role="alert"]')).toBeVisible({
      timeout: 30_000,
    });
    await capture(page, 'apply-error', { motif: false, fullPage: true });
    await page.unroute('**/api/generate');

    // SLICE-24 §2.3, the last of the three: a loading state, held open for as
    // long as the capture needs by keeping the navigation's own request in the
    // air. `/account` is the one route whose `loading.tsx` had a real defect in
    // it, which is what a state nobody has ever rendered tends to have.
    await captureLoadingState(page, {
      name: 'account-loading',
      warm: '/en/account',
      from: '/en/applications',
      holdPattern: '**/en/account*',
      expectUrl: /\/en\/account/,
      placeholderLabel: 'Loading your account',
      navigate: () => page.getByRole('link', { name: 'Account' }).click(),
    });

    // SLICE-24 §2.2: the signed-in half of the Spanish set. Every screen here
    // is an arrival state whose chrome is translated -- the rail and its five
    // section titles, the tier cards in a three-column grid, the EN/ES control,
    // the row of a finished application. The mid-run and result screens are
    // deliberately not re-run in Spanish: what they render is model output in
    // the posting's language, not the UI locale (PROJECT.md §9), so a second
    // run would spend three model calls to photograph the same English
    // sentences under a translated heading.
    await page.goto('/es/apply');
    await capture(page, 'es.apply-arrival', { motif: false, fullPage: true });

    await page.goto('/es/cv');
    await capture(page, 'es.cv-arrival');

    await page.goto('/es/account');
    await capture(page, 'es.account', { motif: false });

    await page.goto('/es/applications');
    await capture(page, 'es.applications', { motif: false });
  });
});

/**
 * Captures a route's `loading.tsx` at both breakpoints.
 *
 * A loading state is defined by being brief, so the only way to photograph one
 * is to stop the thing it is waiting for. The navigation's own request is
 * intercepted and held open -- not delayed by a guessed number of
 * milliseconds, which would be a race against `capture()`'s settle time -- and
 * released once both breakpoints are on disk. What is on screen while it is
 * held is exactly what a visitor on a slow connection sees.
 *
 * The fallback comes out of the router's own cache, which is why the target is
 * visited once before the held navigation: measured directly, a click into a
 * route the router has never rendered and whose prefetch has not yet landed
 * does not show the fallback at all, it simply waits on the payload and stays
 * on the previous screen. Warming it is the state any visitor whose prefetch
 * has landed is already in, and prefetch requests are let through here for the
 * same reason. The two `expect`s are the guard against the alternative: a run
 * that photographs the previous screen under the new screen's filename.
 */
async function captureLoadingState(
  page: Page,
  options: {
    name: string;
    warm: string;
    from: string;
    holdPattern: string;
    expectUrl: RegExp;
    placeholderLabel: string;
    navigate: () => Promise<void>;
  },
): Promise<void> {
  await page.goto(options.warm);
  await page.goto(options.from);
  // Long enough for the link's own prefetch to land before anything is held.
  await page.waitForTimeout(1500);

  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route(options.holdPattern, async (route) => {
    if (route.request().headers()['next-router-prefetch'] === undefined) {
      await held;
    }
    // Held for the length of two captures, by which time the browser may have
    // given up on the request or Playwright may have torn the route down --
    // both of which surface here as a throw from a handler nothing is
    // awaiting, and so as a failure of whatever the test is doing by then.
    // What happens to a request whose only job was to stay in the air is not
    // this harness's business.
    await route.continue().catch(() => undefined);
  });

  await options.navigate();
  await expect(page).toHaveURL(options.expectUrl);
  await expect(page.getByText(options.placeholderLabel)).toBeVisible();
  await capture(page, options.name, { motif: false });

  release();
  // Let the released request finish before the route is torn down, so the
  // screen after this one is a loaded page rather than a half-navigated one.
  await page.waitForTimeout(1000);
  await page.unroute(options.holdPattern);
}

/**
 * §6.6: how many times the progress region and the elapsed counter actually
 * change over a real run, because "it looks alive" is not a measurement.
 *
 * A sampler rather than a `MutationObserver`, after the observer version got
 * this wrong twice. The working card mounts only once the request is in
 * flight, so there is nothing to observe when watching starts; and the counter
 * is a `number-flow` web component whose digits live in a shadow root, which
 * no `subtree` observer on `document` can see. Sampling the rendered text
 * sidesteps both: an element that does not exist yet reads as no text, and
 * `deepText` walks shadow roots the way the eye does.
 *
 * The window has to cover the whole run. A 20s sample of a 55s parse caught
 * four stage changes and read as a failure when the screen was working
 * exactly as intended.
 */
function watchLiveness(
  page: Page,
  windowMs: number,
): Promise<{
  regionChanges: number;
  counterChanges: number;
  counterReading: number;
}> {
  // The two halves need different instruments, which is the whole lesson of
  // this function. Stage events arrive in bursts -- four of the CV parse's
  // stages resolve within milliseconds of each other once the model returns --
  // so a poll collapses them into one reading and a MutationObserver is the
  // only thing that sees them all. The counter is the opposite: nothing about
  // it mutates in a way an observer on the document can reach, so it has to be
  // read, and read out of band.
  const region = page.evaluate((ms) => {
    return new Promise<number>((resolve) => {
      let changes = 0;
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          const node =
            record.target.nodeType === Node.TEXT_NODE
              ? record.target.parentElement
              : (record.target as Element);
          if (node?.closest('[role="status"]') != null) changes += 1;
        }
      });
      // The document, not the region: the working card mounts only once the
      // request is in flight, so there is nothing to attach to at t=0.
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      window.setTimeout(() => {
        observer.disconnect();
        resolve(changes);
      }, ms);
    });
  }, windowMs);

  const counter = page.evaluate((ms) => {
    return new Promise<number>((resolve) => {
      /**
       * The counter changes by CSS custom property, not by text.
       *
       * `number-flow` renders all ten digits into its open shadow root and
       * reveals one per column by setting `--current` on it, so `textContent`
       * there reads "0123456789" at every tick and never changes; an earlier
       * version of this measured exactly that and reported a working counter
       * as dead. Its accessible name carries the real value but is set through
       * `ElementInternals`, which no attribute reflects.
       *
       * `style.setProperty` is an attribute mutation on the digit span, so an
       * observer with `attributeFilter: ['style']` over the shadow root sees
       * every tick. Polling from Node instead aliased the 1Hz counter down to
       * one reading every 2.6s, because each round trip costs more than the
       * interval being measured.
       */
      let changes = 0;
      const observer = new MutationObserver(() => {
        changes += 1;
      });

      /** The highest value the counter displayed during the window, for the
       *  finding message: a change count well under the highest reading means
       *  this observer is undercounting, not that the counter is slow. Sampled
       *  rather than read at the end, because the working card unmounts the
       *  moment the run finishes and takes the counter with it. */
      let highest = 0;
      const reading = (): number => {
        const host = document
          .querySelector('[data-elapsed]')
          ?.querySelector('*');
        const root = (host as Element & { shadowRoot?: ShadowRoot | null })
          ?.shadowRoot;
        if (root === undefined || root === null) return -1;
        const digits = Array.from(root.querySelectorAll('[part~="digit"]'))
          .map((digit) =>
            (digit as HTMLElement).style.getPropertyValue('--current'),
          )
          .join('');
        return digits === '' ? -1 : Number(digits);
      };

      const attach = () => {
        const host = document
          .querySelector('[data-elapsed]')
          ?.querySelector('*');
        const root = (host as Element & { shadowRoot?: ShadowRoot | null })
          ?.shadowRoot;
        if (root === undefined || root === null) return false;
        observer.observe(root, {
          subtree: true,
          attributes: true,
          attributeFilter: ['style'],
        });
        return true;
      };

      // The working card mounts only once the request is in flight, so the
      // host does not exist yet when watching starts.
      let attached = false;
      const attaching = window.setInterval(() => {
        if (!attached) attached = attach();
        highest = Math.max(highest, reading());
      }, 100);

      window.setTimeout(() => {
        window.clearInterval(attaching);
        observer.disconnect();
        // Encoded together so the finding can report both without a second
        // round trip: changes in the integer part, highest reading after it.
        resolve(changes + Math.max(0, highest) / 1000);
      }, ms);
    });
  }, windowMs);

  return Promise.all([region, counter]).then(([regionChanges, encoded]) => ({
    regionChanges,
    counterChanges: Math.trunc(encoded),
    counterReading: Math.round((encoded % 1) * 1000),
  }));
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
