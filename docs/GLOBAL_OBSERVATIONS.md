# Global Live Water Observation Platform

Provider-independent ingestion of **measured** water conditions (temperature,
waves, wind, tide) from public observation networks, matched to SwimLoading
spots, reviewed by an admin, and served on `/spots/*` pages from our own
database only.

Increment 1 (Aug 2026): the architecture + NOAA NDBC as the first provider.
The Tooting Bec / Brockwell my-water.live feed is untouched and unaffected.

## Architecture

```
Provider (NOAA NDBC, later ERDDAP/EMODnet/IMOS…)
    ↓  api/_lib/observations/providers/<code>.js   (adapter → normalized shapes)
Station catalogue            → observation_stations
    ↓  api/cron/observations-ndbc.js               (hourly, CRON_SECRET-gated)
Observation ingestion        → observations         (unique station_id+observed_at)
    ↓  scripts/match-observation-stations.mjs      (candidates only, never primary)
Station-to-spot matching     → spot_observation_stations (status='candidate')
    ↓  /admin → "Observation Stations — Review"    (human approves/rejects)
Approved primary station     → spot_conditions_live (view)
    ↓  api/_lib/observations/conditions.js  getSpotConditions(spotId)
Public spot conditions       → conditions card on /spots/<slug>  +  /api/spots/<slug>/history
```

**The public page never calls NOAA, ERDDAP, or any external provider
synchronously.** External providers are fetched only by the ingestion cron;
public requests read SwimLoading's own persisted data. A provider outage is
invisible to visitors (`getSpotConditions` is contractually null-on-failure,
and a null renders as "no card", never a 500 — proven by
`scripts/render-spot-observations.mjs`).

## Schema (migration `sql/applied/2026-08-17_global-observations-v1.sql`)

| Table | What | Keys |
|---|---|---|
| `observation_providers` | one row per upstream source (`code`: `ndbc`, `mywaterlive`) | unique `code`; `enabled` gates ingestion |
| `observation_stations` | provider catalogue; capability flags LEARNED from data, not trusted from metadata | unique `(provider_id, external_id)` |
| `observations` | raw measured readings | unique `(station_id, observed_at)` = duplicate protection; index `(station_id, observed_at DESC)` serves latest + history |
| `spot_observation_stations` | spot↔station links: `candidate` / `approved` / `rejected`, `is_primary` | PK `(spot_id, station_id)`; partial unique index `one_primary_station_per_spot`; CHECK primary ⇒ approved |
| `spot_conditions_live` (view) | approved links + each station's newest temperature observation | what `getSpotConditions` reads (one query) |

RLS: all four tables are public-read; there are **no** write policies — writes
happen only via the service role (cron/scripts) or the two SECURITY DEFINER
admin RPCs. `spots` PK is `uuid`; all FKs follow it. PostGIS is not installed;
distance is `haversineKm` from `api/seo-utils.js`.

## Provider contract (`api/_lib/observations/normalize.js`)

An adapter exports an object `{ code, fetchCatalogue, fetchBulkObservations?,
fetchStationObservations }` whose results reduce to:

```
NormalizedStation      { externalId, name, latitude, longitude, stationType,
                         waterBody, sensorDepthM, capabilities{temperature,
                         waveHeight, wavePeriod, wind, tide}, metadata }
NormalizedObservation  { externalStationId, observedAt, waterTemperatureC,
                         waveHeightM, wavePeriodS, windSpeedMs,
                         windDirectionDeg, tideHeightM, qualityCode, raw }
```

Validation lives in `validStationOrNull` / `validObservationOrNull`:
- a missing value is **null, never 0** (`Number(null) === 0` produced a
  "0.0°C in San Francisco" bug during development — now a regression test);
- physically implausible values (99.9°C water, 40 m waves) are nulled while
  the row's good fields survive;
- far-future timestamps are rejected as clock faults;
- a row with no measured values at all is dropped.

## NOAA NDBC adapter (`api/_lib/observations/providers/ndbc.js`)

Three public, keyless endpoints (User-Agent identifies SwimLoading):

- `activestations.xml` — catalogue (~1,350 stations). Attribute-scan parse,
  ids uppercased (`ljac1` → `LJAC1`, realtime feeds are uppercase).
- `data/latest_obs/latest_obs.txt` — the whole network's newest observation
  in ONE request (~500 stations with water temp).
- `data/realtime2/<ID>.txt` — 45 days per station; we take 24 h, and only for
  stations linked to a spot.

Parsing is **header-driven** (column names, never positions), `MM` = missing,
`TIDE` ft → m, `DPD` preferred over `APD` for wave period. Realtime data is
unverified by NOAA; rows carry `quality_code='ndbc_realtime'`.

## Ingestion (`api/_lib/observations/ingest.js` + `api/cron/observations-ndbc.js`)

Hourly Vercel cron (`40 * * * *`), `requireCronAuth` first, service key after.
One provider job covers the whole network — never one cron per station.
Order: observations stored **before** `last_observation_at` moves, so a crash
under-reports rather than lies. Failure containment: bad row → dropped;
bad station → `last_error`/`last_error_at` on its row, run continues; bulk
endpoint down → per-station pass still runs; catalogue down → run aborts with
`error` in the summary, nothing written, nothing lost. Station history fetches
run at concurrency 4. Historical observations are never deleted when an
upstream station disappears.

## Matching (`api/_lib/observations/matching.js` + `scripts/match-observation-stations.mjs`)

- Search radius 25 km (`MATCH_CONFIG.maxDistanceKm`), only stations that are
  active and actually reporting water temperature.
