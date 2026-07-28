# Rendering an application

Flow 3 of PROJECT.md section 5: an approved `Application` becomes the PDF and
DOCX files an applicant actually sends, and an `applications` row that indexes
them.

`src/render/` is a seam, the same shape as `src/providers/`. It reads types from
`core` and `core` reads nothing from it, which is how React stays out of a
framework-free `core` (CLAUDE.md section 3).

## The markdown subset, measured

Three real runs of the apply flow at step 6, both documents each, counted rather
than assumed:

| construct               | resume (runs 7 / 8 / 9)    | cover letter |
| ----------------------- | -------------------------- | ------------ |
| `#` h1                  | 1 / 1 / 1                  | 0            |
| `##` h2                 | 1 / 0 / 4                  | 0            |
| `###` h3                | 4 / 5 / 3                  | 0            |
| `-` bullet              | 18 / 17 / 13               | 0            |
| paragraph               | 7 / 5 / 5                  | 4 to 5       |
| `**bold**` (delimiters) | 22 / 22 / 14               | 0            |
| link `[]()`             | 0 / 2 / 0                  | 0            |
| table, code, `>`, `1.`  | 0 across all six documents |              |

So `src/render/markdown.ts` supports exactly h1, h2, h3, bullet, paragraph, bold
and link. A markdown library plus an AST walk plus a mapping layer to two
renderers is more code than the constructs that appear, and every construct it
would add is one nobody has seen the model emit.

A resume is around 2,300 characters and a letter around 1,000, so both fit one
page and pagination is not a problem this step had to solve.

**Anything outside the subset renders as its literal text and is reported, not
thrown.** Throwing after a generation has been paid for costs the user their
tokens twice. A `RenderFinding` carries the line number, the construct and a
truncated snippet; the day a table appears in a real run, the run says so
instead of quietly printing `| --- |`.

Two deliberate silences, both in `markdown.ts`:

- a nested bullet loses its indent and renders flat. No text is lost, no run has
  produced one, and reporting it would be noise.
- an unmatched `**` stays literal text. It is inside the subset, just badly
  written, and the reader sees what the model wrote.

## Fonts

Standard PDF fonts (Helvetica), and **no `Font.register` call anywhere in
`src/render/`**. In the DOCX, Arial: Word on Windows has no Helvetica and
substitutes silently, so naming Arial names what the recruiter actually sees.

ATS safety outranks brand for a file that leaves the product, and an embedded
display font is the single most likely thing to make text unextractable.
DESIGN.md governs the app's own UI. It does not govern the document the
applicant sends.

## The round trip

The headline verification, in `src/render/render.test.ts`:

```
Application (JSON, already gated)
  -> render                    -> PDF bytes / DOCX bytes
  -> extractCvText(bytes)      -> text
  -> findEmDashes, findBannedWords, groundDraft(text, { profile, posting, name })
```

Step 6's gate proves the _JSON_ is clean. The artefact the applicant sends is a
file, and nothing else in the repo proves the file says what the JSON said.
Three failures this catches that the JSON gate structurally cannot:

- **Unextractable text.** A document whose text is images, or a broken font
  embed. `extractCvText` already throws `no_text_layer` below 200 characters,
  so this fails as a test rather than as a rejected application.
- **Text the renderer invented or dropped.** A template printing a hard-coded
  "References available on request" adds an ungrounded claim to a document that
  was clean as JSON.
- **Slop the renderer introduced.** A layout that joins two lines with an em
  dash fails the product's soul test after passing it.

`extract-text.ts` is reused rather than copied. Its error codes and its
`MAX_CV_BYTES` cap were written for what a user uploads, and reading our own
output back through them is a slightly odd fit; a second extractor that could
disagree with the first would be worse.

One test asserts the gate can **fail**, not only that it passes: a line
supported by neither profile nor posting reaches the PDF and is reported. A gate
that has never been seen to fire is not known to work.

### The bullet character, and why `withoutLayoutMarks` exists

Measured, and the reason the gate is run over normalised text.

react-pdf has no list primitive, so a bullet is a `•` drawn in a fixed-width
column. `entitiesIn` in `src/core/grounding.ts` blanks leading markdown
furniture (`/^[\s>#*_+-]+/gm`) so a bullet's first word stays line-initial and
is not read as a capitalised entity. **`•` is not in that class.** So a resume
bullet reading "Rebuilt the month-end export" comes back out of the PDF with
`Rebuilt` reported as an invention, while the same application rendered as DOCX
reports nothing, because the DOCX marker lives in the numbering part rather
than in the text.

A gate whose answer depends on the file format is measuring layout, not claims.
`withoutLayoutMarks` takes the mark back off before the gate runs, and a test
pins both halves of the asymmetry so it cannot come back silently.

