import { afterEach, describe, expect, it } from 'vitest';
import {
  CV_LINES,
  cvExtractionFixtures,
  document,
  docx,
  pdf,
  textStream,
  zip,
} from './cv-fixtures';
import { CvExtractionError, MAX_CV_BYTES, extractCvText } from './extract-text';

// Fixtures moved to cv-fixtures.ts: app/api/cv/route.test.ts needs the exact
// same PDF and zip builders, and two copies of a PDF-object-model builder is
// how one of them quietly stops matching what extractCvText actually does.

/** The code an extraction failed with, or the text if it did not fail. */
async function outcome(bytes: Uint8Array): Promise<string> {
  try {
    return (await extractCvText(bytes)).text;
  } catch (error) {
    if (error instanceof CvExtractionError) {
      return error.code;
    }
    throw error;
  }
}

describe('extractCvText reads', () => {
  it('a PDF', async () => {
    const { text } = await extractCvText(pdf(textStream(CV_LINES)));

    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('Cut the month-end close from three days to one');
    expect(text).toContain('SQL, Python, PostgreSQL, dbt');
  });

  it('a docx', async () => {
    const { text } = await extractCvText(docx(CV_LINES));

    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('Ran the on-call rotation for the payments service');
  });

  it("a PDF's page count", async () => {
    const { pages } = await extractCvText(pdf(textStream(CV_LINES)));
    expect(pages).toBe(1);
  });

  it('no page count for a docx', async () => {
    const { pages } = await extractCvText(docx(CV_LINES));
    expect(pages).toBeUndefined();
  });

  it('a PDF handed over as a Buffer', async () => {
    // pdf.js refuses a Node Buffer by name, and a file read off disk is one, so
    // without normalising it every real upload would fail as corrupt.
    const buffer = Buffer.from(pdf(textStream(CV_LINES)));
    expect((await extractCvText(buffer)).text).toContain('Ada Lovelace');
  });

  it('a docx handed over as a Buffer', async () => {
    expect((await extractCvText(Buffer.from(docx(CV_LINES)))).text).toContain(
      'Ada Lovelace',
    );
  });

  it('a docx whose entry is stored rather than deflated', async () => {
    expect((await extractCvText(docx(CV_LINES, true))).text).toContain(
      'Ada Lovelace',
    );
  });

  it('a docx as one line per paragraph', async () => {
    const { text } = await extractCvText(docx(CV_LINES));
    expect(text.split('\n')).toEqual(CV_LINES);
  });

  it('tabs, breaks and escaped characters in a docx', async () => {
    const xml = document([
      'Tools:<w:tab/>SQL &amp; Python',
      'Ada Lovelace<w:br/>Operations analyst',
      `${'Padding to clear the minimum length. '.repeat(6)}`,
    ]);
    const bytes = zip([{ name: 'word/document.xml', content: xml }]);

    const { text } = await extractCvText(bytes);
    expect(text).toContain('Tools:\tSQL & Python');
    expect(text).toContain('Ada Lovelace\nOperations analyst');
  });
});

// pdf.js calls Math.sumPrecise, which V8 has not shipped. Measured out of
// process: without the polyfill a real CV produces six warnings and the same
// bytes of text, so the polyfill is about pdf.js's font path, not about text.
describe('the Math.sumPrecise polyfill', () => {
  const math = Math as { sumPrecise?: (values: Iterable<number>) => number };
  const original = math.sumPrecise;

  afterEach(() => {
    if (original === undefined) {
      delete math.sumPrecise;
    } else {
      math.sumPrecise = original;
    }
  });

  it('is installed by an extraction, and sums', async () => {
    delete math.sumPrecise;

    expect((await extractCvText(pdf(textStream(CV_LINES)))).text).toContain(
      'Ada Lovelace',
    );
    const installed = Reflect.get(Math, 'sumPrecise') as
      ((values: Iterable<number>) => number) | undefined;
    expect(typeof installed).toBe('function');
    expect(installed?.([0.1, 0.2, 0.3])).toBeCloseTo(0.6);
  });

  it('never replaces an implementation that already exists', async () => {
    // The day V8 ships it, the real one has to win.
    const native = () => 42;
    math.sumPrecise = native;

    await extractCvText(pdf(textStream(CV_LINES)));
    expect(math.sumPrecise).toBe(native);
  });
});