- **Structural refusals** (never even a candidate): non-coastal spots (POOL /
  LAKE / DAM / RIVER / TIDAL_POOL never match a marine network), stations
  whose provider states a non-coastal water body.
- Suitability score 0–100 = distance (50) + observation freshness (20) +
  station type (15: fixed/lido > buoy > unknown) + sensor depth (15: surface >
  unknown > deep). Ranks the review queue; **never** bypasses it.
- Straight-line proximity can be scientifically wrong (False Bay vs Atlantic
  across the peninsula; SF Bay piers vs Ocean Beach outside the Golden Gate).
  Provider metadata cannot resolve this, so in Increment 1 **every** match is
  `status='candidate'` and a human decides.

Run `node scripts/match-observation-stations.mjs` (report only), `--sql out.sql`
(seed SQL), or `--write` (needs `SUPABASE_SERVICE_KEY`).

## Admin approval (`/admin` → "Observation Stations — Review")

Each candidate shows: spot, station (provider, external id, type, both
coordinate pairs, map link), distance, sensor depth, latest temperature + age,
suitability score. Actions: **Approve primary** (readings appear on the spot
page), **Approve secondary** (approved fallback source), **Reject**. Backed by
SECURITY DEFINER RPCs `approve_observation_station` /
`reject_observation_station`, which re-check `profiles.is_admin`. Approving a
new primary when one exists returns `primary_exists` and requires an explicit
confirm (`p_replace := true`) — an approved primary is never silently
overwritten, in the RPC itself, not just the UI.

## Freshness semantics — ONE source of truth

`api/_lib/temperature-freshness.js` (the same module the page titles use):

| State | Age | Page may say |
|---|---|---|
| `LIVE` | ≤ 6 h (`liveHours`) | "Live measurement" |
| `RECENT` | ≤ 48 h (`recentHours`) | "Recent measurement" — never live/current/today |
| `LAST_READING` | ≤ 7 d (`lastReadingDays`) | "Last reading" — never live/current/today |
| `STALE` | older | **nothing is rendered** |

`getObservationState()` derives these from `FRESHNESS_THRESHOLDS`; the spot
renderer contains no freshness constants of its own. The language rule is
enforced by tests (`test/observations-conditions.test.js`) and by the
real-handler harness.

## Public surface

- `getSpotConditions(spotId)` (`api/_lib/observations/conditions.js`) — the
  ONE canonical function. Reads `spot_conditions_live` for the primary
  station via anon REST, 4 s timeout, returns the normalized shape from the
  spec or null. Never throws.
- Conditions card (`api/_lib/observations/render.js`) — renders only when a
  usable measurement exists; only fields that exist (no placeholders); says
  "Nearby measured water temperature" (a buoy near the spot is not the water
  at the swimmer's feet; ≤ 0.5 km reads as on-site); visible attribution line.
  Sensor venues (my-water.live layout) keep their own hero and skip the card.
- `/api/spots/<slug-or-uuid>/history?period=24h|7d|30d`
  (`api/spot-history.js`) — graphing series `{t, temp_c, wave_m?}` from the
  approved primary station, downsampled to ≤400 points, `s-maxage=900`.

## Adding another provider (Increment 2+)

1. `api/_lib/observations/providers/<code>.js` implementing the adapter
   contract (normalize everything; per-station errors throw, the runner
   isolates them).
2. Provider row in `observation_providers` (migration: code, attribution,
   licence, `enabled`).
3. A cron in `vercel.json` + `api/cron/observations-<code>.js` (copy the NDBC
   one; it is ~20 lines) + add the cron name to
   `scripts/lib/endpoint-registry.mjs`.
4. Run the matcher; review candidates in /admin.
5. Fixtures + parsing tests in `test/`, and a run of BOTH render harnesses.

## Attribution & licensing

- **NOAA NDBC**: US Government work, public domain; NOAA asks for credit —
  every card shows "Data: NOAA National Data Buoy Center". Realtime feeds are
  not quality-controlled by NOAA (`quality_code='ndbc_realtime'`).
- **my-water.live**: commercial API under the existing partnership; provider
  row seeded `enabled=false`. Its data continues to flow through the ORIGINAL
  pipeline (`api/cron/sensor-import.js` → `temp_logs`), unchanged.
- Future ERDDAP/EMODnet/IMOS providers each carry their own `attribution` and
  `licence` in the provider row — the card renders whatever is stored, so
  attribution is data, not code.

## Failure behaviour (summary)

| Failure | Result |
|---|---|
| NOAA completely down | cron summary `ok:false`; pages unchanged (serve last stored data per freshness rules) |
| One station 404s / times out | `last_error` on that station; rest of run unaffected |
| Malformed feed | parses to zero rows; nothing stored; no crash |
| Duplicate upstream rows | unique constraint + `ignoreDuplicates` → no-op |
| `spot_conditions_live` unreadable | `getSpotConditions` → null → no card, page 200 |
| Observation goes stale | card degrades LIVE → RECENT → LAST_READING → hidden; never claims live |

## Testing

- `npm test` — unit suites: `observations-ndbc`, `observations-matching`,
  `observations-ingest`, `observations-conditions` (30 tests) + the existing 91.
- `node scripts/render-spot.mjs --smoke` — REAL handler, REAL database, incl.
  Tooting Bec, Brockwell and la-jolla-shores.
- `node scripts/render-spot-observations.mjs` — REAL handler with the view
  staged through a local REST proxy: live / recent / stale / outage scenarios,
  language assertions, provider-outage-cannot-500 proof.
