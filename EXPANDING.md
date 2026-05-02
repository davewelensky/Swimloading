# SwimLoading — Expansion & Consistency Guide

> The rules for adding regions, spots, features, or tabs without breaking anything.
> Keep this in sync. If you change a pattern, update this doc.

---

## The App in One Paragraph

SwimLoading is a 6-tab PWA. Regions and spots are stored in Supabase (`domains` and `spots` tables). Most of the app is **DB-driven** — add a row and it appears everywhere. The exceptions are: international domains (need code changes), the Safety tab (regional content is hardcoded per safety group), and SEO pages (need seo-utils.js entries). Everything else is automatic.

---

## The 6 Tabs — What They Own

| Tab | `showPage()` key | Logic file(s) | Domain-aware? |
|-----|-----------------|--------------|---------------|
| Home | `dashboard` | `app.js → loadDashboard()` | Yes — shows latest temps per domain, intl flag on cards |
| Temps | `logTemp` | `app.js → renderSpotPicker()` | Yes — spot picker groups by domain, intl pill |
| Swims | `events` | `app.js → loadSwimEvents()` | Minimal — filter by region, not domain-specific |
| Trends | `history` | `app-trends.js → loadTrends()` | Yes — regional cards, intl filter, grouped by domain |
| Safety | `safety` | `app.js → renderSafetyRegionalContent()` | Yes — all regional content hardcoded in safety objects |
| Board | `leaderboard` | `app.js → loadLeaderboard()` | Minimal — intl flag on swimmer cards |

---

## How Domains Work

### DB-driven (automatic, zero code)

The `domains` table is the source of truth. Every dropdown, spot picker strip, Trends grid, and profile region selector reads from it at runtime.

```
domains table row → appears in:
  ✓ Profile "Home Region" dropdown
  ✓ Spot picker region strip (Temps tab)
  ✓ Trends regional overview cards
  ✓ Hazard report spot dropdown
  ✓ Swim event region filter
  ✓ History/chart spot selector
```

**If it's a South African domain: one INSERT, zero code.**

### Code-driven (requires changes)

International domains (`INTERNATIONAL_DOMAINS` Set in `app.js:6186`) get special treatment:
- Gold border + globe icon on region cards
- Separate "International" pill in spot picker
- "International" filter tab in Trends
- Dynamic hazard types (no shark sighting)
- Swapped emergency contacts in Safety (999/112 instead of NSRI/10177)

**If it's an international domain: INSERT + code changes (see checklist below).**

---

## Adding a New South African Domain

> Example: adding `LIMPOPO` / Limpopo Province

### Step 1 — Database (required)

```sql
INSERT INTO domains (code, display_name, is_coastal, sort_order, active)
VALUES ('LIMPOPO', 'Limpopo', false, 13, true);
```

Pick `sort_order` to control position in all dropdowns. Coastal regions sort before inland.

### Step 2 — Create spots

```sql
INSERT INTO spots (name, code, domain, water_type, latitude, longitude, area, active)
VALUES ('Magoebaskloof Dam', 'MAGOEBASKLOOF_DAM', 'LIMPOPO', 'DAM', -23.9, 29.9, 'TZANEEN', true);
```

### Step 3 — Verify automatically appears in

- [ ] Profile → Home Region dropdown
- [ ] Temps tab → spot picker (shows under its domain group)
- [ ] Trends tab → Inland filter (if water_type is DAM/LAKE/RIVER) or Ocean/Pools filter
- [ ] Hazard report → Location dropdown

### Step 4 — Optional: Safety content

If you want regional content on the Safety tab, add to `app.js`:

```javascript
// In SAFETY_GROUP (~line 5124):
LIMPOPO: 'limpopo',

// In ALERT_TIPS, SHARK_NOTES (null), COLD_NOTES, REGIONAL_CONTACTS, REGIONAL_REPORTING:
// (copy the namibia pattern as a template)
```

Without this, the Safety tab shows a "Select region" prompt — not a crash, just no content.

### Step 5 — Bump app.js version in index.html if you changed JS

```html
<script src="app.js?v=21"></script>  <!-- increment by 1 -->
```

---

## Adding a New International Domain

> Example: adding `AUSTRALIA`

This requires both database and code changes. Do SQL first, then code, then push once.

### Step 1 — Database

```sql
INSERT INTO domains (code, display_name, is_coastal, sort_order, active)
VALUES ('AUSTRALIA', 'Australia', true, 21, true);
```

### Step 2 — app.js: Mark as international (`~line 6186`)

```javascript
const INTERNATIONAL_DOMAINS = new Set(['EUROPE', 'NAMIBIA', 'UK', 'AUSTRALIA']);
```

