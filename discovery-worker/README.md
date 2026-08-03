# discovery-worker

The Global Swim Discovery candidate-extraction worker for SwimLoading. A
separate Node/TypeScript package inside the main SwimLoading repository —
**never** part of the existing static web app's build, **never** deployed
by Vercel. Deploys independently, later, to Railway.

## Purpose

Turns a retrieved event-listing page (organiser site, listings page, etc.)
into a normalised, evidence-scored **candidate event** — never a published
event. This package's job stops at producing a candidate; nothing here
writes to the existing `swim_events` table, and nothing here talks to
Supabase at all yet.

## Architecture boundary

- **This package never writes to `swim_events`, or to any other existing
  SwimLoading table.** Candidates are a separate concept (`discovery_candidate_events`
  in the eventual schema), reviewed and promoted by an admin — that
  promotion step is a later phase, not this one.
- **This package has its own `package.json` and dependencies**, isolated
  from the root `package.json` used by `scripts/`. No workspace, no
  Turborepo/Nx, no shared `node_modules`.
- **The existing app (`app.js`, `admin.html`, `club-admin.html`, `index.html`,
  `api/`) is untouched.** This worker doesn't import from, or get imported
  by, any of it.
- The only repo-root change this package required was adding
  `discovery-worker/` to `.vercelignore` — see the root `.vercelignore`
  comment for why (this repo has a documented history of committed files
  becoming publicly fetchable by literal path if not explicitly excluded).

## Installation

```bash
cd discovery-worker
npm install
cp .env.example .env   # optional in this phase — every flag defaults to false/off anyway
```

Requires Node 20.6+ (uses `--env-file-if-exists`); developed and tested on
Node 22.

## Commands

```bash
npm run dev -- --fixture fixtures/valid-single-event.html   # process one fixture
npm run process:fixtures                                    # process every fixture in fixtures/
npm test                                                     # run the node:test suite
npm run typecheck                                            # tsc --noEmit
```

Output is written to `out/<fixture-name>.json` (gitignored — regenerated
by running the commands above).

## Fixture approach

There is no live network fetch in this phase. Every input is a checked-in
HTML fixture in `fixtures/`, written to resemble a realistic organiser
page (JSON-LD, or deterministic HTML selectors, or both) without copying
any real, copyrighted event page. The fixture set deliberately covers:

- a single well-formed event (JSON-LD only)
- multiple distances within one event (HTML `.distance-options` selectors)
- JSON-LD nested inside `@graph`, with `@id`-referenced organiser/venue
- month-and-year-only, and day-and-month-with-no-year, date text
- a historical (past) results page
- a pool-only event, and a triathlon page with no separate swim entry
- a cancelled event
- two pages describing the same real-world event under different names,
  for duplicate-detection testing

## Output format

Each `out/<fixture-name>.json` contains:

```jsonc
{
  "fixturePath": "...",
  "candidate": { /* the full normalised CandidateEvent, see src/domain/candidate-event.ts */ },
  "classification": { "classification": "...", "eligible": true, "reasons": [...], "warnings": [...] },
  "confidence": { "totalScore": 80, "reasons": [...], "recommendation": "high_confidence" },
  "validation": { "valid": true, "errors": [] },
  "possibleDuplicates": [ { "comparedTo": "...", "result": { "score": 77, "matchingSignals": [...], "conflictingSignals": [...], "possibleDuplicate": true } } ]
}
```

## Proposed database mapping (Phase 2 — schema only, no persistence code)

The Phase 2 migration `sql/applied/2026-08-03_discovery-schema-v1.sql`
was **applied to production on 2026-08-03**, so the tables this worker
will write to now exist (and are empty).

Persistence is now **implemented** behind `DISCOVERY_WRITE_ENABLED` (see
"Write mode" below), which still defaults to `false` — a default run
remains a pure dry run writing only to `out/*.json`.

`CandidateEvent` (`src/domain/candidate-event.ts`) maps to
`discovery_candidate_events`, camelCase to snake_case:

