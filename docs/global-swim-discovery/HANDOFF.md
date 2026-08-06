# Global Swim Discovery — Handoff

**As at 2026-08-05, end of day.** Live in production unless marked
otherwise. Supersedes the 2026-08-05 morning version, which described a
state that no longer exists — Explore was rebuilt today.

---

## 1. Where it stands

| | |
|---|---|
| Live upcoming events | **289** (278 open water + 11 triathlon swim legs) |
| Countries | **29** |
| Events dated 2027 or later | **34** |
| Bookable routes | **14** |
| Swim spots (places) | **192**, 111 with a temperature |
| Indexable event pages | **218** |
| Sources | 42 total, 38 enabled |
| Candidates queued | 783, of which **635 are dateless** |

### Access

- **Public:** https://www.swimloading.com/explore — **now `index,follow`**
- **Event page:** `/events/{slug}` · **Route page:** `/swims/{slug}` ·
  **Country hub:** `/swims/{country}` e.g. `/swims/south-africa`
- **Admin:** `/discovery-review`
- **Worker:** Railway `heartfelt-benevolence` → service **Swimloading**.
  **Deploy with the CLI, not the dashboard** — see §5.

---

## 2. What Explore is now

Three things, not one. This was the day's product decision, in Dave's
words: *"this must be the handbook for a swimmer going somewhere."*

1. **Races to enter** — dated events, ranked and paginated
2. **Swims you can book** — escorted routes with no fixed date, run when
   conditions allow (`swim_routes`)
3. **Places to just swim** — the `spots` table, with the temperature
   swimmers have measured there

Deliberately **not limited to the sea**. Lakes, dams, rivers, lagoons and
lidos are open water to the person swimming in them.

### New this session

- `search_events_v2` — validated, ranked, paginated. **Ranking runs before
  LIMIT**, or page 2 is not the second page of the ranking.
- `/api/explore/events`, `/api/explore/map-points`, `/api/explore/places`
- `event_editions.slug`, `is_searchable`, `is_indexable`, `is_featured`,
  claim fields; `event_change_log`; `event_claims`; notify preferences on
  `swimmer_event_entries`
- `swim_routes` — with a CHECK making it **impossible** to put a booking
  link on a route the operator does not run (see §4)
- Country hubs, sitemap entries, FAQ/Breadcrumb/Organization schema

---

## 3. The three things that cost the most time today

**The worker ran two-day-old code all day.** Railway's *Redeploy* button
rebuilds **the same commit**. With auto-deploy off, five "successful"
redeployments all shipped the same stale build. The GitHub integration was
also orphaned to an account Dave cannot log into (`GitHub Repo not found`).
**Fixed by deploying with the CLI** — see §5. The GitHub link is still
broken and is the biggest piece of unfinished infrastructure.

**A one-off backfill was used where a rule was needed.** `is_indexable` was
set by a single UPDATE. Nothing set it on INSERT, so the sitemap work
accepted 202 pages and then silently stopped accepting new ones. Now a
trigger (`zz_edition_indexable`, named to sort last so it reads
`verification_tier` after that trigger sets it).

**Diagnosis before reading the code.** Three separate times a confident
explanation turned out to be wrong: the classifier does *not* ignore
`urlPath` (it folds it in — the gap was vocabulary); `routine_privileges`
under-reports grants and made a working permission look missing; flat
`discovery_runs` does not mean the worker is down (it writes nothing when
nothing is due). **Read the code or measure it before explaining it.**

---

## 4. Rules that must not be broken

Carried forward, plus what today added.

**A wave is not an event.** `rejectAsEventName()` blocks waves, age
brackets and numbered placeholders at build time. Seven Midmar start waves
once reached the live site, including a disability start category offered
as a swim you could enter.

**A lesson is not a swim you enter.** New today. A Fort Worth swimming
class reached the public catalogue as an open water swim; its URL said
`/water-sports/swimming-classes/`. `NON_RACE_PHRASES` in `classify.ts` is
checked **before** the open-water signal — a class held in the sea is still
a class.

**An entry option is not an event.** New 6 Aug. Castle Race Series
publishes the Lough Cutra festival as a menu of ways to enter it, and the
AI extractor transcribed the menu: `Sprint`, `Olympic`, `10K`,
`9-10 years`, nineteen candidates for one weekend. `rejectAsEventName()`
now covers bare distances, race formats and hyphenated age ranges, all
**anchored to the whole string** — "Capri-Napoli Marathon" and "10K Lake
Zurich Swim" must survive, and the tests say so. Four were rejected with
no rule behind them ("Gauntlet", "Saturday Swim 5K"): one organiser's
wording is not a pattern, and inventing one deletes a real swim later.
Check precision with `scripts/sweep-not-a-name.ts`, which runs the rules
over the live queue instead of over examples you thought of yourself.

