# Slice 7 — the render flow

## Context

Step 6 closed flow 2: a posting plus a profile becomes a validated, gated
`Application` in memory. Nothing writes it anywhere, and the two documents inside
it are markdown strings that no recruiter can receive. This step closes flow 3
(PROJECT.md section 5):

**an approved application + tier -> rendered PDF/DOCX files -> Supabase Storage
-> an `applications` row.**

Framework-free stays the rule for `core`, but the renderer is not framework-free
and cannot pretend to be: `@react-pdf/renderer` is React. So it gets its own
seam, `src/render/`, which imports types from `core` and is never imported by it.
Same shape as `src/providers/`: a boundary that swaps.

**The round trip is the point of the slice.** Step 6's gate proves the *JSON* is
clean. After this step the artefact the applicant actually sends is a file, and
nothing yet proves the file says what the JSON said. A PDF that renders its text
as images passes every check in the repo and fails every ATS on earth. The gate
that closes this is free: render, read the file back through
`src/core/extract-text.ts` (unpdf, already installed, already handles both
formats), and run `findEmDashes`, `findBannedWords` and `groundDraft` over the
**extracted** text. `extractCvText` already throws `CvExtractionError('no_text_layer')`
below its minimum character count, so images-as-text is caught by a test rather
than by a hiring manager, and it fails loudly without anything new being written.

Proved by a script, like steps 5 and 6. No route handler, no SSE, no screens.

## Decisions taken (say so if any is wrong)

1. **`src/render/`, not `src/core/render.ts`.** CLAUDE.md section 3 says `core` is
   framework-free and that dependencies point inward toward it. Putting React in
   `core` to save a directory would break the one structural rule the repo has.
   `render` imports `Application` and the tier type from `core`; `core` imports
   nothing from `render`.
2. **`@react-pdf/renderer` for PDF, `docx` for DOCX. No Puppeteer.** Both are
   PROJECT.md section 4's own choice, and the templates here are deliberately
   plain, which is the condition that section sets for skipping a headless
   browser. Two new dependencies, which rule 7 says must be justified in writing:
   a PDF and an OOXML package are binary container formats, not a few lines of
   ours. Nothing else is added.
3. **Standard PDF fonts, not the DESIGN.md display font.** ATS safety outranks
   brand for a file that leaves the product, and an embedded display font is the
   single most likely thing to make text unextractable. DESIGN.md governs app UI;
   it does not govern the document the applicant sends. **This decision means the
   next session does not need to read DESIGN.md at all**, which is the point of
   writing it down here.
4. **The markdown parser is ours, and small.** See the measured subset below. A
   markdown library plus an AST walk plus a mapping layer to react-pdf primitives
   is more code than the subset that actually appears, and every construct it
   would add is one nobody has ever seen the model emit.
5. **An unsupported construct renders as its literal text and is reported, not
   thrown.** Throwing after generation has already been paid for is exactly what
   PROJECT.md section 5 splits the two steps to avoid. A finding is visible; a
   crash costs the user their tokens twice.
6. **Rendering is pure.** `renderApplication(application, opts)` returns bytes.
   Storage and the database row are a separate function in `src/lib/`, called by
   the script. A test can render everything and touch no network.
7. **`fit.score` is parsed as an integer at the storage boundary.** This slice is
   the first time the schema's `Percentage` (`z.number().min(0).max(100)`, which
   legally accepts `0.85`) meets `applications.fit_score smallint`. A float, or the
   `0.85` the prompt fix now prevents, fails at insert and surfaces as an opaque
   Supabase status three layers from its cause. So `saveApplication` parses it with
   `z.number().int().min(0).max(100)`: CLAUDE.md's own Zod-at-every-boundary rule,
   `core` left fenced, and a named error instead of a Postgres one. **Not
   `Math.round`** — rounding `0.85` stores `1` for an 85% fit, which is a wrong
   number written confidently, and that is worse than a failed insert.

## Blocked on you

