# EO ingestion: parser field map (Phase 5, pre-implementation)

Status: **mapping only.** No production parser exists yet. This document maps every SwimAnalysis source field to what a real EO
report specimen can supply, how reliably, and which schema changes are needed first. It contains no EO prose.

Specimen: one EO "SwimBETTER Analysis Report" `.docx` (200 m freestyle, 25 m pool, 8 laps). Evidence: `scripts/lab-parse-specimen.mjs`
(a dev spike of label/table/regex extractors) extracts **26 fields**; all 26 match the synthetic Test Swimmer A fixture.
Run it locally with `node scripts/lab-parse-specimen.mjs <file.docx>`. The specimen itself is not committed.

## Principle

The parser produces **evidence**, never coaching. Every field it writes carries provenance (what, where, how, how sure).
Anything it cannot read reliably stays `MISSING` with a reason, and becomes a coach-entry prompt. Nothing is guessed.

## Document anatomy (specimen)

| Part | Structure | Machine-readable? |
|---|---|---|
| Title + "swim date and time" | Heading1 paragraphs | Yes (text) |
| Summary | One paragraph, labelled fields run together (`Label: value` separated by line breaks or nothing) | Yes: scan for known labels, not whitespace |
| Snapshot, Key Insights, section narratives | Heading2/Heading3 + paragraphs | Text yes; meaning needs a claim-type classifier |
| Distribution table | One real `w:tbl`: label row (2-column spans) -> `Actual/Target` row -> value row, twice | Yes (layout-aware) |
| What to Work On | Heading3 `Priority n` + paragraph | Yes (structure) |
| Images (3 in body + logo) | Force field, power-vs-time waveform, lap-view bar/line chart | Labels in image 1 only; charts have no data labels |
| Captions | `Image n: <view>` lines | Yes |

## Field map

Method: **TEXT** label regex, **TABLE** layout-aware cell read, **STRUCT** document structure, **IMAGE** printed text inside an image (vision/OCR),
**CHART** reading a plot without data labels (never auto-filled), **N/A** not in this report type.
Reliability: **R1** deterministic and verified on the specimen, **R2** deterministic but needs a classifier or a coach check,
**R3** vision, usable with confidence flags, **R4** not extractable, coach/other input required.

### R1: extract automatically (verified: 26 fields)

| SwimAnalysis path | Method | Notes |
|---|---|---|
| `session.date` | TEXT header | `Month dd, yyyy at hh:mm:ss AM/PM`. Stored as printed; time zone is not stated |
| `session.stroke` | TEXT summary | |
| `source.analysisContext.swimmerType` | TEXT summary | EO's label ("Distance"), context only |
| `session.distanceM`, `session.poolLengthM`, `session.laps`, `session.strokeCount` | TEXT summary | Unit words stripped (`200 metres`) |
| `session.timeS` | TEXT summary | `N mins S seconds` -> seconds |
| `metrics.strokeRate`, `.distancePerStrokeM`, `.avgPowerW`, `.workKj`, `.propulsivePct` | TEXT summary | `29.53str/min`, `2.82m`, `70.97W`, `12.4kJ`, `35.16%` (no space before unit) |
| `forceDistribution.overall.{propulsive,downward,upward,leftward,rightward,handDrag}Pct` | TABLE | 6 values; they sum to 100.1% |
| `eoReferenceRanges.*` | TABLE target cells | `<4%`, `70-75%`, `0%`, `17-22%` -> `lo`/`hi`. Table heading gives the EO context (swimmer type + stroke) |
| `powerProfile.right.doublePeakPctByLap[1..8]` | TEXT `lap n (x%)` list | EO prints a full 8-lap list for the affected side |
| `powerProfile.left.doublePeakPctByLap` | TEXT pattern ("0% ... across all laps") | Pattern match: expand to 8 zeros, mark MODERATE |
| `eoRecommendations[]` (text, area) | STRUCT | One per `Priority n` heading |
| `eoRecommendations[last].truncated` | STRUCT | Last paragraph lacks terminal punctuation (true in the specimen) |
| alternate values on `metrics.propulsivePct`, `downwardPct`, `leftwardPct`, `rightwardPct`, `handDragPct` | TEXT narrative regex | Parser must record every printed value: 34.67 / 40.38 / 15.41 / 7.7 / 1.23, beside the table values |

