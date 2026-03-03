# SwimLoading Project Skill

You are working on the **SwimLoading** project. Read this entire file before doing anything else. This is the single source of truth for the project context.

---

## What SwimLoading Is

Cape Town ocean swimming community app — live at **swimloading.com**. Growing nationally.
- Main app: `swimloading.com/app` → `index.html`
- Intel page: `swimloading.com/intel` → `intel.html`
- Admin dashboard: `swimloading.com/admin` → `admin.html` (dave.welensky@gmail.com only)
- Landing: `swimloading.com` → `welcome.html`
- Email templates: `swimloading.com/blog/march-challenge.html`

**Stack:** Vanilla HTML/CSS/JS (no framework) · Supabase (Postgres 17 + Auth + RLS) · Vercel (hosting, auto-deploy on git push) · Chart.js · Lucide Icons · PWA

**Repo:** `https://github.com/davewelensky/Swimloading.git` — branch `main`

**Users:** ~315+ registered (March 2026). Growing beyond Cape Town — KZN/Durban users arriving.

**Rule:** Edit files locally → commit → push → Vercel deploys in ~30s. Never edit files on Vercel directly.

---

## Project Structure

```
/Users/davewelensky/SwimLoading/
├── index.html          # Main PWA app (~9500+ lines)
├── intel.html          # /intel page — False Bay crossing intelligence (~1500 lines)
├── admin.html          # /admin page — user analytics + spotlight management
├── welcome.html        # Landing page
├── blog/
│   └── march-challenge.html  # March 2026 Temperature Challenge email template
├── sw.js               # Service worker
├── manifest.json       # PWA manifest
├── vercel.json         # Routing config
├── package.json        # Node scripts
├── supabase/
│   └── functions/
│       └── send-push/index.ts  # Edge Function — Web Push delivery (--no-verify-jwt)
├── sql/applied/        # All applied DB migrations
├── scripts/            # Data import scripts
├── icons/              # App icons
└── .claude/commands/   # This skill file
```

---

## Supabase Database