1. **A migration for the outputs bucket.** The init migration creates exactly one
   bucket, `cvs`. Rendered files need their own, and kickoff step 3's rule is that
   you see a migration before it is applied. What I intend to write, for your
   review:
   - bucket `outputs`, private, objects keyed `<user_id>/<application_id>/<file>`,
     where the id is generated in TypeScript with `crypto.randomUUID()` and passed
     as an explicit `id` on the insert. `applications.id` defaults to
     `gen_random_uuid()`, so waiting for the database to mint it would mean
     insert, read back, upload, update: three round trips and a half-written row
     whenever the upload fails. Supplying the id keeps `saveProfile`'s documented
     file-then-row order, for the reason `saveProfile` gives;
   - policy **select only** for `authenticated`, unlike `cvs` which is `for all`.
     The server writes these with the secret key. A client that can write there
     can replace a rendered resume with anything at all, and the applications list
     would serve it happily;
   - a `comment on column public.applications.files` documenting the shape below,
     matching how `profiles.data` is documented.
2. **Where `company` and `role` come from.** `applications` has both columns;
   `applicationSchema` has neither. Three honest answers: the caller supplies them
   (a `--company` / `--role` flag now, two form fields at step 7), the drafter
   returns them (a prompt change, which this slice is otherwise fenced off from,
   plus a real run to confirm), or they stay null. **I recommend caller-supplied**:
   the columns are already nullable, the user is pasting the posting and knows both
   strings, and it keeps a second posting parse out of the pipeline. Say if you
   would rather pay for the prompt change.
3. **A Supabase project to write to.** The proof run needs a real user id, the same
   way `npm run parse:cv -- --save <USER_ID>` did. Confirm the same id is fine.
4. **Which application to render for the proof.** I propose run 9 from step 6
   (fit 85, coverage 90%, gate clean, both documents present, standard tier),
   because it is the output we have already read line by line and know the flaws
   of. A fresh generation would confound a render bug with a generation one.

## The markdown the model actually writes, measured

Three real runs from step 6, both documents each, counted rather than assumed:

| construct              | resume (runs 7 / 8 / 9) | cover letter |
| ---------------------- | ----------------------- | ------------ |
| `#` h1                 | 1 / 1 / 1               | 0            |
| `##` h2                | 1 / 0 / 4               | 0            |
| `###` h3               | 4 / 5 / 3               | 0            |
| `-` bullet             | 18 / 17 / 13            | 0            |
| paragraph              | 7 / 5 / 5               | 4 to 5       |
| `**bold**` (delimiters)| 22 / 22 / 14            | 0            |
| link `[]()`            | 0 / 2 / 0               | 0            |
| table, code, `>`, `1.` | 0 across all six documents            |

So the parser supports exactly: h1, h2, h3, bullet, paragraph, bold, link. The
cover letter is paragraphs and nothing else, which is what a letter should be. A
resume is around 2,300 characters and a letter around 1,000, so both fit one page
each and pagination is not a problem this slice has to solve.

Anything outside that list becomes a literal line plus a `RenderFinding`, per
decision 5. The test asserts the six real fixtures produce **zero** findings; the
day a table appears, a run says so instead of quietly printing `| --- |`.

## The round-trip gate

The headline verification, and the reason the slice is worth its own step.

```
Application (JSON, already gated)
  -> render                    -> PDF bytes / DOCX bytes
  -> extractCvText(bytes)      -> text
  -> findEmDashes, findBannedWords, groundDraft(text, { profile, posting })
```

Three failures this catches that step 6's gate structurally cannot:

- **Unextractable text.** Empty or near-empty extraction means the document is
  images or a broken font embed. Fatal, and invisible to every other check.
- **Text the renderer invented or dropped.** A template that prints a hard-coded
  "References available on request" adds an ungrounded claim to a document that
  was clean when it was JSON.
- **Slop the renderer introduced.** A layout that joins two lines with an em dash
  is a real way to fail the product's soul test after passing it.

`extract-text.ts` is reused rather than copied. Its error codes and its
`MAX_CV_BYTES` cap were written for user uploads, and reading our own output
through them is a slightly odd fit; that is worth one sentence in the test rather
than a second extractor.

## Tier to files

PROJECT.md section 9: Basic = CV PDF, Standard = CV + cover letter, Full = both as
PDF + DOCX. Written out because this is the thing that gets miscounted:

| tier     | files | which                                                     |
| -------- | ----- | --------------------------------------------------------- |
| basic    | 1     | resume.pdf                                                |
| standard | 2     | resume.pdf, cover-letter.pdf                              |
| full     | 4     | resume.pdf, cover-letter.pdf, resume.docx, cover-letter.docx |

`applicationSchema.coverLetter` is `null` on basic and a string otherwise, so a
basic application carrying a cover letter, or a standard one missing it, is a bug
in the pipeline and this step throws rather than papering over it.