### R2: deterministic extraction, then classify or confirm

| Path | Method | Why not fully automatic |
|---|---|---|
| `eoObservations[]` (sentence-level, `area` from heading) | STRUCT + sentence split | Sentences split reliably (9 force-field sentences in the specimen). **`claimType` needs a classifier** (measurement vs diagnosis): rules for numeric-only sentences, a model for the rest, coach can override. Basis and confidence must be stored |
| `eoRecommendations[].audience` | rule | Clinical/referral wording must be flagged `COACH_ONLY`; a keyword rule catches it, a coach confirms |
| `leftRight.relativeOutput`, `leftRight.persistence` | rule over narrative | Phrases like "right arm ... more power ... across all eight laps" are parseable but are EO statements; mark MODERATE |
| `sourceIssues[]` (contradictions) | cross-field rules | Detectable: a summary-line value differing from the table; the same quantity printed twice; an arm gap quoted two ways; truncation. The contradiction between two *claims* needs a model or a coach |
| `powerProfile.*.shape` | derived | `MULTI_PEAK` if any lap > 0% double peaks, `SINGLE_PEAK` if all 0%. Derivation, not extraction; label it |

### R3: vision on embedded images

| Path | Method | Notes |
|---|---|---|
| `lapComparisons[].forceShares.from.*` (6 shares) | IMAGE label of the force-field image | Values are printed text and clear. **The image carries no lap label**; lap identity must come from the coach (`LapRef.status` stays AMBIGUOUS until confirmed) |
| `leftRight.avgPowerW.{left,right}` | IMAGE label | Printed as "Avg Impulse ... W" per arm, lap unlabelled (see S4) |

### R4: not extractable from this specimen

| Path | Why |
|---|---|
| `lapComparisons[].strokeRate.{from,to}`, `.pullPower.change`, `.propulsivePower.change`, per-lap force shares at lap 8 | Lap-view chart has no data labels. Bar heights are chart reads, never auto-filled. Needs EO's lap data/export, an EO screenshot with labels, or coach entry |
| `strokePhases.*.lapAverages` / `individualStrokes` | The stroke-phase view is **not in this document**. In the other EO layout (PDF) it is an embedded image with printed percentages and seconds, so a vision path exists there. Lap averages and single-stroke panels must be separated by what the panel is titled |
| `handPath.*`, `consistency.*`, `handPathAndPower` | Those views are not in the document |
| `metrics.avgForceN` | Not printed in this layout |
| `swimmer.name`, `swimmer.age`, coach | Not in the document: coach form |
| `session.location` | Printed, but identifying: store only after coach confirmation |
| `swimmer.communicationProfile` | Coach choice |

### Printed but unmapped

| Printed item | Handling |
|---|---|
| Summary field `swap: False` | No known meaning. Keep in a new `unmapped[]` list; never interpret |
| Video suggestions, logo, captions | Preserve as a recommendation flagged `COACH_ONLY` / ignore |

## Ambiguities the parser must record, not resolve

1. **One quantity, several printed values.** Propulsive 35.16 (summary) / 34.7 (table) / 34.67 (narrative); downward 40.4 / 40.38; leftward 15.4 / 15.41; hand drag 1.2 / 1.23 (the last with no unit). The parser stores all values with locations. Choosing one is an engine decision recorded in `selectionBasis`, not a parser decision.
2. **"Avg Impulse" in watts.** EO labels the per-arm figure "impulse" but gives watts. Whether it is per-arm power is unconfirmed.
3. **Arm gap quoted two ways** (about 50% and 20.44%), and the left arm described as both 50% weaker and the right 50% stronger.
4. **Lap identity of images.** Force-field image: no lap label. Lap chart: no data labels.
5. **Date/time zone.** Stored as printed.
6. **Two EO layouts exist** (this DOCX and a numbered-section PDF). The parser needs a layout detector and one extractor per layout.

