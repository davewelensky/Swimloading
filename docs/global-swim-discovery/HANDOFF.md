# Global Swim Discovery — Handoff

**As at 2026-08-03.** Everything below is live in production unless
explicitly marked otherwise.

---

## 1. Access

### Public — Find a Swim
**https://www.swimloading.com/explore**

No login. Currently `noindex,nofollow` — remove that meta tag in
`explore.html` once you're happy the listings are trustworthy enough to
be found by Google.

Two modes:
- **Big swims worth travelling for** — searches everywhere, ranked
  iconic → major → regional → local, then by participant numbers.
- **What's on near me** — pick a city or use browser geolocation, set a
  radius, optionally weekends-only.

### Admin — Discovery Review
**https://www.swimloading.com/discovery-review**

Sign in with your normal SwimLoading account (`dave.welensky@gmail.com`).
Access requires `profiles.is_admin = true` — you have it.

The page shows the review queue, each candidate's evidence trail, its
confidence breakdown, duplicate warnings, and approve/reject buttons.

### Raw data
Supabase SQL editor:
`https://supabase.com/dashboard/project/szgkzuswelntnevobnoh/sql/new`

Paste `sql/debug/discovery-review-queue.sql` for the review queue plus
commented queries for scoring reasons, evidence, duplicates and the
published catalogue.

---

## 2. Current live state

| | |
|---|---|
| Published events | **38**, across **21 countries** |
| Held for review | **6** (all blocked because no year is published) |
| Past-dated events | 0 |
| Invented/test events | 0 — all fixtures were removed before launch |

Sources seeded so far, all from organisers' own calendars:
Oceanman (19 races), major global swims (Midmar, Rottnest, Capri-Napoli,
Bosphorus, Great North Swim, Swim Serpentine, Lorne, Waikiki, Cole
Classic), and UK/Ireland (Chillswim ×3, Go Swim ×3, Menai, Hurly Burly,
Liffey, Lough Cutra + 5 held).

---

## 3. Architecture in one page

**Two separate groups of tables — do not merge them.**

*Published catalogue* (public read): `event_organisers`, `event_venues`,
`event_series`, `event_editions`, `event_distances`, plus the
`public_organisers` view.

*Discovery pipeline* (never public): `discovery_sources`,
`discovery_source_pages`, `discovery_runs`, `discovery_candidate_events`,
`discovery_candidate_distances`, `discovery_event_evidence`,
`discovery_dedupe_links`, `discovery_review_decisions`.

**`public.swim_events` is untouched** and stays SwimLoading-native group
swims with RSVP. A discovered third-party race has no creator, no RSVP
and needs provenance — different concept, different table. Join at the
query layer if a page ever needs both.

**`event_venues` is separate from `spots`** on purpose. `spots` drives
temperature logging, the marine cron, the Passport and spot curation. A
race start line is not automatically a place anyone logs temps at.
`event_venues.spot_id` is an optional admin-confirmed link, never
automatic.

### The write path
There is **no INSERT/UPDATE/DELETE policy on any of the 13 tables for any
client role.** That is deliberate. Everything goes through:

| RPC | Who | Does |
|---|---|---|
| `approve_discovery_candidate` | admin or service_role | The only route into the public catalogue. Atomic, row-locked, idempotent. |
| `reject_discovery_candidate` | admin | Marks rejected, appends audit row. |
| `resolve_dedupe_link` | admin | Clears a duplicate pair (both directions). |
| `search_event_editions` | anon | Public search. SECURITY INVOKER so RLS enforces visibility. |

`approve_discovery_candidate` refuses: classifier-rejected candidates,
past dates, unresolved duplicates, and unconfirmed years — the last two
hard, the first two overridable via `p_override_rejected`.

---

## 4. The worker