This one change triggers: intl gold borders on region cards, intl pill in spot picker, inclusion in Trends "International" filter, dynamic hazard types (no sharks unless you add them), and intl emergency contact swap.

### Step 3 — app.js: Safety group (`~line 5124`)

```javascript
AUSTRALIA: 'australia',
```

### Step 4 — app.js: Five safety content objects

Add one entry to each of these (find them in `renderSafetyRegionalContent()`):

```javascript
// ALERT_TIPS
australia: {
    color: '#f59e0b', icon: 'alert-triangle', title: 'Australian Open Water Hazards',
    body: 'Check Surf Life Saving Australia advisories before swimming. Bluebottle jellyfish (Physalia) are common in coastal waters Oct–Apr. Stingers (box jellyfish, Irukandji) present in northern Australia Nov–May.',
},

// SHARK_NOTES — Australia does have sharks, so use a real note not null
australia: `<strong>Australia:</strong> Sharks are present in all Australian waters. Check local Shark Smart / Surf Life Saving alerts before swimming. Shark nets and drum lines in place at most patrolled beaches in NSW/QLD.`,

// COLD_NOTES
australia: `<strong>Australia temps:</strong> Varies greatly — Sydney 17–23°C, Melbourne 13–19°C, Queensland 24–29°C. Cold shock risk is low in most regions but can apply in southern states winter (June–Aug).`,

// REGIONAL_CONTACTS
australia: [
    ['tel:000','phone','Emergency Services','Police · Ambulance · Fire','000'],
    ['tel:132444','anchor','Marine Rescue NSW','Water rescue · Coastal incidents','13 2444'],
],

// REGIONAL_REPORTING
australia: { title: 'Reporting (Australia)', contacts: [
    ['tel:000','phone','Emergency Services','Police · Ambulance · Fire','000'],
    ['https://sls.com.au','anchor','Surf Life Saving Australia','Beach safety · Hazard reports','sls.com.au'],
]},
```

### Step 5 — app.js: isIntlGroup check (`~line 5138`)

**Only add to this if the new domain has no sharks and needs SA contacts swapped out:**

```javascript
const isIntlGroup = group === 'uk' || group === 'europe'; // Australia DOES have sharks — don't add it here
```

For Australia with sharks, leave isIntlGroup as-is. The sharks section will render with the `australia` SHARK_NOTES entry.

### Step 6 — api/seo-utils.js: Four SEO entries

```javascript
// DOMAIN_MAP
AUSTRALIA: { display: 'Australia', region: 'australia' },

// REGION_DOMAINS
'australia': ['AUSTRALIA'],

// REGION_NAMES
'australia': 'Australia',

// REGION_INTROS
'australia': 'Australia offers some of the world\'s most diverse open water swimming — from the warm tropics of Queensland to the cooler surf beaches of Victoria and Western Australia. Check local Surf Life Saving conditions and stinger alerts before swimming.',
```

### Step 7 — Warm water array (optional, `app.js ~line 6975`)

```javascript
const warmDomains = ['KZN', 'GARDEN_ROUTE', 'EASTERN_CAPE', 'AUSTRALIA']; // if warm
```

This raises the temperature colour ceiling for the region's card in the dashboard.

### Step 8 — Bump versions

```html
<script src="app.js?v=21"></script>
<script src="app-trends.js?v=8"></script>  <!-- only if you changed app-trends.js -->
```

### Step 9 — Verify

- [ ] Spot picker → International pill shows Australia spots
- [ ] Trends → International filter shows Australia card
- [ ] Safety → Select Australia: no SA numbers, correct emergency contacts, correct alert tip
- [ ] Hazard modal → Select Australian spot: no shark sighting in dropdown (if you added to isIntlGroup), or shark sighting visible (if sharks are present)
- [ ] SEO → `/spots/australia` returns a page

---

## Adding a New Spot

Spots are fully database-driven. No code changes ever needed.

```sql
INSERT INTO spots (name, code, domain, water_type, latitude, longitude, area, brand, active)
VALUES (
    'Muizenberg Corner',   -- display name
    'MUIZENBERG_CORNER',   -- code: UPPERCASE_UNDERSCORE, unique
    'FALSE_BAY',           -- must match a code in domains table
    'OCEAN',               -- OCEAN | LAGOON | POOL | TIDAL_POOL | DAM | LAKE | RIVER
    -34.1075,              -- latitude (required for GPS spot-matching in Strava)
    18.4712,               -- longitude
    'MUIZENBERG',          -- area: city/suburb code (used for grouping in spot pages)
    null,                  -- brand: for branded spots (lidos, gyms), else null
    true                   -- active: false = hidden everywhere
);
```

