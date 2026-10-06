# Aquasharks Lab report builder: handoff

Last updated 6 Oct 2026 (simple-report rework, uncommitted: see "6 Oct rework"). Club: **Aquasharks only** (Britt). No shared UI code is touched. This repo is **public**: never commit EO report prose, EO images,
sample report PDFs, or a real swimmer's identity (see "Rules that must not break").

## What it does

Britt uploads one EO Labs SwimBETTER report (PDF, or Word). The system extracts the evidence, she reviews it, and it publishes a swimmer web report
and a downloadable PDF.

```
upload PDF/DOCX -> parse (deterministic) -> read image labels (vision) -> coach review -> publish -> web report + PDF
EO measures.  Aqua Sharks interprets (deterministic rules, no AI interpretation).  The coach decides.
```

| Where | What |
|---|---|
| `/aquasharks-lab/report-builder` | Admin UI (Aquasharks club admins only, noindex) |
| `/aquasharks-lab/report/<token>` | Public swimmer report (the token is the credential) |
| `/api/lab-report-pdf?t=<token>` | PDF download of a published report |
| `/aquasharks-lab/report-preview` | Engine demo on synthetic fixtures (profile switcher) |

## Code map

| Path | Role |
|---|---|
| `aquasharks-lab/analysis/types.d.ts` | **SwimAnalysis v3 schema** (source layer / findings / coach review) |
| `analysis/parser/` | Ingestion: `zip.js` + `docx-blocks.js` (DOCX), `doc-text.js` (DOCX and PDF -> lines), `extract-ai-report.js` (the extractor), `claims.js`, `normalise.js`, `vision.js` (image labels), `debug-rows.js`, `index.js` |
| `analysis/model.js`, `calc.js` | Constructors (everything starts MISSING), pure maths |
| `analysis/rules.js` | Deterministic rules -> findings (classification, confidence, evidence, caveats) |
| `analysis/priorities.js`, `quality.js`, `report-model.js`, `engine.js` | Ranking, data quality, per-profile report model, orchestration (`analyse()` is pure) |
| `analysis/report-view.js` + `.css` | Report HTML (also the print/PDF layout) |
| `analysis/profiles.js`, `drills.js`, `language.js` | Four communication profiles, drill library (DRAFT), language guard |
| `report-builder/app.js` | The coach UI (ES module; reuses the engine in the browser) |
| `api/lab-report.js` | Admin API: `parse save get list readiness publish unpublish` |
| `api/lab-report-public.js`, `api/lab-report-pdf.js` | Public page and PDF (headless Chromium) |
| `api/_lib/lab-report/` | `workflow.js`, `handlers.js` (factories), `store.js` (Supabase + memory), `page.js`, `pdf.js`, `service.js` |
| `sql/applied/2026-10-01_swim-lab-assessments.sql` | Migration (applied 1 Oct 2026) |
| `aquasharks-lab.html` (`/aquasharks-lab`) | Public sales page (copy rewritten 2 Oct to match the real report; see "Sales surfaces") |
| `aquasharks-lab-card.html` (`/aquasharks-lab-card`) + `icons/aquasharks-lab-qr.svg` | A5 poolside card for the squad noticeboard (see "Sales surfaces") |
| `scripts/lab-report-dev.mjs` | Local harness: real handlers, in-memory store, stub admin, real vision |
| `scripts/lab-parse-eo.mjs` | Run the parser on a file and print debug rows (`--vision` for image labels) |
| `scripts/lab-eo-fingerprints.mjs` | Rebuilds the hashed EO fingerprint file used by the hygiene test |

More detail: `analysis/README.md` (model rules) and `analysis/PARSER_FIELD_MAP.md` (every field, how reliably it extracts).

## Status

**Verified**
- Parser on the real EO report as DOCX and as PDF (gated acceptance tests).
- Whole flow locally with the real report: upload -> review -> publish -> public page -> 7-page A4 PDF.
- Live site: builder, admin API lock, PDF endpoint (404 on bad token).
- **Chromium PDF on Vercel works** (2 Oct 2026): a published report's `/api/lab-report-pdf?t=` returns HTTP 200, a 7-page PDF (~1.4 MB).
- **Live admin API works for a real club admin session** (6 Oct): `action: list` returns 200 for Dave's account.
- **PDF parsing works on Vercel** (6 Oct, after the worker fix below): a tiny made-up PDF posted to `action: parse` returns 200, `format: PDF`.
- 417 tests (415 pass, 2 gated acceptance tests skip without the real EO files), `tsc --strict` clean.

