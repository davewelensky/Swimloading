# Club Onboarding Guide

> **This is the single document for onboarding any new SwimLoading club.**
> Follow it top to bottom. Do not improvise steps — every mistake in club history
> came from skipping steps or assuming one club's setup applied to another.

---

## Step 0 — Identify the Club Type First

Every club is one of two types. Pick the type before doing anything else.
The type determines which feature flags to set, which guide page to create, and what the admin experience looks like.

| | Open Water Club | Swim Club |
|---|---|---|
| **`type` value** | `open_water` | `swim_club` |
| **Reference club** | DUC | Aquasharks |
| **Members** | Adults, self-registering | Youth + adult squads, coach-managed |
| **Has league races** | YES | NO |
| **Has temp challenge** | YES | NO |
| **Has challenges tab** | YES | NO |
| **Has squads** | NO | YES |
| **Has parents** | NO | YES |
| **Has attendance** | NO | YES |
| **Has sets planner** | NO | YES |
| **Has gala entries** | NO | YES |
| **Has coaching staff** | NO | YES |
| **Has timetable** | NO | YES |

If the new club does not fit either type cleanly — stop and discuss before proceeding.
**Never mix flags from both types.**

---

## Step 1 — Insert the Club Record

Run this in Supabase SQL editor. Replace all `ALL_CAPS` placeholders.

```sql
INSERT INTO clubs (
  code, slug, name, country, city, founded_year,
  tagline, contact_email, domain, is_active, type
)
VALUES (
  'CLUB_CODE',        -- short uppercase code, e.g. 'DUC', 'AQUA'
  'club-slug',        -- URL slug — no spaces, lowercase, e.g. 'duc', 'aqua-sharks-atlantic'
  'Full Club Name',
  'ZA',               -- ISO country code: ZA, AU, GB, etc.
  'City Name',
  YYYY,               -- founding year (integer) or NULL
  'Short tagline',
  'admin@club.com',   -- club contact email
  'domain-code',      -- SwimLoading domain code (e.g. 'kzn', 'atlantic') or NULL
  true,
  'open_water'        -- or 'swim_club' — from Step 0
)
ON CONFLICT (code) DO NOTHING;
```

Verify it landed and copy the `id`:
```sql
SELECT id, slug, name, type FROM clubs WHERE slug = 'club-slug';
```

---

## Step 2 — Set Feature Flags

Run the correct block for this club's type. **Do NOT mix these two blocks.**

### Open Water Club (DUC-type)
```sql
UPDATE clubs SET features = '{
  "league":          true,
  "temp_challenge":  true,
  "challenges":      true,
  "squads":          false,
  "timetable":       false,
  "attendance":      false,
  "gala_entries":    false,
  "coaching_staff":  false,
  "parent_language": false
}'::jsonb WHERE slug = 'club-slug';
```

### Swim Club (Aquasharks-type)
```sql
UPDATE clubs SET features = '{
  "league":          false,
  "temp_challenge":  false,
  "challenges":      false,
  "squads":          true,
  "timetable":       true,
  "attendance":      true,
  "gala_entries":    true,
  "coaching_staff":  true,
  "parent_language": true
}'::jsonb WHERE slug = 'club-slug';
```

Verify:
```sql
SELECT slug, features FROM clubs WHERE slug = 'club-slug';
```

---

## Step 3 — Create the Club Admin Account

The admin must already have a SwimLoading account. Look up their `user_id` first:
```sql
SELECT id, email FROM auth.users WHERE email = 'admin@club.com';
```

Then insert their club admin record:
```sql
INSERT INTO club_admins (club_id, user_id, role)
VALUES (
  (SELECT id FROM clubs WHERE slug = 'club-slug'),
  'USER_UUID_HERE',
  'admin'   -- 'admin' or 'organiser'
)
ON CONFLICT DO NOTHING;
```

**Without this row the admin cannot log into `/club-admin/club-slug`. This is the most commonly skipped step.**

---

## Step 4 — Import the Roster

The roster is the club's member list. It exists separately from SwimLoading accounts —
members link by clicking a join link.

Go to `/club-admin/club-slug` → **Roster tab** → Import CSV.

CSV format:
```
first_name, last_name, email, date_of_birth, gender, member_type
```

`member_type` values: `youth`, `senior`, `non_competing`, `coach`, `social` (or leave blank)

For **Swim Clubs**: also import squad assignments after the roster is uploaded.

---

## Step 5 — Set Up Squads (Swim Club only — skip for Open Water)

In `/club-admin/club-slug` → **Settings → Squads**:
- Create each squad (name, max members)
- Assign coaches to squads
- Set timetable sessions per squad

These power the Squad Tracker, Sets Planner, and Attendance register.

---

## Step 6 — Create the Club Guide Page

