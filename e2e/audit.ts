import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

/**
 * SLICE-23 §1 and §6: the acceptance checks, run in the page against
 * `getComputedStyle` and `getBoundingClientRect` rather than asserted from
 * source. DESIGN.md §11's own preamble is the rule this exists to honour --
 * "verified by measurement on the rendered page, never by assertion from
 * source" -- which had been suspended for exactly the work where taste is the
 * judge.
 *
 * Every function here returns findings rather than throwing, so one capture
 * run reports everything wrong with a screen instead of stopping at the first
 * thing.
 */

export interface Finding {
  check: string;
  detail: string;
}

export const BREAKPOINTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

/** WCAG relative luminance, from sRGB 0-255. */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The names DESIGN.md §1 indexes, up to the next `##` heading.
 *
 * Exported because `src/ui/tokens.test.ts` reads the same list statically: one
 * parser, so the fast test and the capture run cannot disagree about what the
 * document names.
 */
export function indexedTokens(markdown: string): string[] {
  const start = markdown.indexOf('\n## 1.');
  const end = markdown.indexOf('\n## ', start + 1);
  if (start === -1) return [];
  const section = markdown.slice(start, end === -1 ? undefined : end);

  const names = new Set(section.match(/--[a-z][a-z0-9-]*/g) ?? []);

  // `--space-1` … `--space-10` names ten tokens and writes two. Expanding the
  // run is what makes the middle eight checkable at all; without it the index
  // could lose --space-5 and nothing would notice.
  const runs = section.matchAll(
    /--([a-z][a-z0-9-]*?)(\d+)`?\s*(?:…|\.\.\.)\s*`?--\1(\d+)/g,
  );
  for (const [, prefix, from, to] of runs) {
    for (let n = Number(from); n <= Number(to); n += 1) {
      names.add(`--${prefix}${n}`);
    }
  }

  return [...names].sort();
}

/**
 * SLICE-25: DESIGN.md §1's index, resolved on the rendered page.
 *
 * `tokens.test.ts` already pins that the index and tokens.css name the same
 * set, statically and in the unit suite. This is the other half, and it is not
 * the same assertion: a token can be declared in the stylesheet and still
 * resolve to nothing here, because a stylesheet that never reached the document
 * is a stylesheet nobody is using. Reading it off `document.documentElement` is
 * what proves the cascade actually carries it.
 *
 * **The two fluid steps are measured, not read.** An unregistered custom
 * property computes to its own token stream, so `getPropertyValue('--text-hero')`
 * returns the literal string `clamp(56px, 8.2vw, 132px)` at every viewport
 * width and would report the bug this was written for as fixed. The clamp only
 * resolves once it is used as a length, so a probe element takes it as its
 * `font-size` and the rendered px is read back -- which is exactly what the
 * headline does.
 *
 * Two widths, because one cannot see the defect. The old `--text-display` was a
 * fixed 61px: measured on the landing hero, 61px at 960 and 61px at 1920. A
 * display step that answers the viewport reads differently at the two ends, and
 * one that does not is the same value wearing a clamp.
 */
const FLUID_STEPS = ['--text-display', '--text-hero'];
const TOKEN_WIDTHS = [768, 1920];

export async function checkTokens(page: Page): Promise<Finding[]> {
  const names = indexedTokens(
    readFileSync(
      fileURLToPath(new URL('../DESIGN.md', import.meta.url)),
      'utf8',
    ),
  );

  // Every clause below is satisfied by an empty list, so the list is asserted
  // in its own right: a parse that stopped matching would otherwise report a
  // page with no design system at all as passing.
  if (names.length < 40) {
    return [
      {
        check: 'tokens',
        detail:
          `only ${names.length} token names parsed out of DESIGN.md §1, so this ` +
          `check measured nothing. The index is not where it was.`,
      },
    ];
  }

  const restore = page.viewportSize();
  const findings: Finding[] = [];
  const rendered = new Map<string, number[]>();
  /** Collected across both widths and reported once: a token that resolves to
   *  nothing resolves to nothing at every viewport, and saying so twice is
   *  noise, not evidence. */
  const missing = new Set<string>();

  for (const width of TOKEN_WIDTHS) {
    await page.setViewportSize({ width, height: restore?.height ?? 900 });
    const measured = await page.evaluate(
      ({ list, fluid }) => {
        const root = getComputedStyle(document.documentElement);
        const missing = list.filter(
          (name) => root.getPropertyValue(name).trim() === '',
        );

        // Off-screen and unpainted, but in the layout tree: a detached element
        // has no computed style to read.
        const probe = document.createElement('span');
        probe.style.position = 'absolute';
        probe.style.left = '-9999px';
        probe.style.visibility = 'hidden';
        document.body.append(probe);
        const sizes: Record<string, number> = {};
        for (const name of fluid) {
          probe.style.fontSize = `var(${name})`;
          sizes[name] = parseFloat(getComputedStyle(probe).fontSize);
        }
        probe.remove();

        return { missing, sizes };
      },
      { list: names, fluid: FLUID_STEPS },
    );

    for (const name of measured.missing) missing.add(name);
    for (const [name, size] of Object.entries(measured.sizes)) {
      rendered.set(name, [...(rendered.get(name) ?? []), size]);
    }
  }

  if (missing.size > 0) {
    findings.push({
      check: 'tokens',
      detail:
        `DESIGN.md §1 names ${missing.size} token(s) that resolve to nothing on ` +
        `:root: ${[...missing].join(', ')}. The index and tokens.css have ` +
        `drifted, or the stylesheet never reached the page.`,
    });
  }

  for (const [name, sizes] of rendered) {
    if (sizes.some((size) => !Number.isFinite(size) || size <= 0)) {
      findings.push({
        check: 'tokens',
        detail: `${name} does not resolve to a length: measured ${sizes.join('px, ')}px`,
      });
      continue;
    }
    if (new Set(sizes).size === 1) {
      findings.push({
        check: 'tokens',
        detail:
          `${name} renders at ${sizes[0]}px at both ${TOKEN_WIDTHS.join('px and ')}px. ` +
          `A display step that does not answer the viewport is a fixed size, ` +
          `whatever it is spelled as.`,
      });
    }
  }

  if (restore !== null) await page.setViewportSize(restore);
  return findings;
}

/**
 * §6.1: the shell overlay resolves to non-zero opacity on every route and
 * `mix-blend-mode` computes to multiply.
 */
export async function checkGrain(page: Page): Promise<Finding[]> {
  const result = await page.evaluate(() => {
    const shell = document.querySelector('[data-shell]');
    if (shell === null) {
      return { found: false, opacity: '0', blend: 'none' };
    }
    const style = getComputedStyle(shell, '::after');
    return {
      found: true,
      opacity: style.opacity,
      blend: style.mixBlendMode,
      image: style.backgroundImage.slice(0, 40),
    };
  });

  const findings: Finding[] = [];
  if (!result.found || Number(result.opacity) === 0) {
    findings.push({
      check: 'grain',
      detail: `overlay opacity resolved to ${result.opacity}, expected non-zero`,
    });
  }
  if (result.blend !== 'multiply') {
    findings.push({
      check: 'grain',
      detail: `mix-blend-mode resolved to ${result.blend}, expected multiply`,
    });
  }
  return findings;
}