**After inserting:** spot appears in all dropdowns, Trends, dashboard, SEO spot page, hazard modal, Strava GPS matching. No deploy needed — it's live immediately.

**Common mistakes:**
- Missing `code` column → spot invisible in Trends (the grid uses code)
- Wrong `domain` code → spot invisible in its region (FK silently fails if no CASCADE)
- Wrong `water_type` → spot appears under wrong Trends filter tab
- Missing `latitude`/`longitude` → Strava GPS matching fails silently

---

## Cross-App Consistency Checklist

Run this when any domain, spot, or major feature changes. Mark each as ✓ or ✗.

### After adding a domain or spot

| Surface | Where to check | Pass condition |
|---------|---------------|----------------|
| Profile | Settings → Home Region | New domain appears in dropdown |
| Spot picker | Temps tab → tap spot | New spot visible under correct region group |
| Spot picker intl | Temps tab → International pill | Intl spots appear when domain in INTERNATIONAL_DOMAINS |
| Trends Ocean | Trends → Ocean | SA ocean spots grouped by region card |
| Trends International | Trends → International | Intl region card shows if recent logs exist |
| Trends Inland | Trends → Inland | DAM/LAKE/RIVER spots appear |
| Safety tab | Safety → Select region | Region shows relevant content (not blank) |
| Safety — sharks | Safety → Marine Life | Shark section hidden for UK/Europe |
| Safety — contacts | Safety → Emergency Contacts | Correct national numbers for region |
| Hazard modal | Safety → Report a Hazard → select intl spot | No shark sighting in dropdown |
| Dashboard | Home | Spots with recent logs show temp cards |
| SEO | `/spots/[region-slug]` | Returns 200 with region content |
| SEO spot | `/spots/[spot-name]` | Individual spot page renders |

### After adding a feature to one tab

Ask: does this feature reference a domain? If yes, check:

1. Does it use `domains` (DB, automatic) or hardcoded strings?
2. If hardcoded: is there an entry for every region including intl ones?
3. Does it need different behaviour for `INTERNATIONAL_DOMAINS`?
4. Is the JS logic in the right file? (Dashboard/core → app.js, Nav/profile → app-nav.js, Trends → app-trends.js, Challenges → app-fuel.js, Strava → app-strava.js)
5. Did you bump the `?v=N` on the changed script in index.html?

---

## The Complete Hardcode Map

Every location where domain codes appear in code (not DB). These are the files to grep when something breaks.

### app.js

| ~Line | Symbol | Add for SA? | Add for Intl? |
|-------|--------|------------|---------------|
| 6186 | `INTERNATIONAL_DOMAINS` Set | No | **Yes** |
| 5124 | `SAFETY_GROUP` object | No | **Yes** |
| 5138 | `isIntlGroup` check | No | Only if no sharks + custom emergency |
| 5147 | intl emergency contact swap | No | Only if non-999/112 number |
| 5190 | `ALERT_TIPS` | No | **Yes** |
| 5233 | `SHARK_NOTES` | No | **Yes** (null if no sharks) |
| 5251 | `COLD_NOTES` | No | **Yes** |
| 5281 | `REGIONAL_CONTACTS` | No | **Yes** |
| 5304 | `REGIONAL_REPORTING` | No | **Yes** |
| 5063 | Safety region picker filter | No | Ensure not excluded |
| 6975 | `warmDomains` array | Optional | Optional |

### api/seo-utils.js

| ~Line | Symbol | Add for SA? | Add for Intl? |
|-------|--------|------------|---------------|
| 44 | `DOMAIN_MAP` | No | **Yes** |
| 77 | `REGION_DOMAINS` | No | **Yes** |
| 91 | `REGION_NAMES` | No | **Yes** |
| 105 | `REGION_INTROS` | No | **Yes** |

### index.html

| Element | What it does | When to update |
|---------|-------------|----------------|
| `app.js?v=N` | Cache bust | Every time app.js changes |
| `app-trends.js?v=N` | Cache bust | Every time app-trends.js changes |
| `app-nav.js?v=N` | Cache bust | Every time app-nav.js changes |
| `app-fuel.js?v=N` | Cache bust | Every time app-fuel.js changes |
| `app-strava.js?v=N` | Cache bust | Every time app-strava.js changes |
| `style.css?v=N` | Cache bust | Every time style.css changes |

**Rule: Always bump the version number. Never skip it. Old JS cached at the edge will break users silently.**

---

## Hazard Types by Region Class

The hazard modal adapts when a spot is selected. This is controlled by `updateHazardTypeOptions()` in app.js.