Every club gets a guide page at `/{slug}-guide`. Use the correct template — they are different.

| Club type | Copy from | Save as |
|---|---|---|
| Open Water | `duc-guide.html` | `{slug}-guide.html` |
| Swim Club | `aquasharks-guide.html` | `{slug}-guide.html` |

After copying:
1. Replace all references to the old club name, slug, and contact details
2. Remove any sections that don't apply to this club's flags
3. Do NOT cross-copy content between guide pages — they are club-specific

---

## Step 7 — Send the Join Link

From `/club-admin/club-slug` → **Roster tab** → **Get Join Link**.

Share with members. When they click it and have a SwimLoading account, they are
automatically linked to their roster entry (matched by first name + surname).

---

## Step 8 — Verify the Admin Panel

Open the admin panel as the new club admin and check each tab is correct:

### Open Water Club — what should be visible
- [ ] Overview, Members, Roster, Events, League, Temp Challenge, Challenges, Announcements, Team, Join Link, Settings
- [ ] **NOT visible:** Gala Entries, Attendance, Squad Tracker, Health, Sets Planner, Parents

### Swim Club — what should be visible
- [ ] Overview, Members, Roster, Events, Gala Entries, Attendance, Announcements, Squad Tracker, Health, Sets Planner, Team, Parents, Join Link, Settings
- [ ] **NOT visible:** League, Temp Challenge, Challenges

If you see tabs that should be hidden — check the `features` JSONB in Supabase first.

---

## Feature Flag Reference

All flags live in `clubs.features` JSONB. Loaded at boot into `window._clubFeatures`
via `setClubFeatures()` in `club-admin.html` (~line 2022).

| JSONB key | JS variable | Nav element gated | Open Water | Swim Club |
|---|---|---|---|---|
| `league` | `hasLeague` | `nav-league` | ✅ | ❌ |
| `temp_challenge` | `hasTempChallenge` | `nav-tempchallenge` | ✅ | ❌ |
| `challenges` | `hasChallenges` | `nav-challenges` | ✅ | ❌ |
| `groups` | `hasGroups` | `nav-groups` — goal cohorts, training sessions, RSVP | K8 ✅ | ❌ |
| `health` | `hasHealth` | `nav-health` — injury/illness logging (standalone for OW clubs) | K8 ✅ | auto via squads |
| `squads` | `hasSquads` | `nav-tracker`, `nav-sets` + health auto-on | ❌ | ✅ |
| `timetable` | `hasTimetable` | Settings timetable card | ❌ | ✅ |
| `attendance` | `hasAttendance` | `nav-attendance` | ❌ | ✅ |
| `gala_entries` | `hasGalaEntries` | `nav-entries` | ❌ | ✅ |
| `coaching_staff` | `hasCoachingStaff` | Team coaching card | ❌ | ✅ |
| `parent_language` | `hasParentLanguage` | `nav-parents`, parent matching | ❌ | ✅ |

**Health flag:** `hasHealth = F.health === true || hasSquads` — swim clubs always get health via squads. Open water clubs need `health: true` set explicitly in the features JSONB.

**Never add un-gated code to `club-admin.html`.** The file is shared — un-gated code runs for every club.

---

## Known Issue — Nav Flash on Page Load

**What it is:** Four nav buttons render visible in the HTML before JS hides them:
- `nav-entries` (Gala Entries) — line 513
- `nav-attendance` (Attendance) — line 519
- `nav-tracker` (Squad Tracker) — line 525
- `nav-parents` (Parents) — line 544

They are hidden by `setClubFeatures()` after flags load. This means Open Water clubs (DUC)
briefly see Aquasharks nav tabs on page load before JS runs.

**Safe fix when ready:** Add `style="display:none;"` to those four nav buttons as the HTML default.
This matches how `nav-league`, `nav-health`, `nav-sets`, `nav-tempchallenge`, and `nav-challenges` are already handled.

**Do not fix while clubs are actively using the app without testing both DUC and Aquasharks after the change.**

---

## Current Clubs

| Club | Slug | Type | Admin contact |
|---|---|---|---|
| Durban Underwater Club | `duc` | `open_water` | Steve — `evans.s@mweb.co.za` |
| Aquasharks Atlantic | `aqua-sharks-atlantic` | `swim_club` | Britt — `britt@k8coaching.co.za` (auth login) |
| K8 Coaching | `k8-coaching` | `open_water` | Britt — `britt@k8coaching.co.za` (same auth login, club contact email is k8coaching) |

**Multi-club admin note:** Britt has one SwimLoading auth account (`britt@k8coaching.co.za`) and admin access to both Aquasharks and K8. The club picker in club-admin shows both clubs on login. Dave (`dave.welensky@gmail.com`) has admin access to all three clubs.

---

**Last Updated:** June 2026