/**
 * SLICE-25 §A/§B: the reveal contract.
 *
 * The defect this exists for: `Reveal` and `Motif` declared `initial={{ opacity:
 * 0 }}` on Motion components that render on the server, and Motion serialises
 * `initial` into the SSR markup as an inline style attribute. `opacity: 0` was
 * therefore the *painted* state of the document, and the only thing that ever
 * raised it was client JS. Measured with `javaScriptEnabled: false`: the
 * motif's human line and all three landing sections sat at the literal server
 * attribute `opacity:0;transform:translateY(12px)` and stayed there. The
 * landing page is the marketing surface, and its whole body was invisible to
 * anyone whose bundle was slow, blocked, or still parsing.
 *
 * **The primary half is static, and deliberately so.** A timed check of a
 * hydration race fails or passes according to how fast the machine running it
 * is: measured on this page, the human line cleared at ~1500ms idle and
 * 2015ms under a 6x CPU throttle. Fetching the server's own bytes has no
 * hydration window, no scroll position and no flake, and -- unlike anything
 * timed -- it cannot pass by sampling a moment that happened to be late enough.
 *
 * **The secondary half is timed, and scoped to what is on screen.** Below-fold
 * sections legitimately sit at 0 until scrolled to; DESIGN.md §8 permits
 * scroll-linked opacity, and the landing's third section is below the fold at
 * both breakpoints. Above the fold nothing may be invisible, and the bound is
 * 2s under a 6x throttle -- taken from the 2015ms the broken version measured,
 * so the fixed page has to beat the bug rather than merely beat an idle
 * machine.
 *
 * **Effective opacity, not the element's own.** `opacity` does not inherit: a
 * `<p>` inside a wrapper at `opacity: 0` computes to `1` on itself. Reading the
 * element alone would have reported this page as healthy on the exact bug this
 * check is for -- the same trap `checkFooter`'s `scrollable` escape hatch fell
 * into, where the condition was never actually exercised. Every ancestor up to
 * `<html>` is multiplied in.
 *
 * **The budget is load, plus whatever sequence the element itself declares.**
 * SLICE-26: a flat 2000ms conflated two different things. Text that is
 * invisible because the bundle has not arrived is a bug; text that is
 * invisible because a stylesheet says so for a stated number of milliseconds
 * is a design decision, and the motif's is 1550ms of one -- `--motif-sequence`
 * plus --dur-move, the pause that lets the strike land before the human line
 * answers it. Measured on the landing: first contentful paint at 196-440ms and
 * the human line at 1653-1974ms, so the sequence was consuming three quarters
 * of a budget meant for load and the check flipped on cold-cache variance.
 *
 * So each element is judged against its own `animation-delay +
 * animation-duration` on top of the load budget. This is not an allowlist and
 * exempts no screen by name: the defect this check was written for had no
 * animation at all -- an inline `opacity: 0` from the server and JavaScript as
 * the only way out -- so its allowance is still exactly 2000ms. What it costs
 * is that a stylesheet could buy silence by declaring a long delay, and that
 * is the right trade: a declared sequence is one a reviewer can read in the
 * cascade, an undeclared one is invisible to everybody.
 *
 * **The floor is zero, not one, and that is not a softened threshold.** The
 * motif's generic line rests at `opacity: 0.35` on purpose -- DESIGN.md §9
 * keeps the before-state on screen, dimmed rather than removed, because it is
 * half the argument. A steady value that is the same at first paint and at
 * rest is not a reveal and has nothing to resolve. What this check owns is
 * text that is *not there*; whether text that is there is legible enough is
 * `checkContrast`'s job, it runs on every screen, and it would fail a 0.35
 * that stopped clearing AA. One floor per check, no allowlist, no screen
 * exempted by name.
 */
const REVEAL_BUDGET_MS = 2000;
const REVEAL_THROTTLE_RATE = 6;
/** A hard stop well past the budget, so an element that never resolves is
 *  reported as never rather than as slow. */
const REVEAL_GIVE_UP_MS = 8000;

