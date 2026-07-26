import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CvExtractionError, MAX_CV_BYTES, extractCvText } from './extract-text';

// Fixtures are built here rather than checked in as binaries. A hand-assembled
// PDF and zip keep the diff readable, let a corrupt case be one mutation away
// from a good one, and make the scanned-CV case honest: a structurally valid
// PDF that genuinely has no text in it.

const CV_LINES = [
  'Ada Lovelace',
  'Operations analyst, Cooperativa del Sur, 2022 to 2025',
  'Cut the month-end close from three days to one by scripting the export.',
  'Rebuilt the billing reconciliation so two ledgers stopped disagreeing.',
  'Ran the on-call rotation for the payments service for two years.',
  'Tools: SQL, Python, PostgreSQL, dbt.',
];

// --- PDF ----------------------------------------------------------------

/** A one-page PDF with a real cross-reference table, built object by object. */
function pdf(contentStream: string, encryption?: string): Uint8Array {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    `<</Length ${contentStream.length}>>\nstream\n${contentStream}\nendstream`,
  ];
  if (encryption !== undefined) {
    objects.push(encryption);
  }

  const offsets: number[] = [];
  let body = '%PDF-1.4\n';
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const startxref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }

  const id = '<0123456789abcdef0123456789abcdef>';
  body += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R/ID[${id}${id}]`;
  body += encryption === undefined ? '' : `/Encrypt ${objects.length} 0 R`;
  body += `>>\nstartxref\n${startxref}\n%%EOF\n`;

  return new TextEncoder().encode(body);
}

function textStream(lines: string[]): string {
  return lines
    .map(
      (line, index) => `BT /F1 11 Tf 72 ${720 - index * 16} Td (${line}) Tj ET`,
    )
    .join('\n');
}

// --- docx ---------------------------------------------------------------

interface ZipEntry {
  name: string;
  content: string;
  stored?: boolean;
  encrypted?: boolean;
}

// Eight lines beats depending on `zlib.crc32`, which the pinned @types/node
// does not declare. A fixture with a wrong checksum is not a real docx.
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const raw = encoder.encode(entry.content);
    const data = entry.stored === true ? raw : deflateRawSync(raw);
    const method = entry.stored === true ? 0 : 8;
    const flags = entry.encrypted === true ? 1 : 0;
    const sum = crc32(raw);

    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, flags, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, sum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, raw.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, flags, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, sum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, raw.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const directorySize = centrals.reduce(
    (total, part) => total + part.length,
    0,
  );
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);

  return concat([...locals, ...centrals, end]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function document(paragraphs: string[]): string {
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

function docx(paragraphs: string[], stored = false): Uint8Array {
  return zip([
    { name: '[Content_Types].xml', content: '<Types/>' },
    { name: 'word/document.xml', content: document(paragraphs), stored },
  ]);
}

/** The code an extraction failed with, or the text if it did not fail. */
async function outcome(bytes: Uint8Array): Promise<string> {
  try {
    return await extractCvText(bytes);
  } catch (error) {
    if (error instanceof CvExtractionError) {
      return error.code;
    }
    throw error;
  }
}

describe('extractCvText reads', () => {
  it('a PDF', async () => {
    const text = await extractCvText(pdf(textStream(CV_LINES)));

    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('Cut the month-end close from three days to one');
    expect(text).toContain('SQL, Python, PostgreSQL, dbt');
  });

  it('a docx', async () => {
    const text = await extractCvText(docx(CV_LINES));

    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('Ran the on-call rotation for the payments service');
  });

  it('a docx whose entry is stored rather than deflated', async () => {
    expect(await extractCvText(docx(CV_LINES, true))).toContain('Ada Lovelace');
  });

  it('a docx as one line per paragraph', async () => {
    const text = await extractCvText(docx(CV_LINES));
    expect(text.split('\n')).toEqual(CV_LINES);
  });

  it('tabs, breaks and escaped characters in a docx', async () => {
    const xml = document([
      'Tools:<w:tab/>SQL &amp; Python',
      'Ada Lovelace<w:br/>Operations analyst',
      `${'Padding to clear the minimum length. '.repeat(6)}`,
    ]);
    const bytes = zip([{ name: 'word/document.xml', content: xml }]);

    const text = await extractCvText(bytes);
    expect(text).toContain('Tools:\tSQL & Python');
    expect(text).toContain('Ada Lovelace\nOperations analyst');
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
  const bytes: Record<string, Uint8Array> = {
    empty: new Uint8Array(0),
    too_large: new Uint8Array(MAX_CV_BYTES + 1),
    unsupported_type: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    legacy_or_encrypted_office: new Uint8Array([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]),
    encrypted_pdf: pdf(
      textStream(CV_LINES),
      `<</Filter/Standard/V 2/R 3/Length 128/P -1/O <${'01'.repeat(32)}>/U <${'01'.repeat(32)}>>>`,
    ),
    corrupt: pdf(textStream(CV_LINES)).subarray(0, 120),
    no_text_layer: pdf('0 0 0 rg 72 72 468 648 re f'),
  };

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