`discovery-worker/` — own package, own `node_modules`, deploys to
**Railway** (not Vercel; it's in `.vercelignore`).

```bash
cd discovery-worker
npm install
npm test                    # 91 tests
npm run typecheck
npm run process:fixtures    # dry run, writes out/*.json only

# write to Supabase (needs discovery-worker/.env with the service key)
DISCOVERY_WRITE_ENABLED=true npm run process:fixtures
```

`discovery-worker/.env` holds `SUPABASE_SERVICE_KEY`. It is gitignored
and must never be committed or pasted anywhere. The worker refuses to
start in write mode without it.

**Live crawling is now implemented** (2026-08-03) behind
`DISCOVERY_LIVE_FETCH_ENABLED` — polite HTTP client (robots.txt per RFC
9309, per-host rate limiting, identifiable UA, bounded retries/bodies),
listing + verification crawl modes, scheduler loop, change monitoring,
source health, and charset/language-correct multilingual handling. See
`discovery-worker/README.md` → "The live crawler".

```bash
npm run crawl                    # one pass over due sources
npm run crawl:loop               # Railway mode
npm run crawl:url -- https://…   # ad-hoc page -> out/, never the DB
```

Still **unimplemented and refusing to start if enabled**:
`DISCOVERY_PLAYWRIGHT_ENABLED`, `DISCOVERY_AI_ENABLED`.

### candidate_key
`sha256(normalised source URL | normalised name | edition YEAR)`.

Keyed on the **year**, not the full date, on purpose: a date correction
within a year updates the same candidate, while next year's running
becomes its own. Keying on the full date would leave phantoms; keying on
no date would destroy historical editions. Tests cover both directions —
don't change this without reading `test/candidate-key.test.ts`.

---

## 5. Needs your attention

**Two events published on indirect sourcing** — both flagged
`manual_review`, both worth verifying:
- *South32 Rottnest Channel Swim*, 20 Feb 2027 — organiser site returns
  HTTP 403 to automated fetches, so the date came from search-index
  snippets rather than a page actually read. Their 2026 edition was
  cancelled, so this is a recovery year.
- *Jones Engineering Dublin City Liffey Swim*, 29 Aug 2026 — date from a
  secondary listing, not the organiser's own page.

**Oceanman distances are derived, not stated.** Their calendar lists
category names, not kilometres. The mapping (OCEANMAN=10km, HALF=5km,
SPRINT=1.5km, OCEANKIDS=500m, OCEANTEAMS=3×500m, ULTRA=21km) was verified
on two race pages and applied to the other 17. Recorded as a warning on
every Oceanman candidate.

**`profiles.is_admin` is still self-grantable.** No column-level grant or
trigger prevents a logged-in user setting it on their own row. It now
gates *publishing*, not just reading. Fix is written and pre-checked:
`sql/2026-08-03_protect-profiles-is-admin.sql` — **not applied**.

---

## 6. Written but deliberately NOT applied

| File | Why it's waiting |
|---|---|
| `sql/2026-08-03_protect-profiles-is-admin.sql` | Closes the `is_admin` hole. Pre-checked clean. Only blocker is that it has no bypass, so any future manual admin grant needs a documented `DISABLE TRIGGER` bracket (explained in the file). |
| `sql/2026-08-03_auto-publish-high-confidence.sql` | Auto-publishes the high_confidence tier so review doesn't gate scale. Pre-checked. Worth revisiting: research showed ~⅓ of real events have no published date, so a human stays in the loop regardless. |
| `sql/2026-08-03_enable-live-discovery-sources.sql` | Flips the 3 real sources to `enabled=true` for the now-built crawler (Oceanman → listing mode weekly; both umbrella sources → verification-only weekly). Apply via the MIGRATIONS.md gate before the first crawl. |

---

## 7. Not built yet

1. ~~**Live crawling.**~~ ✅ **BUILT 2026-08-03** (code complete, tests
   green — 141). Not yet live: needs (a)
   `sql/2026-08-03_enable-live-discovery-sources.sql` applied via the
   MIGRATIONS.md gate (enables Oceanman in listing mode + the two
   umbrella sources in verification-only mode), and (b) the Railway
   deploy (`discovery-worker/README.md` → "Deploying to Railway").
   Note the seeded reality differs from what this doc previously said:
   only Oceanman has a crawlable `base_url`; Chillswim/Go Swim/etc. live
   as candidate `source_url`s under two umbrella sources, which the
   crawler re-verifies URL-by-URL rather than listing-crawls.
2. **Geocoding.** `explore.html` uses a hardcoded city list plus browser
   geolocation. Typing an arbitrary place name ("I'm going to Galway")
   needs a real geocoder.
3. **Region grouping.** A radius circle from Manchester treats Dublin
   (needs a flight) and Edinburgh (a train) as equivalent. Grouping by
   region — "Scotland 5 · Ireland 3 · Lake District 4" — matches how
   weekend trips are actually planned. Probably higher value than the
   globe.
4. **Globe view.** `welcome.html` already has one (`cobe@0.6.4`, fed live
   spot coords). Events would reuse it. Worth doing once the catalogue is
   in the hundreds — a globe with 38 dots isn't compelling.
5. **`event_status` column.** Cancelled/postponed currently lives in
   `raw_source_values.eventStatus` because `discovery_candidate_events`
   has no column for it (`candidate_status` is the *review* state). The
   approve RPC reads it correctly, but you can't filter the queue on it.
   Small additive migration.
6. ~~**Verification loop.**~~ ✅ Built into the crawler: known event URLs
   are re-fetched every run, `content_hash` compared,
   `last_changed_at`/`pages_changed` maintained, and re-extraction
   upserts the same `candidate_key` in place. What remains is surfacing
   "changed since approval" in the review UI.

---

## 8. Files

```
discovery-worker/                     the worker (see its own README)
discovery-worker/src/crawl.ts         live-crawler CLI (once/loop/source/url)
discovery-worker/src/fetch/           http-client, robots, links, decode
discovery-worker/src/schedule/        due-source + health + backoff logic
discovery-worker/railway.json         Railway deploy config (root dir: discovery-worker)
explore.html                          public search      -> /explore
discovery-review.html                 admin review       -> /discovery-review
docs/global-swim-discovery/
  database-schema.md                  full schema rationale
  HANDOFF.md                          this file
sql/applied/2026-08-03_*.sql          everything applied 2026-08-03
sql/2026-08-03_protect-profiles-is-admin.sql        NOT applied
sql/2026-08-03_auto-publish-high-confidence.sql     NOT applied
sql/2026-08-03_enable-live-discovery-sources.sql    NOT applied — enables the crawler's sources
sql/debug/discovery-review-queue.sql  paste-into-SQL-editor queries
scripts/test-discovery-schema-rls.mjs RLS probe (readonly-safe by default)
```

One caveat on the record: `sql/applied/2026-08-03_discovery-rpc-fixes-and-search.sql`
was written *after* those changes were applied, to restore the audit
trail. It's labelled as such in the file.
