# SwimLoading Project Skill

You are working on the **SwimLoading** project. Read this entire file before doing anything else. This is the single source of truth for the project context.

---

## What SwimLoading Is

Cape Town ocean swimming community app — live at **swimloading.com**.
- Main app: `swimloading.com/app` → `index.html`
- Intel page: `swimloading.com/intel` → `intel.html`
- Admin dashboard: `swimloading.com/admin` → `admin.html` (dave.welensky@gmail.com only)
- Landing: `swimloading.com` → `welcome.html`

**Stack:** Vanilla HTML/CSS/JS (no framework) · Supabase (Postgres 17 + Auth + RLS) · Vercel (hosting, auto-deploy on git push) · Chart.js · Lucide Icons · PWA

**Repo:** `https://github.com/davewelensky/Swimloading.git` — branch `main`

**Rule:** Edit files locally → commit → push → Vercel deploys in ~30s. Never edit files on Vercel directly.

---

## Project Structure

```
/Users/davewelensky/SwimLoading/
├── index.html          # Main PWA app (~6500+ lines)
├── intel.html          # /intel page — False Bay crossing intelligence (~1400 lines)
├── admin.html          # /admin page — user analytics dashboard (~1100 lines)
├── welcome.html        # Landing page
├── sw.js               # Service worker
├── manifest.json       # PWA manifest
├── vercel.json         # Routing config
├── package.json        # Node scripts (import-historical-swims)
├── sql/applied/        # All applied DB migrations
├── scripts/            # Data import scripts
├── icons/              # App icons (icon-192.png, etc.)
└── .claude/commands/   # This skill file and other commands
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
| `profiles` | User profiles — id, email, display_name, phone, emergency_contact_name, city, avatar_url, onboarding_completed_at, notify_new_swims |
| `spots` | Swimming spots (30+) — id, name, type, latitude, longitude |
| `temp_logs` | Community temperature readings — user_id, spot_id, gps_spot_id, temp_c, created_at |
| `latest_spot_temps` | View — latest temp per spot |
| `swim_events` | Group swims — id, title, location_name, start_at, created_by, status, lat, lng, distance_km, target_pace_sec_per_100m, max_participants |
| `swim_participants` | RSVP/attendance — user_id, event_id |
| `notifications` | In-app bell notifications — user_id, type, title, message, payload, read |
| `historical_swims` | All recorded crossings |
| `historical_routes` | Route definitions |
| `historical_weather` | Weather at time of crossing |
| `v_false_bay_crossings` | View — clean False Bay crossing data |

### Critical: temp_logs FK ambiguity
`temp_logs` has **two** foreign keys to `spots` (`spot_id` and `gps_spot_id`). Always use the explicit hint when joining:
```js
supabaseClient.from('temp_logs').select('spots!temp_logs_spot_id_fkey(name)')
```
Using `.select('spots(name)')` alone will throw PGRST201 ambiguity error.

### profiles.email column
`email` is stored directly in `profiles` (copied from `auth.users` via trigger on signup, backfilled for existing users). The anon key can read it. **Do not** use `auth.users` directly — it requires service_role key.

### Supabase JS client naming
Always use `supabaseClient` as the variable name (NOT `supabase`). The CDN registers a global called `supabase`, so naming your client the same causes a silent conflict where the variable points to the SDK module object instead of your client instance.
```js
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

---

## Main App (index.html) — Key Patterns

### Global variables
```js
let currentUser = null;
let spots = [];
let conditionsCache = {};       // spot_id → array of recent temp_logs (last 96h)
let swimEventsCache = [];        // upcoming active swim_events
let selectedSpotLocked = false;
let gpsSuggestedSpotId = null;
```

### Onboarding / Hard Gate
On `loadApp()`, after fetching the profile, check for incomplete onboarding:
```js
if (!profile.onboarding_completed_at || !profile.phone) {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'none';
    showOnboardingPersonal();
    return;
}
```
Users who signed up before verification was enforced may have null details — they are forced back to onboarding stage 2 on next login.

### Notifications
`notify(userId, entityId, type, title, message, payload)` — inserts into `notifications` table.

Notification types (CHECK constraint): `swim_cancelled`, `approval_request`, `approval_granted`, `approval_rejected`, `participant_late`, `new_signup`, `spot_suggestion`, `swim_updated`, `rsvp_cancelled`, `new_swim`

### Avatar system
`profiles.avatar_url` stores either:
- A Lucide icon name (e.g. `"anchor"`, `"wave"`) — rendered with colour from `AVATARS` array
- A full HTTPS URL (Supabase Storage) — rendered as `<img>`

`updateHeaderAvatar(avatarValue)` handles both cases.

### Swim events
- `swim_events.status` values: `'planned'`, `'active'`, `'cancelled'`
- `swim_events.created_by` = organiser's user UUID
- `swim_participants.user_id` = attendees
- To get total swim activity for a user: query BOTH tables (organised + joined)

---

## Admin Dashboard (admin.html)

