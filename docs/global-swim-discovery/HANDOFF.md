# Global Swim Discovery — Handoff

**As at 2026-08-05.** Live in production unless explicitly marked
otherwise. Supersedes the 2026-08-03 version; unchanged parts are restated
here rather than left behind.

---

## 1. Where it stands

| | |
|---|---|
| Live upcoming events | **250** |
| Countries | **28** |
| Sources enabled | 37 |
| Sources actually producing | **34** (was 11 on 4 Aug) |
| Candidates total | 1,423 |
| Of those, AI-extracted | **756** |
| Awaiting review | 582 |

Two days ago this was 38 events, almost all Ray's Notebook. The jump came
from two changes on 4 August: raising the per-source page budget from 5 to
25, and AI extraction.

### Access

- **Public:** https://www.swimloading.com/explore — no login. Still
  `noindex,nofollow`; see §6.
- **Admin:** https://www.swimloading.com/discovery-review — needs
  `profiles.is_admin = true`.
- **Worker:** Railway project `heartfelt-benevolence`, service
  **Swimloading**, root directory `discovery-worker`. **No auto-deploy** —
  a push does nothing until you click Redeploy.

---

## 2. The extraction ladder

A page stops at the first thing that works:

1. **JSON-LD** — schema.org `Event`. Rare, perfect when present.
2. **Tabular calendar** — a whole season in one `<table>`. Ray's Notebook
   is 338 swims this way; Japan and Brazil the same shape.
3. **CSS selectors** — fixture-shaped, rarely fires on real sites.
4. **Headless render** (Playwright, off by default) — for JS shells.
5. **AI extraction** — last resort, only for pages the four above failed on.

### What the model is allowed to do

**Read. That is all.** It copies what a page prints into six columns —
name, date, place, distances, time, link — verbatim, in any language. The
output is coerced into the same `TableEventRow` the tabular parser emits
and handed to the same `buildFromRow`, so dates, locations, distances,
classification and confidence are computed by unchanged rule-based code.

It never resolves a year, parses a distance, supplies coordinates, or
produces a score. **Confidence scoring is 100% deterministic arithmetic and
must stay that way.**

Provenance is total: `extraction_method = 'ai_fallback'` on the candidate,
`evidence_type = 'ai_fallback'` on every evidence row, plus a per-candidate
warning. `WHERE extraction_method = 'ai_fallback'` is a complete answer to
"what did a model give us?".

---

## 3. What it costs — measured, not estimated

First production call (FFN calendar, `claude-opus-5`): 14,488 condensed
chars → **9,851 in / 6,751 out = $0.22/page**. Then switched to
`claude-sonnet-5`. The sweep so far:

| | |
|---|---|
| AI calls | 135 |
| Tokens | 539,039 in / 95,574 out |
| **Cost** | **≈ $2** at Sonnet intro pricing |

Two lessons worth carrying:

- **Non-English text tokenizes ~2× as densely as English.** French ran
  1.47 chars/token against the ~3 assumed. Never size an AI budget from
  character counts.
- **Output dominated on Opus** (~77% of the bill, ~182 tokens/event) and
  collapsed on Sonnet.

### The four things keeping it cheap

1. **Condensing** — median 109 KB of markup carries 6 KB of readable text;
   `condenseForAi` strips to text plus link targets (median 7.4 KB). The
   biggest lever by far: that $0.22 page would have cost ~$2.60 raw.
2. **Thin-page floor** — under 400 condensed chars, no call at all.
3. **Unchanged pages are never re-read.**
4. **URL-score floor** (`DISCOVERY_MIN_AI_URL_SCORE=2`). Japan burned
   86,459 tokens for **zero** candidates before this existed.

Sonnet intro pricing ends **31 Aug 2026** (then ~$0.13/page).
`DISCOVERY_AI_MODEL` makes the model a variable, not a deploy.

---

## 4. Rules that must not be broken

Each was learned by breaking it.