**Not yet done**
1. ~~Migration~~ **Applied 1 Oct 2026** (`sql/applied/2026-10-01_swim-lab-assessments.sql`); VERIFY queries passed. Saving and publishing work live.
2. ~~Chromium PDF on Vercel~~ **Verified** (see above).
3. **An EO-native PDF has still not been read end to end on the live site.** Dave's first live attempt (6 Oct) hit the pdf.js worker bug (fixed, see
   "Incidents"); the retry result is not recorded yet. Only a PDF converted from the real DOCX has ever parsed successfully (locally). If a real EO PDF comes
   back "not recognised", it is probably another EO layout: get the layout described (never commit the file) and extend the parser.
4. **GitHub Support request** to purge four orphaned commits still served by SHA (details are in a private note, not in this repo).
5. **Sales-page follow-ups** (decisions for Dave): the real EO chart images `/icons/lab-forcefield.jpg` and `lab-forcetime.jpg` are in this public repo (against
   rule 1); the line "wrecks a shoulder over a few seasons" on `/aquasharks-lab` is a health claim (EO clinical claims are coach-only); the swimmer PDF is
   7 pages, so any "short report" claim should stay about plain language, not page count.

## 6 Oct rework: simple, positive, for school swimmers (Dave's decisions)

Audience: Aquasharks school squad swimmers and open-water swimmers, not elite athletes. The report builds on EO's (it credits EO on page 1), keeps what is relevant,
and is short: **three focuses maximum for every swimmer profile**, about four printed pages, and progress over time.