export async function checkReveal(
  page: Page,
  path: string,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  // 1. The server's own bytes, which no JS has touched.
  const response = await page.request.get(path);
  const html = await response.text();

  if (!response.ok() || !html.includes('<main')) {
    // A check that measured an error page is a check that measured nothing,
    // and "no inline opacity:0 found" would be true of it.
    findings.push({
      check: 'reveal',
      detail:
        `${path} served ${response.status()} with no <main> in the body, so the ` +
        `static half of this check had nothing to measure. That is a failure, ` +
        `not a pass.`,
    });
  }

  const inline = [...html.matchAll(/\sstyle="([^"]*)"/g)].map((m) => m[1]);
  const zeroed = inline.filter((value) =>
    /opacity\s*:\s*0(\.0+)?\s*(;|$)/.test(value),
  );
  if (zeroed.length > 0) {
    findings.push({
      check: 'reveal',
      detail:
        `${path}'s server HTML ships ${zeroed.length} inline style(s) at zero ` +
        `opacity: ${zeroed
          .slice(0, 3)
          .map((s) => `"${s}"`)
          .join(', ')}. The server-rendered state is the visible state -- ` +
        `motion is layered on after hydration, never a precondition for ` +
        `reading the page.`,
    });
  }

  // 2. With JS on, under load, how long anything on screen stays invisible.
  const cdp = await page
    .context()
    .newCDPSession(page)
    .catch(() => null);
  if (cdp !== null) {
    await cdp.send('Emulation.setCPUThrottlingRate', {
      rate: REVEAL_THROTTLE_RATE,
    });
  }

  try {
    await page.goto(path);
    const measured = await page.evaluate(
      async ({ giveUp, budget }) => {
        const effective = (element: Element): number => {
          let value = 1;
          let node: Element | null = element;
          while (node !== null) {
            value *= Number(getComputedStyle(node).opacity);
            node = node.parentElement;
          }
          return value;
        };

        const onScreen = (): Element[] => {
          const main = document.querySelector('main');
          if (main === null) return [];
          return [...main.querySelectorAll('*')].filter((element) => {
            const carries = [...element.childNodes].some(
              (n) =>
                n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim(),
            );
            if (!carries) return false;
            const style = getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden') {
              return false;
            }
            const rect = element.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) return false;
            // Screen-reader-only text is not painted, so it has no opacity worth
            // reading: `.visually-hidden` keeps a 1x1 box and clips it away.
            if (
              style.clipPath !== 'none' &&
              rect.width <= 2 &&
              rect.height <= 2
            ) {
              return false;
            }
            return rect.top < window.innerHeight && rect.bottom > 0;
          });
        };

        /**
         * The milliseconds an element's own stylesheet says it will be
         * invisible: the longest delay-plus-duration it declares. Both
         * properties can carry a list, so they are zipped; a negative delay
         * (an animation starting part-way through) counts as none.
         */
        const declared = (element: Element): number => {
          const style = getComputedStyle(element);
          if (style.animationName === 'none') return 0;
          const ms = (value: string) =>
            value
              .split(',')
              .map(
                (part) =>
                  (parseFloat(part) || 0) * (/ms/.test(part) ? 1 : 1000),
              );
          const delays = ms(style.animationDelay);
          const durations = ms(style.animationDuration);
          return Math.max(
            0,
            ...durations.map(
              (duration, index) =>
                Math.max(0, delays[index] ?? delays[0] ?? 0) + duration,
            ),
          );
        };

        let counted = 0;
        for (;;) {
          const now = performance.now();
          const list = onScreen();
          counted = Math.max(counted, list.length);

          const invisible = list.filter((element) => effective(element) < 0.01);
          const late = invisible
            .map((element) => ({
              text: (element.textContent ?? '').trim().slice(0, 40),
              where: `${element.tagName.toLowerCase()}.${String(element.className).split(' ')[0]}`,
              opacity: Math.round(effective(element) * 1000) / 1000,
              allowance: Math.round(budget + declared(element)),
            }))
            .filter((item) => now > item.allowance);

          if (late.length > 0) return { counted, at: now, late, gaveUp: false };
          if (invisible.length === 0) {
            return { counted, at: now, late: [], gaveUp: false };
          }
          if (now > giveUp) {
            return {
              counted,
              at: now,
              late: invisible.map((element) => ({
                text: (element.textContent ?? '').trim().slice(0, 40),
                where: `${element.tagName.toLowerCase()}.${String(element.className).split(' ')[0]}`,
                opacity: Math.round(effective(element) * 1000) / 1000,
                allowance: Math.round(budget + declared(element)),
              })),
              gaveUp: true,
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      },
      { giveUp: REVEAL_GIVE_UP_MS, budget: REVEAL_BUDGET_MS },
    );

    // The vacuity guard. Every other clause here is satisfied by an empty set,
    // so the set has to be asserted non-empty in its own right.
    if (measured.counted === 0) {
      findings.push({
        check: 'reveal',
        detail:
          `${path}: no text-bearing element was found on screen in <main> at all, ` +
          `so the timed half asserted nothing. A check with an empty subject ` +
          `passes for the wrong reason.`,
      });
    } else {
      for (const item of measured.late) {
        findings.push({
          check: 'reveal',
          detail: measured.gaveUp
            ? `${path}: ${item.where} "${item.text}" is still at effective ` +
              `opacity ${item.opacity} after ${Math.round(measured.at)}ms at ` +
              `${REVEAL_THROTTLE_RATE}x CPU throttle, on screen the whole ` +
              `time. It never resolved.`
            : `${path}: ${item.where} "${item.text}" was still at effective ` +
              `opacity ${item.opacity} ${Math.round(measured.at)}ms in at ` +
              `${REVEAL_THROTTLE_RATE}x CPU throttle. Its allowance is ` +
              `${item.allowance}ms: ${REVEAL_BUDGET_MS}ms of load, which is ` +
              `what the SSR-initial-state bug itself measured, plus the ` +
              `${item.allowance - REVEAL_BUDGET_MS}ms its own animation ` +
              `declares. ${measured.counted} elements checked.`,
        });
      }
    }

    // 3. SLICE-25: a declared `transition: all`, which fights any inline style
    //    written onto the same element. Not `transitionProperty === 'all'` on
    //    its own: `all` is the *initial value* of that property, so every
    //    element with no transition at all reports it, and asserting against
    //    that would be asserting that every element must declare a transition.
    //    A non-zero duration is what makes it a real declaration.
    const blanket = await page.evaluate(() => {
      const main = document.querySelector('main');
      if (main === null) return [];
      return [...main.querySelectorAll('*')]
        .filter((element) => {
          const style = getComputedStyle(element);
          return (
            style.transitionProperty
              .split(',')
              .some((p) => p.trim() === 'all') &&
            style.transitionDuration.split(',').some((d) => parseFloat(d) > 0)
          );
        })
        .map(
          (element) =>
            `${element.tagName.toLowerCase()}.${String(element.className).split(' ')[0]}`,
        );
    });
    for (const where of blanket.slice(0, 5)) {
      findings.push({
        check: 'reveal',
        detail:
          `${path}: ${where} declares a transition over \`all\` with a non-zero ` +
          `duration. Name the properties: a blanket transition animates every ` +
          `inline style anything writes onto the element, including a reveal's.`,
      });
    }
  } finally {
    if (cdp !== null) {
      await cdp
        .send('Emulation.setCPUThrottlingRate', { rate: 1 })
        .catch(() => undefined);
      await cdp.detach().catch(() => undefined);
    }
  }

  return findings;
}

/**
 * §6.2: on every route at 1440x900 with minimum content, the footer's bottom
 * is within 2px of viewport height. A long page's footer is at the document
 * bottom by definition, and asserting otherwise would be asserting that no
 * page may be taller than the screen -- but a page that scrolls by less than
 * its own footer's height has hidden the footer for nothing, which SLICE-24
 * §2.1 found on five screens at once and is checked below.
 */
export async function checkFooter(page: Page): Promise<Finding[]> {
  const result = await page.evaluate(() => {
    const footer = document.querySelector('footer');
    if (footer === null) {
      return null;
    }
    const box = footer.getBoundingClientRect();
    return {
      bottom: box.bottom,
      height: box.height,
      viewport: window.innerHeight,
      overflow: document.documentElement.scrollHeight - window.innerHeight,
    };
  });

  if (result === null) {
    return [{ check: 'footer', detail: 'no <footer> on the page' }];
  }
  if (result.overflow > 2) {
    // SLICE-24 §2.1: the `scrollable` escape hatch above used to end the check
    // here, and it let every auth screen through -- each one stood a 100dvh
    // column inside a shell already exactly one viewport tall, so the page
    // scrolled by the height of the chrome and the footer sat below the fold
    // on arrival. A page taller than the screen is not a defect. A page that
    // scrolls by less than its own footer is: there is nothing down there to
    // reach, only the thing that was supposed to close the viewport.
    return result.overflow < result.height
      ? [
          {
            check: 'footer',
            detail:
              `the page scrolls by ${Math.round(result.overflow)}px, less than the ` +
              `footer's own ${Math.round(result.height)}px: nothing is below the fold ` +
              `but the footer that should have closed the viewport`,
          },
        ]
      : [];
  }
  const gap = Math.abs(result.bottom - result.viewport);
  return gap <= 2
    ? []
    : [
        {
          check: 'footer',
          detail: `footer bottom at ${Math.round(result.bottom)}px, viewport ${result.viewport}px (${Math.round(gap)}px short)`,
        },
      ];
}

/**
 * §6.3: for every interactive element, hovering changes at least one of
 * background-color, box-shadow, border-color, transform or text-decoration.
 *
 * Driven with a real `element.hover()` rather than by reading stylesheets: a
 * rule that exists but is overridden by a later one is exactly the failure
 * this is for. Elements that are not visible cannot be hovered and are
 * skipped rather than reported -- a hidden radio's own hover state is not
 * what §3.3 is about.
 */
export async function checkHover(page: Page): Promise<Finding[]> {
  const selector = 'button, a, [role="button"], input, textarea, select';
  const elements = await page.locator(selector).all();
  const findings: Finding[] = [];

  for (const element of elements) {
    if (!(await element.isVisible().catch(() => false))) {
      continue;
    }
    // A disabled control is not interactive, and the correct affordance for it
    // is precisely that nothing happens. §3.3's rule is about an interface
    // where nothing responds to the cursor, not about controls that are off.
    if (await element.isDisabled().catch(() => false)) {
      continue;
    }
    const box = await element.boundingBox();
    if (box === null || box.width < 2 || box.height < 2) {
      continue;
    }

    const read = () =>
      element.evaluate((node) => {
        const s = getComputedStyle(node as Element);
        return [
          s.backgroundColor,
          s.boxShadow,
          s.borderColor,
          s.transform,
          s.textDecoration,
          // The composed underline draw is a pseudo-element transform, which
          // no property on the element itself reflects.
          getComputedStyle(node as Element, '::after').transform,
        ].join('|');
      });

    const before = await read();
    await element.hover({ trial: false, force: true }).catch(() => undefined);
    // Past --dur-micro before reading. `getComputedStyle` returns the value
    // the transition is currently at, and at t=0 that is still the resting
    // value -- which reported every transitioned hover in the app as "no
    // response" on the first run of this harness.
    await element.page().waitForTimeout(260);
    const after = await read();

    if (before === after) {
      const description = await element.evaluate((node) => {
        const el = node as Element;
        const label =
          (el.textContent ?? '').trim() ||
          el.getAttribute('aria-label') ||
          el.getAttribute('placeholder') ||
          el.getAttribute('name') ||
          el.getAttribute('type') ||
          el.id ||
          '';
        return `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''} "${label.slice(0, 30)}"`;
      });
      findings.push({ check: 'hover', detail: `no response: ${description}` });
    }
  }

  // Park the cursor somewhere inert so the screenshot taken after this is not
  // of a hovered control.
  await page.mouse.move(0, 0);
  return findings;
}

/**
 * §6.4: every text/background pair >= 4.5:1, large display text >= 3:1.
 *
 * The background is resolved by walking up the tree for the first ancestor
 * with a non-transparent background, which is what the eye does. Text nodes
 * only: an empty element has no contrast to measure.
 */
export async function checkContrast(page: Page): Promise<Finding[]> {
  const failures = await page.evaluate(() => {
    const parse = (value: string): [number, number, number, number] | null => {
      const match = /rgba?\(([^)]+)\)/.exec(value);
      if (match === null) return null;
      const parts = match[1].split(',').map((p) => Number(p.trim()));
      return [parts[0], parts[1], parts[2], parts[3] ?? 1];
    };

    const lum = ([r, g, b]: number[]) => {
      const c = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
    };

    /**
     * The ground the eye sees under `element`.
     *
     * SLICE-26: the paint stack first, the ancestor walk only as a fallback.
     * An ancestor walk is wrong for anything out of flow, and the landing's
     * header is exactly that -- `position: absolute` over a full-bleed
     * --ink-deep hero, so walking parents resolves it to the body's --base and
     * reports --on-dark chrome sitting on a dark ground as 1.05:1 against a
     * ground it is not on. `elementsFromPoint` returns what is actually
     * painted under a point, which is what the eye reads. It answers inside
     * the viewport only, so the walk stays for anything below the fold.
     *
     * Neither path can see a photograph, and neither should try. An <img>
     * carries no background colour, so a walk that continued past one would
     * report whatever is *behind* the picture -- on the landing, the frame's
     * own --paper-dim placeholder: a colour that is painted, covered, and
     * never seen by anybody. Measured that way the hero deck read 1.03:1
     * while the pixels actually behind it said 4.19:1. So the walk stops at
     * an image and the caller skips the element. Text over a photograph is
     * `checkComposite`'s subject and is measured there, on real pixels.
     */
    const groundOf = (
      element: Element,
      rect: DOMRect,
    ): [number, number, number] | null => {
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x >= 0 && y >= 0 && x < innerWidth && y < innerHeight) {
        for (const node of document.elementsFromPoint(x, y)) {
          if (node.tagName === 'IMG') return null;
          const parsed = parse(getComputedStyle(node).backgroundColor);
          if (parsed !== null && parsed[3] > 0.5) {
            return [parsed[0], parsed[1], parsed[2]];
          }
        }
      }

      let node: Element | null = element;
      while (node !== null) {
        const parsed = parse(getComputedStyle(node).backgroundColor);
        if (parsed !== null && parsed[3] > 0.5) {
          return [parsed[0], parsed[1], parsed[2]];
        }
        node = node.parentElement;
      }
      return [255, 255, 255];
    };

    const out: { text: string; ratio: number; size: number; where: string }[] =
      [];

    for (const element of Array.from(document.querySelectorAll('*'))) {
      const own = Array.from(element.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim(),
      );
      if (!own) continue;

      const style = getComputedStyle(element);
      if (
        style.visibility === 'hidden' ||
        style.display === 'none' ||
        Number(style.opacity) < 0.1
      ) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      // Screen-reader-only text is not painted, so it has no contrast to
      // measure: `.visually-hidden` keeps a 1x1 box and clips it away, which
      // is exactly the shape that survives a bounding-box test and must not
      // survive this one.
      if (style.clipPath !== 'none' && rect.width <= 2 && rect.height <= 2) {
        continue;
      }

      const fg = parse(style.color);
      if (fg === null || fg[3] < 0.1) continue;

      const bg = groundOf(element, rect);
      if (bg === null) continue;
      const ratios = [lum([fg[0], fg[1], fg[2]]), lum(bg)].sort(
        (a, b) => b - a,
      );
      const ratio = (ratios[0] + 0.05) / (ratios[1] + 0.05);

      const size = parseFloat(style.fontSize);
      const weight = Number(style.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const floor = large ? 3 : 4.5;

      if (ratio < floor) {
        out.push({
          text: (element.textContent ?? '').trim().slice(0, 40),
          ratio: Math.round(ratio * 100) / 100,
          size,
          where: `${element.tagName.toLowerCase()}.${String(element.className).split(' ')[0]}`,
        });
      }
    }
    return out;
  });

  return failures.map((f) => ({
    check: 'contrast',
    detail: `${f.ratio}:1 at ${f.size}px on ${f.where} — "${f.text}"`,
  }));
}

