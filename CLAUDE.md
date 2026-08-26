# SwimLoading — Architecture & Deployment Guide

> **Adding a region, spot, or international domain?** See [EXPANDING.md](EXPANDING.md) — it has the complete checklist, hardcode map, and cross-app consistency checks.
>
> **Onboarding a new club?** See [CLUB_ONBOARDING.md](CLUB_ONBOARDING.md) — 8-step process, feature flag SQL, club type rules. Do not improvise.
>
> **Adding a page, partner, club, or feature?** See [GROWTH_HUB.md](GROWTH_HUB.md) — /growth-hub (Master Index) MUST be updated in the same ship. Missing this loses track of effort and developments.

---

## CLUB PLATFORM — MANDATORY RULES (read before any club code change)

These rules apply to every change touching `club-admin.html`, `coach.html`, `sets.html`, or any club guide page (`duc-guide.html`, `aquasharks-guide.html`, etc.).

### ⚠️ K8 Coaching merged into Aquasharks (26 Aug 2026) — K8 is now DORMANT
Britt asked to merge K8 into Aquasharks so she doesn't have to switch between two club-admin instances. All of K8's roster (108 members) and session history moved onto Aquasharks (migration `sql/applied/2026-08-26_migrate-k8-swimmers-to-aquasharks.sql`):
- K8's 06:00/07:00/08:00 Group → Aquasharks' new **OW Masters 6-7 / 7-8 / 8-9** squads (own squads, Mon/Wed/Fri, coach Britt)
- K8's Senior Squad (ASA) → folded into Aquasharks' own pre-existing **Senior Squad** (same swimmers — "the school senior squad")
- The K8 club record, its 4 squads, and their 9 session templates still exist in the DB but are **dormant** (`is_active = false`, not deleted) — nothing routes there anymore
- K8's `hasLeague`/`hasTempChallenge` flags were deliberately **not** carried over to Aquasharks (club-wide flags — would expose League/Temp Challenge to all of Aquasharks' other 215+ members, not just the moved swimmers) — open decision if Britt wants that later
- **If a report mentions "K8" going forward, first check whether it's actually about the OW Masters/Senior Squad swimmers now under Aquasharks** — K8 itself should show nothing (that's expected, not a bug)

### Before making ANY club change, state all three out loud:
1. **Which club asked for this?** (DUC or Aquasharks — K8 is dormant, see above. Britt runs Aquasharks; if something looks K8-specific, it's probably actually about the OW Masters/Senior Squad swimmers migrated into Aquasharks.)
2. **Which feature flag gates it?** (e.g. `hasSquads`, `hasParentLanguage`, `hasLeague` — name it)
3. **Does this touch shared code?** If yes, confirm with the user before proceeding.

If you cannot answer all three — stop and ask.

### Clubs sharing this codebase. Two admins:
- **Steve** → DUC
- **Britt** → Aquasharks (K8 Coaching also exists but is dormant, merged into Aquasharks — see above)

They are separate products. Never assume a feature for one applies to another.

| | DUC | Aquasharks | K8 Coaching (dormant) |
|---|---|---|---|
| Admin | Steve | Britt | Britt |
| Type | `open_water` | `swim_club` | `open_water` |
| Slug | `duc` | `aqua-sharks-atlantic` | `k8-coaching` |
| club_id | — | `385e2c9d-b32e-47d1-bb1d-1e042523de23` | `de64faab-c3d2-4997-a6bb-904ab989650c` |
| What it is | Open water SWIMMING club, adult members, monthly league races | Competitive pool club, youth + adult squads, Cape Town — now also includes the former K8 Masters swimmers (OW Masters 6-7/7-8/8-9) and K8's Senior Squad (folded into Aquasharks' own Senior Squad) | **Merged into Aquasharks 26 Aug 2026** — was Britt's coaching business, open water + Masters squads (06:00/07:00/08:00 Group, Mon/Wed/Fri). Squads/sessions still in DB but inactive. |
| Has squads | NO | YES | YES (dormant) |
| Has parents | NO | YES | NO |
| Has attendance | NO | YES | YES (dormant) |
| Has timetable | NO | YES | YES (dormant) |
| Has sets planner | NO | YES | YES (dormant) |
| Has league | YES | NO | YES (dormant) |
| Has temp challenge | YES | NO | YES (dormant) |
| Has gala entries | NO | YES | NO |
| Has coaching staff | NO | YES | YES (dormant) |

K8 was a **hybrid**: open-water type with league + temp challenge (DUC-like) *and* squads + attendance + timetable + sets (Aquasharks-like), but NO parents and NO gala entries. Kept here for historical/rollback reference only — don't build new features against K8, it's dormant.

### Feature flags (clubs.features JSONB → window._clubFeatures):
- `hasLeague` — League tab — DUC + K8
- `hasTempChallenge` — Temp Challenge tab — DUC + K8
- `hasSquads` — Squad Tracker, Sets Planner, Health — Aquasharks + K8
- `hasTimetable` — Timetable settings — Aquasharks + K8
- `hasAttendance` — Attendance tab — Aquasharks + K8
- `hasGalaEntries` — Entries tab — Aquasharks only
- `hasCoachingStaff` — Coaching staff card — Aquasharks + K8
- `hasParentLanguage` — Parent portal, parent matching — Aquasharks only