| Change | Where |
|---|---|
| EO's printed target ranges are now compared with the swimmer's numbers ("You / Target"). Only what is off target is shown; juniors get words. Targets are read from the report, never hardcoded. | `rules.js` `targetRows`, `report-model.js` POWER |
| "What's going well" section: on-target numbers, smooth arm, and any positive EO sentence Britt shows | `report-model.js` STRENGTHS |
| EO's headline diagnostic sentences (one per EO point) are hidden until Britt shows or rewrites them (**reverses old rule 6 for approved text only**; clinical advice stays coach-only) | `rules.js` `explanationCandidates`, `coachReview.eoClaims`, builder "EO's explanation" panel |
| A note from Britt at the top of the report | `coachReview.coachNote`, builder "Your note" |
| Which arm leads each lap, read from EO's wording ("lap 1 favouring the left..."); coach can enter per-lap watts later. A swap is focus #2 in one plain sentence | parser `leftRight.byLap`, `rules.js` asymmetry |
| Progress: link an earlier session of the same swimmer in the builder; report shows "Since last time" (distance per stroke, forward, downward, hand drag; better/same/not yet by the numbers as shown, no invented tolerance) | `analysis/progress.js`, builder "Progress" panel |
| Parser now reads "(22% occurrence in both laps 1 and 2)" and "clean single-peak" as per-lap double-peak series | `parser/extract-ai-report.js` |
| **Come-back section and practice plan:** "Your practice plan" (weeks split across the report's own focuses in rank order, each with its drill and cue, then a "put it together" week), a pull count the swimmer can check on any length (strokes / laps), and "Your next session" (retest date, three numbers to beat, booking button to `/aquasharks-lab#book`). Retest weeks are Britt's choice (4/6/8, default 6 is a suggestion, not a coaching rule). No reps or volumes are prescribed. | `analysis/plan.js`, `report-model.js` PLAN/NEXT, builder "Retest and practice plan" panel |
| Print layout: sections flow, three page starts (you + note + going well / force + focus / progress + next) | `report-view.css` print block |

Rule changes: rule 6 now reads "EO diagnoses and clinical advice are coach-only **until the coach shows or rewrites a sentence**; clinical advice never auto-surfaces". Rule 3 is unchanged:
EO's ranges are EO's printed values, not invented thresholds.

**Not done:** per-week plan wording is auto-built from drills (Britt cannot yet edit individual weeks); the Sophia-style coach-written EO layout (stroke path, video snapshots, breaststroke) is not recognised by the parser (fails closed); per-lap watts need a builder input; republishing
the existing sample (token `nBU8...`) from the builder is needed before it shows any of this; drill library and the new drills are DRAFT.

## Incidents fixed (6 Oct 2026)

**1. "This account is not an Aquasharks club admin" for a real admin.** Cause: `report-builder/app.js` read the Supabase access token once at page load
and reused it. Tokens expire (~1 h), the API got an expired token, `/auth/v1/user` rejected it, and the handler answered 403 `not_an_admin`.
Fix (`b7d9c30`): the UI reads a fresh token before every request (`freshToken()`, one forced-refresh retry); the API now answers **401 `session_expired`**
when Supabase refuses the token, and keeps **403 `not_an_admin`** for no token or a valid user without a `club_admins` row. Test added. Check an admin
session with: `POST /api/lab-report {"action":"list"}` using the stored `sb-*-auth-token` access token (200 = fine).

**2. "Setting up fake worker failed ... pdf.worker.mjs" on every PDF upload (Vercel only).** Cause: pdf.js finds `pdf.worker.mjs` through a computed path
Vercel's file tracer cannot see, so the file was missing from the `api/lab-report` function. It worked locally because the file is on disk.
Fix (`ea5e197`): `analysis/parser/doc-text.js` imports the worker by a literal specifier and registers it on `globalThis.pdfjsWorker` (pdf.js uses that before
looking for a file), plus `includeFiles` for `api/lab-report.js` in `vercel.json` as a backstop. Reproduce locally by setting
`pdfjs.GlobalWorkerOptions.workerSrc` to a missing path and calling `pdfToDocText`: it failed before the fix and parses after.
Lesson: anything the function loads by a computed path needs a literal import or `includeFiles`; local success proves nothing about Vercel's bundle.

## Sales surfaces (keep in step with the report)

`/aquasharks-lab` (landing) and `/aquasharks-lab-card` (A5 card) sell this report. On 2 Oct 2026 they were rewritten because they promised "one page, one focus,
one drill, no wall of charts" while the report has hero metrics, where-your-power-goes, two arms, **2-3 focus areas each with a drill** (Junior 2, others 3) and
a next-time baseline, with charts and a 7-page PDF. The pages now say: a short plain-English report, a private link plus a PDF within 24 hours, **Britt reviews
every report** (Dave, 2 Oct; named by first name only), and the sample card uses only numbers already published on the page. The card's QR was verified to encode
`https://www.swimloading.com/aquasharks-lab`; it prints on exactly one A5 page (print at 100%, no "fit to page"). **When the report changes, re-check both pages**
against `analysis/report-model.js` and `analysis/profiles.js`; do not promise hand path, "good for your age" or other judgements the rules do not produce.

**6 Oct (later): sales surfaces rewritten for the simple report.** `/aquasharks-lab` and the A5 card now describe: going well first, numbers against EO's target range, three things at most (one at a time),
a practice plan, a note from Britt, a retest date and progress. The card's old "first lap to last lap" line was removed (the report only has that when lap data is entered). The sample card still uses only
one real swimmer's numbers (Johann's report, shown as "a swimmer aged 54", name removed, Dave OK'd 6 Oct); the card earlier used an August 2025 swimmer. Two FAQs added ("Why only three things?", "Is this only for squad swimmers?": open water, triathletes, masters).
EO guidance used (from EO's Technical Error Index, Feb 2026, paraphrased, never copied): fix the dominant issue first, slow changes down, upward force under 3-4% is negligible (code uses 3), like-for-like comparison.
Not sold, deliberately: EO's "emerging shoulder dysfunction" early-warning idea (clinical; coach-only).

## Hand-path charts (6 Oct): coach-confirmed chart reads, EO's own mappings

EO's stroke path, consistency and hand-path-and-power charts print no numbers, so **nothing about them is filled automatically**. `analysis.handPathReading` (crosses midline; per hand: deepest point, width, spread, wrist pitch)
is entered or confirmed by Britt in the builder ("Hand path" panel); every field is `CHART_READ` provenance. Optional: upload chart screenshots and the builder asks the model for SUGGESTIONS
(`parser/hand-path-vision.js`): each chart is read **twice** and a value is offered only where both reads agree (numeric ranges overlap and the overlap is 20 cm or less; categories identical and not UNSURE).
Britt checks each suggestion against the chart thumbnail and presses Use. Nothing is applied by itself.
Rules (`rules.js`, EO Technical Error Index mappings, no invented thresholds): crossover (linked to sideways force above EO's target), wrist pitch (hand angled down at the catch), hand-position consistency.
**One hand wide and the other not is held for the coach** (EO: may be an early shoulder issue, not technique): never swimmer-facing until Britt confirms, wording neutral, no clinical words on the swimmer report.
Depth and width in cm are coach facts only (EO prints no target, so they are never graded or shown to a swimmer).
**Accuracy lesson, 6 Oct:** checked against the coach-written Sophia report, whose text says hands reach "60-75 cm" deep and the right arm is "60-65 cm from the centreline": on the chart itself the side-view curves
reach roughly 50-68 cm and the overhead left-right extent is about 30-40 cm (the 60-65 looks like the front-to-back axis). A human read of these charts can be well off, so reads are double-checked and confirmed against the image.
The model prompt now defines each axis (depth below zero; OVERHEAD width is the HORIZONTAL axis). Upload the original EO platform screenshots, not small images embedded in a PDF.
**Not live-tested:** there is no `ANTHROPIC_API_KEY` on the dev machine, so the model reads are covered by mock tests only. Before relying on suggestions, run the builder against a real EO screenshot with the key set and compare to the chart.

## EO data export import (6 Oct): exact numbers instead of reading charts

Britt's workflow, built into the builder start screen (step-by-step guide on it): in EO open the swim, Charts, the three dots on a chart, **Export FullSwim XLSX** (a zip of five workbooks), and download EO's AI report (PDF/Word)
for the same swim. Drop both in the builder (either alone also works). Review, write the note, set the retest, publish.
- `parser/xlsx.js` (zip+XML spreadsheet reader, no dependencies), `parser/eo-export.js` (per lap, per hand, per stroke statistics), `export-apply.js` (merges into the analysis, origin `EO_EXPORT`; a value the EO report already gave is never overwritten, a >1% disagreement is flagged).
- Gives exactly: per-lap left/right power (the report's "Avg Impulse" is each hand's average power: verified against the chart tooltips), each hand's own force-field shares, first-to-last-lap change, hand path in cm (depth, width, inward sweep, stroke-to-stroke spread, crossing), stroke phases, strokes. Whole-swim combined shares and EO's TARGET RANGES still come from the EO report (the export has neither): without the PDF the "where your power goes" section is left out and the builder says so.
- Conventions assumed from one real swim (verify on others): hand-path metres, depth negative below the surface, lateral negative on the left of EO's centreline and positive on the right. "Crosses the centreline" is YES only if the typical stroke of a hand passes it.
- A "stroke" in EO is a full cycle; the report's "Strokes" is left plus right added (EO's own strokes per lap, DPS and the .fit file all agree). Strokes per length = strokes / 2 / laps.
- Targets are EO's printed ranges for the swimmer type chosen when the report was made (Distance or Sprinter): the same swim is judged differently (downward 17-22% against 32-37%). A miss only counts on the side EO treats as an error (too much downward/sideways/upward/drag, too little forward). The builder warns if last time's report used a different swimmer type.
- **Last report is found automatically**: `rankPrevious` (progress.js) matches by name (a one-letter slip in both names is tolerated; first name alone never matches), keeps only earlier days, prefers like-for-like (same stroke, distance, pool), links the most recent one and says so; Britt can change or remove it. The same EO swim imported twice is flagged (`source.exportId`). The raw export zip is kept with the report (`lab-evidence/<id>/export.zip`).
- Not read yet: `FPvsTime` (the 100 Hz force series: would give wrist pitch and double peaks from our own rule; EO publishes no double-peak rule, so EO's own statement is kept), the polar `fan` data (stored, not drawn), several efforts in one session (each export is one swim), a printable guide page (the guide is on the builder start screen).
- The chart-reading step (`parser/hand-path-vision.js`, builder "Hand path" panel) remains for the case where only screenshots exist; with an export it is not needed.

## Known limits

- Layout detected: `EO_AI_REPORT_V1` only. The older numbered-section EO PDF is reported "not recognised", nothing extracted.
- Lap-by-lap values are in a chart with no data labels, so a lap comparison is **entered by the coach** (an endpoint comparison, never called a trend).
- Stroke-phase panels (separate screenshot), retest/progress comparison, and multi-lap trends are not built. `MULTI_LAP_TREND` exists as a type, is not analysed.
- Drills are a DRAFT library. Coaching rules (thresholds) are deliberately absent: nothing is labelled good or bad.
- In-browser PDF figure rendering (pdf.js) stalls in a hidden tab; it times out and falls back to sending the PDF itself.
- Report images are sent to the Anthropic API for the vision step (admin-triggered only).

## Rules that must not break

1. **Public repo.** No EO prose, no EO images, no sample reports, no real swimmer identity in git. Fixtures are synthetic (Test Swimmer A/B) with short
   paraphrases. `test/lab-fixture-hygiene.test.js` enforces this with hashed 6-word fingerprints; do not weaken it.
2. **EO is evidence, Aqua Sharks is interpretation.** The parser never coaches. The engine never edits source fields.
3. **Never invent a value.** Absent = MISSING with a reason. Ranges stay ranges (no midpoints). Chart reads are never auto-filled.
4. **Conflicting printed values are all kept.** The parser never chooses; the coach records a selection basis. A selection is a decision, not ground truth.
5. **Endpoint comparisons are not trends.** No "fatigue/tire/trend/fade" wording for lap 1 vs lap 8.
6. **EO diagnoses and clinical advice are coach-only until the coach shows or rewrites a sentence** (Britt, in the builder). Clinical advice never auto-surfaces.
7. **Lap averages vs individual strokes are separate** and never substituted.
8. **No unsupported equation** between pull power, force share and propulsive power. Independent signals are corroborated by direction only.
9. Fail closed: unclear claim types are treated as diagnostic; unrecognised layouts extract nothing.
10. Database changes go through MIGRATIONS.md (7 steps, Dave types "apply"). Ship changes update `growth-hub.html` in the same commit.
11. **Sales copy must describe what the report actually contains** (see "Sales surfaces"). Never advertise a section, count or judgement the engine does not produce.

## How to run and test

```bash
npm test                                   # 359 tests (2 gated acceptance tests skip)
npm run lab:typecheck                      # tsc --strict over analysis/ incl. parser
EO_SPECIMEN_DOCX=... EO_SPECIMEN_PDF=... npm test   # include the real-report acceptance tests (files are not in the repo)
node scripts/lab-parse-eo.mjs <file> [--vision]     # parser debug rows
```
Local app: launch config **"Lab report builder harness"** (port 3011; real vision if `ANTHROPIC_API_KEY` is set; PDF needs Chrome, or set `LAB_CHROME_PATH`).
`serve` and the in-app browser cache modules aggressively: bump the `?v=` on `app.js`/CSS when testing edits.

## Environment

Vercel: `ANTHROPIC_API_KEY` (vision), `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`. Model defaults to `claude-sonnet-5-5` (`LAB_REPORT_MODEL` overrides);
this model rejects a forced `tool_choice`, so `service.js` uses auto + retry. Storage: private bucket `lab-evidence` (original uploads). Access: `club_admins`
for slug `aqua-sharks-atlantic` (Britt's single login; never create a second account).

## Next steps, in order

1. Dave retries the real EO PDF in the builder (worker bug is fixed); record the outcome here. If "not recognised", capture the layout and extend the parser.
2. Have Britt run one real EO report end to end (upload -> review -> publish -> PDF) and confirm the web page and PDF on a phone.
3. Decide the sales-page follow-ups (EO images in the public repo, the shoulder claim, report length).
4. File the GitHub Support request.
5. Then: stroke-phase screenshot ingestion, retest/progress comparison (same swimmer, two assessments), the older numbered-PDF layout, drill library sign-off.