## Schema changes required BEFORE implementing ingestion

| # | Change | Why | Blocking |
|---|---|---|---|
| S1 | `Provenance.extraction: { method: 'TEXT'\|'TABLE'\|'STRUCT'\|'IMAGE'\|'CHART'\|'MODEL'\|'MANUAL'; confidence: 'HIGH'\|'MODERATE'\|'LOW'; locator?: { section?, paragraph?, tableCell?, image?, page? } }` and `Provenance.raw` holds the printed token (e.g. `70.97W`) | The debug view needs SOURCE VALUE / NORMALISED VALUE / SOURCE LOCATION / EXTRACTION STATUS per field. Also add `Origin` values `EO_IMAGE_LABEL` and `CHART_READ` so chart reads are never confused with printed values | Yes |
| S2 | `Measured.absence?: 'NOT_IN_SOURCE' \| 'EXTRACTION_FAILED' \| 'COACH_REQUIRED'` when `status` is MISSING | The debug view must tell "this layout never has it" from "we failed to read it" | Yes |
| S3 | `source.documents: { kind: 'EO_REPORT_DOCX'\|'EO_REPORT_PDF'\|'EO_APP_SCREENSHOT'\|'COACH_ENTRY'; filename; sha256; layout: string }[]` replacing single `format`/`filename`; plus `source.layout` | A real assessment needs several inputs (report + stroke-phase screenshot + coach entry), and the layout detector must be recorded | Yes |
| S4 | Rename `leftRight.avgPowerW` -> `leftRight.avgImpulseW` (unit W), pending EO's confirmation of what it measures | The engine currently calls this "power". EO's own label is "impulse". Do not assert semantics we cannot source | Recommended before ingestion |
| S5 | `session.startTime: Observed<string>` | The header carries a time of day | No |
| S6 | `unmapped: { label: string; value: string; location: string }[]` | Printed fields with no schema home (e.g. `swap`) | No |
| S7 | `EoObservation.claimTypeBasis: 'RULE'\|'MODEL'\|'COACH'` and `.claimTypeConfidence` | Claim classification is not deterministic; record how it was decided | Yes (if observations are ingested) |
| S8 | `eoReferenceContext: { swimmerType: string \| null; stroke: string \| null }` | EO's reference ranges are specific to a swimmer type + stroke | No |
| S9 | `lapSeries: { lap: number; strokeRate?; leftPowerW?; rightPowerW?; shares? }[]` with `provenance.extraction.method` possibly `CHART` | Needed for future MULTI_LAP_TREND. Not needed to ingest this specimen | No (future) |

## Proposed ingestion architecture

```
input adapters   DOCX (zip + XML)  |  PDF (text + page images)  |  screenshot  |  coach entry
      -> layout detector     (EO_AI_DOCX_V1, EO_AI_PDF_V1, ...)
      -> layout extractors   TEXT / TABLE / STRUCT deterministic first; IMAGE (vision) second; CHART never
      -> normaliser          units, ranges, "<4%", "mins s", alternates, selection NOT decided here
      -> SwimAnalysis        source layer only + provenance.extraction + absence reasons + sourceIssues
      -> debug view          SOURCE VALUE | NORMALISED VALUE | SOURCE LOCATION | EXTRACTION STATUS
```

Dependencies to decide: a zip reader for DOCX in the serverless runtime (the spike shells out to `unzip`; production needs a library),
and PDF text extraction. Vision extraction reuses the existing `/api/lab-report` extraction call, but only for R3 fields and with every
value flagged `IMAGE` + confidence.

## What the parser must NOT do

- Fill any R4 field from a chart.
- Pick between conflicting printed values.
- Classify EO prose as measured evidence without a recorded basis.
- Store EO prose in source control (test fixtures use paraphrase; real analyses live in the database).
