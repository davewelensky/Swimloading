# Global Observation Platform — handoff

**State as of 18 August 2026.** Everything described here is live in production
unless marked otherwise. Architecture and contracts live in
[GLOBAL_OBSERVATIONS.md](GLOBAL_OBSERVATIONS.md); this file is the operational
picture — what is running, what is unfinished, and what will bite you.

---

## 1. What exists

Measured water temperature from public observation networks, matched to
SwimLoading spots, approved by a human, shown on spot pages **and in the app**.

| | |
|---|---|
| Providers enabled | 3 — NOAA NDBC, Marine Institute Ireland, Copernicus Marine In Situ |
| Stations catalogued | 2,113 |
| Observations stored | 25,675 |
| Spots with live measured temperature | **18** |
| Approved station links | 53 (5 rejected, 0 candidates outstanding) |
| Active spots / countries | 205 / 15 |

**The 18 live spots:** Boscombe, Canford Cliffs, Knoll Beach, South Beach
Studland, Dover, Torbay (UK) · La Jolla Shores, Santa Monica Beach, Aquatic
Park SF, Waimea Bay, Bethany Beach, Capistrano Beach, Morro Rock Beach,
Sunset Beach NC, Tolchester Beach, Barview Jetty (US) · English Bay
Vancouver (CA) · Santa Ponsa (ES).

### The pipeline

```
provider adapter → hourly cron → observations table
     → station-to-spot matching (candidates only, never auto-approved)
     → human approval in /admin
     → spot_conditions_live view
     → conditions card + 48h history chart on /spots/*
     → spot_temp_estimate view → the app, Explore, sitemap gating
```

**Public pages never call an external provider.** Only the crons do. A
provider outage cannot make a spot page fail — proven by
`scripts/render-spot-observations.mjs`.

### Crons (all in `vercel.json`, all gated by `CRON_SECRET`)

| Cron | Schedule | Does |
|---|---|---|
| `observations-cmems` | `20 * * * *` | Copernicus moorings (NetCDF via h5wasm) |
| `observations-ndbc` | `40 * * * *` | NOAA NDBC (whole network in one bulk request) |
| `observations-erddap` | `50 * * * *` | every ERDDAP provider whose row is `enabled` |

---

## 2. Commands

```bash
npm test                                        # 187 tests
node scripts/render-spot.mjs --smoke            # REAL handler, real DB, 15 pages
node scripts/render-spot-observations.mjs       # live/recent/stale/outage scenarios
node scripts/analyse-observation-coverage.mjs   # → out/observation-coverage.{json,md}
node scripts/match-observation-stations.mjs     # candidate matching (dry run by default)
node scripts/propose-spots-from-gaps.mjs        # gaps → spot_suggestions (dry run by default)
node scripts/sync-country-links.mjs --check     # homepage country links vs site-config.js
```

**Never trust `node --check` or unit tests alone for the spot handler.** The
production 500 that started all of this passed both. Run `render-spot.mjs`.

---

## 3. Rules that are load-bearing

**Freshness has one home.** `api/_lib/temperature-freshness.js` — LIVE ≤6h,
RECENT ≤48h, LAST_READING ≤7d, STALE hidden. Never add a threshold anywhere
else. Stale data is never described as Live, Current or Today; that rule is
tested.

**Human decisions are final.** Approved is never re-decided, rejected never
resurrected, a manually chosen primary never displaced. Auto-approval exists
as a framework only and is **OFF** — 0 of 43 matches qualify, because no
provider supplies sensor depth or water body and *unknown is never
permission*.

**Never `DELETE FROM spots`.** `temp_logs`, `hazard_reports`,
`spot_water_readings` and `spot_observation_stations` all cascade. Merging a
spot means repointing the foreign keys then `active = false`. Worked example:
`sql/applied/2026-08-18_merge-santa-ponca-into-santa-ponsa.sql`. 24 tables
reference `spots` — enumerate them before any merge.

**A sensor is not a beach.** Coverage gaps become *suggestions*, never spots.
Station coordinates are the instrument's position — always geocode the actual
shoreline before creating a spot from one.

---

## 4. Known gotchas (each of these cost real time)

- **`Number(null) === 0`.** A missing value became a 0.0 °C reading twice —
  once in the NDBC parser, once in the history chart. Both are now explicit
  null checks with regression tests. Any new parser needs the same.
- **Providers redistribute each other's stations.** NDBC `TIBC1` and
  Copernicus `GL_TS_MO_TIBC1` are the same gauge. A rejection under one
  reappeared as a fresh candidate under the other. `physicalStationKey()` in
  `matching.js` normalises this — extend it for any new provider's naming.
- **`CREATE OR REPLACE VIEW` can only append columns**, never insert them
  mid-list (Postgres 42P16).
- **`spot_suggestions` is not anon-readable.** Scripts reading it without a
  service key get `[]`, not an error. Dedupe is guaranteed by the unique index
  on `observation_station_id`, not by any script-side check.