### Hard rules:
- A feature built for one club is NEVER added to another club without an explicit request
- Every new feature in shared files MUST be gated behind a feature flag — no un-gated code
- DUC is NOT a diving club. It is an open water swimming club with ~637 adult members
- Britt's login is `britt@k8coaching.co.za` for BOTH her clubs — never create a second auth account. Her club_admins rows (Aquasharks + K8) both use this one user_id (`7ade0520-0cf0-4dfb-8275-f053a17a836c`)
- Roster matching requires first name AND surname overlap — a shared first name alone is never a match
- The timetable (`club_squad_sessions`) drives the attendance "Mark →" cards. A squad with no timetable rows never shows a scheduled card — it must be hand-recorded. `day_of_week` is 0=Sun…6=Sat (matches JS `getDay()`).

---

## Architecture Overview (Split April 2026)

The codebase was split from a single 12,300-line `index.html` into modular files to prevent crashes and improve maintainability.

### File Structure

```
index.html (1,792 lines)
  ├─ HTML shell only
  ├─ Links to: app.js, app-nav.js, app-trends.js, app-fuel.js, style.css
  └─ All scripts use global scope (NOT ES modules)

app.js (6,879 lines)
  ├─ Core app initialization
  ├─ Auth / Dashboard / Home page
  ├─ Temperature logging
  ├─ Real-time updates
  └─ All shared utilities

app-nav.js (1,375 lines)
  ├─ Navigation logic & UI
  ├─ Profile completion
  ├─ Onboarding flow
  ├─ User settings
  └─ Account management

app-trends.js (829 lines)
  ├─ Trends tab
  ├─ Region grid rendering
  ├─ Temperature analytics
  └─ Historical data views

app-fuel.js (282 lines)
  ├─ Fuel/Challenges tab
  ├─ April Challenge UI
  ├─ Leaderboard
  └─ Points system

app-strava.js
  ├─ Strava connection UI (dashboard banner, profile card)
  ├─ Activity import modal
  ├─ Log form (prefill spot/date from activity)
  └─ Submit to /api/strava/import-activity

api/strava/
  ├─ connect-url.js   — GET, returns signed OAuth URL
  ├─ callback.js      — handles OAuth redirect, stores tokens
  ├─ token-helper.js  — shared: getValidStravaToken, getUserId
  ├─ activities.js    — fetches swims, spot matching, upserts strava_imports
  └─ import-activity.js — creates temp_log from selected activity

style.css (1,138 lines)
  ├─ All styling (dark theme)
  ├─ Desktop & mobile responsive
  ├─ Component styles (cards, buttons, nav)
  └─ Media queries for mobile optimization

promos-config.js
  └─ ALL promo/challenge definitions — dates, status, label (edit here only)

promos.js
  └─ Promo engine — isPromoActive(id) helper + auto-hides [data-promo] elements

manifest.json
  └─ PWA manifest (home screen install)

sw.js
  └─ Service worker (offline support)

vercel.json
  └─ Vercel routing & cache config (CRITICAL)
```

### Script Loading Order

All scripts are loaded sequentially in `index.html` **with global scope** (no ES modules). Order matters:
1. `app.js` — initializes everything, sets up global functions
2. `app-nav.js` — depends on app.js globals
3. `app-trends.js` — depends on app.js globals
4. `app-fuel.js` — depends on app.js globals
5. `app-strava.js` — depends on app.js globals (Strava integration)
6. `style.css` — styling applied after DOM loaded

**Cache busting:** Bump the `?v=N` query string on any script tag when you change that file (e.g. `app-strava.js?v=3`). Vercel's edge cache won't invalidate otherwise.

## Data Model

### Key Supabase Tables

- **users** — auth, profile status (onboarding_completed_at), home_domain
- **spots** — swim locations (name, code, domain, type, latitude, longitude, country_code)
- **domains** — regions (code, display_name, is_coastal, sort_order)
- **countries** — ISO countries (iso_code, name, is_domestic) — source of truth for international classification
- **temp_logs** — SWIMMER-reported temperature readings (spot_id, temp_c, created_at, user_id, location_source). Community/ground-truth data.
- **spot_water_readings** — MODELLED water temp per spot (`source` = open_meteo | copernicus), kept SEPARATE from temp_logs so model data never pollutes the community feed/count/points. View `spot_water_latest` = latest per spot+source. Populated by `/api/cron/marine-temps.js` (Open-Meteo Marine SST, coastal spots only, every 3h). See "Water-temperature intelligence" below.
- **swim_events** — upcoming group swims (title, date, domain, participants)
- **leaderboard** — April 2026 challenge scores (user_id, points, rank)
- **strava_connections** — OAuth tokens per user (service role writes; RLS enforced)
- **strava_imports** — cached Strava activities; `imported_to_log_id` set once imported

### Water-temperature intelligence (started Jul 2026)

Goal: a trustworthy water temp on every spot, blending sources with a confidence score.