The renderer added the mark, so the renderer takes it off. Adding `•` to that
character class in `core` would fix this **and** a latent case in step 6 (a
model that writes `• ` in its markdown hits the same false positive today), but
it is a change to the product's soul gate that nobody has authorised. It is
recorded here rather than made.

**Hyphenation is not active.** react-pdf ships a hyphenation callback, and a
banned word split as `spearhead-\ned` would walk straight through
`findBannedWords`: a clean gate on a slopped document. Measured on a paragraph
long enough to wrap: no `-\n` appears and `spearheaded` is still found. A test
pins it, so the day a version turns it on the suite says so rather than the
gate going quiet.

PDF bytes are not deterministic (react-pdf stamps a creation date), so nothing
snapshots bytes. The assertions are about the extracted text, which is the thing
that matters anyway.

### What it has been proved against, and what it has not

- **Proved:** the fixture pair in `src/core/fixtures.ts`, at all three tiers,
  both formats. Every block of markdown survives into the extracted text, the
  slop gate is clean on the way back out, and `groundDraft` reports nothing.
- **Not yet proved:** a real generation. The three measured runs above went to
  stdout during step 6 and were never written into the repo, so the fixture
  documents are representative of their shape rather than copies of them.
- **Not proved by any test:** that Word opens the DOCX. `extract-text.ts` reads
  the archive with `node:zlib` and the OOXML with a regex, which proves the
  bytes are a readable zip holding the right text, not that Word accepts them.

The fixture posting and profile live in `src/core/fixtures.ts` rather than in a
test file, because two test files cannot import each other without running each
other's suites, and two fixture profiles drifting apart is how a gate starts
passing for the wrong reason.

## Tier to files

PROJECT.md section 9, written out because this is the thing that gets
miscounted:

| tier     | files | which                                                        |
| -------- | ----- | ------------------------------------------------------------ |
| basic    | 1     | resume.pdf                                                   |
| standard | 2     | resume.pdf, cover-letter.pdf                                 |
| full     | 4     | resume.pdf, cover-letter.pdf, resume.docx, cover-letter.docx |

`applicationSchema.coverLetter` is `null` on basic and a string otherwise, so a
basic application carrying a cover letter, or a standard one missing it, is a
bug in the pipeline and `renderApplication` throws rather than papering over it.
Nothing has been generated at that point, so nothing is paid for twice.

## Filenames and object keys

They are not the same string, on purpose.

The **filename** is what lands in a recruiter's downloads folder, so it is
chosen: `Santiago Vittor - Resume - Wilson Sonsini.pdf`, falling back to
`Santiago Vittor - Resume.pdf` when no company is supplied. Hyphens, never an em
dash, which the product bans. `resume(1).pdf` is out.

The **object key** is `<user_id>/<application_id>/<kind>.<format>`. A key built
from the display filename would move every time somebody typed the company
differently.

`name` comes from the caller, for the same reason it does in step 6:
`profileSchema` has no name field, and deriving one would be inventing it.
`company` and `role` are caller-supplied too (`--company`, `--role`), because
`applicationSchema` has neither and the alternative was a prompt change this
step was fenced off from.

## Storage

`saveApplication` mints the application id in TypeScript with
`crypto.randomUUID()` and passes it as an explicit `id` on the insert. The
object key contains it, so waiting for `gen_random_uuid()` would mean insert,
read back, upload, update: three round trips and a half-written row whenever an
upload fails. Files first, then the row, for the reason `saveProfile` gives.

`fit_score` is parsed as an integer here and nowhere else.
`applications.fit_score` is a `smallint`; `Percentage` in `src/core/application.ts`
is `z.number().min(0).max(100)`, which legally accepts `0.85` for 85%. This is
the first place those two meet. It is **not** `Math.round`: storing `1` for an
85% fit is a wrong number written confidently, which is worse than a refused
insert.

The `outputs` bucket is private and its only policy is **select** for
`authenticated`, unlike `cvs` which is `for all`. The server writes these with
the secret key, so the owner never needs insert or update, and a client that
could write there could replace a rendered resume with anything at all.

## Known and not solved here

- **Orphaned objects.** Deleting an application, or an account, cascades the row
  and leaves the objects in `outputs` behind; storage has no foreign key to
  cascade through. That cleanup is step 9's, and it is named here because this
  step's migration is what creates the orphan.
- **Anything the drafts already get wrong is inherited.** `docs/grounding.md`
  records two inventions surviving on the last measured run. Rendering does not
  fix them and this gate cannot see them: both are lowercase or posting-sourced,
  which is exactly where lexical grounding is blind. A "sendable" verdict on a
  rendered PDF is a verdict on the rendering, not on the writing.