- **New `best_source` values must be added in two places**, or they get the
  wrong label: `_spTempChip()` in `app.js` and the ternary in `explore.html`.
  Both once described a buoy as a swimmer or a model.
- **Vercel route order matters.** A `/spots/<slug>` redirect must sit *before*
  the `^/spots(/.*)?$` catch-all or it never fires.

---

## 5. Open items

### Lakes — matching now supported, no lake spot in range yet
`water_type = 'LAKE'` has always existed (13 active lake spots). What was
missing was station matching, which allowed OCEAN/LAGOON only. Now fixed:
`matchEligibility()` enforces **same water body in both directions** — a sea
buoy may not serve an inland lake, a Great Lakes buoy may not serve a beach.

Because every station stores `water_body = NULL`, the station's body is
inferred by `inferStationWaterBody()` from its name (`lake`, `Erie`,
`Huron`, `Georgian Bay`, `Maumee`, `loch`, `reservoir`…) and NDBC's 45xxx
Great Lakes numbering. **Unknown is refused for lake spots** — a wrong lake
match is a different body of water entirely — while unknown stations keep
serving coastal spots as before.

None of the 13 lake spots has a station within 25 km today (they are Swiss
and South African lakes; the Great Lakes buoys are in the US). So this
unblocks Edgewater Beach and Maumee Bay **if those spots are ever created**,
and any future lake spot near a monitored lake. Nothing changes today.

### South Africa has no measured coverage, and cannot get it
143 spots — 72% of the platform — and **no current provider reaches them**.
NDBC has zero SA stations; every Copernicus platform in SA waters is a
drifting buoy, Argo float or ship thermosalinograph (verified: zero fixed
moorings). SA spots run on swimmer logs + the Open-Meteo model.
Options: investigate a SA source (SAEON, SAWS) as a *feasibility probe
first* — I cannot promise a usable one exists — or a my-water.live sensor
partnership, which is the same profile as Tooting Bec.

### Ireland has no measured source either
Marine Institute buoys are 50 km+ offshore (outside the 25 km trust radius);
their coastal network was dormant when probed. The Stena FerryBoxes cross
Dublin Bay twice daily but their temperature sensor is dead. Recheck
periodically; a my-water.live sensor at the Forty Foot would beat any buoy.

### EMODnet is registered but disabled
Its public ERDDAPs carry climatologies and sea level only, no NRT
temperature. Superseded by `cmems_insitu`, which reads the same network at
source. Leave disabled.

### Riviera buoy is silent
`GL_TS_MO_6100022` — no stored temperature since 23 July. Six Riviera spots
have it approved as a *secondary*, so nothing displays. It will start working
by itself if the buoy resumes. Correct negative behaviour; leave alone.

### Suitability scoring cannot express geography
All three rejected matches score **above** the lowest approved one. The cause
is not bad weights — the formula cannot represent a headland, and we hold no
coastline data. Ocean Beach SF vs the SF Bay stations is the canonical case.
**Do not retune the weights to hide this**; n=3 and the fix is data, not
arithmetic.

---

## 6. The 18 August incident (read before approving machine suggestions)

Approving observation-gap suggestions in `/admin` created **16 US spots on
Cape Town's `/spots/atlantic` page**. The suggestions deliberately left
`country_code` NULL (refusing to guess a country from coordinates); the
Add-Spot form derives *domain* from country and fell back to the South
African default when there wasn't one. All 16 also carried buoy coordinates
and no station link.

Fixed: `sql/applied/2026-08-18_fix-observation-gap-spots.sql` — all 16
retired, 6 rebuilt at geocoded shorelines. Guards added in three places:
the generator can refuse countryless suggestions
(`GAP_DISCOVERY_CONFIG.requireCountry`), `autoSetDomain()` no longer applies
SA defaults outside a SA bounding box, and `addSpot()` hard-refuses a South
African region on non-South-African coordinates — which covers manual entry,
geocode and the suggestion prefill alike.

Backups retained: `_bak_20260818_gap_spots`, `_bak_20260818_gap_suggestions`,
and the four `_bak_20260818_santa_ponca_*` tables. Clean these up in a later
session once the changes have been live a while — never in the same session
that created them.

**Residual risk:** the bounding-box guard is deliberately generous, so it
blocks only what is unambiguously outside South Africa. It would not catch a
Namibian spot mis-filed as West Coast. Per-domain boxes would, but that is a
bigger change than this incident justified.

---

## 7. What I would do next

1. **Probe a South African source** before building anything. The home market
   is 72% of the platform and structurally uncovered; everything else is
   incremental next to that.
2. **Leave auto-approval off** until a provider supplies sensor depth or water
   body. The dry run is the evidence, and it currently says no.

Do **not** add another provider just because one is available — the data
should decide, and right now it points at South Africa or at nothing.
