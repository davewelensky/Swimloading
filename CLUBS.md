# SwimLoading — Club Management Feature

> **Status:** In active build (May 2026).
> This is the canonical reference. Update it every time a feature ships or a decision is made.

---

## The Problem We're Solving

Swim clubs currently manage everything via spreadsheets, WhatsApp, and paper:
- **Attendance** — coaches mark a spreadsheet after every session (Britt's May 2026.xlsx)
- **Members** — no central record of trial swimmers, unpaid fees, squad assignments
- **Schedule** — shared via WhatsApp, no single source of truth
- **Results** — galas logged manually, no QT progress tracking
- **Communication** — admins juggling WhatsApp, email, and SMS individually

SwimLoading replaces the spreadsheet with a proper digital system while connecting club admin to the swimmer-facing app.

---

## Club Types We Support

We initially targeted open water only. Aqua Sharks (pool club) proved the model works for any water sport club. Current targets:

- Pool swimming clubs (Aqua Sharks Atlantic — live)
- Open water swimming clubs (DUC — in onboarding)
- Triathlon clubs (swim leg focus)
- Surf lifesaving clubs
- Freediving clubs
- Wild swimming / outdoor swimming societies

**Not targeting:** gym chains, generic multi-sport clubs, land sports.

---

## Build Status — Complete Task List

### ✅ Infrastructure
- [x] `clubs` table — one row per club, slug-based routing
- [x] Multi-club support — /club-admin/:slug, club picker for multi-club admins
- [x] RLS on all club tables — scoped by club_id, SECURITY DEFINER helper functions
- [x] Public club page — swimloading.com/clubs/:slug
- [x] Member join flow — /join/:code (self-serve, admin shares link)
- [x] Club admin auth — club_admins table + club_members role check
- [x] Vercel routing — /clubs/(.*), /club-admin/(.*), /join/(.*)

### ✅ Member Management (Roster)
- [x] Add member — full form: name, squad, DOB, gender, member #, school, SASA #, join date
- [x] Guardian 1 + Guardian 2 — name, relation, mobile, email
- [x] Collection contacts — au-pair, family, etc.
- [x] Medical — allergies, chronic conditions, emergency meds, medical aid
- [x] Consents — indemnity date, photo consent, social media, medical auth
- [x] Billing — fee tier, invoice email, billing notes
- [x] Admin notes per swimmer
- [x] Edit member — squad, category, DOB, gender, phone, trial, fee status
- [x] Trial swimmer flag (`is_trial`) — red TRIAL badge in attendance mark modal
- [x] Fee paid flag (`fee_paid`) — amber UNPAID badge in attendance mark modal
- [x] Trial dates — `trial_start_date`, `trial_end_date` on club_roster
- [x] Fee due date — `fee_due_date` on club_roster
- [x] Link roster entry to SwimLoading user account
- [x] Unlink member from SwimLoading account
- [x] Filter roster by status, category, name search
- [x] Roster table shows trial/unpaid status

### ✅ Squad Management
- [x] Create squads — name, type (Competitive/Development/LTS/Masters), sort order
- [x] Remove squads (soft delete — `is_active = false`)
- [x] Squad types: competitive, development, lts, masters
- [x] Squad picker in Add Member and Edit Member modals
- [x] Squad auto-fills fee tier suggestion when selected
- [x] Masters squad hides guardian section (swimmers are adults)

### ✅ Weekly Timetable
- [x] Add recurring session — squad, day of week, start/end time, coach, max capacity, notes
- [x] Remove recurring session (soft delete)
- [x] Timetable displayed grouped by day (Mon → Sun)
- [x] Drives Today's Schedule banner on dashboard
- [x] `coach_name` and `max_capacity` columns on `club_squad_sessions`
- [x] Bug fix: loadSquads() was filtering club_squad_sessions by club_id (column doesn't exist) — Today's Schedule was always empty. Fixed to filter by squad_id IN (...).

### ✅ Attendance
- [x] 7 status codes matching Britt's spreadsheet:
  - `present` = ✓ (attended)
  - `no_contact` = nc (absent, no message from parent)
  - `notice` = Notice (advance notice given)
  - `no_show` = NS (said coming, didn't show)
  - `away` = Away (holiday)
  - `dnp` = DNP (did not pay)
  - `catch_up` = C/U (make-up session)
- [x] Old status constraint (present/late/absent/excused) dropped from DB
- [x] `is_catch_up` flag + `catch_up_for_date` on club_attendance
- [x] Attendance count: present + catch_up + late = attended
- [x] Trial (red) and Unpaid (amber) badges in mark modal
- [x] Coach can create sessions and mark attendance per swimmer
- [x] Session list shows coach name, attended/total count and %
- [x] Today's Schedule banner shows sessions from timetable
- [x] `coach_name` on `club_sessions` (actual logged sessions)

### ✅ Results & Performance (Pool — Aqua Sharks)
- [x] Gala results — stroke, distance, time, is_pb per swimmer per gala
- [x] PB cache — `club_swimmer_times` for fast QT progress bar rendering
- [x] QT progress bars in member-facing app (app-club.js)
- [x] Age-group QT calculation using DOB from club_member_profile

### ✅ Results & Performance (Open Water — DUC)
- [x] Race results — position, points, year, month per swimmer per event
- [x] Season standings — denormalised, rebuilt from race_results
- [x] League standings visible on public club page

### ✅ Events
- [x] Create event — title, date, time, description, entry cap, cutoff, is_league, public flag
- [x] Member RSVP ("I'm Swimming")
- [x] Day-of entry (guests)
- [x] Pre-entry system with permanent race numbers

### ✅ Communication
- [x] Announcements — coach posts to squad, members read in app

### ✅ Security
- [x] `club_coaches` — admin/organiser only (private: certs, emergency contacts)
- [x] `club_member_profile` — admin full + member reads own DOB/gender only
- [x] `club_squads` — admin full + active member read
- [x] `club_squad_sessions` — admin full + active member read (via squad_id join)
- [x] `club_admins` — admin full + self-read (needed for auth flow)
- [x] SECURITY DEFINER helper functions prevent RLS recursion

---

## 🔧 Next to Build — Prioritised

### Priority 1 — Britt can replace the spreadsheet completely

- [ ] **CSV / bulk import** — upload the May spreadsheet, map columns to roster fields, import all swimmers at once. Single biggest blocker to onboarding Aqua Sharks properly.
- [ ] **Monthly attendance report** — for each squad, show a grid: swimmers × sessions, status codes, attendance %, DNP count. Mirrors what Britt's spreadsheet shows. Export to PDF or CSV.
- [ ] **Trial expiry alerts** — badge on roster when `trial_end_date` is within 7 days. Admin action: convert to full member or remove.
- [ ] **Fee overdue alerts** — badge/filter on roster for `fee_paid = false` + `fee_due_date` past. Admin can bulk-email or WhatsApp.
- [ ] **Roster trial/fee toggles from roster table** — currently only editable in the Edit modal; add inline toggle so Britt can flip without opening modal.

### Priority 2 — Replace WhatsApp for session management

- [ ] **Session cancellation** — admin marks a session as cancelled; all swimmers who have intent get push/email notification.
- [ ] **Swimmer intent** — swimmer taps "I'm coming tomorrow" in the app; coach sees count before session.
- [ ] **Email notifications to parents** — attendance marked → parent gets summary email (especially `no_contact`, `dnp`, `no_show`).
- [ ] **Coach session notes** — free-text notes on a session (what was trained, distances, key focus). Visible to squad members.
- [ ] **Session template** — save a session's structure as a template, reuse next week.

### Priority 3 — Performance and progress tracking

- [ ] **Swimmer progress dashboard** — attendance % (last 30 days), PB count, QT progress in one view per swimmer.
- [ ] **Attendance trend chart** — per swimmer, show attendance rate over time. Useful for tracking disengaging members.
- [ ] **Squad comparison** — which squad has the best attendance rate this month?
- [ ] **Birthday reminders** — weekly email to admin: "3 swimmers have birthdays this week: …"
- [ ] **QT deadline tracker** — for Aqua Sharks: show days until QT qualifying closes, who has and hasn't hit it.

### Priority 4 — Comms and engagement

- [ ] **Direct message to parent** — admin clicks swimmer → compose message → sends via email (or WhatsApp link).
- [ ] **Bulk announcement** — send to all members of a squad or entire club (currently posts to in-app feed only).
- [ ] **WhatsApp deep link** — "Message parent" opens WhatsApp with pre-filled text.
- [ ] **Push notifications** — session added, cancelled, or changed; attendance marked with problematic code.

### Priority 5 — Club growth and sales

- [ ] **Gala entry management** — admin posts upcoming galas, swimmers submit entries (events, categories), admin exports entry sheet.
- [ ] **Waitlist for squads** — squad is full → swimmer goes on waitlist, gets notified when spot opens.
- [ ] **Public results page** — public-facing page for gala/meet results per club.
- [ ] **DUC onboarding** — wire Steve Evans as admin, generate first join link, share with club.

---

## What Competitors Do That We Don't (Yet)

| Feature | TeamUnify | SwimCloud | Spond | Us |
|---------|-----------|-----------|-------|----|
| Roster management | ✅ | ✅ | ✅ | ✅ |
| Squad/group management | ✅ | ✅ | ✅ | ✅ |
| Attendance tracking | ✅ | ✅ | ✅ | ✅ |
| 7-code attendance (match coach workflow) | ❌ | ❌ | ❌ | ✅ |
| Timetable builder | ✅ | ✅ | ✅ | ✅ |
| Medical/guardian records | ✅ | ❌ | ❌ | ✅ |
| QT progress bars | ❌ | ✅ | ❌ | ✅ |
| Real water conditions | ❌ | ❌ | ❌ | ✅ |
| CSV import | ✅ | ✅ | ✅ | ❌ need |
| Attendance reports/export | ✅ | ✅ | ✅ | ❌ need |
| Email notifications to parents | ✅ | ✅ | ✅ | ❌ need |
| Direct messaging | ✅ | ✅ | ✅ | ❌ need |
| Gala entry management | ✅ | ✅ | ❌ | ❌ need |
| Mobile-first coach UI | ❌ | ❌ | ✅ | partial |
| Trial swimmer tracking | ❌ | ❌ | ❌ | ✅ |
| Fee overdue tracking | ✅ | ❌ | ❌ | ✅ |
| Self-serve join flow | ❌ | ❌ | ✅ | ✅ |
| Public club page | ❌ | ✅ | ❌ | ✅ |

**Our edge:** water conditions, QT progress, trial/fee tracking, 7-code attendance matching real coach workflows, self-serve onboarding.
**Their edge:** CSV import, reporting, email comms, gala entries.

---

## Data Model (Supabase)

### Core tables (both club types)

| Table | Key columns added | RLS |
|-------|------------------|-----|
| `clubs` | slug, name, code, city, home_spot_id | public read |
| `club_categories` | age divisions per club | public read |
| `club_members` | member_number, category_id, role, is_active | member read own club |
| `club_admins` | club_id, user_id, role, committee_title | admin full + self-read |
| `club_coaches` | name, title, certs, first_aid, emergency_contact | admin only |
| `club_join_links` | code, expires_at, max_uses, use_count | public read, admin write |
| `club_roster` | display_name, squad_id, **is_trial**, **fee_paid**, **trial_start/end_date**, **fee_due_date** | admin full |
| `club_member_profile` | DOB, gender, guardian 1+2, collection contacts, medical, consents, billing | admin full + member reads own DOB/gender |
| `club_squads` | name, type, sort_order, is_active | admin full + member read |
| `club_squad_sessions` | squad_id, day_of_week, start_time, end_time, **coach_name**, **max_capacity**, is_active | admin full + member read |
| `club_sessions` | squad_id, session_date, **coach_name**, notes | admin |
| `club_attendance` | session_id, roster_id, status (7 codes), **is_catch_up**, **catch_up_for_date** | admin |
| `club_session_attendance` | swimmer intent ("I'm coming") — rename to `club_attendance_intents` in next migration | member write own |
| `club_announcements` | coach posts to squad | member read, admin write |
| `club_events` | title, date, is_league, is_public, entry_cap | member read, admin write |
| `club_race_entries` | member/guest, race_number, entry_type, arrived | member read own, admin all |

**Bold** = added in May 2026 migrations.

### Pool club tables (Aqua Sharks)

| Table | Purpose |
|-------|---------|
| `club_gala_results` | Per-swimmer gala results — stroke, distance, time, is_pb |
| `club_swimmer_times` | PB cache per event — feeds QT progress bars |

### Open water league tables (DUC)

| Table | Purpose |
|-------|---------|
| `club_race_results` | League results — position, points, year, month_col |
| `club_season_standings` | Denormalised standings built from race_results |

### Dropped

| Table | Reason |
|-------|--------|
| ~~`club_league_results`~~ | Original design. Superseded by `club_race_results` + `club_season_standings`. Dropped May 2026. |

### Naming note

- `club_session_attendance` = swimmer **intent** ("I'm coming tomorrow") — rename to `club_attendance_intents` in a future migration
- `club_attendance` = **coach mark** ("she showed up, marked nc") — correctly named

### Migrations applied

| File | What it does |
|------|-------------|
| `sql/applied/create_clubs_schema.sql` | Full schema foundation |
| `sql/applied/add_attendance_upgrade.sql` | 7 status codes, coach_name on sessions, is_trial/fee_paid/dates on roster, is_catch_up on attendance |
| `sql/applied/fix_club_rls_and_schema.sql` | RLS policies on 5 tables, SECURITY DEFINER helpers, drop club_league_results |

---

## Key Decisions

1. **No payment processing.** We surface billing triggers (fee due dates) but never handle money. Payment is external (EFT, SnapScan).

2. **Temp logs stay universal.** Club members' logs appear in the main SwimLoading Trends view. Public club page filters by member user_ids.

3. **Join flow is self-serve.** Admin generates a link, drops in WhatsApp, members join themselves.

4. **Category assigned by DOB.** Age calculated from profile DOB, matched to club_categories min_age/max_age. Default to middle category if no DOB.

5. **Race numbers are permanent.** Member #14 is always Steve's number. Day-of guests get D01, D02 per event (not permanent).

6. **Multi-club support.** /club-admin picks club by slug. Admin of multiple clubs sees a picker. URL updates to /club-admin/:slug.

7. **Soft deletes on squads and timetable sessions.** `is_active = false` rather than hard delete — preserves historical attendance data.

8. **club_squad_sessions has no club_id.** It links via squad_id → club_squads. All queries and RLS policies must join through club_squads to get club_id.

---

## Pricing

| Region | Monthly | Annual |
|--------|---------|--------|
| South Africa | R799/mo | R599/mo |
| United Kingdom | £49/mo | £39/mo |
| Australia | A$79/mo | A$59/mo |

- 30-day free trial, cancel anytime
- No per-head billing regardless of club size

---

## Race Day Reality (Open Water) — What We Own and What We Don't

NSRI owns in-water safety. SwimLoading is admin-only.

> "Admin has a start list. They can see who registered and who checked in at the table. That's it. NSRI and race officials own the water."

**Never build or claim:** real-time swimmer tracking, GPS in-water tracking, anything NSRI would rely on.

---

## Files

| File | Route | Notes |
|------|-------|-------|
| `clubs.html` | /clubs/:slug | Public club page |
| `club-admin.html` | /club-admin/:slug | Admin dashboard (13 tabs) |
| `app-club.js` | — | Member-facing club tab (QT bars, results, announcements) |
| `join.html` | /join/:code | Self-serve member join flow |
| `blog/duc-demo.html` | (direct link) | DUC sales demo — static data |
| `sql/applied/` | — | All applied migrations |

---

## Club Setup

### Aqua Sharks Atlantic (live)
- Pool club, Cape Town
- Britt runs day-to-day admin
- Squads: Bronze, Silver, Gold, Juniors, Seniors (+ LTS/Masters)
- Timetable: daily squad sessions
- Attendance via Britt's spreadsheet → replacing with club-admin

### DUC — Durban Underwater Club (in onboarding)
| Field | Value |
|-------|-------|
| Club ID | f72cf810-0019-40f8-a57f-476bea8a8f55 |
| Home spot | Vetch's Beach |
| First admin | Steve Evans — evans.s@mweb.co.za |
| Events seeded | League Race 5 (31 May), Race 6 (28 Jun), Race 7 (26 Jul) |

---

## What to Never Build

- Real-time swimmer tracking in water
- GPS tracking of any kind
- Anything claiming to know where a swimmer is after entering the water
- Payment processing (Stripe, PayFast, etc.)
- Any safety system NSRI or race officials would rely on

---

**Last Updated:** 12 May 2026
**Maintained by:** Dave Welensky and Claude
