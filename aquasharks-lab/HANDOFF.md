# Aquasharks Lab report builder: handoff

Last updated 6 Oct 2026. Club: **Aquasharks only** (Britt). No shared UI code is touched. This repo is **public**: never commit EO report prose, EO images,
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
