# SwimLoading — Club Management Feature

> **Status:** In active build (May 2026). Some features live, others in progress.
> This document is the canonical reference for the clubs feature. Update it as decisions are made or scope changes.

---

## The Problem We're Solving

Open water swim clubs (like DUC — Durban Underwater Club, founded 1954, ~100 active members) currently manage everything via:

- WhatsApp (race number requests to Steve, conditions questions)
- Manual spreadsheets for league standings
- MyClubAccount or paper for race entries
- Shouting names on the beach for roll call

SwimLoading already has: real water conditions, swim events, a leaderboard, and hazard alerts. The club tier layers admin tools and club identity on top of that existing foundation.

---

## What the Club Tier Delivers

### Live Now

1. **Conditions feed** — home water temp and conditions, logged by members, visible to all
2. **Swim events** — admin posts upcoming swims, members tap "I'm Swimming", attendance tracked
3. **Club leaderboard** — monthly points by swims logged
4. **Hazard alerts** — members report hazards, push alert goes to whole club
5. **Public club page** — swimloading.com/clubs/duc — real conditions, upcoming events, league standings, join link

### In Active Build

6. **Club admin dashboard** — /club-admin/duc — manage members, categories, events, entries, league results
7. **Member join flow** — /join/:code — admin shares link, member joins, gets permanent race number
8. **League management** — admin enters results after each race, points auto-calculated, standings update
9. **Pre-entry system** — members enter through app for upcoming events, permanent race number assigned instantly
10. **Day-of entry** — guests add themselves at a table (name, DOB, sign digital indemnity, get day-of number like D01, D02)
11. **Printable/CSV start list** — export the full entry list for timekeepers

---

## Race Day Reality — What We Own and What We Don't

### A real DUC race start:

- Swimmers and families mill around the clubhouse (~150m from water)
- Swimmers walk to the start individually — no orderly queue
- Wave starts for different distances (not everyone goes at once)
- All finish at the same spot, then chat, shower, and return to bags at their own pace
- 200 people in and out over 2–3 hours

### What we can honestly say:

- Admin has a pre-entry list on their phone at the registration table
- Admin can mark who showed up at registration (not at the water's edge)
- No-shows are visible before the gun — admin sees who registered but hasn't checked in at the table
- The start list is ready to print — no manual compilation
- Day-of guests get a number and sign a digital indemnity without paper

### What we cannot say (and must never claim):

- "Know who's in the water in real time" — impossible in an open start
- "Know who's out safe" — there is no single exit point; swimmers meander back
- Any form of real-time water safety tracking
- Anything NSRI would rely on for rescue decisions
- "Replace beach roll call" — we replace the registration admin, not the actual headcount at the water's edge

### NSRI alignment

NSRI owns in-water safety. SwimLoading is admin-only. The honest framing:

> "Admin has a start list. They can see who registered and who checked in at the table. That's it. NSRI and race officials own the water."

Never build past this boundary. Never market past this boundary.

---

## Data Model (Supabase)

### Core tables (both clubs)

| Table | Purpose | RLS |
|-------|---------|-----|
| `clubs` | One row per club — code, slug, name, country, city, home_spot_id, domain | public read |
| `club_categories` | Age divisions per club | public read |
| `club_members` | User linked to club — member_number, category_id, role (member/organiser/admin) | member read own club |
| `club_admins` | Non-swimming staff (committee, officials) — separate from club_members | admin full + self-read |
| `club_coaches` | Coach records — certs, first aid, emergency contact | admin only |
| `club_join_links` | Invite links — code, expires_at, max_uses, use_count | public read, admin write |
| `club_roster` | Master swimmer list — may or may not link to a SwimLoading user | public read (join flow) |
| `club_member_profile` | Extended profile — DOB, guardian, **medical info**, consents | admin full + member reads own DOB/gender |
| `club_events` | Upcoming races/sessions | member read, admin write |
| `club_race_entries` | Who entered — member or guest, race_number, entry_type, arrived | member read own, admin all |
| `club_squads` | Squad definitions (Bronze/Silver/Gold/Juniors/Seniors) | admin full + member read |
| `club_squad_sessions` | Recurring weekly timetable — coach, days, times | admin full + member read |
| `club_sessions` | Actual logged training sessions | admin |
| `club_attendance` | Coach-marked attendance per session (7 status codes) | admin |
| `club_session_attendance` | Swimmer self-reported intent for a session ("I'm coming") | member write own |
| `club_announcements` | Coach posts to squad | member read, admin write |

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
| ~~`club_league_results`~~ | Original league design (event-linked). Superseded by `club_race_results` + `club_season_standings`. Zero JS references. Dropped May 2026. |

### Key decisions on naming

- `club_session_attendance` = swimmer **intent** ("I'm coming tomorrow") — confusingly named, rename to `club_attendance_intents` in a future migration
- `club_attendance` = **coach mark** ("she showed up, marked as nc") — correctly named

Migrations: `sql/applied/create_clubs_schema.sql` (foundation) · `add_attendance_upgrade.sql` (7 codes + trial/fee) · `fix_club_rls_and_schema.sql` (RLS + drop dead table)

---

## Key Decisions

1. **No payment fields anywhere.** Payment is external (EFT, SnapScan, etc.). We surface billing triggers (fee due dates, birthdays) but never process money.

2. **Temp logs stay universal.** Club members' logs appear in the main SwimLoading Trends view, not siloed to the club. The public club page filters by member user_ids.

3. **Join flow is self-serve.** Admin generates a link, drops it in WhatsApp, members join themselves. No manual admin per member.

4. **Category assigned by DOB.** On joining, age is calculated from profile DOB and matched to club_categories min_age/max_age. If no DOB is on file, default to the middle category.

5. **Race numbers are permanent.** Once assigned to a member, #14 is always Steve's number across all events. Day-of guests get D01, D02, etc. per event — not permanent.

6. **Multi-club support.** /club-admin picks the club by slug. An admin of multiple clubs sees a club picker. The URL updates to /club-admin/:slug.

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

## Club Types We Target

Open water only — clubs where water conditions matter:

- Open water swimming clubs (DUC, COSC, etc.)
- Triathlon clubs (swim leg focus)
- Surf lifesaving clubs
- Freediving clubs
- Wild swimming and outdoor swimming societies
- Paddle/kayak clubs (adjacent)

**Not targeting:** pool clubs, gym chains, generic multi-sport clubs.

---

## Files

| File | Route | Notes |
|------|-------|-------|
| `clubs.html` | /clubs/:slug | Public club page — live data from Supabase, demo data as fallback |
| `club-admin.html` | /club-admin/:slug | Admin dashboard |
| `join.html` | /join/:code | Member join flow |
| `blog/duc-demo.html` | (direct link) | Sales demo for DUC — static + demo data, not wired to live DB |
| `sql/applied/create_clubs_schema.sql` | — | Full schema migration (applied) |
| `vercel.json` | — | Routes: /clubs/(.*), /club-admin/(.*), /join/(.*) |

---

## DUC Setup

| Field | Value |
|-------|-------|
| Club ID | f72cf810-0019-40f8-a57f-476bea8a8f55 |
| Home spot | DUC (Vetch's Beach) |
| Home spot ID | 8e788976-b0de-49d7-81ef-62f6f4335054 |
| First admin target | Steve Evans — evans.s@mweb.co.za (not yet onboarded) |

**Categories:**

| Name | Ages |
|------|------|
| Guppies | Under 18 |
| Sailfish | 18–29 |
| Makos | 30–39 |
| Walrus | 40–49 |
| Coelacanths | 50+ |

**Seeded events:**

- League Race 5 — 31 May 2026
- League Race 6 — 28 Jun 2026
- League Race 7 — 26 Jul 2026

---

## What to Build Next

1. Wire Steve Evans as DUC admin once he has a SwimLoading account
2. Generate first join link for DUC, share with Steve for WhatsApp blast
3. Build result entry UI in club-admin (admin enters post-race points per category)
4. CSV export of pre-entry list for timekeepers
5. Birthday and fee-due reminders (email to admin)

---

## What to Never Build

- Real-time swimmer tracking in water
- GPS tracking of any kind
- Anything claiming to know where a swimmer is after they enter the water
- Payment processing (Stripe, PayFast, etc.) — always external
- Any safety system that NSRI or race officials would be expected to rely on

---

**Last Updated:** 4 May 2026
**Maintained by:** Dave Welensky and Claude
