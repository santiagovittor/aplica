import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import {
  BREAKPOINTS,
  checkContrast,
  checkFooter,
  checkGrain,
  checkGroundInversion,
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
    await capture(page, 'landing');

    // Once, not per screen. The chrome it measures is the shell's, identical
    // on every route, and it costs a second of real wall clock because it has
    // to watch an animation actually run rather than read a resting state.
    findings.push(
      ...(await checkGroundInversion(page)).map((f) => ({
        ...f,
        screen: 'ground-change',
      })),
    );

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

    // Watching starts now and runs the length of a real parse. Deliberately
    // not awaited yet: the mid-run capture has to happen *inside* the window,
    // and a 20s sample of a 55s parse measures the quiet middle of it rather
    // than the run.
    const liveness = watchLiveness(page, 55_000);
    await page.waitForTimeout(10_000);
    await capture(page, 'cv-midrun', { motif: false, hover: false });

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
    await capture(page, 'apply-midrun', { motif: false, hover: false });

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
  });
});

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