| Region class | Hazard types shown | Not shown |
|-------------|-------------------|-----------|
| SA / Namibia | Seal Aggression, **Shark Sighting**, Jellyfish/Bluebottle, Sewage, Rip Current, Beach Closure, Other | — |
| International (UK/Europe) | Seal Aggression, Jellyfish bloom, **Blue-Green Algae**, Sewage, Rip Current, Swim Ban/Closure, Other | Shark Sighting |

When adding a new international domain, decide which set applies and either:
- Leave as-is (it inherits intl types once added to `INTERNATIONAL_DOMAINS`)
- Or add a third branch in `updateHazardTypeOptions()` if the region needs custom types (e.g., box jellyfish warning for tropical Australia)

---

## Deployment Rules

These are non-negotiable. Every broken deploy traced back to one of these.

1. **SQL runs before JS.** Never push code that depends on a column/table that doesn't exist yet.
2. **Bump `?v=N` on every changed script.** Vercel edge cache will serve old JS otherwise.
3. **One commit per logical change.** Don't mix domain data migration with UI refactors.
4. **Test the golden path after every push.** Open the live app, log a temp, check the Trends tab. 60 seconds.
5. **International changes need more testing.** Switch Safety region to UK, check: no NSRI number visible, sharks section hidden, 999 shown.

### Deployment order for a new international domain

```
1. Run SQL migration in Supabase (domains INSERT + spots INSERTs)
2. Edit app.js (INTERNATIONAL_DOMAINS + 5 safety objects)
3. Edit api/seo-utils.js (4 entries)
4. Bump app.js version in index.html
5. git add → git commit → git push
6. Vercel auto-deploys (~30s)
7. Hard refresh: Cmd+Shift+R
8. Run consistency checklist above
```

---

## Where Each Tab Gets Its Data

| Tab | Primary query | Cache variable | Staleness |
|-----|-------------|---------------|-----------|
| Home | `latest_spot_temps` view + `temp_logs` | `conditionsCache` | 96h rolling |
| Temps | `spots` table (loaded at startup) | `spots` global | Session |
| Swims | `swim_events` table | `swimEventsCache` | Session |
| Trends | `latest_spot_temps` + `temp_logs` | `trendsData`, `conditionsCache` | Fetched on tab open |
| Safety | `hazard_reports` table | `_activeHazards` | Fetched on tab open |
| Board | `leaderboard` view | — | Fetched on tab open |

**Shared globals (set once at startup):**
- `supabaseClient` — Supabase client
- `currentUser` — logged-in user
- `currentUserProfile` — profile inc. home_domain
- `domains[]` — all domain rows from DB
- `spots[]` — all spot rows from DB
- `conditionsCache` — 96h logs keyed by spot_id
- `swimEventsCache` — upcoming events

If something looks stale, check whether it reads from a cache or re-fetches.

---

## Profile Section — What It Owns

The profile page (app-nav.js) manages:

| Field | DB column | Impacts |
|-------|----------|---------|
| Display name | `users.display_name` | Nav initials, leaderboard |
| Home region | `users.home_domain` | Safety tab default region, dashboard greeting |
| Home beach | `users.home_beach_id` | Dashboard "home spot" temp card |
| Phone | `users.phone` | Safety gate for joining group swims |
| Emergency contact | `users.emergency_contact_*` | Safety gate for joining group swims |
| Avatar | `users.avatar_url` | Nav + profile card |

**Home domain ≠ home beach.** home_domain controls which safety region loads by default. home_beach_id controls which spot shows prominently on the dashboard.

When a user has no `home_domain` set, the Safety tab shows "Select region…" — this is correct and expected. The hazard report modal is always available regardless.

---

## Anti-Patterns to Avoid

**Don't hardcode domain codes in queries.** Use the `domains` array already loaded at startup.

```javascript
// Wrong
if (spot.domain === 'ATLANTIC' || spot.domain === 'FALSE_BAY') { ... }

// Right
const isCoastal = domains.find(d => d.code === spot.domain)?.is_coastal;
```

**Don't add new fields to CLAUDE.md that belong here.** CLAUDE.md is the deployment guide. This file is the expansion/consistency guide.

**Don't add a new regional safety object without testing UK→SA switching.** The `renderSafetyRegionalContent()` function runs every time the user changes region in Safety. It replaces DOM content. A missing `null` check will crash the whole tab.

**Don't use emoji in the app UI.** Lucide icons only. See CLAUDE.md Brand Guidelines.

**Don't skip the version bump.** If you changed `app.js` and didn't bump the `?v=N`, the Vercel edge will serve the old file to users on mobile who haven't cleared cache. This is invisible and hard to debug.

---

*Last updated: May 2026. Maintained by Dave Welensky & Claude.*
