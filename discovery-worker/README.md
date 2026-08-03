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
npm run crawl                                               # one live-crawl pass over due sources, then exit
npm run crawl -- --source <uuid>                            # crawl one source now, ignoring next_run_at
npm run crawl:loop                                          # long-running scheduler (Railway start command)
npm run crawl:url -- https://…                              # ad-hoc single page -> out/, never the DB
npm test                                                     # run the node:test suite (141 tests)
npm run typecheck                                            # tsc --noEmit
```

All `crawl*` commands require `DISCOVERY_LIVE_FETCH_ENABLED=true` and
refuse to make any network request without it. The scheduler modes also
need `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` (they read
`discovery_sources` even in dry-run); with `DISCOVERY_WRITE_ENABLED=false`
they fetch politely but write extraction output to `out/` instead of the
database — a full shakedown mode.

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

## The live crawler (src/crawl.ts)

Implemented 2026-08-03. Every network request goes through
`fetch/http-client.ts` (`PoliteHttpClient`), which guarantees:

- **robots.txt checked before every page request** (parsed per RFC 9309:
  group selection, longest-match, wildcards, `$` anchors; cached per
  origin per process). No robots.txt (404) = allowed; robots.txt
  *unreachable* (5xx/network) = the whole host is skipped this run —
  conservative on purpose. `discovery_sources.robots_checked_at` is
  stamped on every run that consulted robots.
- **One request at a time per host**, minimum 5s apart (configurable),
  honouring the site's `Crawl-delay` up to a 30s cap.
- **An identifiable UA** — `SwimLoadingDiscoveryBot/1.0 (+https://www.swimloading.com/explore; contact: dave.welensky@gmail.com)`
  — never a disguised browser string.
- **Bounded retries** (3, exponential backoff, `Retry-After` honoured) on
  429/5xx/network only. A 403/404 is a fact and is never retried.
- **Bounded bodies** (5MB cap) and HTML-only content types.

### Crawl modes (per source, decided by `parser_type`)

- **Listing mode** (`jsonld`/`html`/`jsonld_html`): fetch `base_url`,
  discover same-registrable-domain links (structural filtering only —
  never English keywords, so non-English sites work), then fetch known
  event URLs first (verification) and new links after, within
  `DISCOVERY_MAX_PAGES_PER_RUN`. Overflow defers to the next run.
- **Verification mode** (`manual`, e.g. the researched umbrella sources):
  only re-fetch the URLs of pages/candidates the source already has.
  This is the change-monitoring loop: `content_hash` comparison feeds
  `last_changed_at` and `discovery_runs.pages_changed`.

Pages DISCOVERED from a listing must extract a name plus a date or
distances to earn a candidate row (`shouldPersistDiscoveredPage`); known
event URLs always re-persist (same `candidate_key` → idempotent update).
After writing, each new candidate is scored against everything the source
already has (`dedupe/match.ts`) and unresolved duplicate links are
written — these block approval until reviewed.

Source health is maintained on every run: `last_run_at`,
`last_success_at`, `consecutive_failure_count`,
`health_status` (healthy/degraded/failing/blocked), and `next_run_at`
from `crawl_frequency` with exponential backoff (capped 4×) on repeated
failure.

### Multilingual behaviour ("check all languages")

- Bodies are decoded by their **declared charset** (BOM → Content-Type →
  `<meta charset>` → UTF-8), so ISO-8859-x / Windows-125x organiser pages
  don't mangle names. (`fetch/decode.ts`)
- `Accept-Language` is negotiated from the source's `language_codes`
  column, English as fallback.
- The page's declared language (`<html lang>`, `og:locale`,
  Content-Language) is recorded on every candidate
  (`raw_source_values.pageLanguage`), and non-English pages carry an
  explicit reviewer warning that deterministic extraction is
  English-tuned beyond JSON-LD.
- JSON-LD extraction (the primary path) is language-agnostic.
- `candidate_key` and dedupe name normalisation are **Unicode-aware**
  (NFKD, diacritics folded, all scripts preserved). The old ASCII-only
  rule collapsed a fully non-Latin name to `''` — every such event on a
  page would have shared one key. ASCII names produce byte-identical
  output to the old rule, so existing keys are unchanged
  (`test/i18n-normalisation.test.ts` pins both properties).
- Link discovery and the persistence gate use **no language-specific
  keywords** anywhere.

### Deploying to Railway

The repo ships `railway.json` (Nixpacks, `npm run crawl:loop`,
restart-on-failure). In the Railway service settings set **Root
Directory: `discovery-worker`**, and set environment variables:
`DISCOVERY_LIVE_FETCH_ENABLED=true`, `DISCOVERY_WRITE_ENABLED=true`,
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (plus any politeness overrides).
The scheduler wakes every `DISCOVERY_SCHEDULER_INTERVAL_SECONDS` (900)
and crawls whatever `next_run_at` says is due, so the process is idle
almost always. SIGTERM finishes the current pass before exiting.

## Safety flags

```
DISCOVERY_WRITE_ENABLED=false
DISCOVERY_LIVE_FETCH_ENABLED=false
DISCOVERY_PLAYWRIGHT_ENABLED=false
DISCOVERY_AI_ENABLED=false
DISCOVERY_MAX_PAGES_PER_RUN=25
DISCOVERY_MAX_AI_CALLS_PER_RUN=0
```

Write mode and live fetch are implemented but default **off** — the
default run remains a pure dry run. Playwright and AI extraction are NOT
implemented, and `assertConfigSafe()` refuses to start (exits non-zero
with a clear message) if either is set to `true`. `.env.example`
documents every politeness/budget knob.

## What is deliberately not implemented

- **Playwright extraction.** No headless browser dependency at all.
  (Rottnest's organiser site 403s automated fetches — a headless browser
  wouldn't change that; it needs a different sourcing strategy anyway.)
- **AI-assisted extraction fallback.** No LLM call, no API key read for
  this purpose. Confidence scoring is 100% deterministic rule-based
  arithmetic (`confidence/rules.ts`) — never an LLM-generated score.
- **Duplicate merging.** `dedupe/match.ts` only ever scores a pair and
  reports signals — it never merges, updates, or deletes a record.
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

1. ~~Stand up the additive `discovery_*` schema~~ — ✅ **DONE** (applied
   2026-08-03, `sql/applied/2026-08-03_discovery-schema-v1.sql`).
2. ~~`DISCOVERY_WRITE_ENABLED=true` write path~~ — ✅ **DONE**.
3. ~~Live crawler~~ — ✅ **DONE 2026-08-03**: polite HTTP client,
   robots.txt, listing/verification crawl modes, scheduler,
   change monitoring, source health, multilingual decoding — see "The
   live crawler" above. Page budgets are now actually enforced.
4. **Next:** apply `sql/2026-08-03_enable-live-discovery-sources.sql`
   (MIGRATIONS.md gate), run `npm run crawl` locally in dry-run to
   shake down the three sources, flip `DISCOVERY_WRITE_ENABLED=true`,
   then deploy to Railway (see "Deploying to Railway").

Playwright and AI-assisted extraction remain later still, gated behind
their own flags, only once deterministic extraction has proven
insufficient against real, approved sources. AI-assisted extraction is
also the planned answer for non-English pages without JSON-LD — the
deterministic HTML selectors are English-tuned and non-English pages are
already flagged per-candidate (`pageLanguage` warning) so reviewers can
see exactly where that gap bites.
