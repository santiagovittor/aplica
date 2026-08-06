import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The defect this pins, in full, because it cost a day and left no trace.
 *
 * `CvUpload` and `ApplyForm` each track whether they are still on screen, so a
 * stream event that arrives after the reader has navigated away is dropped
 * rather than setting state on a component that is gone. The flag was written
 * as a ref initialised to `true` and an effect that only tore down:
 *
 *     const mounted = useRef(true);
 *     useEffect(() => () => { mounted.current = false; }, []);
 *
 * `useRef(true)` runs once per component instance. An effect's teardown runs
 * every time that effect is torn down. React's StrictMode -- on in `next dev`,
 * off in a production build -- deliberately mounts, tears down and remounts
 * every effect once, and nothing in the shape above puts the flag back. So in
 * development the flag was already `false` before the user clicked anything,
 * every `if (mounted.current)` guard became a silent no-op, and a run's worth
 * of SSE events was read off the wire and discarded. The screen sat on its
 * first step for as long as anyone was willing to wait, no error, no timeout,
 * while the server finished the parse and saved the profile.
 *
 * Nothing caught it: the unit suite has no DOM, and `e2e/apply.spec.ts` drives
 * `next start`, the one mode where StrictMode is off. This test is the cheap
 * gate that would have. It reads source rather than behaviour on purpose --
 * the defect is a shape, it is written down in the file, and a static
 * assertion cannot race the machine the way a rendered one would.
 */

const CLIENT_DIRS = ['app', 'ui'];

/** `useEffect(() => () => {...}, [])` -- an effect that is nothing but its own
 *  teardown, which is the shape that cannot restore what it clears. */
const TEARDOWN_ONLY_EFFECT = /useEffect\(\s*\(\s*\)\s*=>\s*\(\s*\)\s*=>/;

async function tsxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return tsxFiles(path);
      }
      return entry.name.endsWith('.tsx') ? [path] : [];
    }),
  );
  return found.flat();
}

describe('a mount flag', () => {
  it('is never restored only by an effect that does nothing but tear down', async () => {
    const src = join(fileURLToPath(new URL('..', import.meta.url)));
    const files = (
      await Promise.all(CLIENT_DIRS.map((dir) => tsxFiles(join(src, dir))))
    ).flat();

    // A guard on the guard: a glob that quietly matches nothing would make
    // this test pass forever without reading a line of the code it protects.
    expect(files.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (TEARDOWN_ONLY_EFFECT.test(source)) {
        offenders.push(relative(src, file).replaceAll('\\', '/'));
      }
    }

    expect(offenders).toEqual([]);
  });
});