| Worker field | Column | Note |
|---|---|---|
| `candidateKey` | `candidate_key` | ✅ Implemented — `src/domain/candidate-key.ts`. sha256 of (normalised source URL \| normalised name \| edition **year**), truncated to 32 chars. `UNIQUE (source_id, candidate_key)` makes re-extraction an upsert, not a duplicate. |
| `sourceId` | `source_id` | FK → `discovery_sources`. The worker's own value is `fixture:<path>`; in write mode it resolves to the synthetic fixture source row (see below). |
| `sourceUrl` / `officialUrl` / `registrationUrl` | `source_url` / `official_url` / `registration_url` | |
| `canonicalName` / `originalName` | `canonical_name` / `original_name` | |
| `eventType` | `event_type` | Same nine-value vocabulary, CHECK-constrained |
| `status` | *(not stored on the candidate)* | See "contract gaps" below |
| `organiserName` / `venueName` | `organiser_name` / `venue_name` | Plus nullable `proposed_organiser_id` / `proposed_venue_id` for admin-confirmed links |
| `locationText`, `city`, `region`, `countryCode` | same, snake_case | |
| `latitude` / `longitude` | `latitude` / `longitude` `numeric(9,6)` | CHECK: both-or-neither, plus range |
| `startDate` / `endDate` | `start_date` / `end_date` `date` | |
| *(from `rawSourceValues.htmlDateText`)* | `original_date_text` | Promoted to a real column |
| `datePrecision` / `dateConfirmed` | `date_precision` / `date_confirmed` | Anti-inference CHECK mirrors `validation.ts` exactly |
| `distances[]` | **`discovery_candidate_distances`** | One row per option — never an array, never JSON-only |
| `waterBodyType` / `wetsuitPolicy` | same, snake_case | |
| `descriptionSummary` / `extractionMethod` | same, snake_case | |
| `confidenceScore` / `confidenceReasons` | `confidence_score` (0–100) / `confidence_reasons` jsonb | |
| *(from `ConfidenceBreakdown.recommendation`)* | `publication_recommendation` | Promoted to a real column |
| `warnings` / `rawSourceValues` | `warnings` / `raw_source_values` jsonb | |
| `evidence[]` | **`discovery_event_evidence`** | One row per field, so the review UI can show which snippet supports which value |
| `extractedAt` | `extracted_at` | |

### Why the candidate key is keyed on the YEAR, not the full date

Two failure modes pull in opposite directions:

- Key on the **full date** → an organiser correcting "12 June" to "13
  June" mints a brand-new candidate and the old one lingers as a phantom.
  Change monitoring breaks.
- Key on **no date** → an annual race at a stable URL collides with
  itself every year: the 2028 listing overwrites the 2027 candidate.
  Historical editions are destroyed.

Year-granularity avoids both — a same-year correction updates in place, a
new year gets its own candidate. Both behaviours are covered by tests in
`test/candidate-key.test.ts`.

Deliberately excluded from the key: confidence score, classification,
distances, warnings, coordinates. All legitimately change between
extractions of the same event; none changes its identity.

### Contract gaps

1. ~~`candidate_key` does not exist~~ — ✅ **closed**, see above.
2. **`CandidateEvent.status`** (`scheduled`/`cancelled`/…) still has no
   dedicated column on `discovery_candidate_events` — the table's
   `candidate_status` is the *review* state, a different thing. The fact
   is **not dropped**: the writer stores it as
   `raw_source_values.eventStatus` and in `raw_payload.status`, and
   there's a test asserting the cancelled fixture round-trips it. Still
   worth a small additive migration to give it a real column before the
   review UI needs to filter on it — **not done here**, since that needs
   the `MIGRATIONS.md` approval gate.
3. **`start_time` type differs by design.** Candidate distances store it
   as `text` (raw extraction may be `"TBC"`); published
   `event_distances.start_time` is a real `time`. The cast happens at
   admin-reviewed promotion, not in the worker.

Full schema rationale: `docs/global-swim-discovery/database-schema.md`.

## Write mode

Off by default. A normal run is a dry run: fixtures in, `out/*.json` out,
nothing touches the database.

```bash
# dry run (default) — no credentials needed, no DB access
npm run process:fixtures

# write mode — requires BOTH variables, refuses to start without them
DISCOVERY_WRITE_ENABLED=true \
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
  npm run process:fixtures
```

What a write run does, in order:

1. **Upserts one synthetic source row** (`discovery_sources`, fixed id
   `00000000-0000-4000-8000-000000000001`, `enabled=false`) representing
   `fixtures/`. It is deliberately disabled so no future scheduler can
   ever treat it as a real crawl target. Real sources stay an admin
   action.
2. **Opens a `discovery_runs` row**, and closes it at the end with
   counters — `succeeded`, or `partial`/`failed` with the error recorded,
   so a broken run is visible rather than looking like it never happened.