/**
 * §6.5: wherever --human display text renders, a corresponding slop line and
 * a drawn annotation exist in the same subtree. A lone terracotta paragraph
 * fails, which is the exact defect §0 describes.
 *
 * SLICE-26 adds the second half: the human line reaches full opacity and
 * *stays* there. `checkReveal`'s floor is 0.01, which is the right floor for
 * "this text is not there at all" and the wrong one for the sentence carrying
 * the page's whole argument -- a line that resolves to 0.4 and stops passes
 * that check and fails a reader. Two samples a second apart, because the
 * failure being guarded against is a value that resolves and then leaves
 * again: one reading cannot tell an end state from a frame of one.
 */
const MOTIF_SETTLE_MS = 1000;

export async function checkMotif(page: Page): Promise<Finding[]> {
  const findings = await page.evaluate(() => {
    const human = getComputedStyle(document.documentElement)
      .getPropertyValue('--human')
      .trim();

    const toRgb = (hex: string) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex);
      if (m === null) return null;
      const n = parseInt(m[1], 16);
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    const wanted = toRgb(human);
    const out: { check: string; detail: string }[] = [];

    for (const element of Array.from(document.querySelectorAll('*'))) {
      const text = (element.textContent ?? '').trim();
      if (!text) continue;
      const style = getComputedStyle(element);
      if (style.color !== wanted) continue;
      if (parseFloat(style.fontSize) < 20) continue;
      // Only the innermost element carrying the colour, so one motif is not
      // reported three times for its ancestors.
      if (
        Array.from(element.children).some(
          (c) => getComputedStyle(c).color === wanted,
        )
      ) {
        continue;
      }

      const figure = element.closest('figure');
      if (figure === null) {
        out.push({
          check: 'motif',
          detail: `--human display text outside a motif: "${text.slice(0, 40)}"`,
        });
        continue;
      }
      const hasSlop =
        figure.textContent !== null && figure.querySelectorAll('p').length >= 3;
      const hasAnnotation =
        figure.querySelector('svg.rough-annotation') !== null;
      if (!hasSlop) {
        out.push({
          check: 'motif',
          detail: `motif has no slop half: "${text.slice(0, 40)}"`,
        });
      }
      if (!hasAnnotation) {
        out.push({
          check: 'motif',
          detail: `motif has no drawn annotation: "${text.slice(0, 40)}"`,
        });
      }
    }
    return out;
  });

  const opacity = await page.evaluate(async (settle: number) => {
    const human = getComputedStyle(document.documentElement)
      .getPropertyValue('--human')
      .trim();
    const toRgb = (hex: string) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex);
      if (m === null) return null;
      const n = parseInt(m[1], 16);
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    const wanted = toRgb(human);

    /** Every ancestor multiplied in: `opacity` does not inherit, so a line
     *  inside a wrapper at 0 computes to 1 on itself. */
    const effective = (element: Element): number => {
      let value = 1;
      let node: Element | null = element;
      while (node !== null) {
        value *= Number(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      return value;
    };

    const lines = () =>
      [...document.querySelectorAll('figure *')].filter((element) => {
        const style = getComputedStyle(element);
        if (style.color !== wanted) return false;
        if (parseFloat(style.fontSize) < 20) return false;
        return (element.textContent ?? '').trim() !== '';
      });

    const first = lines().map(effective);
    await new Promise((resolve) => setTimeout(resolve, settle));
    const second = lines().map((element) => ({
      text: (element.textContent ?? '').trim().slice(0, 40),
      value: effective(element),
    }));

    return { counted: first.length, first, second };
  }, MOTIF_SETTLE_MS);

  // Satisfied by an empty set otherwise, so the set is asserted in its own
  // right: a motif that rendered no --human line at all would pass silently.
  if (opacity.counted === 0) {
    findings.push({
      check: 'motif',
      detail:
        'no --human display line was found inside a <figure>, so the opacity ' +
        'half of this check measured nothing. On a screen that renders the ' +
        'motif that is the failure, not a pass.',
    });
  }

  for (const [index, line] of opacity.second.entries()) {
    if (line.value < 1 || (opacity.first[index] ?? 0) < 1) {
      findings.push({
        check: 'motif',
        detail:
          `the human line "${line.text}" measured effective opacity ` +
          `${Math.round((opacity.first[index] ?? 0) * 100) / 100} and then ` +
          `${Math.round(line.value * 100) / 100} a second later. It has to ` +
          `reach 1 and stay there: it is the sentence the page argues with.`,
      });
    }
  }

  return findings;
}