`applications.files` shape, which the migration comment documents:

```json
[{ "kind": "resume", "format": "pdf", "path": "<uid>/<app>/resume.pdf", "bytes": 41234 }]
```

## Files

| File                          | What                                                   |
| ----------------------------- | ------------------------------------------------------ |
| `src/render/markdown.ts`      | the measured subset, markdown text -> blocks           |
| `src/render/markdown.test.ts` | every construct, plus the unsupported-line finding      |
| `src/render/pdf.tsx`          | the two react-pdf documents                            |
| `src/render/docx.ts`          | the same two through the `docx` package                |
| `src/render/index.ts`         | `renderApplication`, the tier matrix, `RenderFinding`  |
| `src/render/render.test.ts`   | the round trip, all three tiers                        |
| `src/lib/supabase.ts`         | `+ saveApplication(userId, application, files, meta)`, with the integer parse from decision 7 |
| `src/lib/supabase.test.ts`    | the new write, same style as `saveProfile`             |
| `supabase/migrations/*_outputs_bucket.sql` | the bucket, its policy, the column comment |
| `scripts/apply.mts`           | `+ --out DIR`, `+ --save USER_ID`                      |
| `package.json`                | the two dependencies                                   |
| `docs/render.md`              | the measured subset and what the round trip proved     |

Nothing in `src/core/`, `src/prompts/`, `src/providers/`, `src/ui/`, `src/app/` or
`messages/*.json` is touched. The prompts stay fenced.

## `src/render/index.ts`

```ts
renderApplication(application, { name, tier, company? }):
  Promise<{ files: RenderedFile[]; findings: RenderFinding[] }>

interface RenderedFile {
  kind: 'resume' | 'cover-letter';
  format: 'pdf' | 'docx';
  filename: string;
  bytes: Uint8Array;
}
```

`name` comes from the caller for the same reason it did in step 6: `profileSchema`
has no name field and deriving one would be inventing it.

The filename is what lands in a recruiter's downloads folder, so it is chosen, not
generated: `Santiago Vittor — Resume.pdf` is out (em dash, and the product bans
it), `resume(1).pdf` is out. Proposal, confirmable in the run:
`Santiago Vittor - Resume - Wilson Sonsini.pdf`, falling back to
`Santiago Vittor - Resume.pdf` when no company is supplied.

**PDF bytes are not deterministic.** react-pdf stamps a creation date, so no test
snapshots bytes. Tests assert the extracted text, which is the thing that matters
anyway.

`groundDraft` needs a profile and a posting, which `renderApplication` deliberately
does not take. `render.test.ts` reuses `apply.test.ts`'s existing fixtures rather
than inventing a second set: two fixture profiles drifting apart is how a gate
starts passing for the wrong reason.

Errors carry the stage and the file kind, never the document text. Same rule as
`ApplicationError` and `ProfileParseError`: an error reaches logs, and a resume is
personal data.

## Commits

1. `feat(render): parse the markdown the drafts actually use`
2. `feat(render): a resume and a cover letter as PDF`
3. `feat(render): the same two documents as DOCX`
4. `feat(render): give each tier the files it owes`
5. `test(render): read the rendered files back through the gate`
6. `feat(db): a private bucket for rendered outputs` (after you approve it)
7. `feat(lib): store the outputs and the application row`
8. `chore: render from the apply script`
9. `docs(render): the markdown subset and what the round trip proved`

Every git command scoped with
`-C "C:\Users\user-1\Documents\Personal Projects\aplica"`.

## Verification

Measured and pasted, not asserted.

- **At install, before anything else:** `@react-pdf/renderer`'s React peer range
  against the pinned `react@19.2.4`, and whether it renders under Node 24 without
  a browser shim. Both are checks, not assumptions. If either fails, that is a
  finding to report before writing templates around it.
- `typecheck`, `lint`, `format:check`, `build`, `test`, plus the suite with every
  provider environment variable unset.
- A real render of run 9's application at **all three tiers**, with the file list
  and byte size of each, so the tier matrix is proved rather than reviewed.
- **The round trip pasted in full**: the text extracted back out of `resume.pdf`,
  next to the markdown it came from. Not a diff summary. If a line is missing, it
  should be visible to you, not to me alone.
- The gate rerun over the extracted text: em dashes, banned words, and every
  ungrounded number and entity, listed rather than summarised.
