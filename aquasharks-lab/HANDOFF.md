# Aquasharks Lab report builder: handoff

Last updated 1 Oct 2026. Club: **Aquasharks only** (Britt). No shared UI code is touched. This repo is **public**: never commit EO report prose, EO images,
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
| `sql/2026-10-01_swim-lab-assessments.sql` | Migration (see "Status") |
| `scripts/lab-report-dev.mjs` | Local harness: real handlers, in-memory store, stub admin, real vision |
| `scripts/lab-parse-eo.mjs` | Run the parser on a file and print debug rows (`--vision` for image labels) |
| `scripts/lab-eo-fingerprints.mjs` | Rebuilds the hashed EO fingerprint file used by the hygiene test |

More detail: `analysis/README.md` (model rules) and `analysis/PARSER_FIELD_MAP.md` (every field, how reliably it extracts).

## Status

**Verified**
- Parser on the real EO report as DOCX and as PDF (gated acceptance tests).
- Whole flow locally with the real report: upload -> review -> publish -> public page -> 7-page A4 PDF.
- Live site: builder, admin API lock (403), PDF endpoint (404 on bad token). 359 tests (2 gated), `tsc --strict` clean.

**Not yet done**
1. ~~Migration~~ **Applied 1 Oct 2026** (`sql/applied/2026-10-01_swim-lab-assessments.sql`); VERIFY queries passed (table empty, RLS on, no policies,
   bucket `lab-evidence` private, 3 check constraints). Saving and publishing are now possible live; nothing has been published yet.
2. **Chromium PDF on Vercel is unverified.** Works locally. First live check: publish a test report and open the Download PDF link. The function needs
   `includeFiles` for `@sparticuz/chromium` (set in `vercel.json`); if it fails, check function size/memory first.
3. **EO-native PDF untested.** The PDF specimen was converted from the real DOCX with LibreOffice. Try one PDF straight from EO.
4. **GitHub Support request** to purge four orphaned commits still served by SHA (details are in a private note, not in this repo).

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
6. **EO diagnoses and clinical advice are coach-only.** They are preserved for the coach and never reach a swimmer unconfirmed.
7. **Lap averages vs individual strokes are separate** and never substituted.
8. **No unsupported equation** between pull power, force share and propulsive power. Independent signals are corroborated by direction only.
9. Fail closed: unclear claim types are treated as diagnostic; unrecognised layouts extract nothing.
10. Database changes go through MIGRATIONS.md (7 steps, Dave types "apply"). Ship changes update `growth-hub.html` in the same commit.

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

1. Publish a test report on the live site; confirm the web page and the PDF download (Chromium function).
2. Have Britt run one real EO report end to end; try an EO-native PDF.
3. File the GitHub Support request.
4. Then: stroke-phase screenshot ingestion, retest/progress comparison (same swimmer, two assessments), the older numbered-PDF layout, drill library sign-off.
