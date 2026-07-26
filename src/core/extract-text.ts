import { inflateRawSync } from 'node:zlib';

/**
 * A CV file to plain text (PROJECT.md section 5, flow 1). Framework-free, so it
 * runs in a route handler, in a script, and in the unit suite unchanged.
 *
 * The unhappy path is the point. A CV arrives as a scan with no text layer, a
 * password-protected export, a file truncated in transfer, or something whose
 * extension is a lie. Every one of those has to end in a message the person can
 * act on, not a stack trace and not an empty profile.
 */

export type CvExtractionCode =
  | 'empty'
  | 'too_large'
  | 'unsupported_type'
  | 'legacy_or_encrypted_office'
  | 'encrypted_pdf'
  | 'corrupt'
  | 'no_text_layer';

export const MAX_CV_BYTES = 10 * 1024 * 1024;

/**
 * Below this, whatever came out is not a CV: a cover page, a scan whose only
 * text is a header, or a PDF holding nothing but images. Sending it to the
 * model would spend the user's tokens to produce an empty profile.
 */
const MIN_TEXT_CHARS = 200;

const MESSAGES: Record<CvExtractionCode, string> = {
  empty: 'That file is empty. Upload the CV itself, not a shortcut to it.',
  too_large: `That file is larger than ${MAX_CV_BYTES / 1024 / 1024} MB. A CV that big is usually a scan; export it from a word processor as a PDF instead.`,
  unsupported_type:
    'That file is not a PDF or a Word .docx, whatever its name says. Export the CV as one of those and upload it again.',
  legacy_or_encrypted_office:
    'That looks like an old .doc file, or a Word file with a password on it. Save it as .docx without a password, or export it as a PDF.',
  encrypted_pdf:
    'That PDF has a password on it. Open it, export an unprotected copy, and upload that.',
  corrupt:
    'That file claims to be a PDF or a .docx but cannot be read. It was probably truncated on the way here. Try uploading it again, or export a fresh copy.',
  no_text_layer:
    'No text could be read from that file. It is almost certainly a scan or a photo, which has no text layer for us to read. Upload a PDF exported from a word processor.',
};

/**
 * Carries a `code` as well as a message. Step 7 localises against the code;
 * until then the English message is what a developer and a script see.
 */
export class CvExtractionError extends Error {
  constructor(readonly code: CvExtractionCode) {
    super(MESSAGES[code]);
    this.name = 'CvExtractionError';
  }
}

/**
 * The format is decided by the file's own first bytes, never by its extension.
 * A `.pdf` that is really a JPEG has to fail as an unsupported type, not as a
 * corrupt PDF, because those two sentences send the person to different fixes.
 */
export async function extractCvText(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength === 0) {
    throw new CvExtractionError('empty');
  }
  // Checked before any parsing: the cheap guard has to run before the
  // expensive, attacker-influenced one.
  if (bytes.byteLength > MAX_CV_BYTES) {
    throw new CvExtractionError('too_large');
  }

  const text = normalise(
    isPdf(bytes)
      ? await pdfText(bytes)
      : isZip(bytes)
        ? docxText(bytes)
        : refuse(bytes),
  );

  if (countTextCharacters(text) < MIN_TEXT_CHARS) {
    throw new CvExtractionError('no_text_layer');
  }
  return text;
}

function refuse(bytes: Uint8Array): never {
  throw new CvExtractionError(
    isOleContainer(bytes) ? 'legacy_or_encrypted_office' : 'unsupported_type',
  );
}

/**
 * The header is allowed to sit after leading bytes rather than at offset zero,
 * and readers accept that, so a strict prefix check would reject files every
 * other tool opens.
 */
function isPdf(bytes: Uint8Array): boolean {
  return latin1(bytes.subarray(0, 1024)).includes('%PDF-');
}

/** A local file header, so an empty archive (`PK\x05\x06`) is not a docx. */
function isZip(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
}

/**
 * Both a legacy `.doc` and a password-protected `.docx` are OLE compound files:
 * Office encrypts the whole zip and wraps it, so an encrypted `.docx` never
 * looks like a zip.
 */
function isOleContainer(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  // Imported here rather than at the top of the file: unpdf carries a build of
  // pdf.js, and a docx upload should not pay to load it.
  const { extractText, getDocumentProxy } = await import('unpdf');

  try {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } catch (error) {
    // pdf.js signals a missing password by exception name. Everything else that
    // fails after a valid header is a file we cannot read.
    throw new CvExtractionError(
      error instanceof Error && error.name === 'PasswordException'
        ? 'encrypted_pdf'
        : 'corrupt',
    );
  }
}

