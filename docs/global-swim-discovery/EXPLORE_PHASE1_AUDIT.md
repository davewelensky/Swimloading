# Explore Phase 1 — audit and implementation plan

**Written 2026-08-05, before any code change**, as required by the Phase 1
brief §23. Everything below was read off the running database and the
repository, not assumed.

---

## 1. Existing architecture summary

Explore is a **single static page**, `explore.html` (656 lines, all CSS and
JS inline, no build step). It talks **directly to Supabase from the browser**
with the anon key — there is no `api/` route between them. It loads
`@supabase/supabase-js@2`, `lucide` and `leaflet` from CDNs.

The catalogue behind it is the discovery pipeline's published output:

```
discovery_candidate_events        (private, worker-written)
        │  approve_discovery_candidate() / auto_publish_eligible_candidates()
        ▼
event_series ──< event_editions >── event_venues
                      │
                      └──< event_distances
event_organisers ──(public_organisers view)
```

`/explore` → `explore.html` via a `vercel.json` route. 96 routes there, all
the same rewrite-plus-no-cache shape.

## 2. Current Explore workflow

1. Page load calls **one** RPC: `search_event_editions({p_sort:'date', p_limit:1000})`.
2. **The entire forward catalogue is fetched once** into `ALL` and everything
   after that is client-side. This is deliberate and documented in the file:
   the map's result list follows the viewport, so a server round-trip per pan
   would be unusable.
3. `buildPlaces()` derives the autocomplete list from the loaded rows — so
   every suggestion is guaranteed to return results.
4. Leaflet map plots one `circleMarker` per event, coloured by
   `verification_tier`. Panning re-runs `applyFilters()`; **the viewport is
   the location filter** when no place is explicitly chosen.
5. `applyFilters()` filters `ALL` on: place match, map bounds, `before` date,
   minimum distance, and triathlon-leg inclusion.
6. `render()` groups by month and writes result rows.

**No login anywhere on this page.** No save, no follow, no detail page, no
analytics, no URL state.

## 3. Existing database model

`event_editions` (22 cols) — `id, series_id, venue_id, edition_year, title,
start_date, end_date, date_precision, date_confirmed, status,
registration_status, registration_url, official_url, timezone,
last_verified_at, source_candidate_id, created_at, updated_at,
participant_estimate, confidence_score, verification_tier, discipline`

`event_venues` (15) — incl. `city, region, country_code, latitude, longitude,
timezone, water_body_type, spot_id` ← **already joins to SwimLoading spots**

`event_series` (13) — incl. `prominence, event_type, official_url`

`event_distances` (13) — **already a proper child table**, incl.
`distance_metres, category, start_time, wetsuit_policy,
qualification_required, price_amount, price_currency`

`event_organisers` (14) — incl. `email`, and **no public-read policy**; the
public path is the `public_organisers` view.

`swimmer_event_entries` (9) — `user_id, edition_id, status, completed_on,
source_log_id, note, created_at, updated_at`.
Status CHECK: `interested | entered | completed`. Unique on
`(user_id, edition_id)`. **0 rows — built, never wired to a UI.**

Water temperature: `venue_water_readings` (observation, 6-hourly) and
`venue_water_climatology` (Copernicus, 83 venues × 52 weeks, populated).

### The most important finding

**`swim_events` is NOT the Explore catalogue.** The brief §2 says to extend
`swim_events`; that table is the *app's* user-created group swims
(`created_by, visibility, target_pace_sec_per_100m, tow_float_recommended,
requires_approval, recurrence_series_id`). It is a different product for a
different audience. The brief's own wording — "`swim_events` **or equivalent
public event model**" — resolves this: **the equivalent is `event_editions`,
and all Phase 1 work targets that.** Extending `swim_events` instead would
fork the catalogue in two.

There is also a **third**, unrelated event system: the `eventops` schema (19
tables — `organisations, registrations, payments, timing_reads, finish_times,
participants, prize_rules`). That is race-day operations, not discovery.
Note it defines its own `eventops.event_distances`, which is why
`pg_policies` appears to show conflicting policies on "event_distances" —
two tables, two schemas. **Do not touch `eventops` in this phase.**

## 4. Current API routes

There is **no Explore API**. `api/` holds 30 handlers (Strava, spots SEO,
sets, crons, channel content). Explore uses none of them.