/** §6.7: the wordmark is present in the header. */
export async function checkWordmark(page: Page): Promise<Finding[]> {
  const present = await page
    .locator('header [aria-label="Aplica"]')
    .first()
    .isVisible()
    .catch(() => false);
  return present
    ? []
    : [{ check: 'wordmark', detail: 'no wordmark in the header' }];
}

/**
 * The ground change, sampled while it runs (SLICE-20 §2.3, DESIGN.md §8).
 *
 * Every other check here reads a resting state. This one exists because the
 * defect it caught lives only *between* two resting states, both of which
 * measure fine: the shell chrome's ink and the ground travel in opposite
 * directions over --dur-stage, so animating them together walked the text
 * through the ground's own colour. Measured at the worst frame, the footer
 * links hit 1.13:1 and the wordmark 1.33:1 -- text that disappears and comes
 * back on every run start.
 *
 * The fix (tokens.css `--delay-invert`) holds the ink still, then steps it in
 * one frame once the ground is past the crossing. That floor cannot reach AA:
 * with --ink-soft on the way out and --on-dark-soft on the way in, the two
 * luminances are close enough that the best any timing can do for the footer
 * links is about 1.7:1. That is arithmetic, not a choice.
 *
 * So this is a regression guard, not an accessibility floor. It sits above
 * what the broken version measured (1.13:1 and 1.33:1) and below what the
 * fixed one does (footer links 1.82:1, wordmark 4.40:1). The first threshold
 * tried was 1.9, read off a sampling pass that stepped over the worst frame;
 * the dense sweep found 1.82 and the harness rightly failed on its own author.
 *
 * Toggling `body[data-stage]` directly is what `ApplyForm` and `CvUpload` do
 * from their own phase machines, so this drives the real mechanism on whatever
 * screen it is called from. It restores the attribute afterwards.
 */
const INVERT_FLOOR = 1.6;

export async function checkGroundInversion(page: Page): Promise<Finding[]> {
  const wasSet = await page.evaluate(
    () => document.body.dataset.stage === 'true',
  );

  const read = () =>
    page.evaluate(() => {
      // The shell's chrome only. Every screen in the product puts its own
      // <header> around its heading inside <main>, and that text is not
      // chrome: it does not invert with the ground, so sampling it reports a
      // page heading correctly staying --ink as a chrome failure. The bug was
      // always here; it never fired because this check has only ever been run
      // from the landing, the one screen with no heading block of its own.
      const chrome = [
        ...document.querySelectorAll('header *, footer *'),
      ].filter(
        (el) =>
          el.closest('main') === null &&
          [...el.childNodes].some(
            (n) =>
              n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim(),
          ),
      );
      return {
        ground: getComputedStyle(document.body).backgroundColor,
        items: chrome.map((el) => ({
          text: (el.textContent ?? '').trim().slice(0, 24),
          color: getComputedStyle(el).color,
        })),
      };
    });

  const rgb = (value: string): [number, number, number] => {
    const [r, g, b] = (value.match(/[\d.]+/g) ?? ['0', '0', '0']).map(Number);
    return [r, g, b];
  };

  const floors = new Map<string, number>();
  const started = Date.now();
  await page.evaluate(() => {
    document.body.dataset.stage = 'true';
  });

  // Every 20ms across the whole --dur-stage change and a little past it.
  // Screenshotting inside this loop perturbs it: the captures cost enough
  // wall-clock that the sampler steps straight over the worst frame and
  // reports a floor that is too kind. So it only measures.
  for (let ms = 20; ms <= 900; ms += 20) {
    const wait = ms - (Date.now() - started);
    if (wait > 0) await page.waitForTimeout(wait);
    const { ground, items } = await read();
    for (const item of items) {
      const ratio = contrastRatio(rgb(item.color), rgb(ground));
      const best = floors.get(item.text);
      if (best === undefined || ratio < best) floors.set(item.text, ratio);
    }
  }

  await page.evaluate((restore) => {
    if (restore) document.body.dataset.stage = 'true';
    else delete document.body.dataset.stage;
  }, wasSet);

  return [...floors]
    .filter(([, ratio]) => ratio < INVERT_FLOOR)
    .map(([text, ratio]) => ({
      check: 'ground-inversion',
      detail:
        `"${text}" drops to ${ratio.toFixed(2)}:1 during the ground change ` +
        `(floor ${INVERT_FLOOR}:1). The chrome's ink is crossing the ground ` +
        `instead of stepping past it -- see --delay-invert.`,
    }));
}