**A wave is not an event.** Midmar publishes its start-wave schedule on one
page; the extractor turned each wave into an event and **seven reached the
live site**, including "Disabled, Pope-Ellis and 71yr/over" — a disability
start category offered publicly as a swim you could enter.
`rejectAsEventName()` in `normalize/text.ts` blocks numbered placeholders,
section headings, age brackets and entry classifications **at build time,
before a candidate exists** — not by scoring low, because a low score still
reaches the queue and can still be auto-approved. Tested for **precision
over recall**: eleven real names must survive, because a false positive
silently deletes a real swim.

**An unconfirmed date is never stored.** The schema enforces
`date_confirmed OR (start_date IS NULL AND end_date IS NULL)`. Violating it
doesn't make a weak candidate — it throws on INSERT and **aborts the whole
source's crawl**. `toCandidateEventRow` enforces the same rule as a backstop.

**A page-stated year is read, not inferred.** `pageYearFrom` reads the year
off the page's own heading; a row saying `6月28日` under a `2026` heading has
stated both halves. A printed weekday still wins — it *verifies* rather than
accepts, and can override the heading.

**Cross-language month collisions are refused.** `listopad` is November in
Polish and October in Croatian, and both are live sources. `buildLookup()`
detects collisions at load and leaves them unparsed with a warning.

**Thousands separators are refused.** `1,500` is 1.5 km in half of Europe
and 1500 m in the other half. European decimal commas *are* handled.

**Standard triathlon distances are defined, not inferred.** Sprint 750 m,
Olympic/Standard 1500 m, Middle/70.3 1900 m, Full 3800 m — World Triathlon
definitions. Only consulted once a page is identified as multisport, so
"Sprint" on an open-water listing is never 750 m.

**Discipline is separate from event type.** A triathlon's swim leg *is* an
`official_race`; what differs is `discipline = 'multisport_swim_leg'`.
`/explore` shows open water only unless the viewer opts legs in, and the
column defaults to `open_water` so that holds even if a client forgets.

**`candidate_key` is keyed on the YEAR, not the full date.** Re-crawling
within a year updates the same candidate; next year's running becomes its
own. Keying on the full date leaves phantoms; keying on no date destroys
historical editions. See `test/candidate-key.test.ts` before touching it.

---

## 5. Water temperature

Two different kinds of fact, deliberately in two tables.

**Observation** — `venue_water_readings`, Open-Meteo Marine, 6-hourly via
`/api/cron/venue-marine-temps.js`. Shown only within 14 days: it's today's
water, a fair guide to next weekend and meaningless further out.

**Climatology** — `venue_water_climatology`, Copernicus reanalysis, built by
`scripts/copernicus-climatology.py`. What the water *typically* does in a
given week across 20 years. Answers "what will it be in March?".

- Table applied 2026-08-05; **not yet populated** — run the script.
- Proven end to end: Amagansett week 27 = **19.7 °C (18.2–21.3), 20 years**.
- ~10 s and 1.76 MB per venue; 162 venues ≈ half an hour. Idempotent.
- Credentials: `~/.copernicusmarine` (written by `cm.login()`) **or** the
  `COPERNICUSMARINE_SERVICE_*` env vars. Either works.
- Dataset (verified via `--describe`, not guessed):
  `METOFFICE-GLO-SST-L4-REP-OBS-SST`, variable `analysed_sst`, **kelvin**,
  1981-10-01 → 2026-03-31.

**Coverage is the thing most likely to be misunderstood.** Copernicus SST is
*sea* surface temperature — ocean only, 0.05° grid. Of 162 venues with
coordinates, ~84 are on the marine grid. Lakes, dams and rivers get nothing,
exactly as they do today. This makes coastal venues answerable for **any
date**; it does not widen **which venues** are answerable. The script names
uncovered venues individually rather than counting them.

---

## 6. Needs your attention