describe('extractCvText refuses', () => {
  const cases: Record<string, () => Uint8Array> = {
    'an empty file': () => new Uint8Array(0),

    'a file over the size cap': () => {
      const oversized = new Uint8Array(MAX_CV_BYTES + 1);
      oversized.set(new TextEncoder().encode('%PDF-1.4'));
      return oversized;
    },

    // The extension is never consulted, so a JPEG named cv.pdf is caught by its
    // own first bytes rather than by failing to parse as a PDF.
    'a JPEG wearing a PDF name': () =>
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),

    'plain text': () => new TextEncoder().encode(CV_LINES.join('\n')),

    'a zip that is not a docx': () =>
      zip([{ name: 'notes.txt', content: CV_LINES.join('\n') }]),
  };

  for (const [name, build] of Object.entries(cases)) {
    it(`${name}`, async () => {
      await expect(extractCvText(build())).rejects.toBeInstanceOf(
        CvExtractionError,
      );
    });
  }

  it('an empty file with the right code', async () => {
    expect(await outcome(new Uint8Array(0))).toBe('empty');
  });

  it('an oversized file before it parses anything', async () => {
    expect(await outcome(new Uint8Array(MAX_CV_BYTES + 1))).toBe('too_large');
  });

  it('an unrecognised format', async () => {
    expect(await outcome(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'unsupported_type',
    );
  });

  it('a zip with no word/document.xml', async () => {
    const bytes = zip([{ name: 'mimetype', content: 'application/epub+zip' }]);
    expect(await outcome(bytes)).toBe('unsupported_type');
  });

  it('a legacy .doc or a password-protected Word file', async () => {
    // The OLE compound-file signature. Word wraps an encrypted .docx in one of
    // these, so an encrypted docx never looks like a zip.
    const ole = new Uint8Array([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00,
    ]);
    expect(await outcome(ole)).toBe('legacy_or_encrypted_office');
  });

  it('a zip whose entry is encrypted', async () => {
    const bytes = zip([
      {
        name: 'word/document.xml',
        content: document(CV_LINES),
        encrypted: true,
      },
    ]);
    expect(await outcome(bytes)).toBe('legacy_or_encrypted_office');
  });

  it('a password-protected PDF', async () => {
    // A standard security handler whose stored hashes match no password, which
    // is what a reader sees before the person types one in.
    const hash = `<${'01'.repeat(32)}>`;
    const encryption = `<</Filter/Standard/V 2/R 3/Length 128/P -1/O ${hash}/U ${hash}>>`;

    expect(await outcome(pdf(textStream(CV_LINES), encryption))).toBe(
      'encrypted_pdf',
    );
  });

  it('a truncated PDF', async () => {
    const good = pdf(textStream(CV_LINES));
    expect(await outcome(good.subarray(0, Math.floor(good.length / 2)))).toBe(
      'corrupt',
    );
  });

  it('a truncated docx', async () => {
    const good = docx(CV_LINES);
    expect(await outcome(good.subarray(0, good.length - 30))).toBe('corrupt');
  });

  it('a docx whose entry data is garbage', async () => {
    const name = 'word/document.xml';
    const bytes = zip([{ name, content: document(CV_LINES) }]);
    // The compressed data starts right after the local header and the name.
    // 0xff opens a deflate block with the reserved type, so this is corrupt
    // rather than merely wrong, and it cannot decode to plausible text.
    bytes.fill(0xff, 30 + name.length, 30 + name.length + 16);

    expect(await outcome(bytes)).toBe('corrupt');
  });

  it('a scan with no text layer', async () => {
    // A valid one-page PDF that draws a filled rectangle and no text at all.
    expect(await outcome(pdf('0 0 0 rg 72 72 468 648 re f'))).toBe(
      'no_text_layer',
    );
  });

  it('a docx with almost nothing in it', async () => {
    expect(await outcome(docx(['Ada Lovelace']))).toBe('no_text_layer');
  });
});

describe('every failure message', () => {
  const bytes = cvExtractionFixtures();

  for (const [code, input] of Object.entries(bytes)) {
    it(`for ${code} tells the person what to do`, async () => {
      let thrown: unknown;
      try {
        await extractCvText(input);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(CvExtractionError);
      const error = thrown as CvExtractionError;
      expect(error.code).toBe(code);
      // Two sentences at least: what happened, and the way out of it.
      expect(error.message.split('. ').length).toBeGreaterThan(1);
    });
  }
});