3. Per fixture: **upserts a `discovery_source_pages` row** with a
   sha256 `content_hash` (the change-monitoring primitive), then
   **upserts the candidate** on `(source_id, candidate_key)`, then
   **replaces** its distances and evidence.

Children are deleted-then-inserted rather than upserted: distances and
evidence have no natural key and are wholly derived from the current
extraction, so replacement is the correct semantic and stops re-runs
stacking duplicates.

`SUPABASE_SERVICE_KEY` bypasses RLS completely. It belongs only in this
server-side worker — local `.env` or Railway's environment. Never in
browser code, never committed, never logged.

## Output format (current — local JSON only)

Every candidate field is `null` when unknown — nothing is invented or
defaulted. `confidenceReasons`/`confidence.reasons` and `evidence` make
every point on the score, and every extracted fact, traceable back to
where it came from (a specific JSON-LD field or a specific CSS selector).

## Safety flags

```
DISCOVERY_WRITE_ENABLED=false
DISCOVERY_LIVE_FETCH_ENABLED=false
DISCOVERY_PLAYWRIGHT_ENABLED=false
DISCOVERY_AI_ENABLED=false
DISCOVERY_MAX_PAGES_PER_RUN=5
DISCOVERY_MAX_AI_CALLS_PER_RUN=0
```

All four capability flags **must** stay `false` in this phase — none of
the corresponding capability is implemented yet. `src/config.ts`'s
`assertPhaseOneSafe()` refuses to start (exits non-zero with a clear
message naming every offending flag) if any is set to `true`. This is not
a soft warning — verified by running the process with each flag flipped.

## What is deliberately not implemented

- **Live network fetching.** Every `SourceRecord` comes from a fixture
  file read off disk (`jobs/process-fixture.ts`).
- **Playwright extraction.** No headless browser dependency at all.
- **AI-assisted extraction fallback.** No LLM call, no API key read for
  this purpose. Confidence scoring is 100% deterministic rule-based
  arithmetic (`confidence/rules.ts`) — never an LLM-generated score.
- **Duplicate merging.** `dedupe/match.ts` only ever scores a pair and
  reports signals — it never merges, updates, or deletes a record.
- **Source health tracking, retry/backoff, change monitoring.** These
  belong to the (not-yet-built) `discovery_sources`/`discovery_runs`
  tables and a real scheduler — out of scope while everything is
  fixture-only.
- **Status-aware confidence scoring.** A cancelled event (see
  `fixtures/cancelled-event.html`) is correctly captured with
  `status: "cancelled"`, but the confidence scorer does not currently
  penalise cancelled/postponed events — a future phase should decide
  whether/how status should affect the publication recommendation.
- **Geocoding.** `normalize/location.ts` only maps a small fixed set of
  country names to ISO codes and never resolves a free-text place name to
  coordinates — coordinates only ever come from a structured JSON-LD
  `geo` block.

## Next implementation phase

Per the approved architecture, the next task is **not** live scraping —
it's proving the write path safely:

1. ~~Stand up the additive `discovery_*` schema~~ — ✅ **DONE**. Applied
   to production 2026-08-03 as
   `sql/applied/2026-08-03_discovery-schema-v1.sql`. All 13 tables + the
   `public_organisers` view exist and are empty.
2. ~~Add `DISCOVERY_WRITE_ENABLED=true` support~~ — ✅ **DONE**. Service-role
   client, `candidate_key`, and the upsert path into
   `discovery_candidate_events` / `discovery_candidate_distances` /
   `discovery_event_evidence` / `discovery_source_pages` /
   `discovery_runs`. Row shapes verified against the live schema
   (including the idempotency guarantee) in a rolled-back transaction.
   **A real end-to-end write run has not been executed yet** — it needs
   `SUPABASE_SERVICE_KEY` in `discovery-worker/.env`.
3. **Next:** run the worker once for real in write mode, confirm the 11
   fixture candidates land, then run it a second time and confirm the row
   count is unchanged (idempotency in practice, not just in a test).
4. Then: one real, approved source, `DISCOVERY_LIVE_FETCH_ENABLED=true`,
   with the page/cost budgets in `.env` actually enforced (they're read
   but not yet enforced against anything real in this phase).

Playwright and AI-assisted extraction remain later still, gated behind
their own flags, only once deterministic extraction has proven
insufficient against real, approved sources.
