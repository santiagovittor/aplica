import { createElement as h, type ReactElement } from 'react';
import {
  Document,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import type { Block, Span } from './markdown';

/**
 * The blocks of a parsed document as a PDF (SLICE-7 decision 2).
 *
 * **Standard PDF fonts only, and no `Font.register` anywhere in this file.**
 * ATS safety outranks brand for a file that leaves the product, and an embedded
 * display font is the single most likely thing to make text unextractable.
 * DESIGN.md governs the app's own UI; it does not govern the document the
 * applicant sends, and the round-trip gate in `render.test.ts` is what proves
 * the difference.
 *
 * **No JSX, `pdf.ts` rather than `pdf.tsx`.** `scripts/apply.mts` runs on Node's
 * own type stripping, which does not transform JSX, so a `.tsx` here would mean
 * a third dependency (a JSX-capable loader) for the script to import the
 * renderer at all. The templates are a `map` over blocks rather than
 * hand-written markup, which is where `createElement` costs least.
 *
 * One page geometry for both documents. A resume and a letter from the same
 * person should look like they came from the same desk, and the only real
 * difference between them is that a letter is paragraphs.
 */

const PAGE_SIZE = 'LETTER';
const MARGIN = 54; // 0.75in, what a word processor gives a resume by default.
const BODY = 10;
const LINE_HEIGHT = 1.45;
const BULLET_INDENT = 12;

const styles = StyleSheet.create({
  page: {
    paddingVertical: MARGIN,
    paddingHorizontal: MARGIN,
    fontFamily: 'Helvetica',
    fontSize: BODY,
    lineHeight: LINE_HEIGHT,
    color: '#111111',
  },
  h1: { fontSize: 19, fontWeight: 'bold', marginBottom: 6 },
  h2: { fontSize: 12, fontWeight: 'bold', marginTop: 14, marginBottom: 4 },
  h3: { fontSize: 10.5, fontWeight: 'bold', marginTop: 8, marginBottom: 2 },
  paragraph: { marginBottom: 6 },
  bulletRow: { flexDirection: 'row', marginBottom: 2 },
  bulletMark: { width: BULLET_INDENT },
  bulletText: { flex: 1 },
  bold: { fontWeight: 'bold' },
  link: { color: '#111111', textDecoration: 'underline' },
});

/** Returns the PDF's bytes. Pure: nothing is written and nothing is fetched. */
export async function renderPdf(
  blocks: Block[],
  meta: { title: string; author: string },
): Promise<Uint8Array> {
  const buffer = await renderToBuffer(
    h(
      Document,
      { title: meta.title, author: meta.author, creator: 'Aplica' },
      h(
        Page,
        { size: PAGE_SIZE, style: styles.page },
        ...blocks.map((block, index) => blockElement(block, index)),
      ),
    ),
  );

  // A copy, for the same reason `saveProfile` copies before an upload: a Buffer
  // is a view over a pooled ArrayBuffer, and handing that view onward makes
  // `.buffer` mean something other than these bytes.
  return new Uint8Array(buffer);
}

function blockElement(block: Block, index: number): ReactElement {
  const key = String(index);

  if (block.kind === 'bullet') {
    // No list primitive in react-pdf, so the marker is a fixed-width column.
    // A hanging indent is what makes a wrapped bullet read as one bullet.
    return h(
      View,
      { key, style: styles.bulletRow },
      h(Text, { style: styles.bulletMark }, '•'),
      h(Text, { style: styles.bulletText }, ...spanElements(block.spans)),
    );
  }

  return h(
    Text,
    { key, style: styles[block.kind] },
    ...spanElements(block.spans),
  );
}

/**
 * Nested `Text` rather than one string per span, so bold sits inside the
 * paragraph's own line breaking instead of starting a new line.
 */
function spanElements(spans: Span[]): ReactElement[] {
  return spans.map((span, index) => {
    const key = String(index);

    if (span.href !== undefined) {
      return h(Link, { key, src: span.href, style: styles.link }, span.text);
    }
    return h(
      Text,
      span.bold ? { key, style: styles.bold } : { key },
      span.text,
    );
  });
}
