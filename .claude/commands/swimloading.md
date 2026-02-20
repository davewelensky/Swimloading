# SwimLoading Project Skill

You are working on the **SwimLoading** project. Read this entire file before doing anything else. This is the single source of truth for the project context.

---

## What SwimLoading Is

Cape Town ocean swimming community app — live at **swimloading.com**.
- Main app: `swimloading.com/app` → `index.html`
- Intel page: `swimloading.com/intel` → `intel.html`
- Landing: `swimloading.com` → `welcome.html`

**Stack:** Vanilla HTML/CSS/JS (no framework) · Supabase (Postgres 17 + Auth + RLS) · Vercel (hosting, auto-deploy on git push) · Chart.js · PWA

**Repo:** `https://github.com/davewelensky/Swimloading.git` — branch `main`

**Rule:** Edit files locally → commit → push → Vercel deploys in ~30s. Never edit files on Vercel directly.

---

## Project Structure

```
/Users/davewelensky/SwimLoading/
├── index.html          # Main PWA app (~6000 lines)
├── intel.html          # /intel page — False Bay crossing intelligence
├── welcome.html        # Landing page
├── sw.js               # Service worker
├── manifest.json       # PWA manifest
├── vercel.json         # Routing config
├── package.json        # Node scripts (import-historical-swims)
├── sql/applied/        # All applied DB migrations
├── scripts/            # Data import scripts
└── .claude/commands/   # This skills file and other commands
```

---

## Supabase Database

**Project ID:** `szgkzuswelntnevobnoh`
**URL:** `https://szgkzuswelntnevobnoh.supabase.co`

### Key Tables
| Table | Purpose |
|---|---|
| `profiles` | User profiles |
| `spots` | Swimming spots (30+) |
| `temp_logs` | Community temperature readings |
| `latest_spot_temps` | View — latest temp per spot |
| `swim_events` | Group swims |
| `swim_participants` | RSVP/attendance |
| `historical_swims` | All recorded crossings |
| `historical_routes` | Route definitions |
| `historical_weather` | Weather at time of crossing |
| `v_false_bay_crossings` | View — clean False Bay crossing data |

### Key Spots (False Bay crossing route)
- **Miller's Point** — start of crossing, western bay, typically coolest
- **Glencairn** — mid-point sensor
- **Simons Town** — inshore reading
- **Rooi Els** — finish of crossing (33km from Miller's Point)
- **Strand / Gordon's Bay** — eastern bay, typically warmest (satellite SST ~20°C)

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

Satellite SST images are sent by Derrik/Ryan (~2x per day when available).
Source is being investigated — goal is to automate ingestion.

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

### Current SST Values (last updated: 20 Feb 2026)
- Miller's Point start: **~17°C**
- Open bay mid-crossing: **~19°C**
- Strand / Rooi Els finish: **~20°C**
- Bay warming trend: confirmed (warming vs 19 Feb)

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

## Development Rules

1. **Always read the file before editing** — intel.html is ~1400 lines
2. **One screen at a time** for TFT display work
3. **Never use `|| 19.5`** as avgTemp fallback — it was a bug, correct value is `17.0`
4. **Commit messages** follow pattern: `[what changed] — [why/context]`
5. **Test in browser** before committing when changing intel.html layout
6. **No framework** — this is vanilla HTML/JS, keep it that way
7. **RLS is on** for all main app tables; intel uses anon key with unrestricted views
8. **Don't break the main app** — index.html has live users

---

## Roadmap Context

- **Phase 1 (now):** Beta — 20 testers, core features live
- **Phase 2:** Safety system, community features
- **Phase 3:** Data intelligence, predictions, Strava/Garmin import
- **Phase 4:** Insurance play (Discovery Vitality, Outsurance)

The `/intel` page is the foundation of Phase 3 intelligence — it will expand significantly.

---

## When This Skill Is Invoked

Use this context to:
- Update SST satellite data in intel.html
- Fix TFT display screen layouts
- Add new intel features
- Query or update Supabase tables
- Commit and push changes correctly
- Understand what's already built before suggesting new things

**Always check git log and current file state before making changes.**