**Discipline is separate from event type.** Nine French triathlons —
Embrunman among them — went live as open-water swims on 5 Aug because the
classifier reads names and Embrunman contains no word it recognises. The
source URL said `calendrier-triathlon`. Corrected; the general fix is done
for classes but **not yet for multisport** — the surviving "Lough Cutra
Castle Triathlon and Multisport Festival" candidate still carries
`discipline: open_water`, which is the next thing to fix here.

**An unconfirmed date is never stored.** Schema-enforced. This is why the
760 Freedom Swim ("December 2026", no day) has NULL dates.

**A page-stated year is read, not inferred.** Landed 4 Aug and **only
actually ran today** — see §3.

**Only `operates` may carry a booking link.** `swim_routes` has a CHECK
enforcing it. Big Bay runs the Cape routes; it *supports* SA swimmers on
the English Channel, North Channel and Loch Awe, which are booked through
CS&PF, the ILDSA and others. A wrong booking link costs a swimmer money,
so the database refuses rather than trusting the UI.

**Never invent a coordinate.** Chapman's Peak has no spot, so it has no
pin. A geocoded point is stamped `coordinates_source='geocoded'` — a suburb
centroid is a fine map pin and a wrong start line.

**AI-read candidates never auto-publish, and are never indexable.**

---

## 5. Deploying the worker

Railway's *Redeploy* rebuilds the same commit. **This does not ship new
code.** Until the GitHub App is reconnected, deploy from the repo:

```bash
/Users/davewelensky/.hermes/node/bin/railway login
cd discovery-worker && /Users/davewelensky/.hermes/node/bin/railway link
/Users/davewelensky/.hermes/node/bin/railway up
```

`link` from **inside `discovery-worker`** — running `up` from the repo root
creates a stray new project and bundles 512 MB of `.git` (Cloudflare 413).
`discovery-worker/.railwayignore` handles the size.

**To reconnect GitHub properly:** the Railway App must be installed on the
**`davewelensky`** GitHub account (which owns the repo), not `DaveW4153`.
Visiting `github.com/davewelensky` does not sign you in as that account —
check the avatar menu. Then Railway → Swimloading → Settings → Source.

**Verify the deployed build by behaviour, not the deploy log.** Fingerprint
in `discovery_candidate_events.warnings`:
- old: `"no weekday to verify the year"`
- new: `"Year 2026 taken from the page's own heading"`

---

## 6. Needs attention

**1. Country resolution — DONE, 6 Aug.** The diagnosis above was wrong and
is left here as a warning: the country was on the page every time, and no
URL-path parsing was needed or written. Two gaps in our own parsing threw
it away — a twelve-entry country name lookup that had never heard of the
Philippines, Greece or **Australia**, and a JSON-LD path that skipped the
US-state inference the free-text path already had. Both fixed, with the
name list now generated from ISO 3166-1 rather than typed.

Bigger than it looked: 22 candidates were countryless, 16 of them
Australian. Backfilled by
`sql/applied/2026-08-05_country-resolution-backfill.sql`, every value
produced by replaying the fixed parser over each row's own stored payload
(`discovery-worker/scripts/replay-country-resolution.ts`). Venues without
a country: 9 → 2, and those two are correct — "North Wales" and
"Guaymas, SON" (Mexican state codes are three letters, unsupported).

Reading a bare subdivision code now needs the event's own UTC offset,
because Italy abbreviates provinces exactly like US states (Como `CO`,
Milano `MI`, Palermo `PA`). The US and Canada are negative year-round, so
`CO` at UTC+02:00 is Como. Cost of the guard: "Casablanca, MA" at
UTC+01:00 is refused too. Unset and warned beats confidently wrong.

**1b. Fixing the data was only half of it.** `/swims/philippines` still
404'd, because the hub list was a *second* hand-maintained country list —
twenty typed in `events-handler.js`, the same twenty typed again in
`sitemap-dynamic.js`. **16 countries with live events had no hub**, and
nothing failed, because a stale hand-written list never fails. Both now
read `api/_countries.js` (generated, all ISO countries), driven by what is
actually in `event_venues`. **When a lookup starts returning more values,
check what else was quietly gated on the old, shorter list.**

**2. active.com is PARKED until 12 Aug** (`weekly`, `next_run_at` +7d).
It works — 7 events across 6 countries in one 40-page run at **zero AI
cost**, including SWIM MIAMI *2027*, with 566 URLs deferred. Country
resolution no longer blocks it (see 1). Restore it to **daily** after a
supervised re-crawl shows clean names, countries and classification. It is
the best answer to "how does the catalogue keep growing", because a global
aggregator carries next season's events as organisers post them.

