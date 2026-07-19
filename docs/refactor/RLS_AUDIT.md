# RLS Audit — Tables With Personal/Operational Data

Metadata-only audit (policy definitions, column names, RLS status) — no
records were dumped. Severity is my assessment.

## 🔴 CRITICAL — confirmed unrestricted public SELECT

| Table | RLS enabled | Anon SELECT | Sensitive fields present | Unsafe policy | Severity |
|---|---|---|---|---|---|
| `profiles` | Yes | **Yes — confirmed live** (see `INCIDENT_PROFILES_PUBLIC_READ.md`) | `phone`, `date_of_birth`, `address_line1/2`, `city`, `postal_code`, `emergency_contact_name/phone`, `email`, `full_name` | `"Public profiles are viewable by everyone"` — `USING (true)` | **CRITICAL** — 645 users, subject of this task |
| `club_roster` | Yes | **Yes — policy confirmed, not live-tested (see note below)** | `phone`, `date_of_birth`, `gender`, `display_name`, fee/trial status | `"Public can read club_roster"` — `USING (true)` | **CRITICAL — same class of issue, includes youth/minor squad members (Aquasharks has youth squads per CLAUDE.md)** |

**Why `club_roster` wasn't live-tested against the anon key the way `profiles`
was:** discovering it came from the Step 6 sweep, after the anon-role
verification budget for this task ("minimum possible requests," no personal
data retention) was already spent confirming `profiles`. The policy
definition (`USING (true)`, no auth check, same shape as the confirmed
`profiles` issue) is conclusive enough on its own — a `USING (true)` SELECT
policy with RLS enabled and `anon` holding table-level SELECT grant behaves
identically regardless of which table it's on. Treating this as confirmed
without a redundant live call, consistent with "minimum possible requests."

**This table is out of this task's named scope (`profiles`) but was found
during the explicitly-requested Step 6 sweep of related tables, so it's
reported here in full rather than held back.** No SQL fix is proposed for
it in this pass — see "Decisions required" in the incident report.

## 🟡 Likely intentional public data (verify, don't assume)

| Table | RLS enabled | Anon SELECT | Notes | Severity |
|---|---|---|---|---|
| `temp_logs` | Yes | Yes (`USING (true)`-equivalent + authenticated) | Columns: `temp_c, conditions, hazards, notes, photo_url, lat, lng, spot_id, user_id, ...` — this is the app's **entire product concept**: swimmer-reported public conditions data (CLAUDE.md: "Community/ground-truth data"). Public read here is very likely correct, not a bug. `user_id` is a bare UUID — not identifying on its own, **but becomes identifying in combination with the `profiles` leak** (join `temp_logs.user_id` → `profiles.id` to deanonymize who logged what, then read their phone/address). This combination risk goes away once `profiles` is fixed, without touching `temp_logs` itself. | Informational — flag the combination risk, not the table itself |
| `june_challenge_events` | Yes | Yes (`USING (true)`-equivalent) | Public challenge leaderboard/feed data — same reasoning as `temp_logs`, publicly-readable-by-design for a live public leaderboard page. Not independently column-audited this pass (out of scope — no sensitive-sounding columns expected on an events/leaderboard table, but not proven). | Low — verify column list before assuming safe |

## 🟢 Confirmed properly scoped (spot-checked, not exhaustively)

| Table | RLS enabled | Anon SELECT | Notes |
|---|---|---|---|
| `campaign_participants` | Yes | No | Has exactly 1 SELECT policy, not unrestricted |
| `club_admins` | Yes | No | `is_club_manager()`-gated, own-row read only |
| `club_challenge_points` | Yes | No | Scoped |
| `club_coaches` | Yes | No | Zero SELECT policies at all — RLS enabled with no permissive SELECT policy means **nobody** (not even authenticated) can SELECT via the API unless a policy is added elsewhere or access goes through a SECURITY DEFINER function. Worth confirming this isn't accidentally over-restrictive and breaking a legitimate feature, but it is not a public-exposure risk. |
| `club_health_events` | Yes | No | 3 SELECT policies, none unrestricted |
| `club_members` | Yes | No | 2 SELECT policies, none unrestricted |
| `club_session_assignments` | Yes | No | Scoped |
| `crossing_attempts` | Yes | No | Zero SELECT policies — same "nobody can read via API" note as `club_coaches` |
| `crossing_prep_notes` | Yes | No | Same as above |
| `fuel_tests` | Yes | No | Scoped (PHtest.html data) |
| `growth_founders` | Yes | No | `auth.role()='authenticated'` only — reasonable (internal tool, all authenticated users can see the founder directory, matches its low sensitivity) |
| `growth_sponsors` | Yes | No | Zero SELECT policies directly — access is via the `founders_all` `ALL`-command policy (checked in the prior session), which does gate correctly |
| `newsletter_subscribers` | Yes | No | Zero SELECT policies — nobody can read via API, correct for a subscriber list |
| `push_subscriptions` | Yes | No | Scoped |
| `strava_connections` | Yes | No | 2 SELECT policies, scoped — correct, this table holds OAuth tokens |
| `swimmer_health_events` | Yes | No | Scoped |
| `swimming_post_interest` | Yes | No | Has an authenticated-broad policy but not unrestricted-to-anon — lower risk, not deep-audited this pass |
| `activity_audit` | Yes | No | Zero SELECT policies — service-role/cron-only by design, matches its use in `purge-audit.js` |

## Not audited this pass (out of the explicitly-requested table list, or genuinely not found)

- `users`/`members` as named tables don't exist in `public` schema — user identity lives in `auth.users` (Supabase-managed, not directly queried by app code) plus `profiles` as the public-schema extension table.
- `contact submissions` — no obviously-named table found; `swimming_post_interest` and `newsletter_subscribers` are the closest matches and were checked above.
- `coach assignments` — covered via `club_coaches`/`club_session_assignments` above.
- `journey data` — `crossing_prep_notes`/`crossing_attempts` covered above; `crossing_targets`/`crossing_evidence` not individually checked (same table-family, same owner, reasonable to assume same pattern but not proven).
- Sponsor/contact tables beyond `growth_sponsors` — the proposed (unapplied) `sponsor_partners`/`sponsor_partner_audit` tables from the prior session don't exist yet, nothing to audit.

## Bottom line

**The `profiles` exposure is not isolated.** `club_roster` has the identical
policy shape and is at least as severe given youth-squad data. Recommend
treating both as one remediation effort, or at minimum queuing
`club_roster` as the immediate next task after `profiles` ships — not a
"someday" item.