/**
 * DESIGN.md §11 item 11, the value range. **Editorial screens only.**
 *
 * "At 1440x900 the background colours of elements each covering >=15% of the
 * viewport must span >=0.35 relative luminance." Until now nothing measured
 * it, and D8 records what that cost: the item passed on the landing page on a
 * technicality, because the only two background colours in the DOM were the
 * oat ground and a 44px green button. The >=15% qualifier is what closed that,
 * and this is the first thing to enforce it.
 *
 * **Scoped to register, not to archetype.** The item's own escape hatch reads
 * "or the screen is Column", which is the wrong axis: `/apply`, `/cv`,
 * `/applications` and `/account` are Desk, not Column, and every one of them
 * is a single --base ground by design. Running this there would be demanding
 * ground variety from screens whose whole brief is restraint (DESIGN.md §2).
 * Tool is exempt; the caller runs this on Editorial screens.
 *
 * **A grid of paint samples, not a walk of the DOM.** What the item is about
 * is how much of the screen each ground actually covers, and an element's box
 * is not that: `body` is as tall as the document and would qualify at every
 * viewport whatever is painted over it. `elementsFromPoint` answers with the
 * real stack at a point, so an element only counts where it is actually
 * visible.
 *
 * **A photograph is a ground, and it is read as pixels.** The first version of
 * this walked past an <img> looking for a background *colour*, on the reasoning
 * that a photograph has none. On a hero whose ground is a full-bleed
 * photograph that resolved to the frame's --paper-dim placeholder -- a colour
 * that is painted, covered, and seen by nobody -- and the check reported a
 * dark screen as a single cream ground at 87% of the viewport, luminance
 * 0.818. Worse, the only way to satisfy it from the page would have been to
 * repaint the placeholder, which `checkImageStability` requires to be
 * --paper-dim: two checks, one contradiction, neither of them wrong about its
 * own subject. Item 11 now says a sample over an image resolves to the image's
 * own composited pixel, so the capture is read back the way `checkComposite`
 * reads it and the pixel includes everything on top of the photograph -- the
 * grade, the tint, both scrims, the grain.
 *
 * A photograph is one ground rather than a thousand, so its samples pool under
 * one key and its luminance is their mean: "the background colours of elements
 * each covering >=15%" is a statement about elements, and the element here is
 * the image. Solid grounds pool the same way and their mean is the colour
 * itself, so there is one path, not two.
 *
 * Two qualifying grounds are required as well as the span, so the failure mode
 * D8 describes cannot come back in another shape: one ground plus one bright
 * accident is not a range.
 */
const VALUE_RANGE_VIEWPORT = { width: 1440, height: 900 };
const VALUE_RANGE_COLUMNS = 60;
const VALUE_RANGE_ROWS = 40;
const GROUND_MIN_SHARE = 0.15;
const VALUE_RANGE_MIN_SPAN = 0.35;

