# SwimLoading — Club Management: Architecture, Rules & Roadmap

> **This document is the contract.** Every club feature decision, every data change, every UI gate lives here.
> Update it every time something ships or a decision is made.
> When in doubt — read this first. Do not proceed from memory or assumption.

---

## How We Work — Non-Negotiable Rules

### Data Safety
1. **Never DELETE or UPDATE production data without explicit user confirmation** — state exactly what will be deleted, wait for "yes, do it."
2. **Never assume a DB record is wrong or duplicate** — query first, show the user, ask before acting.
3. **Always check FK constraints before any delete** — a failed delete is safer than a successful one that shouldn't have happened.
4. **Never bulk-delete based on a mismatch assumption** — e.g. "these look like wrong-club data" is not grounds to delete. Verify with the user.
5. **Before any SQL that modifies data** — show the exact query and the rows it will affect. Wait for approval.

### Code Safety
1. **Never add features for Club A that touch Club B's rendering** — every change to `club-admin.html` is club-type-aware by design.
2. **Always check `currentClub.club_type` before rendering** — the gate is `isSquadClub` / `isOpenWater`. Use it everywhere.
3. **No feature is "for all clubs" by default** — every UI section must be explicitly assigned to a club type or marked universal.
4. **Before touching `club-admin.html`** — read the section being changed, confirm brace balance after edits, test both club types mentally.
5. **Never leave orphaned code** — if a function is replaced, remove the old one in the same commit. Floating code causes SyntaxErrors.

### Process
1. **Always audit before fixing** — when something is broken, identify root cause before writing a single line of code.
2. **State what you're going to change** — before editing, say what file, what lines, what the change is.
3. **One problem at a time** — list each change before making it.
4. **If you don't know who a record belongs to — ask.** Do not delete unknown records.
5. **Moving forward only** — every session ends with all clubs in a better state than it started.

---

## Club Types

We support two club types, served by a single `club-admin.html` differentiated by `currentClub.club_type`.

### `swim_club` — Pool/squad swimming club
**Example:** Aqua Sharks Atlantic
Members are children/teens. Parents are the primary contact. Squads are training groups with assigned coaches. Sessions run on a weekly timetable. Attendance is marked per session by the coach.

### `open_water` — Open water / underwater / freediving club
**Example:** Durban Underwater Club (DUC)
Members are adults. No parent/guardian concept. No squads or weekly timetable. Events are races (league rounds). Temp logging is a core feature. Committee structure, not coaching staff.

---

## UI Gate — What Each Club Type Sees

The gate lives in `loadClubContext()` and `renderOverview()` in `club-admin.html`.

```javascript
const isOpenWater = currentClub.club_type === 'open_water';
const isSquadClub = currentClub?.club_type !== 'open_water';
```

### Navigation

| Nav Item | swim_club | open_water | Element ID |
|----------|-----------|------------|------------|
| Overview | ✅ | ✅ | Universal |
| Members | ✅ | ✅ | Universal |
| Roster | ✅ | ✅ | Universal |
| Events | ✅ | ✅ | Universal |
| Gala Entries | ✅ | ❌ | `nav-entries` |
| League | ❌ | ✅ | `nav-league` |
| Attendance | ✅ | ❌ | `nav-attendance` |
| Squad Tracker | ✅ | ❌ | `nav-tracker` |
| Temp Challenge | ❌ | ✅ | `nav-tempchallenge` |
| Announcements | ✅ | ✅ | Universal |
| Team | ✅ | ✅ | Universal |
| Join Link | ✅ | ✅ | Universal |
| Settings | ✅ | ✅ | Universal |

### Overview sections