**3. `profiles.is_admin` — closed today**, trigger `protect_profile_admin_fields`.
**No bypass by design**: granting an admin now needs
`DISABLE TRIGGER` / `UPDATE` / `ENABLE TRIGGER`.

**4. 635 dateless candidates.** Re-crawling does **not** fix these: unchanged
pages are skipped by the page-hash cache, so a parser fix does not
retroactively apply. They need either a forced re-extraction or acceptance
that those sources do not publish dates.

**5. Six Polish events pending, one held back.** "Night Swim Open Water
2025" is dated 2026 and has a sibling candidate with no date at all — name
and date disagree. Left in the queue on purpose.

**6. 19 venues still have no coordinates** — Danish street addresses,
French `(77)`-style postcodes, "North Wales" (UK vs Pennsylvania, 5,406 km
apart, correctly refused). Run `node scripts/geocode-venues.mjs --dry-run`
after any crawl.

**7. Places are 72% South Africa** (138 of 192). A traveller to Spain or
Italy gets races but almost no places.

**8. Spots have no seasonal temperature.** The climatology is keyed on
event *venues*, so a route page can say "14.8 °C that week" and a spot page
cannot. Same data, one join away.

---

## 7. Tools

```bash
# Probe candidate sources — reports DATED EVENTS, not just reachability
cd discovery-worker && DISCOVERY_LIVE_FETCH_ENABLED=true \
  npm run probe:batch -- candidates.tsv

# Geocode venues (Nominatim, 1 req/sec, refuses ambiguity)
node scripts/geocode-venues.mjs --dry-run

# Seasonal water temperature, incremental
python3 scripts/copernicus-climatology.py --only-missing

# One source, deep crawl, no AI spend
cd discovery-worker && DISCOVERY_LIVE_FETCH_ENABLED=true \
  DISCOVERY_WRITE_ENABLED=true DISCOVERY_AI_ENABLED=false \
  DISCOVERY_MAX_PAGES_PER_RUN=40 npm run crawl -- --source <uuid>
```

`probe-sources.ts` answers the question that decides a source — **how many
dated events would we get** — using the real extractors. Reachability alone
would have recommended Big Bay Events, which publishes zero dates. It also
recognises one-event-per-page sites, which an earlier version dismissed as
"thin" and would have cost us Australia.

---

## 8. Gotchas that cost real time

- **Railway "Redeploy" ships the same commit.** Five successful
  redeployments, no new code.
- **PostgREST caps at 1000 rows.** `--only-missing` saw 19 venues instead
  of 83 and re-processed everything.
- **`tsx` does not typecheck.** Tests passed while `npm run typecheck`
  failed. Run both.
- **`information_schema.routine_privileges` under-reports grants.** Use
  `has_function_privilege`.
- **Postgres fires same-timing triggers in NAME order.** `zz_edition_indexable`
  is named to sort after `trg_edition_verification` because it reads what
  that one sets.
- **A one-off backfill is not a rule.** If it must hold continuously, it is
  a trigger.
- **Unchanged pages are never re-extracted**, so a parser fix does not
  retroactively repair stored candidates.
- **Slugs are permanent.** Six were changed today, safe only because the
  pages were unreachable (noindex + absent from sitemap) for the ~1 hour
  they existed.
- **Northern calendars are half-spent in August.** Japan, New Zealand and
  much of Poland were historic seasons, not failures. New sources will look
  disappointing until seasons turn.

---

## 9. Files changed today

```
explore.html                          rebuilt: API-backed, 3 modes, URL state
api/explore/events.js                 validated ranked search
api/explore/map-points.js             map pins + honest tallies
api/explore/places.js                 spots layer
api/events-handler.js                 /events/{slug}, /swims/{slug}, country hubs
api/sitemap-dynamic.js                + 218 events, 14 routes, country hubs
discovery-worker/src/extract/classify.ts       NON_RACE_PHRASES
discovery-worker/src/normalize/text.ts         title suffix stripping
discovery-worker/scripts/probe-sources.ts      source probe
scripts/geocode-venues.mjs                     Nominatim geocoder
scripts/copernicus-climatology.py              --only-missing
sql/applied/2026-08-05_*.sql                   9 migrations
```

209 worker tests pass; typecheck clean.

Migrations follow **MIGRATIONS.md**: file from the template, read-only
pre-checks, backup if destructive, Dave types "apply", apply via
`supabase-admin`, verify read-only, file into `sql/applied/`. Several
pre-checks caught wrong assumptions today — including one that would have
added a duplicate source. Do not skip them.