- The DOCX opened and its extracted text checked the same way. A DOCX that Word
  will not open is a real failure mode and `extract-text.ts` reading it is not
  quite proof, so say plainly which of the two was tested.
- The `applications` row and the `outputs` object paths after a `--save` run,
  read back out of Supabase.
- **Blunt verdict on whether the PDF is sendable**: not "does it validate" but
  does it look like a resume a person made, at a glance, next to the honest
  answer about the two residual inventions step 6 shipped.

## Not built

No route handler, no SSE, no `maxDuration`, no streaming progress. No auth: without
a session there is no user id and no decrypted key, so a generation route today
would be a stub with a hard-coded id, which is worse than no route. No
`usage_counters` increment, for the same reason step 6 gave — it is a route and
session concern and it belongs with the route. No signed download URLs and no
screens; the applications list is step 7's.

**No cleanup of orphaned objects.** `applications` has an owner delete policy and
a user delete cascades the row, and neither touches the `outputs` bucket, so a
deleted application leaves its files behind. That is step 9's work, but this
migration is what creates the orphan, so it is named here rather than discovered
there. The same is true of the account-deletion path. No landing page, no copy in
`messages/*.json`. No enrichment. No change to the prompts or to `src/core`.

---

# Carried over from step 6

Each is a thing an earlier step found and could not act on inside its own scope.
Nothing here is fixed by slice 7.

## The apply pipeline's own open items

- **`research: true` has never completed against a real provider.** Three
  attempts, all `google request failed with status 429` at the reviewer call,
  while plain calls to the same model returned 200 all session. Diagnosed as the
  account's grounding/search quota, not per-minute and not our code. The on/off/
  override logic is unit-tested; the path has never run end to end. It needs a
  different key or a different provider, not another retry.
- **Two inventions survive on the last measured run**, both recorded in
  `docs/grounding.md`: "non-technical staff maintain daily" (from a prompt that
  names `daily` as a failure, by that word) and a skills heading reading "AI
  Enablement & Legal Tech". Both are lowercase or posting-sourced, so lexical
  grounding is structurally blind to them. The judgement recorded at the time was
  cheap-model capability rather than a missing rule, and the next lever is
  measuring a stronger model, not adding a fifth prompt bullet. **Anything
  rendered inherits them**, which is the honest caveat on any "sendable" verdict.
- **`Percentage` in `src/core/application.ts` is still `z.number().min(0).max(100)`.**
  A model returning `0.85` for 85% passes it. The prompt fix was chosen over
  tightening the schema, and it has held for five runs; the schema change remains
  unauthorised and is a one-line `.int()` away if you ever want both belts.
  **This slice is where it stops being trivia**: `applications.fit_score` is a
  `smallint`, so decision 7 parses the integer at the storage boundary instead.
  Tightening `Percentage` itself would make that parse redundant, which is the
  argument for doing it, and it is still yours to authorise.
- **The Spanish banned-word list has known collisions**, documented in
  `src/core/slop.test.ts`. Curated by hand; nobody removes an entry unilaterally.

## Owed verification, still owed

- **The `openai_compatible` path has never returned a usable body.** The NIM run
  found and fixed a real bug (`guardedLookup` returning a string address, which
  killed every pinned request), then NIM queued indefinitely on inference while
  answering `/v1/models` instantly. So `max_tokens: 32768` remains untested, and
  it is the single most likely thing to fail against a small self-hosted model.
  Ollama on this machine would settle it for free and is the harsher test.
- **OpenAI cannot do company research.** Its `web_search` tool lives on the
  Responses API; the adapter speaks `/chat/completions` because that is what the
  compatible hosts speak. `supportsSearch` is `false` with the reason recorded in
  `openai.ts`. The fix is a second request shape and it is an unmade scope
  decision.
- **Anthropic's search model is `claude-opus-5`** because the docs never enumerate
  which models search. Haiku 4.5 is unconfirmed rather than unsupported. Settling
  it needs a live Anthropic API key, which does not exist here — only a Claude
  Code subscription.

## The enrichment slice is still specced and still blocked

Full spec is in SLICE-6.md and is not repeated. The one thing that must not be
lost: it is **blocked on the GitHub token decision** (unauthenticated GitHub is 60
requests per hour per IP, shared across every user of a Vercel deployment), it
changes the provenance model to a per-source `sourceRef`, and
`ALLOW_PRIVATE_PROVIDER_HOSTS` must never be reused to widen its fetch.