> **Closed 2026-08-05.** The two security items that used to head this list
> are applied and verified; both migrations are in `sql/applied/`.
>
> - **`profiles.is_admin` self-escalation** — a `BEFORE UPDATE` trigger now
>   rejects any update that changes the column. Confirmed at apply time that
>   the risk was live: `profiles_update_own` is `auth.uid() = id` with no
>   column restriction and no trigger guarded it. There is **no bypass by
>   design** — granting an admin now means bracketing the `UPDATE` with
>   `DISABLE`/`ENABLE TRIGGER`, spelled out in the migration's operational
>   note. Read that before you next try to make someone an admin.
> - **Auto-publish of AI-read candidates** — `auto_publish_eligible_candidates`
>   gained `AND c.extraction_method <> 'ai_fallback'`. The 2026-08-04
>   publish-and-label decision is **not** reversed; only the model-read rows
>   are held, because a tier can describe a thin listing but not a row that
>   was never an event. Prospective only: nothing was eligible at apply time,
>   so it bites on the next crawl.
>
> **Still open from that second one:** 56 published editions already trace to
> an AI-read candidate (40 `manual_review`, 16 `insufficient_evidence`). They
> were deliberately left live — most are probably real swims, so a review
> pass beats a bulk delete. The query that lists them is in
> `sql/applied/2026-08-05_ai-candidates-require-review.sql`.

**1. `/explore` is still `noindex,nofollow`.** With 250 events across 28
countries the original reason (thin, US-heavy coverage) has largely gone.
This is the single biggest constraint on the whole effort — nobody can find
it. Remove the meta tag in `explore.html` when you're happy.

**2. 582 candidates awaiting review.** Many are dateless rows that should
resolve themselves now that page-stated years are accepted, as sources
re-crawl.

**3. Populate the climatology.** `python3 scripts/copernicus-climatology.py`.

**4. Two events published on indirect sourcing**, both `manual_review`,
both worth verifying: *South32 Rottnest Channel Swim* 20 Feb 2027 (organiser
403s automated fetches; date from search-index snippets) and *Dublin City
Liffey Swim* 29 Aug 2026 (secondary listing).

**5. Oceanman distances are derived, not stated.** Their calendar lists
category names. The mapping (OCEANMAN=10km, HALF=5km, SPRINT=1.5km,
OCEANKIDS=500m, OCEANTEAMS=3×500m, ULTRA=21km) was verified on two race
pages and applied to 17 others. Recorded as a warning on every candidate.

**6. `/explore` loads every event and filters client-side.** Fine at 250;
needs server-side bounding-box queries in the low thousands. The 1000-row
ceiling is a stopgap and is commented as one.

---

## 7. Not built

**Wetsuit legality.** The obvious triathlon product: federations set it by
measured water temperature. Blocked on two things — thresholds must be
sourced from current World Triathlon and Ironman rulebooks (they differ by
federation and by age-group vs elite) and stored as versioned data, not
constants; and predicting months out needs the climatology populated.

**Lake and river temperature.** Neither Open-Meteo nor Copernicus covers
inland water. Needs a different source, or swimmer-reported only.

**Duplicate merging.** `dedupe/match.ts` scores pairs and reports; it never
merges. `aQuellé Midmar Mile` and `54th aQuellé Midmar Mile` are the same
race and want merging by hand.

**Geocoding.** `explore.html` uses a place list built from the loaded data
plus browser geolocation. An arbitrary place name needs a real geocoder.

**Region grouping.** A radius circle from Manchester treats Dublin (flight)
and Edinburgh (train) as equivalent. "Scotland 5 · Ireland 3 · Lakes 4"
matches how weekend trips are actually planned.

---

## 8. Configuration

Railway service **Swimloading** → Variables:

```
DISCOVERY_LIVE_FETCH_ENABLED=true
DISCOVERY_WRITE_ENABLED=true
DISCOVERY_AI_ENABLED=true
DISCOVERY_AI_MODEL=claude-sonnet-5
DISCOVERY_MAX_AI_CALLS_PER_RUN=5        # per source per run, NOT global
DISCOVERY_MIN_AI_URL_SCORE=2
DISCOVERY_MAX_PAGES_PER_RUN=25
ANTHROPIC_API_KEY=...
SUPABASE_URL=https://szgkzuswelntnevobnoh.supabase.co
SUPABASE_SERVICE_KEY=...
```

`DISCOVERY_MAX_AI_CALLS_PER_RUN` is **per source, per run**. At 25 across 26
sources that is up to 650 calls in one sweep. Raise it only with measured
numbers from `discovery_runs.metrics` in hand.

Every capability flag defaults to **false** and each mode fails **closed** —
AI enabled with no key, or with a cap of 0, both refuse to start.

---

## 9. Gotchas that cost real time

- **`SUPABASE_URL` must be the full URL.** A bare project ref crash-loops
  the worker. Set it **directly on the service**, not as a shared variable.
- **`CREATE OR REPLACE FUNCTION` cannot add a column to `RETURNS TABLE`.**
  Needs `DROP FUNCTION` first — and **the drop takes the grants with it**.
  `/explore` calls `search_event_editions` as `anon`; losing that grant
  breaks the page for logged-out visitors only.
- **A view joined per-row is a timeout.** `search_event_editions` joined
  `venue_temp_estimate` and the planner re-ran the whole view once per
  output row: 297,553 buffers, 507 ms for 192 rows. `WITH temps AS
  MATERIALIZED` fixed it — 25 ms. **Compare buffers, not milliseconds**:
  the first call after a drop/recreate measured 198 ms with identical
  buffers, which is plan-cache warm-up, not a regression.
- **`cm.login()` returns `False`, it does not raise.** And
  `check_credentials_valid=True` performs no other action, so it never
  prompts. Read the docstring — I got this wrong three times in a row.
- **cheerio's `.text()` concatenates with no separator**, so
  `<span>Lieu : ANNECY</span><span>Ville : ANNECY</span>` became
  `ANNECYVille`. Affected every language, not just French.
- **A promoted candidate cannot simply be rejected** —
  `dce_promoted_only_when_approved` requires clearing `promoted_edition_id`
  in the same statement.
- **CSS specificity:** `.mini label` (0,1,1) beats `.tritoggle` (0,1,0).
  Qualify to `.mini label.tritoggle`.
- **Railway has no auto-deploy.** Every worker change needs a manual
  Redeploy. Several confusing hours came from testing a stale build.

---

## 10. Files

```
discovery-worker/
  src/extract/ai.ts            condenser + prompt + Anthropic client
  src/extract/classify.ts      open water / pool / multisport, 15 languages
  src/extract/table.ts         tabular calendars, multilingual headers
  src/normalize/date.ts        16-language months+weekdays, collision refusal
  src/normalize/distance.ts    multilingual units + standard tri distances
  src/normalize/text.ts        rejectAsEventName() — the wave gate
  src/jobs/crawl-source.ts     crawl decision flow, AI budget + URL filter
  src/jobs/process-ai-page.ts  AI rows -> the same path table rows take
  src/confidence/rules.ts      deterministic scoring. Never an LLM.
  test/                        200 tests

scripts/copernicus-climatology.py    seasonal temperature, run locally
api/cron/venue-marine-temps.js       6-hourly current temperature
explore.html                         the public page
sql/applied/                         every migration, with its reasoning
```

Migrations follow **MIGRATIONS.md**: file from the template, read-only
pre-checks, backup if destructive, Dave types "apply", apply via the
`supabase-admin` MCP, verify read-only, file into `sql/applied/`. Every file
in `sql/applied/` carries its own pre-checks, rollback and verify blocks —
read one before writing a new one.

**Note:** `sql/2026-08-04_water-temperature-for-event-venues.sql` was applied
but never filed into `sql/applied/`. Housekeeping only.
