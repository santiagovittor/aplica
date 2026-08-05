import { Fragment } from 'react';
import { parseMarkdown, type Block, type Span } from '@/render/markdown';
import styles from './PaperFragment.module.css';

/**
 * A cropped corner of a real generated document, as paper (DESIGN.md §7: "a
 * paper fragment beats a screenshot. Show a cropped corner of the real CV or
 * cover letter: the product's proof is a document, so put a document on
 * screen").
 *
 * **The same parser the downloads run through.** `parseMarkdown` is what
 * `src/render`'s PDF and docx templates read, so what is on screen here and
 * what lands in the applicant's downloads folder come from one reading of one
 * string. A second, screen-only markdown renderer would be a copy free to
 * drift, and the drift would be invisible: nobody compares a landing page to a
 * PDF.
 *
 * **Document headings are not page headings.** `# Jordan Ellis` is the name at
 * the top of a resume, not a level-one heading in this page's outline, so
 * every block renders as a styled paragraph. Rendering them as real `h1`/`h2`
 * would put a second document's structure inside the landing's own and hand
 * every heading Fraunces and --letterpress from globals.css, which is the one
 * thing a Helvetica-set resume must not look like.
 *
 * **A link renders as its text, never as an anchor.** This is a specimen of a
 * document rather than a copy of it that works; an `<a>` here would be a
 * control a reader can tab to and click in a picture, and DESIGN.md §11 item 7
 * would rightly demand a hover state for it. The measured documents carry no
 * link in the cropped region in any case (`markdown.ts` counts what real runs
 * emit), so this costs no text.
 *
 * Where the crop falls is the stylesheet's: the whole document is passed in and
 * the frame cuts it at the tile's own edge.
 */
export function PaperFragment({
  markdown,
  caption,
}: {
  markdown: string;
  /** What the fragment is, for a reader who is not looking at it. */
  caption: string;
}) {
  const { blocks } = parseMarkdown(markdown);

  return (
    <figure className={styles.frame}>
      <div className={styles.sheet}>
        {group(blocks).map((run, index) =>
          run[0].kind === 'bullet' ? (
            <ul key={index} className={styles.list}>
              {run.map((block, item) => (
                <li key={item} className={styles.item}>
                  {text(block.spans)}
                </li>
              ))}
            </ul>
          ) : (
            <p key={index} className={styles[run[0].kind]}>
              {text(run[0].spans)}
            </p>
          ),
        )}
      </div>
      <figcaption className="visually-hidden">{caption}</figcaption>
    </figure>
  );
}

/**
 * Consecutive bullets into one run, everything else alone.
 *
 * `parseMarkdown` returns a flat list, because a PDF and a docx both want it
 * flat: neither has a list primitive, and both draw the marker themselves. HTML
 * does have one, and five `<li>` outside a `<ul>` is a list a screen reader
 * cannot count.
 */
function group(blocks: Block[]): Block[][] {
  const runs: Block[][] = [];
  for (const block of blocks) {
    const open = runs.at(-1);
    if (block.kind === 'bullet' && open?.[0].kind === 'bullet') {
      open.push(block);
    } else {
      runs.push([block]);
    }
  }
  return runs;
}

function text(spans: Span[]) {
  return spans.map((span, index) =>
    span.bold ? (
      <strong key={index}>{span.text}</strong>
    ) : (
      <Fragment key={index}>{span.text}</Fragment>
    ),
  );
}
