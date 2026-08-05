/**
 * One real run of the apply pipeline, kept verbatim, so the landing can show a
 * document instead of a picture of one (DESIGN.md §7: "a paper fragment beats
 * a screenshot").
 *
 * **Nothing here was written by hand.** Both values below are copied out of
 * `npm run apply`'s own output, which is why the file exists at all: the tile
 * that renders them is the product's proof, and a proof someone typed is a
 * mockup. The commands, in order, on 2026-08-04:
 *
 * ```
 * APLICA_DEV_PROVIDER=google npm run parse:cv -- e2e/fixtures/cv.pdf > profile.json
 * APLICA_DEV_PROVIDER=google npm run apply -- posting.txt --profile profile.json \
 *   --name "Jordan Ellis" --tier standard --no-research
 * ```
 *
 * `e2e/fixtures/cv.pdf` is the harness's own fixture CV, so the person is
 * fictional and no real applicant's document is on the front page of anything.
 * The parse ran on `gemini-3.6-flash` and the three apply calls on
 * `gemini-3.1-flash-lite`, each provider's own default for its step
 * (`providers/defaults.ts`). The run exited 0: the slop gate found no em dash
 * and no banned word, and the grounding gate found no number or entity that
 * does not trace to the CV or the posting. A run that had failed either gate
 * would not be proof of anything.
 *
 * The posting was the same reporting role `e2e/shots.spec.ts` uses, for the
 * same reason it uses it: the fixture CV genuinely fits it, so the documents
 * are what the product produces on a good day rather than what it produces
 * when asked for the impossible.
 *
 * **It is not translated, and that is the product's own rule rather than an
 * omission.** A generated document is written in the posting's language, not
 * in the UI's (PROJECT.md §9); `e2e/shots.spec.ts` declines to re-run the
 * result screens in Spanish on exactly that ground. The tile's own copy is
 * translated in `messages/`; the artefact inside it is the artefact.
 */

/**
 * The resume from that run, as the model wrote it: the markdown that
 * `src/render` turns into the PDF and the docx the applicant downloads. The
 * landing parses it with the same `parseMarkdown` those two renderers use, so
 * the fragment on screen and the file on disk come from one source.
 *
 * The whole document, not the slice the tile shows. Where the crop falls is a
 * layout decision and belongs in the stylesheet; trimming the text here would
 * bake one viewport's answer into the data and quietly make this a hand-made
 * excerpt again.
 */
export const DEMO_RESUME = `# Jordan Ellis

## Summary
Operations Analyst comfortable owning reporting pipelines from raw data to dashboards managers actually read. I use SQL, Python, and spreadsheet modelling for operational reporting.

## Experience

**Northwind Logistics | Operations Analyst | 2022–Present**
* Ran the weekly reporting cycle for a 40-person operations team, cutting the close from three days to one.
* Maintain data pipelines and the data warehouse using SQL and Python.
* Built the shipment tracking dashboard.
* Trained four new analysts on the reporting pipeline and the data warehouse.

**Northwind Logistics | Junior Analyst | 2020–2022**
* Reconciled daily shipment records against carrier invoices, catching billing errors worth about 2% of spend.
* Wrote the first version of the automated exception report using Python.

## Education
**Riverbend University | B.A. Economics | 2020**`;

/**
 * The fit score from a second run, where the same profile was put against a
 * senior iOS role it has no business applying to. The pipeline answered
 * `recommendation: "skip"` with `fit.score: 0`, which is the number the tile
 * shows.
 *
 * Zero is not a placeholder and it is not rounded down for effect. It is what
 * the run returned, and a score bar with nothing in it is the honest picture of
 * a refusal: the tile beside it says the product will tell you not to apply,
 * and this is what that looks like when it happens.
 *
 * The verdict sentence beside it lives in `messages/` rather than here. It is
 * the one thing on this tile addressed to the reader rather than about a
 * fictional applicant, so it is translated copy, the same way the motif's demo
 * slop line already is (DESIGN.md §9's fixed demo pair).
 */
export const DEMO_FIT_SCORE = 0;
