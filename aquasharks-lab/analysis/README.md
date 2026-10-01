# Aqua Sharks SwimBETTER analysis

EO Labs measures. Aqua Sharks interprets. This folder is the interpretation pipeline.
Plain ES modules (no build step); the schema is TypeScript (`types.d.ts`) and the JS is checked against it
with `npm run lab:typecheck` (`tsc --strict --checkJs`).

```
EO report ──► [parser, Phase 5] ──► SwimAnalysis (source layer, never edited by the engine)
                                        │
   model.js     emptyAnalysis(): everything MISSING; overlay() fills only what a source printed
   calc.js      pure maths: % change, early/late, left/right asymmetry, conservative comparison, cross-check, confidence
   rules.js     deterministic rules ──► Finding[]   (classification, confidence, evidence refs, caveats)
   engine.js    applyReview() (coach decisions) ──► priorities.js ──► quality.js ──► report-model.js
   profiles.js  JUNIOR | PERFORMANCE | MASTERS_OPEN_WATER | COACH  (presentation only, same findings)
   report-view.js  ReportModel ──► HTML.  Omits any MISSING section. Knows nothing about EO.
```

## Rules of the model
- A value exists only if a source or a coach supplied it (`status` + `provenance`). Nothing is inferred into a number.
- Ranges stay ranges. A midpoint is never invented. Derived values are labelled `DERIVED`.
- Classifications: MEASURED, OBSERVED, INFERRED, COACH_CONFIRMATION_REQUIRED. An inferred diagnosis can never be MEASURED
  and reaches a swimmer only after a coach confirms it.
- Confidence: HIGH only for exact complete printed values. Approximate, ranged, partial or conflicting inputs cap at MODERATE; ambiguous or missing is LOW.
- Stroke phases: lap averages and individual strokes are separate collections. Swimmer-facing conclusions read lap averages only; a single stroke never substitutes for one.
- A lap comparison names its actual laps (e.g. lap 1 vs lap 8, 0-25 m vs 175-200 m). An ENDPOINT_CHANGE is never described as a trend or as fatigue; only a future MULTI_LAP_TREND may be.
- Several printed values for one quantity are all kept with locations. The one used is a recorded source-selection decision (`selectionBasis`), not ground truth.
- No formula is assumed between pull power, force share and propulsive power. Independent signals are corroborated by direction only.
- EO's own diagnoses, reference ranges and clinical advice are preserved in the source layer, shown only to the coach, and never become thresholds.
- Priorities: ranked by classification x confidence x rule impact, ties by rule order. Max 3 to a swimmer (JUNIOR 2).

## Rules implemented
POWER_EFFECTIVENESS, LAP_COMPARISON (endpoint comparison, corroborated by direction), ASYMMETRY_PROFILE (power, double peaks, lap-average phase timing),
POSSIBLE_TECHNICAL_OPPORTUNITY (always coach-confirmation-required unless hand-path evidence exists and a coach confirms), OUTPUT_SUMMARY.

## Fixtures
`fixtures/test-swimmer-a-200m.js` (synthetic, full) and `fixtures/test-swimmer-b-sprint.js` (synthetic, thin source: proves graceful degradation).
Fixtures are synthetic and anonymised: numeric test data plus short paraphrases. No EO prose and no real identity (enforced by `test/lab-fixture-hygiene.test.js` using hashed 6-word fingerprints). Fixture values are not thresholds for other swimmers.

EO ingestion: `parser/` (PDF + DOCX), specified in `PARSER_FIELD_MAP.md`. The coach workflow (upload, review, publish, PDF) is `aquasharks-lab-report-builder.html` + `report-builder/app.js` over `api/lab-report*.js`.

## Tests
`test/lab-analysis-*.test.js`, run by `npm test`.