- **Two sources, kept separate:** swimmer-reported (`temp_logs`, ground truth) + modelled (`spot_water_readings`). NEVER write model data into `temp_logs` — it would inflate the "temps logged" count and trip points/leaderboard triggers.
- **#1 Open-Meteo Marine (LIVE):** `/api/cron/marine-temps.js`, every 3h (`0 */3 * * *`). Fetches sea-surface temp for the ~95 coastal spots (OCEAN + LAGOON) in bulk batches of ≤20 (Open-Meteo bulk 400s above ~20 coords, or if ONE coord is off the marine grid — hence per-spot fallback). No API key.
- **Coverage reality:** marine model = oceans/seas only. Pools (69) + inland lake/dam/river (16) get NO model temp — they stay swimmer-reported (product decision: "swimmer-only + honest label"). ~2 coastal spots also lack grid coverage (e.g. Zinkwazi Lagoon up an estuary, Lake Lugano miscoded coastal).
- **#4 Confidence score (LIVE):** view `spot_temp_estimate` blends swimmer (preferred, ground truth) + model → `best_c`, `best_source`, `confidence` (high = both agree & swimmer <24h; medium = one fresh source; low = stale/single; none = nothing in 7d + no model). The app loads it into `window.spotTempEstimate` (in loadDashboard's cache block) and renders a temp + colour-coded confidence dot on each spot-picker row (`_spTempChip`, green/cyan/amber). Reuse this view anywhere a spot needs a trustworthy temp.
- **#5 Copernicus (Phase 3, later):** same `spot_water_readings` table, `source='copernicus'`, for history + forecast.

### Countries & International Classification

International spots are classified via `spots.country_code → countries.iso_code → countries.is_domestic`.

- `is_domestic = true` → South African spots (shown in Ocean/Pool/Inland/Lagoon/Dam tabs)
- `is_domestic = false` → International spots (shown in International tab; gold border treatment)

At startup, `loadCountriesAndRebuildIntl()` is called after `loadSpots()` and builds the `internationalSpotIds` Set. **Never use the hardcoded `INTERNATIONAL_DOMAINS` Set as the primary check** — it exists only as a fallback.

To add a new international country: INSERT into `countries` with `is_domestic = false` and ensure spots have the correct `country_code`.

### Key Global Variables

```javascript
let supabaseClient  // Supabase client instance
let currentUser     // Logged-in user object
let currentUserProfile  // Full profile (onboarding_completed_at, home_domain, etc.)
let domains = []    // All regions (loaded at startup)
let spots = []      // All active spots (loaded at startup — includes country_code)
let internationalSpotIds = new Set()  // spot IDs where countries.is_domestic = false — rebuilt after loadSpots()
let conditionsCache // Temperature cache by spot
let swimEventsCache // Upcoming swims cache
```

## Deployment Process

### Local Development Workflow

```bash
# 1. Make changes to any file (app.js, style.css, index.html, etc.)
# 2. Test locally in browser (F12 dev tools)

# 3. Commit changes
git add <file>
git commit -m "description of change"

# 4. Push to GitHub
git push

# 5. Vercel auto-deploys (watches main branch)
# Monitor: https://vercel.com/davewelensky/swimloading
```

### Vercel Configuration (vercel.json)

**CRITICAL:** Cache headers prevent stale assets from being served.

```json
{
  "routes": [
    {
      "src": "^/style\\.css$",
      "dest": "/style.css",
      "headers": {
        "Cache-Control": "no-cache, no-store, must-revalidate"
      }
    },
    {
      "src": "^/sw\\.js$",
      "dest": "/sw.js",
      "headers": {
        "Cache-Control": "no-cache",
        "Service-Worker-Allowed": "/"
      }
    },
    {
      "src": "^/app$",
      "dest": "/index.html",
      "headers": {
        "Cache-Control": "no-cache, no-store, must-revalidate"
      }
    }
  ]
}
```

**Without these headers**, Vercel's edge cache serves old versions of CSS/JS even after redeployment.

### Deployment Checklist

1. ✅ Change file (app.js, style.css, etc.)
2. ✅ **Growth Hub sync**: if the change adds/removes a page, partner, club, feature, email, or founding member — update `growth-hub.html` in the same commit (see [GROWTH_HUB.md](GROWTH_HUB.md))
3. ✅ `git add <file>`
4. ✅ `git commit -m "message"`
5. ✅ `git push`
6. ✅ Vercel redeploys automatically
7. ✅ Hard refresh browser: **Cmd+Shift+R** (Mac) or **Ctrl+Shift+R** (Windows)

**If changes don't appear**: Check Vercel dashboard for failed deployments, verify cache headers in vercel.json.

## Making Changes — By Feature

### Adding a New UI Component

1. **Decide which file**: Dashboard → `app.js` | Nav → `app-nav.js` | Trends → `app-trends.js`
2. **Add HTML** to the appropriate section in `index.html`
3. **Add JS logic** to the matching file (app.js, app-nav.js, etc.)
4. **Add CSS** to `style.css`
5. **Commit + Push** (see Deployment Checklist above)

### Fixing Styling (CSS)

1. Edit `style.css`
2. Commit + Push (Vercel redeploys)
3. Hard refresh browser
4. If old CSS still appears: Check cache headers in `vercel.json`

### Updating Navigation UI

1. Modify nav buttons in `index.html`
2. Update logic in `app-nav.js`
3. Update CSS in `style.css` (media queries for mobile!)
4. Commit + Push
5. Hard refresh on live site