| Section | swim_club | open_water | Notes |
|---------|-----------|------------|-------|
| Stat cards: Members, Trials, Fees | ✅ | ✅ | Universal |
| Stat card: Sessions | ✅ | ❌ | `statSessions` |
| Needs Attention | ✅ | ✅ | Different language |
| Unlinked members text | "Parents haven't joined" | "Members haven't joined" | `isSquadClub` ternary |
| Squad KPI dashboard (Today's Fill, Coach Cover, week bar chart) | ✅ | ❌ | `renderDayDashboard()` gated |
| Attendance Pulse (last 30 days) | ✅ | ❌ | gated |
| Upcoming Events | ✅ | ✅ | Universal |
| Pipeline title | "Parent & Member Pipeline" | "Member Onboarding" | |
| Pipeline rows | linked/stillToJoin/trials/trialsReady/notInSquad | onSwimLoading/stillToJoin/activeTrials | |

### Settings sections

| Section | swim_club | open_water | Element ID |
|---------|-----------|------------|------------|
| Club info | ✅ | ✅ | Universal |
| Squads | ✅ | ❌ | `settings-squads-card` |
| Weekly Timetable | ✅ | ❌ | `settings-timetable-card` |

### Team sections

| Section | swim_club | open_water | Element ID |
|---------|-----------|------------|------------|
| Committee & Admins | ✅ | ✅ | Universal |
| Coaching Staff | ✅ | ❌ | `team-coaching-card` |

---

## Live Clubs

### Aqua Sharks Atlantic (`swim_club`)

| Field | Value |
|-------|-------|
| Slug | `aqua-sharks-atlantic` |
| Admin | Britt |
| Roster | 209 members |
| Squads | 7 |
| Events | 22 |
| Founded in app | May 2026 |

**Primary use case being replaced:** Britt's Excel spreadsheet (May 2026.xlsx)
**Status:** Active — attendance workflow in use. CSV import and monthly report still needed.

---

### Durban Underwater Club — DUC (`open_water`)

| Field | Value |
|-------|-------|
| Slug | `duc` |
| Club ID | `f72cf810-0019-40f8-a57f-476bea8a8f55` |
| Primary admin | Steve Evans — evans.s@mweb.co.za |
| App support admin | Dave Welensky — dave.welensky@gmail.com |
| Roster rows | 637 (bulk imported 8 May 2026) |
| Public member count | **550** (set in Settings — this is the displayed figure) |
| Categories | 5: Makos, Sailfish, Walrus, Guppies, Coelacanths |
| Events | 4 (League Race 5–7 + one more) |
| Season standings | 833 rows (historical league data) |
| Race results | 0 (races upcoming) |
| Founded | 1954 |
| Home spot | Vetch's Beach, Durban |

**637 vs 550:** The 637 roster rows include historical/inactive members from the bulk import. 550 is the active member count shown publicly. This is correct — no cleanup needed unless DUC requests it.

**Members with SwimLoading accounts:**

| Name | Email | Role | Temp logs (total) |
|------|-------|------|-------------------|
| Steve Evans | evans.s@mweb.co.za | Admin | 33 (8 May, 20 Apr, 5 Mar) |
| Dave Welensky | dave.welensky@gmail.com | Admin (App Support) | 10 (May) |
| Trevor Lauf | trevorlauf@gmail.com | Member | 12 |
| Andrew Taylor | andrewtaylor00099@gmail.com | Member | 10 |
| Jenny Sutton | jennyandmikesutton@yahoo.com | Member | 2 |
| Ryan Nortje | ryan.nortje@gmail.com | Member | 1 |

**Known open data issue:**
- `steven@secmansol.co.za` — ghost `club_members` record deleted 12 May 2026. Was not in `club_admins`. Identity unknown. If this person needs access, they rejoin via the join link.

---

## What Broke 12 May 2026 — Root Causes

Documented so it never happens again.

### 1. Orphaned code → SyntaxError → blank screen for both clubs
A new `renderDayDashboard()` KPI function was inserted but the old speedometer function body (145 lines) was left floating outside any function. The stray `}` at the end broke JavaScript parsing. Both clubs showed blank screens.

**Fix:** Deleted orphaned block (lines 2412–2555 of original file).
**Rule:** When replacing a function, delete the old one in the same edit. Verify brace balance.

### 2. No club type gate in `renderOverview()` → DUC showed squad UI
Squad KPI dashboard, attendance pulse, squad action items, "Parents haven't joined" text — all rendered unconditionally. DUC (open water, adults, no squads) showed all of it.

**Fix:** Added `isSquadClub` gate to every squad-specific section.
**Rule:** Every new section in `renderOverview()` must be assigned to a club type in the UI Gate table before it ships.

### 3. Attempted data deletion based on assumption
Tried to DELETE DUC roster records assuming they were contaminated Aqua Sharks data. They were 637 real DUC members imported 8 May. Blocked by FK constraint — no data lost.

**Rule:** Never delete without showing affected rows and getting explicit "yes, do it" from the user.

### 4. Settings and Team not gated by club type
Squads, Weekly Timetable, and Coaching Staff showed for DUC.

**Fix:** Added element IDs to the three cards, hid them for `open_water` in `loadClubContext()`.
**Rule:** UI Gate table above is the complete reference. New sections must be added to it.

### 5. Deleted unknown `club_members` record without identification
`steven@secmansol.co.za` was deleted from `club_members` without knowing who the person was. Was not in `club_admins` and had no roster link or profile name, but identity was never confirmed.

**Rule:** If you don't know who a record belongs to — ask. Do not delete unknown records.

---

## Database — Club Tables Reference

### Core (both types)

| Table | Notes |
|-------|-------|
| `clubs` | slug, name, club_type, city, member_count |
| `club_admins` | club_id, user_id, role, committee_title |
| `club_members` | club_id, user_id, member_number (TEXT, no # prefix), role, category_id, is_active |
| `club_roster` | club_id, display_name, member_number, user_id, squad_id, is_trial, fee_paid, trial/fee dates |
| `club_categories` | club_id, name, min_age, max_age, sort_order |
| `club_join_links` | club_id, code, expires_at, max_uses |
| `club_events` | club_id, title, event_date, is_league, is_public |
| `club_announcements` | club_id |
| `club_member_profile` | Guardian, medical, consents, billing per member |

### swim_club only

| Table | Purpose |
|-------|---------|
| `club_squads` | Training groups |
| `club_squad_sessions` | Weekly timetable — **NO `club_id` column**, filter via `squad_id IN (...)` |
| `club_sessions` | Actual logged sessions |
| `club_attendance` | Per-session marks (7 status codes) |
| `club_session_assignments` | Roster member → session |
| `club_coaches` | Coaching staff — admin only |
| `club_gala_entries` | Gala entries per swimmer |
| `club_gala_results` | Gala results per swimmer |
| `club_swimmer_times` | PB cache per event |

### open_water only

| Table | Purpose |
|-------|---------|
| `club_race_results` | League race results (has `club_id` directly) |
| `club_season_standings` | Denormalised standings (has `club_id` directly) |
| `club_race_entries` | Race pre-entries via `club_event_id` |

### Critical schema facts
- `club_squad_sessions` has **no `club_id`** — always join via `club_squads`
- `club_members.member_number` is TEXT — never store with a `#` prefix
- `club_race_results` and `club_season_standings` both have `club_id` — safe to filter directly

---

## Dashboard Rebuild — Aqua Sharks (Priority for 13 May 2026)

Research complete. Sources: TeamUnify, SwimClub Manager (UK), Spond, Commit Swimming, GymDesk, iClassPro.

### Why the current dashboard is weak
- KPI tiles (Today's Fill %, Coach Cover) show numbers with no context or action attached
- Week bar chart is decorative — coach cannot act on it
- No hierarchy — "most important thing right now" is not clear
- Not mobile-optimised for poolside use
- Vanity metrics: numbers that never change what you do

### The pool deck test
The Aqua Sharks coach must be able to open the dashboard on a phone while standing at the pool and get the answer to "who is coming and what do I need to know?" in under 30 seconds. Large tap targets, no scrolling past the fold, trials and headcount immediately visible.

**Every metric needs a threshold and an action.** "Fill: 67%" is useless. "Fill: 67% — 6 spots open" with a share button is useful.

### Dashboard structure — Aqua Sharks (swim_club)

**Strip 1 — Today's Sessions** *(always at the top)*
- One card per session today: squad, time, coach assigned, `enrolled / capacity` fill bar
- Colour: green (space), amber (≥80% full), red (full/over)
- "Mark attendance" button on each card — no navigation required
- If no sessions today → show next scheduled session date
- Trial swimmers in today's session flagged with TRIAL badge

**Strip 2 — Needs Attention** *(each item has one direct action button)*
- 🔴 Trials expiring within 7 days → "Review trials"
- 🔴 Fees overdue (fee_paid = false + fee_due_date past) → "View unpaid"
- 🟠 Swimmers not attended in 14+ days → "View roster"
- 🟡 Trial swimmers at 3+ sessions with no membership decision → "Convert or remove"
- 🟡 Sessions this week without a coach assigned → "Assign coach"
- 🟡 Members not yet on SwimLoading → "Share join link"
- If no alerts exist → section is hidden entirely

**Strip 3 — Squad Health** *(weekly glance)*
- One card per squad: attendance % last 30 days + trend vs previous 30 (▲▼, not a chart)
- Number of active trials in that squad
- Tap → Squad Tracker filtered to that squad

**Strip 4 — This Week**
- Mon–Sun mini grid: sessions per day with fill %
- Attendance rate this week vs last week — one number with direction

### What to remove from current dashboard
- Week bar chart (decorative)
- Standalone KPI tiles (Today's Fill %, Coach Cover as numbers with no context)
- Attendance Pulse as a separate widget → fold into Squad Health cards
- Anything that requires mental arithmetic

### Dashboard structure — DUC (open_water)

**Strip 1 — Upcoming Events**
- Next 3 events: name, date, days until entry closes, entries confirmed
- Alert if entry deadline within 7 days

**Strip 2 — Needs Attention**
- Members not yet on SwimLoading → "Share join link"
- Members with no activity in 30 days

**Strip 3 — Temp Logging Leaderboard**
- Top 5 loggers this month: name, log count, points
- Community/gamification — this IS the DUC dashboard's primary engagement metric

**Strip 4 — Upcoming Events full list** *(keep existing)*

### Visual principles (both club types)
- Amber/red draws attention to problems — green ticks are background noise
- Every alert has one direct action button, linking to the exact fix
- Mobile first — large tap targets, minimal scroll
- No decorative charts — visuals only when they answer a specific question
- Progress indicators beat raw numbers: "78% ▼ from 84% last month" beats "78%"

---

## Pricing

| Region | Monthly | Annual |
|--------|---------|--------|
| South Africa | R799/mo | R599/mo |
| United Kingdom | £49/mo | £39/mo |
| Australia | A$79/mo | A$59/mo |

- 30-day free trial, no credit card required
- No per-head fee regardless of club size
- Fully self-serve onboarding

---

## Files

| File | Route | Purpose |
|------|-------|---------|
| `club-admin.html` | /club-admin/:slug | Admin dashboard — all tabs, both club types |
| `clubs.html` | /clubs/:slug | Public club page |
| `app-club.js` | — | Member-facing club tab |
| `join.html` | /join/:code | Self-serve join flow |
| `blog/duc-demo.html` | direct link | DUC sales demo |
| `sql/applied/` | — | All applied migrations |

---

## What We Never Build

- Real-time in-water swimmer tracking
- GPS tracking of any kind
- Safety systems NSRI or race officials would rely on
- Payment processing
- Anything claiming to know where a swimmer is after entering water

---

*Last updated: 12 May 2026 — Dave Welensky & Claude*
