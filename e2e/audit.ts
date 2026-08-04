import type { Page } from '@playwright/test';

/**
 * SLICE-23 §1 and §6: the acceptance checks, run in the page against
 * `getComputedStyle` and `getBoundingClientRect` rather than asserted from
 * source. DESIGN.md §10's own preamble is the rule this exists to honour --
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
 * §6.2: on every route at 1440x900 with minimum content, the footer's bottom
 * is within 2px of viewport height. Only meaningful when the page does not
 * scroll -- a long page's footer is at the document bottom by definition, and
 * asserting otherwise would be asserting that no page may be taller than the
 * screen.
 */
export async function checkFooter(page: Page): Promise<Finding[]> {
  const result = await page.evaluate(() => {
    const footer = document.querySelector('footer');
    if (footer === null) {
      return null;
    }
    return {
      bottom: footer.getBoundingClientRect().bottom,
      viewport: window.innerHeight,
      scrollable:
        document.documentElement.scrollHeight > window.innerHeight + 2,
    };
  });

  if (result === null) {
    return [{ check: 'footer', detail: 'no <footer> on the page' }];
  }
  if (result.scrollable) {
    return [];
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

    const groundOf = (element: Element): [number, number, number] => {
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

      const bg = groundOf(element);
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
 */
export async function checkMotif(page: Page): Promise<Finding[]> {
  return page.evaluate(() => {
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