// --- docx ---------------------------------------------------------------
//
// A .docx is a zip holding `word/document.xml`. Reading one entry out of a zip
// is `node:zlib` plus the archive's own index, so there is no library here.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const EOCD_MIN_LENGTH = 22;
const MAX_ZIP_COMMENT = 0xffff;
const ENCRYPTED_FLAG = 0x1;
const STORED = 0;
const DEFLATED = 8;
const DOCUMENT_ENTRY = 'word/document.xml';

function docxText(bytes: Uint8Array): string {
  return toPlainText(readDocumentXml(bytes));
}

function readDocumentXml(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let entry;
  try {
    entry = findEntry(bytes, view, DOCUMENT_ENTRY);
  } catch {
    throw new CvExtractionError('corrupt');
  }

  if (entry === undefined) {
    // A zip with no `word/document.xml` is some other zip: an .odt, an .epub, a
    // folder someone compressed. Not a corrupt docx.
    throw new CvExtractionError('unsupported_type');
  }
  if ((entry.flags & ENCRYPTED_FLAG) !== 0) {
    throw new CvExtractionError('legacy_or_encrypted_office');
  }

  try {
    return new TextDecoder().decode(inflate(bytes, view, entry));
  } catch {
    throw new CvExtractionError('corrupt');
  }
}

interface ZipEntry {
  flags: number;
  method: number;
  compressedSize: number;
  localOffset: number;
}

/**
 * Read through the central directory, not by scanning for local headers. A zip
 * written as a stream sets a flag and leaves the sizes in a descriptor after
 * the data, so the local header's sizes can be zero and only the directory is
 * reliable.
 *
 * ponytail: no zip64. The 10 MB cap in `extractCvText` fires long before an
 * archive needs 64-bit offsets, and a zip64 record fails as `corrupt` rather
 * than silently reading the wrong bytes.
 */
function findEntry(
  bytes: Uint8Array,
  view: DataView,
  name: string,
): ZipEntry | undefined {
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== CENTRAL_HEADER_SIGNATURE) {
      throw new Error('central directory header not found');
    }

    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const entryName = latin1(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength),
    );

    if (entryName === name) {
      return {
        flags: view.getUint16(cursor + 8, true),
        method: view.getUint16(cursor + 10, true),
        compressedSize: view.getUint32(cursor + 20, true),
        localOffset: view.getUint32(cursor + 42, true),
      };
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return undefined;
}

function findEndOfCentralDirectory(view: DataView): number {
  const earliest = Math.max(
    0,
    view.byteLength - EOCD_MIN_LENGTH - MAX_ZIP_COMMENT,
  );

  for (
    let offset = view.byteLength - EOCD_MIN_LENGTH;
    offset >= earliest;
    offset -= 1
  ) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      return offset;
    }
  }

  throw new Error('end of central directory not found');
}

function inflate(
  bytes: Uint8Array,
  view: DataView,
  entry: ZipEntry,
): Uint8Array {
  if (view.getUint32(entry.localOffset, true) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error('local file header not found');
  }

  // The local header's extra field is free to differ in length from the
  // directory's, so the data offset is computed from the local header alone.
  const start =
    entry.localOffset +
    30 +
    view.getUint16(entry.localOffset + 26, true) +
    view.getUint16(entry.localOffset + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);

  if (entry.method === STORED) {
    return data;
  }
  if (entry.method === DEFLATED) {
    return inflateRawSync(data);
  }
  throw new Error(`unsupported compression method ${entry.method}`);
}

/**
 * WordprocessingML to text. Paragraphs and breaks become newlines, tabs become
 * tabs, every other tag is markup we do not need. A CV's meaning survives this;
 * its formatting does not, and the model is given text, not a layout.
 */
function toPlainText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<w:tab\b[^>]*>/g, '\t')
      .replace(/<w:(?:br|cr)\b[^>]*>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]*>/g, ''),
  );
}

/** `&amp;` last, so `&amp;lt;` stays `&lt;` instead of collapsing to `<`. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&amp;/g, '&');
}

// --- shared -------------------------------------------------------------

function latin1(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function countTextCharacters(text: string): number {
  return text.replace(/\s/g, '').length;
}