### Adding a New Database Table (or any schema/data change)

Follow **[MIGRATIONS.md](MIGRATIONS.md)** — the 7-step workflow: migration file
from `sql/MIGRATION_TEMPLATE.sql` → read-only dry-run → backup if destructive →
Dave types "apply" → apply via `supabase-admin` MCP → verify read-only → file
into `sql/applied/` and ship. Never paste SQL into the dashboard except as the
documented fallback.

## Mobile Optimization

### Responsive Design Breakpoints

```css
@media (max-width: 520px) {
  /* Mobile styles here */
  /* These override desktop defaults */
}
```

**Important:** Always test changes on actual mobile device (not just browser resize).

### Common Mobile Issues

- **Icons squeezed**: Check `flex-direction: column` and `gap` property
- **Text too small**: Ensure `font-size` is readable on small screens
- **Buttons hard to tap**: Ensure padding/height ≥ 44px (Apple guidelines)

## Performance Considerations

### File Size Impact

- app.js is 371K (largest)
- If it exceeds 500K, consider splitting further (e.g., challenges logic into separate file)

### Lighthouse Monitoring

Vercel provides Lighthouse scores in deployment preview. Monitor:
- First Contentful Paint (FCP) < 2s
- Cumulative Layout Shift (CLS) < 0.1
- Largest Contentful Paint (LCP) < 2.5s

## Site Sync — single source of truth for cross-page facts