Live at `swimloading.com/admin`. Access: redirects to `/` if not `dave.welensky@gmail.com`.

### Sections
1. **KPI cards** — Total users, Active (30d), Dormant, Ghost, % Profiles Complete, Total Temp Logs
2. **Spot Activity** — bar chart (top 10) + table (top 15) by temp log count
3. **User Locations** — bar chart (top 10 cities) + full city breakdown table
4. **Users Table** — searchable/sortable, columns: Email · Display Name · Phone · Emergency · City · Temps · Joined (swim_participants) · Organised (swim_events.created_by) · Last Active · Status

### User status definitions
- 🟢 **Active** — any activity in last 30 days
- 🟡 **Dormant** — has activity but >30 days ago
- 👻 **Ghost** — zero activity ever (0 temps + 0 swims joined + 0 swims organised)

### City normalisation
`normaliseCity(raw)` function — lowercases input, looks up in `CITY_MAP`, falls back to title-case. Handles Cape Town variants, Somerset West, Simon's Town, Knysna (typo Knydna), Johannesburg + suburb Jansenpark, Hermanus, Hout Bay, Gordon's Bay, Fish Hoek, etc.

### Filter buttons
All · 🟢 Active · 🟡 Dormant · 👻 Ghost · ⚠️ Incomplete (missing display_name or phone)

---

## /intel Page — False Bay Intel

`intel.html` is the crossing intelligence dashboard. Currently private beta (Dave + Carina only).

### Tabs
1. **Now** — live conditions: GO/CAUTION/NO-GO signal, live water temps, wind forecast
2. **Window** — 7-day wind forecast table
3. **Records** — historical crossing records, scatter chart, swimmer profiles
4. **Prediction** — time predictions for skins solo crossings (women + men)

### Key Variables in intel.html
```javascript
const currentTemp = 17.0;  // Western bay start temp — UPDATE with each satellite/reading
// Line ~1281

const avgTemp = 17.0;      // Fallback when no live Supabase readings
// Line ~533 (in loadLiveTemps() no-readings return)

const temp = live?.avgTemp || 17.0;  // Used in buildGoSignal() and buildChecklist()
// Lines ~726 and ~756
```

### GO/NO-GO Logic
- **GO**: NW wind + speed < 35 km/h + temp ≥ 18°C
- **CAUTION**: partial conditions met
- **NO-GO**: non-NW wind OR speed ≥ 40 km/h OR wave > 2.5m

### Prediction Model
- Uses `v_false_bay_crossings` view
- Filters: `category=skins`, `swim_type=solo`
- Caps outliers at 13h max
- Shows women + men separately
- Two scenarios: at current temp / if temp reaches 18°C+

---

## SST Satellite Data Workflow

Satellite SST images are sent by Derrik/Ryan (~2x per day when available). Goal is to automate ingestion.

### How to Update SST Data (current manual process)
When a new satellite image arrives:

1. **Read the colour scale** (legend on right: purple=10°C → dark red/maroon=20°C)
2. **Extract key zone temps:**
   - Miller's Point / western bay start (swimming start)
   - Open bay mid-crossing
   - Strand / Rooi Els end (swimming finish)
   - Atlantic upwelling outside bay (context only)
3. **Update these locations in intel.html:**
   - Line ~330: Key Requirements checklist temp sub-text
   - Line ~531: `loadLiveTemps()` no-readings fallback display text
   - Line ~533: `return { avgTemp: X.X, hasLive: false }` — the number fed to prediction
   - Line ~562: Footer note below live readings list
   - Line ~726: `const temp = live?.avgTemp || X.X` in `buildGoSignal()`
   - Line ~756: `const temp = live?.avgTemp || X.X` in `buildChecklist()`
   - Line ~763: Checklist sub-text (both above/below threshold branches)
   - Line ~1281: `const currentTemp = X.X` — main prediction variable
4. **Commit with message:** `Update SST data from satellite image DD Mon YYYY`
5. **Push** — Vercel deploys automatically

### Colour Scale Reference
| Colour | Temp |
|---|---|
| Dark maroon | ~20°C |
| Dark red | ~19°C |
| Red | ~18°C |
| Orange-red | ~17°C |
| Orange | ~16°C |
| Yellow-green | ~15°C |
| Green | ~14°C |
| Teal/cyan | ~13°C |
| Blue | ~12°C |
| Dark blue | ~11°C |
| Purple | ~10°C |

### Current SST Values (last updated: 27 Feb 2026)
- Miller's Point start: **~17°C**
- Open bay mid-crossing: **~18–19°C**
- Strand / Rooi Els finish: **~17–18°C**

### Windguru Crossing Intel Card
When Windguru data is provided, add a static HTML card to the Now tab (after the tides card, before Swim Window). Pattern:
- Table: Time · Wind (km/h, converted from knots ×1.852) · Gusts · Direction · Rating
- Amber analysis panel: sweet spot window, swell context, watch points
- Blue GO-IF panel: direction ✓/✗, tide ✓/✗, swell ⚠️, clear NO-GO triggers
- Remove the card after the crossing date passes