export async function checkValueRange(page: Page): Promise<Finding[]> {
  const restore = page.viewportSize();
  await page.setViewportSize(VALUE_RANGE_VIEWPORT);
  // The item is stated at one size, so it is measured at that size: a hero
  // sized in viewport units is a different composition at 1440 than at 390.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  const png = (await page.screenshot()).toString('base64');

  const measured = await page.evaluate(
    async ({ columns, rows, shot }) => {
      const parse = (
        value: string,
      ): [number, number, number, number] | null => {
        const match = /rgba?\(([^)]+)\)/.exec(value);
        if (match === null) return null;
        const parts = match[1].split(',').map((p) => Number(p.trim()));
        return [parts[0], parts[1], parts[2], parts[3] ?? 1];
      };

      const channel = (value: number) => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const lum = (r: number, g: number, b: number) =>
        0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${shot}`)).blob(),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) return null;
      context.drawImage(bitmap, 0, 0);
      const scale = bitmap.width / window.innerWidth;

      /** samples and summed luminance, per ground. */
      const grounds = new Map<string, { samples: number; sum: number }>();
      const record = (key: string, value: number) => {
        const entry = grounds.get(key) ?? { samples: 0, sum: 0 };
        entry.samples += 1;
        entry.sum += value;
        grounds.set(key, entry);
      };

      const images = [...document.querySelectorAll('img')];
      let total = 0;

      for (let row = 0; row < rows; row += 1) {
        const y = ((row + 0.5) / rows) * window.innerHeight;
        for (let column = 0; column < columns; column += 1) {
          const x = ((column + 0.5) / columns) * window.innerWidth;
          total += 1;
          for (const node of document.elementsFromPoint(x, y)) {
            if (node.tagName === 'IMG') {
              // The image's own composited pixel, which is the photograph plus
              // everything painted over it. Read from the capture rather than
              // from the file: the grade, the tint and the scrims are what make
              // this ground the value it is.
              const pixel = context.getImageData(
                Math.min(bitmap.width - 1, Math.round(x * scale)),
                Math.min(bitmap.height - 1, Math.round(y * scale)),
                1,
                1,
              ).data;
              const index = images.indexOf(node as HTMLImageElement);
              record(`image ${index}`, lum(pixel[0], pixel[1], pixel[2]));
              break;
            }
            const parsed = parse(getComputedStyle(node).backgroundColor);
            if (parsed !== null && parsed[3] > 0.5) {
              record(
                `rgb(${parsed[0]}, ${parsed[1]}, ${parsed[2]})`,
                lum(parsed[0], parsed[1], parsed[2]),
              );
              break;
            }
          }
        }
      }

      return {
        total,
        grounds: [...grounds].map(([key, entry]) => ({
          key,
          samples: entry.samples,
          luminance: entry.sum / entry.samples,
        })),
      };
    },
    { columns: VALUE_RANGE_COLUMNS, rows: VALUE_RANGE_ROWS, shot: png },
  );

  if (restore !== null) await page.setViewportSize(restore);

  if (measured === null) {
    return [
      {
        check: 'value-range',
        detail:
          'the page could not open a 2D context to read the capture back, so ' +
          'no ground over the photograph could be resolved.',
      },
    ];
  }

  const qualifying = measured.grounds
    .map((ground) => ({
      key: ground.key,
      share: ground.samples / measured.total,
      luminance: ground.luminance,
    }))
    .filter((ground) => ground.share >= GROUND_MIN_SHARE)
    .sort((a, b) => b.luminance - a.luminance);

  const describe = (list: typeof qualifying) =>
    list
      .map(
        (ground) =>
          `${ground.key} at ${Math.round(ground.share * 100)}% of the ` +
          `viewport, luminance ${ground.luminance.toFixed(3)}`,
      )
      .join('; ');

  if (qualifying.length < 2) {
    return [
      {
        check: 'value-range',
        detail:
          `only ${qualifying.length} ground covers >=${Math.round(
            GROUND_MIN_SHARE * 100,
          )}% of the viewport at ${VALUE_RANGE_VIEWPORT.width}x` +
          `${VALUE_RANGE_VIEWPORT.height} (${describe(qualifying) || 'none'}). ` +
          `An Editorial screen with one ground is a document. A button is not ` +
          `a ground: the smaller fills measured were ${measured.grounds.length - qualifying.length} ` +
          `colours, none of them reaching the floor.`,
      },
    ];
  }

  const span =
    qualifying[0].luminance - qualifying[qualifying.length - 1].luminance;
  return span >= VALUE_RANGE_MIN_SPAN
    ? []
    : [
        {
          check: 'value-range',
          detail:
            `the qualifying grounds span ${span.toFixed(3)} relative luminance ` +
            `(floor ${VALUE_RANGE_MIN_SPAN}): ${describe(qualifying)}.`,
        },
      ];
}

/**
 * DESIGN.md §7: "Text over an image always sits on a scrim, never raw
 * photography. Measure the resulting pair." This is that measurement, and it
 * is the one check here that reads pixels rather than styles.
 *
 * `checkContrast` cannot do it and never could. It resolves a ground by
 * finding a background *colour*, and a photograph has none -- so text over the
 * hero image resolves to whatever ground the image is sitting on and passes on
 * the strength of a colour the reader cannot see. Every value that matters
 * here is composited rather than declared: the grade, the scrim's gradient,
 * the grain multiplying over both, the edge falloff. The only honest way to
 * measure a composite is to look at it.
 *
 * So: hide the text (`visibility: hidden`, which does not reflow), photograph
 * the viewport, hand the PNG back into the page as a data URL, decode it with
 * `createImageBitmap` and read the pixels behind each run of text.
 *
 * **The floor is a percentile, not the worst pixel.** A photograph under a
 * scrim is not flat, and a single specular pixel from a desk lamp would fail
 * a run of text that is perfectly readable. 1% is the allowance: no more than
 * one hundredth of the area behind a line may fall below AA. The absolute
 * worst pixel is reported alongside it, because that is the number worth
 * knowing when this fails.
 *
 * **Element opacity is deliberately not folded in**, so this and
 * `checkContrast` differ in exactly one thing: where the ground comes from.
 * The motif's struck slop line rests at 0.55 on the dark ground on purpose
 * (Motif.module.css), a decision made against the graphics floor rather than
 * the text one. Reopening it here would be this check quietly legislating a
 * settled call in a component it is only passing over.
 */
const COMPOSITE_TOLERANCE = 0.01;

export async function checkComposite(
  page: Page,
  options: { requireSubjects?: boolean } = {},
): Promise<Finding[]> {
  const subjects = await page.evaluate(() => {
    const images = [...document.querySelectorAll('main img')].map((image) =>
      image.getBoundingClientRect(),
    );
    if (images.length === 0) return { images: 0, marked: [] };

    const overlaps = (rect: DOMRect) =>
      images.some(
        (image) =>
          rect.left < image.right &&
          rect.right > image.left &&
          rect.top < image.bottom &&
          rect.bottom > image.top,
      );

    const marked: {
      id: number;
      rect: { x: number; y: number; width: number; height: number };
      color: string;
      size: number;
      weight: number;
      text: string;
      where: string;
    }[] = [];

    for (const element of [...document.querySelectorAll('body *')]) {
      const carries = [...element.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim(),
      );
      if (!carries) continue;

      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (style.clipPath !== 'none' && rect.width <= 2 && rect.height <= 2) {
        continue;
      }
      if (!overlaps(rect)) continue;

      const id = marked.length;
      element.setAttribute('data-composite', String(id));
      marked.push({
        id,
        rect: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        },
        color: style.color,
        size: parseFloat(style.fontSize),
        weight: Number(style.fontWeight) || 400,
        text: (element.textContent ?? '').trim().slice(0, 40),
        where: `${element.tagName.toLowerCase()}.${String(element.className).split(' ')[0]}`,
      });
    }

    return { images: images.length, marked };
  });

  if (subjects.images === 0) {
    return [
      {
        check: 'composite',
        detail:
          'no <img> in <main>, so this check measured nothing. On an ' +
          'Editorial screen whose composition is built on a photograph, that ' +
          'is the finding.',
      },
    ];
  }
  if (subjects.marked.length === 0) {
    // Not a defect on its own. Keeping type off a photograph is a legitimate
    // answer to §7 and on this product it is the measured one: the landing's
    // motif was over the image until this check reported it at 1.42:1, and the
    // deck that replaced it is the only run of type on the photograph at all.
    // Below 60rem even that steps off, so the caller asks for a subject only
    // where the composition is supposed to have one.
    return options.requireSubjects === true
      ? [
          {
            check: 'composite',
            detail:
              `${subjects.images} image(s) in <main> and no text over any of ` +
              `them at this breakpoint, where the composition is supposed to ` +
              `put some there. Nothing was measured.`,
          },
        ]
      : [];
  }

  await page.evaluate(() => {
    for (const element of document.querySelectorAll('[data-composite]')) {
      (element as HTMLElement).style.visibility = 'hidden';
    }
  });
  const shot = (await page.screenshot()).toString('base64');
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('[data-composite]')) {
      (element as HTMLElement).style.removeProperty('visibility');
      element.removeAttribute('data-composite');
    }
  });

  const measured = await page.evaluate(
    async ({
      png,
      list,
      tolerance,
    }: {
      png: string;
      list: typeof subjects.marked;
      tolerance: number;
    }) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${png}`)).blob(),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (context === null) return null;
      context.drawImage(bitmap, 0, 0);
      const scale = bitmap.width / window.innerWidth;

      const channel = (value: number) => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const lum = (r: number, g: number, b: number) =>
        0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

      return list.map((subject) => {
        const parts = (/rgba?\(([^)]+)\)/.exec(subject.color)?.[1] ?? '0,0,0')
          .split(',')
          .map((p) => Number(p.trim()));
        const ink = lum(parts[0], parts[1], parts[2]);

        const x = Math.max(0, Math.round(subject.rect.x * scale));
        const y = Math.max(0, Math.round(subject.rect.y * scale));
        const width = Math.min(
          Math.round(subject.rect.width * scale),
          bitmap.width - x,
        );
        const height = Math.min(
          Math.round(subject.rect.height * scale),
          bitmap.height - y,
        );
        if (width < 1 || height < 1) return null;

        const pixels = context.getImageData(x, y, width, height).data;
        const ratios: number[] = [];
        for (let i = 0; i < pixels.length; i += 4) {
          const ground = lum(pixels[i], pixels[i + 1], pixels[i + 2]);
          const [light, dark] = ink > ground ? [ink, ground] : [ground, ink];
          ratios.push((light + 0.05) / (dark + 0.05));
        }
        ratios.sort((a, b) => a - b);

        return {
          ...subject,
          worst: ratios[0],
          floor: ratios[Math.floor(ratios.length * tolerance)],
          samples: ratios.length,
        };
      });
    },
    { png: shot, list: subjects.marked, tolerance: COMPOSITE_TOLERANCE },
  );

  if (measured === null) {
    return [
      {
        check: 'composite',
        detail:
          'the page could not open a 2D context to read the capture back, so ' +
          'nothing was measured.',
      },
    ];
  }

  const findings: Finding[] = [];
  for (const result of measured) {
    if (result === null) continue;
    const large =
      result.size >= 24 || (result.size >= 18.66 && result.weight >= 700);
    const required = large ? 3 : 4.5;
    if (result.floor < required) {
      findings.push({
        check: 'composite',
        detail:
          `"${result.text}" (${result.where}, ${result.size}px) measures ` +
          `${result.floor.toFixed(2)}:1 against the pixels actually behind it, ` +
          `worst pixel ${result.worst.toFixed(2)}:1, floor ${required}:1. ` +
          `Text over a photograph is only as legible as its scrim.`,
      });
    }
  }
  return findings;
}