Facts that appear on many pages and used to drift at month-rollover / country-add
(country count, the current month's challenge, per-sponsor challenge state) now live
in ONE file. **Never hardcode these into individual pages again.**

### Files
- **`site-config.js`** — the single source of truth. Edit here only.
  - `countries` — international list (drives welcome.html pills/grid/footer AND every count; count = list + 1 for South Africa). Each entry has a `slug` — always build country hrefs from `c.slug` (`/spots/${c.slug}`), never guess one from the label. `slug: null` = no dedicated country page yet (link to its containing region instead, e.g. Italy → `/spots/europe`).
  - `spots` / `swimmers` / `tempsLogged` — global stats
  - `challenges['YYYY-MM']` — monthly challenge calendar; **auto-selected by SAST date, so a month's challenge goes live at 00:00 on the 1st with no code change** (just have the entry ready). Set `winner` (verified name only) to enable recap.
  - `sponsorChallenges` — links a partner page's challenge box to its challenge month.
- **`site-sync.js`** — runtime. Loaded AFTER site-config.js. Stamps `[data-sync="…"]` elements (numbers are comma-formatted automatically), and renders/recaps/hides `[data-challenge="…"]` sponsor boxes. API: `window.siteSync.currentChallenge()`, `.countryCount()`, `.sastMonth()`, `.refresh()`.

### Using it on a page
```html
<script src="/site-config.js"></script>
<script src="/site-sync.js"></script>
...
spots across <span data-sync="countries">12</span> countries      <!-- numeric -->
<span data-sync="countries.word">Twelve</span> countries          <!-- spelled-out -->
<span data-sync="spots">140</span>+ spots                         <!-- comma-formatted -->
<span data-sync="tempsLogged">2,400</span>+ temps logged
```
Sponsor challenge box (auto active / recap / pending / hidden) — see the pattern in `partners/magic5.html` (`data-challenge`, inner `data-state` sections, `data-slot` fields).

**⚠️ NEVER hand-type a country/spot/swimmer/temps-logged count, or hand-write a
per-country list (pills, grid cards, footer link columns), on ANY page.** Always
a `[data-sync]` span, or — for a repeated list like a country grid — a JS block
that maps over `window.SITE_CONFIG.countries` at render time. A hand-written
international footer list on welcome.html silently fell to 7 of 12 countries
this way (Jul 2026) because nobody remembers to touch a hardcoded list when a
country is added elsewhere — the fix was deleting the hardcoded list and
rendering it from `SITE_CONFIG.countries`, not "updating the 7 to 12."

**`site-config.js` and `site-sync.js` are served with `no-cache, no-store,
must-revalidate`** (see `vercel.json`) specifically so they never need a `?v=N`
cache-bust bump — editing the file is enough. Any page loading them plain
(no `?v=`) always gets the latest content immediately.

**Before shipping any change to `site-config.js`** (new country, new stat),
grep the repo for stale copies of the old numbers/lists to catch anything not
yet wired to `data-sync` — e.g. `grep -rn "12 countries\|140+" --include="*.html" .`
— and wire whatever you find to `data-sync` rather than hand-editing the number.

### ⚠️ CRITICAL — the monthly challenge lives in FOUR places. Update ALL of them, every month.

> **The file `app-june.js` is NOT June-only. It is the GENERIC in-app challenge engine and it runs the CURRENT month's challenge.** As of July 2026 it runs the **July "Winter Warrior" / Blu Smooth** challenge. The filename is legacy from when the first challenge was June — **do NOT create `app-july.js`, `app-august.js`, etc., and do NOT assume "June" content is stale just because the month changed.** Its copy (titles, prize, share text, draw date) is edited in place each month, and its live on/off + dates come from the DB challenge-config row it loads (`enabled`, `launch_date`, `end_date`, `test_mode`). Before touching it, read what month it is currently serving.

A challenge is only correct when **all four** are in step for the same month:

| # | Where | What to change | Drives |
|---|-------|----------------|--------|
| 1 | **DB challenge-config row** (loaded by `app-june.js`) | `launch_date`, `end_date`, `enabled`, `test_mode` | Whether the in-app challenge is live, and its window |
| 2 | **`app-june.js`** (the engine — misnamed, runs the current month) | In-place copy: title, prize, share strings, draw date, image | What logged-in users see in the app |
| 3 | **`site-config.js` → `challenges['YYYY-MM']`** | title, sponsor, prize, start/end, winner | Marketing/partner pages via `data-sync` + sponsor boxes (auto-selects by SAST month on the 1st) |
| 4 | **`site-config.js` → `sponsorChallenges`** | map the sponsor key → that month (e.g. `blusmooth: { challengeMonth: '2026-07' }`) | Which partner page shows the ACTIVE box vs a RECAP |

### Monthly rollover checklist (do once per month, BEFORE the 1st)
1. **DB config** — point the challenge-config row at the new month's `launch_date`/`end_date` (keep `test_mode` until launch, then flip live).
2. **`app-june.js`** — update the in-place copy for the new month (title, sponsor, prize, share text, draw date). Bump `?v=N` in `index.html`.
3. **`site-config.js`** — add the `challenges['YYYY-MM']` entry (appears on the marketing pages automatically on the 1st, SAST) and add/point the `sponsorChallenges` key to that month.
4. **Close last month** — set the **verified** `winner` on the month that just ended (see winner-verification process); its sponsor recap flips on automatically. Confirm the previous sponsor's page no longer shows an active challenge.
5. **Bump cache** — `?v=N` on `site-config.js` / `site-sync.js` wherever referenced (welcome.html + every partner page), plus `app-june.js` in index.html.
6. **Verify live**, month-boundary aware: the new challenge shows in the app AND on the sponsor's partner page (active), the previous sponsor shows a recap, and no page still advertises the finished month.

**Wired sponsor pages** (load `site-config.js` + `site-sync.js`, box = `data-challenge`): `partners/magic5.html` (June), `partners/blu-smooth.html` (July), `partners/maurten.html` (August). Add the same block to any future sponsor's page.

**This is separate from `promos.js`** below (banners/sale windows). Site-sync = facts & challenge calendar; promos = timed promotional banners.

## Promo & Challenge System

Seasonal promos and challenges are managed through two files — **never hardcode promo HTML/banners directly in pages**.

### Files
- **`promos-config.js`** — single source of truth. Add, end, or force promos here only.
- **`promos.js`** — engine. Exposes `window.isPromoActive(id)`. Must be loaded AFTER `promos-config.js`.

### Adding a new promo (3 fields)
```js
// in promos-config.js
'july-blusmooth': {
  status:    'auto',         // "auto" | "on" | "off"
  startDate: '2026-07-01',   // SAST, first day it shows
  endDate:   '2026-07-31',   // SAST, last day it shows (inclusive)
  label:     'Blu Smooth July Challenge',
},
```
Then wrap the promo HTML: `<div data-promo="july-blusmooth">…</div>`

### Status overrides
- `"auto"` — show only within date window (default)
- `"on"` — force visible (QA, early preview)
- `"off"` — force hidden (finished, paused)

### Timezone
All date comparisons use **Africa/Johannesburg (SAST)**. Change `PROMO_TIMEZONE` in `promos.js` to shift globally.

### Using isPromoActive() for nav links / CTAs
```js
// Hide a nav link when promo is inactive — avoids dead links
var link = document.getElementById('sale-nav-link');
if (link) link.style.display = isPromoActive('magic5-memorial-day') ? '' : 'none';
```

### Loading the scripts
Add to any page that uses `data-promo` attributes or `isPromoActive()`:
```html
<script src="/promos-config.js"></script>
<script src="/promos.js"></script>
```

### Current promo registry

| ID | Status | Window | Notes |
|----|--------|--------|-------|
| `magic5-memorial-day` | `off` | 15–27 May 2026 | Finished. Memorial Day sale. |
| `june-challenge` | `auto` | 1–30 Jun 2026 | Magic5 goggles prize draw |
| *(future)* `july-blusmooth` | — | Jul 2026 | MK2 wetsuit — details TBC |
| *(future)* `sis-june` | — | mid-Jun 2026 | SiS challenge — brief coming |

---

## Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| Blank page | Script load failed | Check browser console (F12), verify all .js files exist |
| Old CSS/JS still visible | Edge cache not invalidated | Bump `?v=N` on script tags; verify `Cache-Control: no-cache` in vercel.json |
| Nav icons squeezed | CSS not applied to mobile | Check `@media (max-width: 520px)` rules |
| Supabase error 401 | Auth token expired | Auto-refreshes on page reload |
| Changes don't appear | Not pushed to git | Run `git push` before hard refresh |
| Strava `redirect_uri: invalid` | `STRAVA_REDIRECT_URI` env var wrong/missing | Set to `https://www.swimloading.com/api/strava/callback` in Vercel env |
| Strava `invalid_state` on callback | Service worker cached old OAuth URL (39h old) | sw.js skips all `/api/` routes; connect-url sends `Cache-Control: no-store` |
| Strava save does nothing | Missing strava_imports row or stale form state | import-activity.js creates row inline; form state resets on open |
| Toast hidden behind modal | z-index clash | Toast z-index must be 99999; stravaLogModal is 10004 |
| Strava connect-url 500 | Missing env vars in Preview | SUPABASE_URL hardcoded fallback in all api/strava/*.js files |
| International tab shows nothing | INTERNATIONAL_DOMAINS hardcoded set didn't match actual domain codes | Fixed: uses countries.is_domestic via internationalSpotIds Set |
| Domestic tabs show intl spots | WATER_TYPE_GROUPS filter didn't exclude international spots | Fixed: filteredData now excludes internationalSpotIds |

## Strava Integration

### Principle
"Strava tracks the swim. SwimLoading tracks the water." Users import a Strava activity and add water temperature, conditions, and hazards that Strava doesn't capture.

### Status (May 2026)
- **Production approved** — 999 athletes allowed (Strava Developer Program approved)
- **Open to all users** — no beta gate; any logged-in user can connect Strava
- Connect entry points: Dashboard banner (new users), Log Conditions page, Profile settings

### OAuth Flow
1. User taps "Connect Strava" → `GET /api/strava/connect-url` (requires valid Supabase JWT)
2. Server returns signed OAuth URL: `userId|timestamp|hmac` base64url-encoded as `state`
3. User authorises on Strava → redirect to `/api/strava/callback?code=...&state=...`
4. Callback verifies HMAC state, exchanges code for tokens, upserts into `strava_connections`
5. Redirect to `/app?strava=connected` → JS shows toast

### Required Vercel Env Vars
- `STRAVA_CLIENT_ID` — 230706
- `STRAVA_CLIENT_SECRET` — (secret; regenerate at strava.com/settings/api if leaked)
- `STRAVA_REDIRECT_URI` — `https://www.swimloading.com/api/strava/callback`
- `STRAVA_HMAC_SECRET` — signs OAuth state parameter

### Key Lessons Learned
- **Service Worker must NOT cache `/api/` routes** — stale OAuth URLs cause `invalid_state` error. `sw.js` has `if (url.pathname.startsWith('/api/')) return;` guard.
- **`connect-url` response has `Cache-Control: no-store`** — prevents any edge/browser caching.
- **`STRAVA_REDIRECT_URI` env var** — must be `https://www.swimloading.com/api/strava/callback`. If this is wrong (e.g. placeholder), Strava returns `redirect_uri: invalid`.
- **`strava_connections` columns**: `updated_at` / `created_at` — there is no `connected_at` column.

### GPS Spot Matching
Spots GPS columns: `latitude`/`longitude` (NOT `lat`/`lng`). Haversine radius: 1.5km.

## Deployment Monitoring

- **Live site:** https://www.swimloading.com
- **Vercel fallback:** https://swimloading.vercel.app
- **Vercel dashboard:** https://vercel.com/davewelensky/swimloading
- **GitHub commits:** https://github.com/davewelensky/Swimloading/commits/main

## Brand Guidelines

Use these for every page, demo, email, or component built for SwimLoading. Do not deviate without explicit instruction.

### New Page Checklist
Every SwimLoading HTML page must have all of the following before shipping:
1. **Nav brand** — `logo-wave.png` (22px) + "SwimLoading" gradient text (see below)
2. **Mouse spotlight** — `body::before` CSS + `mousemove` JS (see below)
3. **No emojis** — Lucide icons only
4. **Dark background** — `#080f1a` or `#0a1628`
5. **Fonts** — Bebas Neue (headings) + DM Sans (body) — never Inter/Roboto/system-ui on branded pages

### Logo Assets (`/icons/`)

| File | What it is | When to use |
|------|-----------|-------------|
| `logo-wave.png` | Wave mark only (no text), cyan on transparent | **Nav bars** — use alongside "SwimLoading" text |
| `logo-nav.png` | Wave mark + "SWIMLOADING" wordmark stacked, cyan | Auth screens / login panels only (used at ~56px) |
| `logo.png` | Rounded square app icon (swimmer in water) | App store, PWA, favicon contexts only |
| `icons/icon.svg` | SVG wave icon | Favicon / `<link rel="icon">` |

**Nav brand HTML (always this pattern):**
```html
<a href="https://swimloading.com" style="display:flex;align-items:center;gap:7px;text-decoration:none;font-size:15px;font-weight:800;letter-spacing:-0.5px;background:linear-gradient(135deg,#38bdf8 0%,#0ea5e9 50%,#0284c7 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
  <img src="/icons/logo-wave.png" alt="" style="height:22px;width:auto;">SwimLoading
</a>
```
The text uses a **cyan gradient** (`#38bdf8 → #0ea5e9 → #0284c7`), weight 800, font-size 20px (mobile) / 24px (desktop), letter-spacing -0.5px. Never plain white.

### Buttons (marketing pages / demos)
- **Primary**: `background: #38bdf8`, `color: #080f1a`, `border-radius: 50px`, `font-weight: 700`, `padding: 13px 26px` — pill shape
- **Ghost**: `background: transparent`, `border: 1px solid rgba(255,255,255,0.15)`, `border-radius: 50px`, same padding
For pages in subdirectories (e.g. `/blog/`), use `../icons/logo-wave.png`.

### Colors

```css
--bg:          #080f1a   /* primary dark background */
--bg-card:     #0d1728   /* card background */
--cyan:        #38bdf8   /* brand accent — buttons, links, highlights */
--text:        #f1f5f9   /* primary text */
--text-sec:    #64748b   /* secondary/muted text */
--border:      rgba(255,255,255,0.06)
--amber:       #f59e0b   /* warnings, alerts */
--green:       #10b981   /* success, qualifies */
--danger:      #ef4444   /* errors */
```

### Typography

- **Headings / display:** `Bebas Neue` (Google Fonts)
- **Body / UI:** `DM Sans` (Google Fonts)
- Never use Inter, Roboto, Arial, or system-ui for SwimLoading branded pages

Google Fonts import:
```html
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,300&display=swap" rel="stylesheet">
```

### No emojis
Never use emojis in any SwimLoading UI. Use Lucide icons instead (`https://unpkg.com/lucide@latest`).

### Mouse Spotlight Effect
Used on `welcome.html` and all club demo pages. Add to any dark-background SwimLoading page:

**CSS** (inside `<style>`, on `body`):
```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  background:
    radial-gradient(18px circle at var(--mouse-x, -999px) var(--mouse-y, -999px),
      rgba(56, 189, 248, 0.55), transparent 100%),
    radial-gradient(500px circle at var(--mouse-x, -999px) var(--mouse-y, -999px),
      rgba(56, 189, 248, 0.07), transparent 70%);
}
```

**JS** (single `mousemove` listener — merge with any existing one, don't duplicate):
```javascript
document.addEventListener('mousemove', e => {
  document.body.style.setProperty('--mouse-x', e.clientX + 'px');
  document.body.style.setProperty('--mouse-y', e.clientY + 'px');
});
```
Default `-999px` keeps the dot off-screen until the mouse enters.

---

## Page Index — All swimloading.com Routes

Complete inventory of every public page. Brand checklist: spotlight = mouse cursor glow, logo = logo-wave.png + gradient text nav, pill = border-radius:50px buttons.

### App (authenticated)

| Route | File | Purpose | Spotlight | Logo Nav | Pill Btns |
|-------|------|---------|-----------|----------|-----------|
| `/app` | `index.html` + `app.js` etc | Main PWA — Dashboard, Temps, Swims, Trends, Safety, Leaderboard | n/a (mobile app) | n/a | ✅ (style.css .btn) |

### Marketing / Landing Pages

| Route | File | Purpose | Spotlight | Logo Nav | Pill Btns |
|-------|------|---------|-----------|----------|-----------|
| `/` | `welcome.html` | Main landing page — hero, features, sign up CTA | ✅ | ✅ | ✅ |
| `/pricing` | `pricing.html` | Pricing tiers (Free / Pro / Club) | ✅ | ✅ | ✅ |
| ~~`/landing`~~ | `landing.html` | **NOT LIVE — deliberately.** The file exists and has no route in `vercel.json`, so `/landing` returns 404. That is correct and should stay that way: it is a stale fork of `welcome.html` (same H1 "Know the water", same opening sections, untouched since 11 June), nothing links to it, and it is not in the sitemap. Routing it would publish a near-duplicate of the homepage competing with `/` for the same terms. Delete the file, or leave it as a scratch copy — but do not route it. Audited 2026-08-09. | — | — | — |
| `/pro` | `pro.html` | Big Water Intel — race intelligence product page | ✅ | ✅ | ✅ |

### Intelligence / Race Pages (paid data)

| Route | File | Purpose | Spotlight | Logo Nav | Pill Btns |
|-------|------|---------|-----------|----------|-----------|
| `/intel` | `intel.html` | Open water race intelligence hub | ✅ | ✅ | ✅ |
| `/robben` | `robben.html` | Robben Island crossing intelligence | ✅ | ✅ | ✅ |
| `/ri` | `ri.html` | RI swim data / conditions | ✅ | ✅ | ✅ |
| `/big5` | `big5.html` | Big 5 swim event intelligence | ✅ | ✅ | ✅ |
| `/capepoint` | `capepoint.html` | Cape Point swim intelligence | ✅ | ✅ | ✅ |
| `/dassen` | `dassen.html` | Dassen Island intelligence | ✅ | ✅ | ✅ |
| `/preekstool` | `preekstool.html` | Preekstoel crossing intelligence | ✅ | ✅ | ✅ |
| `/westangle` | `westangle.html` | West Angle crossing intelligence | ✅ | ✅ | ✅ |

### Campaign / Demo Pages

| Route | File | Purpose | Spotlight | Logo Nav | Pill Btns |
|-------|------|---------|-----------|----------|-----------|
| `/campaign` | `campaign.html` | Marketing campaign page | ✅ | ✅ | ✅ |
| n/a (direct link) | `blog/duc-demo.html` | DUC Club tier sales demo | ✅ | ✅ | ✅ |

### SEO Pages (SSR via Vercel)

| Route | Handler | Purpose | Spotlight | Logo Nav |
|-------|---------|---------|-----------|----------|
| `/spots` | `api/spots-handler.js` | All spots overview | ✅ | ✅ |
| `/spots/atlantic` | `api/spots-handler.js` | Atlantic Seaboard spots | ✅ | ✅ |
| `/spots/false-bay` | `api/spots-handler.js` | False Bay spots | ✅ | ✅ |
| `/spots/west-coast` | `api/spots-handler.js` | West Coast spots | ✅ | ✅ |
| `/spots/kzn` | `api/spots-handler.js` | KwaZulu-Natal spots | ✅ | ✅ |
| `/spots/garden-route` | `api/spots-handler.js` | Garden Route spots | ✅ | ✅ |
| `/spots/overberg` | `api/spots-handler.js` | Overberg spots | ✅ | ✅ |
| `/spots/inland` | `api/spots-handler.js` | Inland spots (dams/rivers) | ✅ | ✅ |
| `/spots/gauteng` | `api/spots-handler.js` | Gauteng (JHB/Pretoria) pools | ✅ | ✅ |
| `/spots/free-state` | `api/spots-handler.js` | Free State (Bloemfontein) | ✅ | ✅ |
| `/spots/{spot-name}` | `api/spots-handler.js` | Individual spot pages (~90+) | ✅ | ✅ |

**SEO config lives in:** `api/seo-utils.js` (DOMAIN_MAP, REGION_DOMAINS, REGION_NAMES, REGION_INTROS)

### Club Admin (authenticated — club_admins only)

| Route | File | Purpose | Brand Required |
|-------|------|---------|---------------|
| `/club-admin/:slug` | `club-admin.html` | Full club admin panel — roster, squads, attendance, galas, squad tracker, announcements | Minimal |
| `/sets/:slug` | `sets.html` | Sets Planner — weekly calendar, set library, AI generator, AI insights, WhatsApp sharing | Minimal |
| `/coach/:slug` | `coach.html` | Coach session view — attendance, walk-ins | Minimal |

**Sets Planner architecture (`sets.html` + `api/sets/`):**
- Auth: `getSession()` only — do NOT use `onAuthStateChange` to trigger boot (causes Supabase v2 deadlock)
- `api/sets/generate.js` — POST, calls Anthropic API, respects `duration_mins` hard constraint
- `api/sets/insights.js` — POST `{ club_id }`, uses `SUPABASE_SERVICE_KEY`, fetches 4-week set history + upcoming galas + swimmer PBs vs `ssa_qualifying_times`, returns Claude JSON recommendations
- Tables: `club_swim_sets`, `club_set_assignments` — both gated by `club_admins` RLS

### Internal / Admin

| Route | File | Purpose | Brand Required |
|-------|------|---------|---------------|
| `/admin` | `admin.html` | Admin panel (internal only) | No |
| `/admin/live-quiz` | `live-quiz-admin.html` | CLDSA live quiz admin — questions, start/finish, reset, QR. API `api/live-quiz.js`, rules in `api/_lib/live-quiz/`, local harness `node scripts/live-quiz-dev.mjs` | Minimal |
| `/live/:slug`, `/live/:slug/screen` | `live.html`, `live-screen.html` | Live quiz player page (members only) and projector screen (public, names as "First L.") | Yes |
| n/a | `blog/march-challenge.html` | Email template (March challenge) | Email only |
| n/a | `blog/april-recap_8.html` | Email template (April recap) | Email only |

### New Page Checklist

Every new public-facing SwimLoading page MUST have:

1. **Nav bar** — `logo-wave.png` (22px) + SwimLoading gradient text + CTA button
   ```html
   <nav style="...sticky top-0...">
     <a href="/" style="display:flex;align-items:center;gap:8px;text-decoration:none;">
       <img src="icons/logo-wave.png" alt="" style="height:22px;">
       <span style="font-size:20px;font-weight:800;background:linear-gradient(135deg,#38bdf8 0%,#0ea5e9 50%,#0284c7 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-0.5px;">SwimLoading</span>
     </a>
   </nav>
   ```
2. **Mouse spotlight** — `body::before` CSS + `mousemove` JS (see Brand Guidelines above)
3. **Pill buttons** — `border-radius: 50px` on all primary CTAs
4. **Dark background** — `#050d1a` or similar (never white/light backgrounds)
5. **No emojis** — use Lucide icons only
6. **Brand fonts** — Bebas Neue (display) + DM Sans (body) from Google Fonts

---

## Future Considerations

If code size becomes an issue again:
- Split `app.js` into: `app-home.js`, `app-log.js`, `app-profile.js`
- Lazy-load based on active page
- Use dynamic imports (`import()`) if converting to ES modules

---

**Last Updated:** May 18, 2026  
**Maintained by:** Dave Welensky & Claude

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules — full workflow in [.claude/CLAUDE.md](.claude/CLAUDE.md):
- The graph is a **navigation layer, not a source of truth**. Always verify against the real source before changing code.
- Use it for WIDE tasks (architecture, dependency tracing, blast radius, "where does X live"). Skip it for a known file and a small isolated edit.
- `npm run graph:check` before broad exploration; `npm run graph:refresh` only if stale in a way that affects the task (~6 s, no API cost).
- `graphify query "<question>"` returns a scoped subgraph — far cheaper than grepping the repo. `graphify path "A" "B"` for relationships, `graphify explain "X"` for one concept.
- Never load all of GRAPH_REPORT.md or graph.json into context; skim the relevant section only.