**Project ID:** `szgkzuswelntnevobnoh`
**URL:** `https://szgkzuswelntnevobnoh.supabase.co`
**Anon Key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA`
**VAPID Public Key:** `BAd_dnaXgagx5PBYmVLeuHsCyljuCrUQVGTd7ZqFcJnw9S1mAh-kGFkn2gcs74IBIvdugFqHmqgTnRu9dRNeBtk`

### Key Tables
| Table | Purpose |
|---|---|
| `profiles` | User profiles — id, email, display_name, phone, emergency_contact_name, city, avatar_url, onboarding_completed_at, notify_new_swims, is_admin |
| `spots` | Swimming spots — id, name, code (required!), water_type, domain, latitude, longitude, active |
| `temp_logs` | Community temperature readings — user_id, spot_id, gps_spot_id, temp_c, created_at |
| `latest_spot_temps` | View — latest temp per spot. **Filters WHERE code IS NOT NULL** |
| `swim_events` | Group swims — id, title, location_name, start_at, created_by, status, distance_km, max_participants |
| `swim_participants` | RSVP/attendance — user_id, event_id, status |
| `notifications` | In-app bell notifications — recipient_user_id, type, title, message, payload, read_at |
| `push_subscriptions` | Web Push subscriptions per device — user_id, subscription (JSON), user_agent, created_at |
| `hazard_reports` | Active hazard alerts — spot_id, hazard_type, severity, title, description, active_until |
| `spotlights` | SA Open Water Spotlight entries — title, swimmer_names, route_description, distance_km, status, tracking_url, active |
| `spotlight_updates` | Progress updates for spotlights — spotlight_id, notes, temp_c, km_completed, logged_at |
| `historical_swims` | All recorded crossings (2,685 swims, Big Bay Events 2014–2024) |
| `historical_routes` | Route definitions |
| `historical_swimmers` | Normalised swimmer profiles |
| `historical_weather` | Weather at time of crossing (currently empty — backfill pending) |
| `v_false_bay_crossings` | View — clean False Bay crossing data |

### Spots — Critical Notes
- `code` column is **required** — without it, the spot won't appear in Trends (`latest_spot_temps` filters `WHERE code IS NOT NULL`)
- The admin spot creation form auto-fills code from spot name (UPPER_SNAKE_CASE)
- `domain` CHECK constraint (current): `ATLANTIC`, `FALSE_BAY`, `WEST_COAST`, `SOUTH_COAST`, `GARDEN_ROUTE`, `EASTERN_CAPE`, `KZN`, `INLAND`, `NON_COASTAL`, `NAMIBIA`
- `water_type` CHECK constraint (current): `OCEAN`, `LAGOON`, `POOL`, `DAM`
- When adding a new domain via SQL: use `NOT VALID` on the new constraint to skip existing-row scan (avoids Supabase transaction conflict). All existing data is clean.

### Domains (Regions)
```javascript
// index.html — buildGroupedSpotOptions() and Trends section
const DOMAINS = ['ATLANTIC', 'FALSE_BAY', 'WEST_COAST', 'SOUTH_COAST', 'GARDEN_ROUTE', 'EASTERN_CAPE', 'KZN', 'INLAND', 'NAMIBIA'];
const COASTAL_REGIONS = ['ATLANTIC', 'FALSE_BAY', 'WEST_COAST', 'SOUTH_COAST', 'GARDEN_ROUTE', 'EASTERN_CAPE', 'KZN', 'NAMIBIA'];
```

`formatDomain(d)` auto-converts snake_case to Title Case. Special override:
```javascript
function formatDomain(d) {
    const overrides = { KZN: 'KwaZulu-Natal' };
    if (overrides[d]) return overrides[d];
    return d.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
```

When adding a NEW domain, update **4 places** in `index.html`:
1. `DOMAINS` array in `buildGroupedSpotOptions()` (~line 606)
2. Ungrouped exclusion filter array (~line 620)
3. `COASTAL_REGIONS` array in Trends section (~line 8721)
4. `DOMAINS` array in Trends section (~line 8725)
Also update: `admin.html` domain `<select>` (~line 488), and `eventRegionFilter` `<select>` in Swims tab.

### Spots by region
- **Atlantic**: Sea Point, Clifton, Camps Bay, Bakoven, Llandudno, Sandy Bay, Hout Bay area
- **False Bay**: Muizenberg, Boulders, Simon's Town, Fish Hoek, Clovelly, Roman Rock Lighthouse
- **West Coast**: Big Bay, Small Bay, Melkbosstrand, Yzerfontein, Langebaan, Paternoster
- **South Coast**: Pringle Bay, Rooi Els, Betty's Bay, Fisherhaven Lagoon, Klein River Lagoon
- **Garden Route**: Santos Beach, Mossel Bay, Knysna
- **Eastern Cape**: Port Elizabeth/Gqeberha, St Francis Bay, Kenton-on-Sea
- **KZN**: DUC (-29.869091, 31.053618), Durban Surf (-29.850122, 31.039588), Umhloti Beach (-29.664785, 31.122931)
- **Namibia**: Swakopmund Beach, Walvis Bay

### Critical: temp_logs FK ambiguity
`temp_logs` has **two** foreign keys to `spots`. Always use explicit hint:
```js
supabaseClient.from('temp_logs').select('spots!temp_logs_spot_id_fkey(name)')
```

### profiles columns
- `email` — copied from `auth.users` via trigger. Do not query `auth.users` directly.
- `display_name` — set during onboarding (`saveOnboardingPersonal()` sets both `full_name` AND `display_name`)
- `notify_new_swims` — **DEFAULT true** (opt-out model). All existing users set to true Feb 2026.
- `is_admin` — boolean DEFAULT false. Dave's profile has `is_admin = true`.

### Supabase JS client naming
Always use `supabaseClient` (NOT `supabase`). CDN registers a global called `supabase` — naming conflict causes silent failure.

---

## Push Notifications

**Stack:** Web Push API + VAPID + Supabase Edge Function + pg_net webhook

### How it works
1. User opts in → `push_subscriptions` row inserted
2. `notify()` inserts into `notifications` table
3. Database webhook `push_on_notification` fires on INSERT → calls `send-push` Edge Function
4. `notify()` also directly invokes `send-push` via `functions.invoke()` for reliability
5. Edge Function sends Web Push to all user's subscriptions via VAPID

### Edge Function deployment
```bash
npx supabase functions deploy send-push --project-ref szgkzuswelntnevobnoh --no-verify-jwt
```
**Must use `--no-verify-jwt`** — pg_net webhook sends no auth header.

### notify() — allowed notification types (CHECK constraint)
`swim_cancelled`, `approval_request`, `approval_granted`, `approval_rejected`, `participant_late`, `new_signup`, `spot_suggestion`, `swim_updated`, `rsvp_cancelled`, `new_swim`, `hazard_alert`

**Do NOT use** `'test'` or `'new_member'` — they violate the constraint.

### iOS Requirements
- App must be installed as **Home Screen icon** (not just Safari tab)
- Push subscriptions expire — 410 from Apple auto-deletes the subscription

---

## SA Open Water Spotlight

Admin-managed banner at top of dashboard for notable swim feats (relays, crossings).

### Tables
- `spotlights` — title, swimmer_names, route_description, distance_km, status (`upcoming`/`live`/`completed`), tracking_url, active
- `spotlight_updates` — spotlight_id, notes, temp_c, km_completed, logged_at

### RLS
- SELECT: `active = true`
- INSERT/UPDATE/DELETE: authenticated users

### Admin management (admin.html → 🌟 SA Open Water Spotlight)
- Create/edit spotlights, status dropdown, post live updates, archive when done
- `loadSpotlightBanner()` in index.html — shown only when status = upcoming or live

---

## Hazard Warning System

When creating a swim at a hazardous spot, users see a confirmation modal before proceeding.

- `activeHazardsBySpot` — global Map keyed by spot_id, loaded in `loadDashboard()`
- `hazardAcknowledged` — module-level boolean flag
- `showHazardConfirm(hazards)` — modal with NSRI number (087 094 9774)
- `proceedCreateAnyway()` — sets flag + calls `requestSubmit()`

---

## Swim Score Temperature Cap

```javascript
let scoreCap = 100;
if (isOceanType && spot.temp_c != null) {
    if (t < 14)       scoreCap = 49;  // Cold → max "Fair"
    else if (t < 16)  scoreCap = 74;  // Cool → max "Good"
}
const score = Math.max(0, Math.min(scoreCap, Math.round(raw)));
```

---

## Email Infrastructure

### Outbound auth emails (signup confirmation, password reset)
- **Provider:** Resend SMTP (`smtp.resend.com`, port 465, username `resend`)
- **Sender:** `no-reply@swimloading.com`
- **Domain:** `swimloading.com` verified in Resend (Ireland eu-west-1)
- **Config:** Supabase → Authentication → Settings → Custom SMTP
- **Note:** If a user says password reset email not arriving, first try admin-resend from Supabase Dashboard → Authentication → Users → three-dot menu → Send password recovery. Also check spam.

### Inbound support mailbox
- `support@swimloading.com` → forwarded to `dave.welensky@gmail.com` via Cloudflare Email Routing

### Bulk email campaigns
- **Provider:** Brevo (brevo.com) — account: `dave.welensky@gmail.com`
- **Sender:** `SwimLoading <support@swimloading.com>` — domain authenticated
- **Contact list:** "SwimLoading Members" (~315+ contacts, update before each campaign)
- **Export members SQL:**
  ```sql
  SELECT email, display_name FROM profiles
  WHERE email IS NOT NULL AND email != ''
  ORDER BY display_name;
  ```
- **Campaign history:** March Temperature Challenge 2026 (sent Feb 26 2026) — 45% open rate, 35% CTR

---

## Main App (index.html) — Key Patterns

### Global variables
```js
let currentUser = null;
let spots = [];
let conditionsCache = {};
let swimEventsCache = [];
let selectedSpotLocked = false;
let gpsSuggestedSpotId = null;
let hazardAcknowledged = false;
let activeHazardsBySpot = {};
```

### Swims Tab — Event Filters
The Swims tab has two side-by-side filters:
- `eventRegionFilter` — static `<select>` with all domains as options (All/Atlantic/False Bay/.../KwaZulu-Natal/Pools & Inland/Namibia)
- `eventMonthFilter` — dynamic `<select>` populated by `populateMonthFilter()` with next 12 months (e.g. "April 2026")
- `populateMonthFilter()` is called from the spots-load callback alongside `populateSpotDropdowns()`
- Filter logic in `loadEvents()` looks up event's `spot_id` against in-memory `spots` array for `domain`, and filters month by `start_at`
- `clearEventFilter()` resets both `eventRegionFilter` and `eventMonthFilter`
- **No** `eventSpotFilter` or `eventTypeFilter` — these were replaced

### New swim notifications
After `submitEvent()` succeeds, queries profiles where `notify_new_swims = true` (excluding creator) and calls `notify()` for each. Shows toast: "📣 X swimmers notified".

---

## Admin Dashboard (admin.html)

### Sections
1. **KPI cards** — Total users, Active (30d), Dormant, Ghost, % Profiles Complete, Total Temp Logs
2. **Spot Management** — Add spot (code auto-fills from name), toggle active/inactive
3. **Spot Activity** — bar chart + table by temp log count
4. **User Locations** — bar chart + city breakdown
5. **🌟 SA Open Water Spotlight** — create/edit spotlights, post live updates, archive
6. **Users Table** — searchable/sortable, status filter
7. **📳 Test Push** button — sends test notification to Dave's devices

### User status definitions
- 🟢 **Active** — activity in last 30 days
- 🟡 **Dormant** — has activity but >30 days ago
- 👻 **Ghost** — zero activity ever
- ⚠️ **Incomplete** — missing display_name or phone

### Admin notifications
When user completes onboarding, all `is_admin = true` profiles get a `new_signup` notification.

---

## /intel Page — False Bay Crossing Intelligence

### Key Variables
```javascript
const currentTemp = 17.0;  // Line ~1281
const avgTemp = 17.0;      // Line ~533
const temp = live?.avgTemp || 17.0;  // Lines ~726 and ~756
```

### GO/NO-GO Logic
- **GO**: NW wind + < 35 km/h + temp ≥ 18°C
- **NO-GO**: non-NW wind OR ≥ 40 km/h OR wave > 2.5m

### APIs active on intel.html
- **WorldTides** — live tide predictions. Key: `7e54bed9-1290-4668-82da-aecaaa714a50` (~line 547). Free tier ($3.99/yr, 1000 credits). Endpoint: `https://www.worldtides.info/api/v3?extremes`
- **Open-Meteo** — 7-day marine + wind forecast for Miller's Point (-34.2269, 18.4648)

### Crossing Prediction Model (False Bay)
Formula: `33 / (owPace + currentAssist) + (17 * 15 / 3600)` hours
- 33 km crossing, 17 feeds × 15s, current assist varies by wind
- Current assist calibration (from historical Weather Underground data):
  - NW 10–15 mph (Kat's record 30 Nov 2022, 8:09:26): 0.43 km/h assist confirmed
  - NNW/NW 12–17 mph (Barend's day 24 Feb 2024): very similar profile to a good forecast day
  - Best Case (0.45 km/h assist): NW 15+ mph building through day
  - Most Likely (0.35 km/h assist): NW 10–15 mph steady
  - Conservative (0.20 km/h assist): NNW 8–12 mph moderate

---

## SST Satellite Data

### Current values (last updated: 27 Feb 2026)
- Miller's Point start: **~17°C**
- Open bay mid-crossing: **~18–19°C**
- Strand / Rooi Els finish: **~17–18°C**

### Colour scale
| Colour | Temp | | Colour | Temp |
|---|---|---|---|---|
| Dark maroon | ~20°C | | Yellow-green | ~15°C |
| Dark red | ~19°C | | Green | ~14°C |
| Red | ~18°C | | Teal/cyan | ~13°C |
| Orange-red | ~17°C | | Blue | ~12°C |
| Orange | ~16°C | | Purple | ~10°C |

### Update locations in intel.html
Lines ~330, ~531, ~533, ~562, ~726, ~756, ~763, ~1281

---

## Historical Swim Data

- 2,685 swims (Big Bay Events 2014–2024) imported into `historical_swims`
- 49 False Bay crossings (20 solo) — used in intel.html `loadCarina()` stats
- `historical_weather` table is **empty** — Open-Meteo backfill not yet done
- `conditions` field on crossings (`good`/`bumpy`/`choppy`) not yet used in intel predictions

---

## TFT Display Device

Hardware: ESP32 + ILI9341 320×240 TFT
Code: `/Users/davewelensky/SwimLoading/device/SwimLoadingDisplay/SwimLoadingDisplay.ino`

---

## Design System

```css
--ocean-blue: #0284c7      --ocean-light: #38bdf8
--ocean-dark: #0c4a6e      --dark-bg: #0a1628
--mid-bg: #1e293b          --card-bg: #162032
--border: rgba(255,255,255,0.08)
--text: #f1f5f9            --text-secondary: #94a3b8
--green: #10b981           --amber: #f59e0b
--red: #ef4444
```

---

## Pending Roadmap Items

1. **Swim Overlap Warning** — amber banner when another swim exists at same spot ±2h
2. **Avatar Photo Upload** — Supabase Storage bucket `avatars`, tab UI in profile modal
3. **Profile Loading Spinner** — overlay while Supabase fetch resolves
4. **Safety Check-in/out** — Phase 2: "Going swimming" + "I'm out safe" + auto-alert
5. **Badges & Achievements** — Phase 2 gamification
6. **Dev/Prod Supabase split** — `swimloading-dev` project for testing
7. **Admin "View" modal** — view full user details from admin panel
8. **Monthly Challenge leaderboard RPC** — `sql/applied/monthly_challenge_rpc.sql` still needs to be applied in Supabase
9. **historical_weather backfill** — Open-Meteo API backfill for all crossing dates
10. **Conditions breakdown in intel** — split crossing times by Good/Bumpy/Choppy conditions

---

## Development Rules

1. **Always read the file before editing**
2. **Never use `supabase` as client variable** — use `supabaseClient`
3. **Never use `|| 19.5`** as avgTemp fallback — correct value is `17.0`
4. **Use explicit FK hint** for temp_logs: `spots!temp_logs_spot_id_fkey(name)`
5. **Spots need a code** — without `code`, spot is invisible in Trends
6. **Push Edge Function needs `--no-verify-jwt`** when deploying
7. **Notification types are constrained** — only use allowed values
8. **RLS is on** — when adding new tables, add SELECT + INSERT + UPDATE + DELETE policies
9. **No framework** — vanilla HTML/JS only
10. **Commit messages:** concise description of what + why
11. **Hard gate is live** — users without `onboarding_completed_at` or `phone` redirected to onboarding
12. **New domain SQL** — always use `NOT VALID` on constraint ADD to avoid Supabase transaction conflict
13. **water_type constraint** — only `OCEAN`, `LAGOON`, `POOL`, `DAM` are valid (not TIDAL_POOL, LAKE, RIVER — those are UI filter groupings only)