Relevant existing infrastructure to reuse rather than rebuild:
- `api/cron/_auth.js` — `requireCronAuth()`, Bearer `CRON_SECRET`, GET-only.
- `api/spots-handler.js` + `api/seo-utils.js` — the established **server-side
  rendered public page** pattern; `/events/{slug}` should follow it exactly.
- `api/sitemap-dynamic.js` — **contains no event URLs today.**
- `analytics_events` (`event_name, user_id, properties`) — written by a
  fire-and-forget `fetch` POST straight to PostgREST; pattern in
  `welcome.html:1812`. Reuse this, don't invent a second analytics path.
- `notifications` table (`recipient_user_id, swim_event_id, type, title,
  message, payload, read_at`) — note `swim_event_id`, which points at the
  *other* events table; a catalogue notification needs its own column or a
  payload-based reference.

## 5. Gap analysis

| Brief § | Status | Note |
|---|---|---|
| 2 Canonical model | **Partly present** | Identity/date/location/distances/organiser largely exist. Missing: `slug`, descriptions, `water_type` on the edition, entry dates, expected temps, `is_public/is_searchable/is_featured`, claim fields |
| 3 Migrations | n/a | `MIGRATIONS.md` process already mandatory |
| 4 Search UX | **Partly** | Place, min distance, before-date, tri toggle exist. Missing: date *from*, radius, weekend-only, entries-open, confirmed-only, water type, explicit near-me mode |
| 5 Search API | **Absent** | Browser→Supabase direct. `search_event_editions` is the de-facto API |
| 6 Ranking + match reasons | **Absent** | Sorts by date only |
| 7 Result cards | **Partly** | Rows exist with tier badge, distances, temp. No save, no detail link, no image |
| 8 Detail pages | **Absent** | No `/events/{slug}` route, no slug column |
| 9 Save/follow | **Table exists, unused** | `swimmer_event_entries` + correct RLS. Missing: notify prefs, `saved`/`planning` states, all UI, post-login resume |
| 10 Change log + notifications | **Absent** | |
| 11 Trust indicators | **Present** | `verification_tier` + `vtierBadge()` already live and honest |
| 12 Organiser claim | **Absent** | |
| 13 Analytics | **Absent on Explore** | Infrastructure exists |
| 14 SEO | **Absent** | Page is `noindex,nofollow`; no structured data, no sitemap entries |
| 17 Security | **Good baseline** | RLS on every relevant table; organiser emails already hidden behind a view |
| 18 Performance | **Known ceiling** | Loads up to 1000 rows client-side, documented as a stopgap |

## 6. Security implications

- `event_editions` public read is `status <> 'unconfirmed'` — anonymous users
  can read every published edition. Correct for a public catalogue.
- `event_organisers` has **no** public policy; `email`/`phone` are not
  exposed. Any new API must keep reading through `public_organisers`.
- `analytics_events` admin read is gated on a **hardcoded email**
  (`auth.email() = 'dave.welensky@gmail.com'`), not `profiles.is_admin`.
  Inconsistent with every other admin gate; worth aligning.
- `profiles.is_admin` self-escalation was closed on 2026-08-05 (trigger
  `protect_profile_admin_fields`). New admin-gated APIs can now rely on it.
- **56 published editions came from AI-read (`ai_fallback`) candidates and
  have never been reviewed.** Auto-publish of AI candidates was stopped the
  same day, but those 56 are live. This directly constrains §14: making event
  pages indexable would put unreviewed machine-read listings into Google.

## 7. Assumptions requiring validation

1. `event_editions` is the canonical model, not `swim_events` — resolved from
   the brief's "or equivalent"; stated here so it is auditable.
2. `eventops` is out of scope.
3. Event **images** do not exist anywhere in the schema. Cards and OG tags
   need a designed fallback, not an image pipeline.
4. `notifications.swim_event_id` cannot carry an `event_editions` id without
   a schema change (FK points elsewhere).

## 8. Already present — deliberately NOT duplicated

- `event_distances` child table (brief asked for `swim_event_distances`)
- `swimmer_event_entries` (brief asked for `swim_event_follows`)
- verification tiers and their public labels
- venue↔spot link, water temperature observation + climatology
- RLS on every event table; organiser contact details already private
- cron authentication; analytics table and write pattern