---

## Key Spots (False Bay crossing route)
- **Miller's Point** — start of crossing, western bay, typically coolest
- **Glencairn** — mid-point sensor
- **Simons Town** — inshore reading
- **Rooi Els** — finish of crossing (33km from Miller's Point)
- **Strand / Gordon's Bay** — eastern bay, typically warmest (satellite SST ~20°C)

---

## TFT Display Device

Hardware: ESP32 + ILI9341 320×240 TFT screen
Code: `/Users/davewelensky/SwimLoading/device/SwimLoadingDisplay/SwimLoadingDisplay.ino`

3 rotating screens (30s each):
- **Screen 0** — Sea Surface Temps (spot cards + gradient bar)
- **Screen 1** — Crossing Intel (wind + swell + GO/NO-GO)
- **Screen 2** — Sunday Prediction (times + progress bars)

Data sources: Supabase (SST) + Open-Meteo (wind/swell)

Currently fixing layout issues on each screen — tackle one screen at a time.

---

## Pending Roadmap Items (next up)

### From feature backlog (in order of priority):
1. **Swim Overlap Warning** — amber banner in create swim form when another swim exists at same spot ±2h. Non-blocking. Uses `lat`/`lng` match + `.neq('status','cancelled')`. Functions: `checkSwimOverlap()`, `renderOverlapWarning()`. Add `onchange` to `#eventSpot` and `#eventDateTime`.

2. **New Swim Notifications (opt-in)** — `profiles.notify_new_swims BOOLEAN DEFAULT FALSE`. Toggle in Settings (only visible when push enabled). After `submitEvent()` succeeds, query opted-in users and call `notify()` for each. Needs SQL: `ALTER TABLE profiles ADD COLUMN notify_new_swims BOOLEAN DEFAULT FALSE` + add `'new_swim'` to notifications type CHECK constraint.

3. **Avatar Photo Upload** — Supabase Storage bucket `avatars` (public, 2MB). Tab UI in profile modal: Photo / Icon. `handleAvatarFileSelect()` uploads to `userId/avatar.ext`, stores public URL in `profiles.avatar_url`. `updateHeaderAvatar()` detects URL vs icon name. Backwards compatible with existing icon names.

4. **Profile Loading Spinner** — `showProfileSettings()` shows loading overlay immediately on open, hides after Supabase fetch resolves. Add `#profileLoadingOverlay` div inside `#profileModal`.

5. **Support Email** — add `support@swimloading.com` link to Settings page (above Sign Out) and welcome.html footer.

6. **Safety Check-in/out** — Phase 2 feature. "Going swimming" + "I'm out safe" with auto-alert if no check-out.

7. **Badges & Achievements** — Phase 2 gamification.

8. **Dev/Prod Supabase split** — long-standing deferral. `swimloading-dev` project for testing.

---

## Development Rules

1. **Always read the file before editing** — index.html is ~6500 lines, intel.html is ~1400 lines
2. **Never use `supabase` as your client variable name** — use `supabaseClient` (CDN conflict)
3. **Never use `|| 19.5`** as avgTemp fallback — it was a bug, correct value is `17.0`
4. **Use explicit FK hint** for temp_logs spot joins: `spots!temp_logs_spot_id_fkey(name)`
5. **Commit messages** follow pattern: `[what changed] — [why/context]`
6. **Test in browser** before committing when changing intel.html layout
7. **No framework** — this is vanilla HTML/JS, keep it that way
8. **RLS is on** for all main app tables; intel uses anon key with unrestricted views
9. **Don't break the main app** — index.html has ~163 live users
10. **One screen at a time** for TFT display work
11. **Hard gate is live** — users without `onboarding_completed_at` or `phone` get redirected to onboarding on login

---

## Design System

### Colour palette (shared across all pages)
```css
--ocean-blue: #0284c7
--ocean-light: #38bdf8
--ocean-dark: #0c4a6e
--dark-bg: #0a1628
--mid-bg: #1e293b
--card-bg: #162032
--border: rgba(255,255,255,0.08)
--text: #f1f5f9
--text-secondary: #94a3b8
--green: #10b981
--amber: #f59e0b
--red: #ef4444
```

### Component patterns
- Cards: `background: var(--card-bg)`, `border: 1px solid var(--border)`, `border-radius: 14px`
- Status pills: inline-flex, small rounded, colour-coded (green/amber/red)
- Toasts: `showToast(message, type)` — `type` is `'success'` or `'error'`
- Modals: `display: block/none` toggle, dark overlay
- Spinners: CSS `@keyframes spin { to { transform: rotate(360deg); } }`

---

## When This Skill Is Invoked

Use this context to:
- Update SST satellite data in intel.html
- Fix TFT display screen layouts
- Add features to the main app (index.html)
- Update or extend the admin dashboard (admin.html)
- Query or update Supabase tables
- Commit and push changes correctly
- Understand what's already built before suggesting new things

**Always check git log and current file state before making changes.**