/**
 * DESIGN.md §8: "Parallax and pinning are removed entirely, not shortened."
 *
 * That sentence is why this cannot be left to the blanket reduced-motion rule
 * in globals.css. It works by collapsing every duration to 0.01ms, and a
 * scroll-driven animation has no duration to collapse -- its progress is the
 * scroll position, so the parallax would survive the one rule written to stop
 * it. The declaration has to be inside a `no-preference` query instead, and
 * this is what proves it is.
 *
 * Both halves are measured, and the first is the one that matters most: under
 * ordinary motion the image must move between two scroll positions. Without
 * that clause a parallax that never ran at all -- an unsupported timeline, a
 * typo in a keyframe name -- would sail through the reduced-motion half by
 * being equally still in both.
 */
export async function checkParallax(
  page: Page,
  path: string,
): Promise<Finding[]> {
  const read = () =>
    page.evaluate(() => {
      const image = document.querySelector('[data-parallax]');
      if (image === null) return null;
      const style = getComputedStyle(image);
      return { translate: style.translate, animation: style.animationName };
    });

  const sample = async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    // Two frames: a scroll-driven animation is updated by the compositor, so
    // the computed value one tick after a programmatic scroll is still the
    // old one.
    await page.waitForTimeout(250);
    const top = await read();
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(250);
    const scrolled = await read();
    await page.evaluate(() => window.scrollTo(0, 0));
    return { top, scrolled };
  };

  const findings: Finding[] = [];

  await page.goto(path);
  const moving = await sample();

  if (moving.top === null || moving.scrolled === null) {
    return [
      {
        check: 'parallax',
        detail:
          `no [data-parallax] element on ${path}, so this check measured ` +
          `nothing. A reduced-motion assertion over an absent animation ` +
          `passes for the wrong reason.`,
      },
    ];
  }
  if (moving.top.translate === moving.scrolled.translate) {
    findings.push({
      check: 'parallax',
      detail:
        `the image layer reads translate ${moving.top.translate} at scroll 0 ` +
        `and at scroll 400. It is not moving at all, so the reduced-motion ` +
        `half below is asserting nothing.`,
    });
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    await page.goto(path);
    const still = await sample();
    if (still.top !== null && still.scrolled !== null) {
      if (still.top.translate !== still.scrolled.translate) {
        findings.push({
          check: 'parallax',
          detail:
            `under prefers-reduced-motion the image still travels: ` +
            `${still.top.translate} at scroll 0, ${still.scrolled.translate} ` +
            `at scroll 400. §8 removes parallax entirely, it does not shorten it.`,
        });
      }
      if (still.top.animation !== 'none') {
        findings.push({
          check: 'parallax',
          detail:
            `under prefers-reduced-motion the image still carries ` +
            `animation-name: ${still.top.animation}. A scroll-driven ` +
            `animation has no duration for the global reduce rule to collapse, ` +
            `so it has to be declared inside a no-preference query.`,
        });
      }
    }
  } finally {
    await page.emulateMedia({ reducedMotion: null });
    await page.goto(path);
  }

  return findings;
}

/**
 * DESIGN.md §7: "Real `alt`, explicit `width`/`height`, `--paper-dim`
 * placeholder. A layout shift is a bug."
 *
 * The attributes and the placeholder are read off the element; the shift is
 * measured, because the attributes are the usual way to avoid one and not a
 * proof of having avoided it. `layout-shift` entries are collected from before
 * the navigation, since the shift being guarded against happens at the moment
 * the image resolves and is over before any check could ask about it.
 */
const CLS_BUDGET = 0.01;

export async function checkImageStability(
  page: Page,
  path: string,
): Promise<Finding[]> {
  await page.addInitScript(() => {
    const store = window as unknown as { __shift?: number };
    store.__shift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        };
        if (!shift.hadRecentInput) {
          store.__shift = (store.__shift ?? 0) + shift.value;
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });

  await page.goto(path);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(500);

  const measured = await page.evaluate(() => {
    const image = document.querySelector('main img');
    if (image === null) return null;
    const frame = image.closest('[data-image-frame]');
    return {
      width: image.getAttribute('width'),
      height: image.getAttribute('height'),
      alt: image.getAttribute('alt'),
      placeholder:
        frame === null ? null : getComputedStyle(frame).backgroundColor,
      wanted: getComputedStyle(document.documentElement)
        .getPropertyValue('--paper-dim')
        .trim(),
      shift: (window as unknown as { __shift?: number }).__shift ?? 0,
    };
  });

  if (measured === null) {
    return [{ check: 'image', detail: `no <img> in <main> on ${path}` }];
  }

  const findings: Finding[] = [];
  if (measured.width === null || measured.height === null) {
    findings.push({
      check: 'image',
      detail:
        `the hero image has width="${measured.width}" height="${measured.height}". ` +
        `Both are required: the box has to exist before the bytes arrive.`,
    });
  }
  if ((measured.alt ?? '').trim().length < 10) {
    findings.push({
      check: 'image',
      detail: `the hero image's alt is "${measured.alt}", which is not a real description`,
    });
  }

  const asRgb = (hex: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (m === null) return hex;
    const n = parseInt(m[1], 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  };
  if (measured.placeholder === null) {
    findings.push({
      check: 'image',
      detail:
        'the hero image has no [data-image-frame] ancestor, so it has no ' +
        'placeholder to hold its box while it loads',
    });
  } else if (measured.placeholder !== asRgb(measured.wanted)) {
    findings.push({
      check: 'image',
      detail:
        `the image frame's background is ${measured.placeholder}, expected ` +
        `--paper-dim (${asRgb(measured.wanted)})`,
    });
  }

  if (measured.shift > CLS_BUDGET) {
    findings.push({
      check: 'image',
      detail:
        `${path} accumulated ${measured.shift.toFixed(4)} of layout shift on ` +
        `load (budget ${CLS_BUDGET}). Something is being sized after it arrives.`,
    });
  }

  return findings;
}
