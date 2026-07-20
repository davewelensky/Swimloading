# Phase 2.5 — Swim Passport V1: Discovery & Review Package

**Status:** discovery only. No SQL applied, nothing committed, nothing deployed.
**Date:** 2026-07-20

---

## 1. Discovery report

Passport V1 answers "where have I swum?" from existing data. Every field the
brief asks for is derivable today with **no schema change** — with two
exceptions that need your decision (§3).

**What exists**

| Table | Rows | Relevance |
|---|---|---|
| `temp_logs` | 2,368 | Source of visits. 10 rows have `spot_id IS NULL`; 824 have `user_id IS NULL` (legacy/anonymous). |
| `spots` | 218 | 32 are `active = false`. 27 have `country_code IS NULL`. |
| `domains` | 21 | The de-facto **region** table. 2 have `country_code IS NULL`. |
| `countries` | — | `iso_code → name`, plus `is_domestic`. |

**Existing architecture reused unchanged**

- Feature flag pattern: `feature_flags(key, enabled_global, allowed_user_ids)`
  plus a `SECURITY DEFINER <feature>_flag_enabled(uuid)` helper. Identical to
  `overview_v2`.
- Tab switching: `switchIdentityTab(tab)` in `app-story-timeline.js`. It was
  generalised to N tabs during 2.4 discovery and then **reverted to the 2-tab
  form** when Records was descoped. Passport needs that generalisation back —
  see §11.
- Deep link: `_scSetPendingHighlight()` in `app-story-card.js`, reused by
  Overview's "View Story". Passport's Overview link needs no equivalent; it
  only switches tabs.

---

## 2. Schema findings

### 2.1 There is no `region` column — BLOCKING ASSUMPTION

`spots` has: `id, name, domain, latitude, longitude, meet_note, active,
created_at, code, area, water_type, brand, country_code, timezone`.

No `region`. Two candidates:

| Candidate | Coverage | Verdict |
|---|---|---|
| `domains.display_name` via `spots.domain` | **100%** — `domain` is NOT NULL and 0 spots reference a missing domain | **Use this** |
| `spots.area` | 136 of 218 NULL (62%) | Unusable |

**Region = `domains.display_name`** ("Atlantic", "False Bay", "Pools & Inland",
"Eastern Cape"…). Because `spots.domain` is NOT NULL with zero orphans,
**"Unknown region" is unreachable in practice.** The code path stays as a
safety net, but expect it never to render.

### 2.2 Country needs a fallback

`spots.country_code → countries.name`. 27 spots (12%) have no `country_code`,
**23 of which have logs**. But every one of those 27 resolves through
`domains.country_code` (spanning ZA, GB, CH).

Concretely, for your three testers:

| Swimmer | Spots | Would show "Unknown country" |
|---|---|---|
| Dave | 34 | 1 |
| Carina | 23 | 2 |
| Johan | 21 | 4 |

The affected spots are Seaforth Beach, Kromme River, and four Virgin Active
pools — all unambiguously South African. Labelling them "Unknown country" in
a permanent record would look broken.

**Recommendation (REVISED — see the caveat, it matters):**
`COALESCE(spots.country_code, <unambiguous domain country>)`.

**The naive `COALESCE(s.country_code, d.country_code)` is wrong.** The `EUROPE`
domain is multi-country — its spots carry CH (3), IT (1), PT (1) and 7 with no
country at all — while `domains.country_code` for EUROPE is `CH`. A blind
fallback would label all 7 unknown European spots **Switzerland**, inventing a
country for spots that may be anywhere in Europe. That is exactly the
fabrication the brief forbids.

Apply the fallback **only when the domain is unambiguous** — when its spots
resolve to at most one distinct country:

```sql
LEFT JOIN LATERAL (
  SELECT CASE WHEN count(DISTINCT s2.country_code) = 1
              THEN min(s2.country_code) END AS cc
  FROM spots s2
  WHERE s2.domain = s.domain AND s2.country_code IS NOT NULL
) dom_cc ON true
...
COALESCE(c.name, dcc.name, 'Unknown country') AS country
```

Effect: the 20 ZA/GB spots get their correct country; the 7 EUROPE spots
honestly read "Unknown country" until the data is fixed. Self-correcting — if
EUROPE is later split into real country domains, the fallback starts working
with no code change.

**Separate follow-up (not this phase):** backfill `spots.country_code` from
the domain for all 27 rows, so every other consumer benefits too.

### 2.3 `water_type` values do not match the brief's filter list

DB values: `OCEAN` (113), `POOL` (71), `LAGOON` (16), `LAKE` (13), `DAM` (4),
`RIVER` (1).

The brief lists: Ocean, Lake, River, Pool, **Lido**, Other.

- **`LIDO` does not exist** in the data. Including it would render a filter
  that can never match.
- **`LAGOON` and `DAM` are missing** from the brief but are real, and DAM
  matters for inland South African swimmers.

**Recommendation:** derive filters from the result set, as the brief already
says ("only show filter values that exist"). Display names: Ocean, Pool,
Lagoon, Lake, Dam, River. Drop Lido. Keep "Other" as a catch-all for any
future `water_type`.

### 2.4 Duplicate spot names are impossible

`CREATE UNIQUE INDEX spots_name_ci_uniq ON spots (lower(name))`.

The schema already guarantees name uniqueness. Test #6 ("duplicate names
remain separate") **cannot be constructed** — the fixture insert would violate
the index. Grouping by `spot_id` is strictly stronger and is what the RPC
does; I'll assert the grouping key rather than fake a duplicate. Flagged
rather than silently dropped.

### 2.5 Deleted spots

`temp_logs.spot_id → spots(id) ON DELETE CASCADE`. A hard-deleted spot takes
its logs with it, so **a dangling `spot_id` cannot exist**. "Deleted" in
practice means `active = false` (32 spots).

Dave has 2 such spots, Carina 2, Johan 1 — Dalebrook Tidal Pool, Glen Beach,
Glencairn Beach. Real Cape Town spots, real swims.

**Recommendation: include inactive spots.** The Passport is a historical
record; excluding them would erase swims that happened. `active` governs
whether a spot can be *logged to now*, not whether it was ever swum.

---

## 3. Data-quality findings — decisions needed

| # | Finding | Recommendation |
|---|---|---|
| A | 27 spots (23 with logs) lack `country_code`; all resolve via domain | Fall back to `domains.country_code` |
| B | 32 spots inactive; 5 tester-visited | Include — Passport is history |
| C | `LIDO` in brief, absent from data; `LAGOON`/`DAM` present, absent from brief | Derive filters from results; drop Lido |
| D | Duplicate names impossible (unique index) | Reframe test #6 as a grouping-key assertion |
| E | 10 logs have `spot_id IS NULL` | Excluded by the join, as specified |
| F | All three testers show **1 country** | The example's "3 countries" won't appear. Summary should suppress the countries line when it's 1, or show it plainly — your call |

---

## 4. Proposed RPC

`get_my_swim_passport_v1()` — `SECURITY INVOKER`, `STABLE`, no writes.

```sql
CREATE OR REPLACE FUNCTION public.get_my_swim_passport_v1()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_spots jsonb;
  v_countries jsonb;
  v_summary jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT passport_v1_flag_enabled(v_uid) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;

  -- One pass over the swimmer's own spot-linked logs. Country falls back
  -- to the spot's domain (the spot's region already carries the country)
  -- before the "Unknown country" bucket. Region is the domain's display
  -- name -- spots has no region column. Inactive spots are INCLUDED: the
  -- Passport is a historical record, and active=false only means the spot
  -- can no longer be logged to.
  WITH visits AS (
    SELECT
      t.spot_id,
      s.name                                       AS spot_name,
      COALESCE(c.name, dc.name, 'Unknown country') AS country,
      COALESCE(d.display_name, 'Unknown region')   AS region,
      s.water_type,
      min((COALESCE(t.logged_at, t.created_at) AT TIME ZONE 'Africa/Johannesburg')::date) AS first_swim_date,
      max((COALESCE(t.logged_at, t.created_at) AT TIME ZONE 'Africa/Johannesburg')::date) AS last_swim_date,
      count(*)      AS total_swims,
      min(t.temp_c) AS coldest_temp_c,
      max(t.temp_c) AS warmest_temp_c
    FROM temp_logs t
    JOIN spots s        ON s.id = t.spot_id           -- NULL spot_id excluded here
    LEFT JOIN domains d  ON d.code = s.domain
    LEFT JOIN countries c  ON c.iso_code = s.country_code
    LEFT JOIN countries dc ON dc.iso_code = d.country_code
    WHERE t.user_id = v_uid
    GROUP BY t.spot_id, s.name, c.name, dc.name, d.display_name, s.water_type
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'spot_id', spot_id, 'spot_name', spot_name,
      'country', country, 'region', region, 'water_type', water_type,
      'first_swim_date', first_swim_date, 'last_swim_date', last_swim_date,
      'total_swims', total_swims,
      'coldest_temp_c', coldest_temp_c, 'warmest_temp_c', warmest_temp_c
    ) ORDER BY country ASC, region ASC, spot_name ASC, spot_id ASC), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'country', country, 'spot_count', spot_count, 'swim_count', swim_count
      ) ORDER BY country ASC)
      FROM (SELECT country, count(*) AS spot_count, sum(total_swims) AS swim_count
            FROM visits GROUP BY country) k
    ), '[]'::jsonb),
    jsonb_build_object(
      'total_spots_explored', count(*),
      'total_countries', count(DISTINCT country),
      'total_regions', count(DISTINCT region),
      'total_swims_at_spots', COALESCE(sum(total_swims), 0)
    )
  INTO v_spots, v_countries, v_summary
  FROM visits;

  RETURN jsonb_build_object(
    'summary', v_summary, 'countries', v_countries, 'spots', v_spots);
END;
$$;
```

**Ordering note.** `country ASC` puts a literal "Unknown country" alphabetically
under U, not last. If you want unknowns pinned to the bottom, ordering needs an
explicit `(country = 'Unknown country')` sort key — say the word. With the
domain fallback in place this is currently moot (no unknowns).

**Determinism.** Fully deterministic: `spot_id` is the final tiebreaker and is
unique per row.

---

## 5. Migration SQL

`sql/2026-07-20_passport-v1.sql`, additive only: one flag row, two functions,
grants. No table, column, index, trigger or policy changes.

Flag: `passport_v1`, `enabled_global = false`, allowlist = Dave
(`df137255…`), Carina (`cff2fc33…`), Johan (`becb6930…`) — the same three as
`overview_v2`, verified against `auth.users` this session.

---

## 6. Rollback SQL

```sql
BEGIN;
DROP FUNCTION IF EXISTS public.get_my_swim_passport_v1();
DROP FUNCTION IF EXISTS public.passport_v1_flag_enabled(uuid);
DELETE FROM feature_flags WHERE key = 'passport_v1';
COMMIT;
```

Touches nothing else. Because the migration is additive and read-only,
rollback is total — no data can be left behind.

---

## 7. Response shape

As the brief specifies, with `region` sourced from `domains.display_name` and
`country` from the coalesce chain. Explicitly absent: `latitude`, `longitude`,
any coordinate, `user_id`, `temp_log_id`, `dedupe_key`, raw `metadata`,
`spots.area`, `spots.code`, `spots.brand`, `spots.timezone`, `meet_note`.

---

## 8. RLS and security analysis

**The important finding: RLS does not scope `temp_logs`.**

```
"Authenticated users can view all temp logs"  →  auth.role() = 'authenticated'
"Public read temp_logs for landing page"      →  anon, USING (true)
```

Any authenticated user can already read every `temp_logs` row, and anon can
read them all. So under `SECURITY INVOKER`, **RLS provides no per-swimmer
isolation** — the sole privacy boundary is the function's own
`WHERE t.user_id = v_uid`.

This is not new (the Overview RPC has the same property) but it must be
stated plainly:

- `WHERE t.user_id = v_uid` is **load-bearing security**, not a filter.
  Any future edit that loosens it leaks every swimmer's history.
- `SECURITY INVOKER` is still correct — it means the function cannot do
  anything the caller couldn't. But it is not what keeps the data private.
- Test #4 (cross-user exclusion) is therefore the single most important
  test in the suite, not a formality.

`spots`, `domains` and `countries` are all public-readable reference data;
joining them leaks nothing.

Function hardening, matching `overview_v2`: `REVOKE ALL … FROM public, anon`
then `GRANT EXECUTE … TO authenticated`; `SET search_path = public` on both
functions; flag helper is `SECURITY DEFINER` so the flag table needn't be
readable by the caller.

---

## 9. Indexes required

**None.**

`idx_temp_logs_user (user_id)` and `idx_temp_logs_user_created (user_id,
created_at DESC)` already exist. The query is a single indexed scan of one
swimmer's logs (~76–114 rows for the testers, 2,368 in the entire table)
joined to three small reference tables. Adding an index here would be
premature.

Worth re-checking if a swimmer ever exceeds a few thousand logs.

---

## 10. UI design

Third tab in the private Identity modal. Header "Swim Passport", supporting
line "A private record of the places you have experienced through swimming."

Summary line, zero-value tiles suppressed per the brief:
`34 spots explored · 1 country · 8 regions`

Then filter chips (only water types present in the result), then spots grouped
country → region.

**Region heading collapses when it matches the country** (your decision,
20 Jul). Ten of the 21 domains are country-level, so without this an
international swimmer reads "United Kingdom → United Kingdom → Brighton
Beach". Rule: suppress the region heading when
`lower(region) = lower(country)`. Exact string comparison is sufficient —
verified against every domain:

| Collapses | Correctly does NOT collapse |
|---|---|
| United Kingdom, France, Spain, Namibia, Seychelles, Thailand | All 11 South African regions (Atlantic, False Bay, KwaZulu-Natal…), Croatia → Dalmatia |

One oddity survives: the `EUROPE` domain has `display_name = 'Europe'` but
resolves to Switzerland, so a Swiss spot reads "Switzerland → Europe →
Lake Lugano". Not collapsed (the strings differ), and not wrong — just loose.
It's the same underlying modelling issue as the multi-country fallback above,
and the same data fix resolves both.

`region` is still returned in the RPC payload regardless; collapsing is
presentation-only, so the data stays complete for later use.

Each spot is a compact card:

```
Clifton 4th Beach
12 swims
First: 14 May 2025      Last: 18 July 2026
11.5°C coldest          18.2°C warmest
```

Existing visual language: `#0d1728` cards, `var(--border)`, cyan `#38bdf8`
accents, DM Sans, 14px radius, 22px section rhythm. No emojis, illustrations,
decorative map, badges, progress bars or completion percentages.

Missing temperatures (`coldest`/`warmest` null) render as `—`, matching the
Overview tiles.

Empty state exactly as briefed, with no statistic tiles.

---

## 11. Identity tab integration

`switchIdentityTab` must go back to the N-tab form it briefly had during 2.4
discovery — the same generalisation, this time for Passport instead of
Records:

- `IC_TABS = ['overview', 'story', 'passport']`
- Tab button + panel rendered in `app-identity.js` **only when `passport_v1`
  is enabled** for the viewer, exactly as the Story tab is gated today
- Lazy init: Passport loads on first activation, not on modal open
- `role="tablist"` / `role="tab"` / `role="tabpanel"` and `aria-selected`
  already exist and extend unchanged

A swimmer without the flag sees two tabs and no behavioural change.

---

## 12. Overview integration

The existing Passport card becomes conditional:

- **Flag on** — card is actionable, action labelled "View Passport",
  switches to the Passport tab
- **Flag off** — unchanged: "Coming soon", no button

**No extra query.** `app-overview.js` already resolves `storyTimelineEnabled()`
for the View Story button; Passport uses the same one-time flag read pattern.
Both are cached per modal open.

---

## 13. Analytics

Three events, payloads restricted to the brief's allowlist:

| Event | Payload |
|---|---|
| `identity_passport_opened` | `total_spots_bucket`, `source` |
| `passport_filter_selected` | `filter_type`, `total_spots_bucket` |
| `overview_passport_clicked` | `source` |

`total_spots_bucket` = `'0' | '1-9' | '10-24' | '25-49' | '50+'`.
Never sent: spot names, country names, regions, coordinates, user identifiers,
temperatures, dates.

---

## 14. Accessibility

Carrying forward what 2.4.2 established, plus tab-specific work:

- Tab semantics already correct; extending to a third tab needs
  `aria-controls` on the new button and `aria-labelledby` on the panel
- Keyboard: **the existing tab bar has no arrow-key handling** — buttons are
  reachable by Tab but not navigable with Left/Right as the ARIA tabs pattern
  expects. Pre-existing gap; I'd fix it here since we're touching the tab bar.
- Focus: visible focus outline on tab buttons and filter chips (the same gap
  found on the View Story button in 2.4.2)
- Focus management: moving to the Passport tab should move focus to the panel
- Heading order: `h3` for section headings, consistent with 2.4.2. Country
  headings `h4`, region headings `h5` — a real hierarchy, no skipped levels
- Contrast: verified against the ≥7:1 bar 2.4.2 met
- Filter chips as `role="group"` with `aria-pressed`

---

## 15. Test plan — server

All 20 from the brief, minus the reframing in §2.4:

1–3 auth/flag gating (anonymous → 28000, non-allowlisted → 42501, allowlisted → success)
4 **cross-user exclusion — the critical one, see §8**
5 distinct spots counted by `spot_id`
6 ~~duplicate names~~ → **grouping key is `spot_id`** (duplicates impossible, §2.4)
7 `spot_id IS NULL` logs excluded
8 country grouping correct
9 null country → domain fallback → "Unknown country" only if both null
10 null region handled (synthetic — unreachable with real data, §2.1)
11–15 first/last/total/coldest/warmest correct
16 no coordinates
17 no forbidden private fields (recursive text sweep, as in 2.4)
18 empty swimmer safe
19 deterministic ordering (run twice, compare)
20 zero fixture persistence

Plus two I'd add:
21 inactive spots included (§2.5)
22 null `temp_c` yields null coldest/warmest, not an error

Method as established: one flat `BEGIN … ROLLBACK`, fixtures via
`auth.users → profiles → spots → temp_logs`, `logged_at` left NULL with
`created_at` backdated (48h trigger), results surfaced via `RAISE EXCEPTION`
so the transaction cannot commit.

## 15b. Test plan — client harness

`test-passport.html`, same contract as `test-overview.html`: fixtures only, no
Supabase client, no analytics, noindex, unlinked. Covers all sixteen client
cases from the brief including long spot names, missing temperatures, filter
behaviour, three viewports, flag-off, and the RPC failure state.

---

## 16. Harness

New `test-passport.html`; `test-overview.html` extended with a "Passport flag
on" variant to prove the Overview card becomes actionable.

---

## 17. Files changed

| File | Change |
|---|---|
| `sql/2026-07-20_passport-v1.sql` | New — flag + 2 functions |
| `sql/2026-07-20_passport-v1-tests.sql` | New — 22 scenarios |
| `app-passport.js` | New — panel render, filters, empty state |
| `app-identity.js` | Third tab, flag-gated |
| `app-story-timeline.js` | `switchIdentityTab` → 3 tabs + arrow keys |
| `app-overview.js` | Passport card actionable when flag on |
| `index.html` | Script tag + `?v=` bumps |
| `test-passport.html` | New harness |
| `test-overview.html` | Passport-on variant |
| `growth-hub.html` | Capability entry, same ship |

---

## 18. Deployment order

1. Validate RPC in rolled-back transaction (22/22 before applying)
2. Apply migration after explicit "apply"
3. Verify flag: `enabled_global=false`, three-person allowlist
4. Re-run 22 scenarios against the applied RPC; confirm zero persistence
5. `git mv` to `sql/applied/`
6. Commit code + SQL + growth-hub together; bump `?v=`
7. Push; verify production serves the new assets and hashes match
8. Harness check at 375/768/1280 against production-served JS
9. Your live acceptance in an allowlisted session

---

## 19. Rollback order

1. Set `allowed_user_ids = '{}'` — instant kill, no deploy needed
2. If code is at fault: `git revert`, push, verify
3. If schema is at fault: run §6 rollback
4. Flag absent → `passport_v1_flag_enabled` returns false → RPC refuses →
   client falls back to two tabs

The flag is the fast path. No swimmer outside the three sees anything either way.

---

## 20. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `WHERE user_id = v_uid` removed/loosened by a later edit → **full history leak** | Low | **Severe** | RLS won't catch it (§8). Test #4; comment marks the clause as load-bearing |
| "Unknown country" on obviously-SA spots | **Certain without the fallback** | Medium | Domain fallback (§2.2) + separate backfill |
| Inactive spots excluded → history silently disappears | Medium | Medium | Include them (§2.5) |
| `LIDO` filter that never matches | Certain if brief followed literally | Low | Derive filters from results |
| Tab bar regression affecting Story | Low | Medium | Same generalisation already written and reverted once in 2.4; harness covers all three tab states |
| Query slow for a high-volume swimmer | Very low | Low | Indexed; 2,368 rows total today |
| Scope creep into maps/badges/sharing | Medium | Medium | Explicit do-not-build list honoured |

**Overall: low risk.** Additive, read-only, flag-gated to three people, fully
reversible, no schema change. The one thing deserving real attention is the
`user_id` predicate being the only privacy boundary.

---

## Decisions — ALL SETTLED 20 Jul 2026

| # | Decision | Outcome |
|---|---|---|
| 0 | Region heading collapses when it equals the country name | **Yes** (§10) |
| 1 | Country fallback, restricted to unambiguous domains | **Yes** (§2.2) |
| 2 | Include inactive spots | **Yes** — Passport is history (§2.5) |
| 3 | Filter list: drop Lido, add Lagoon and Dam | **Yes** (§2.3) |
| 4 | "Unknown country" sort position | **Pinned last** — an unresolved bucket should never sort above real places. Explicit sort key: `(country = 'Unknown country') ASC, country ASC`. Same for "Unknown region". |
| 5 | Summary line with only 1 country | **Show it plainly** — "1 country". The brief suppresses *zero*-value tiles; 1 is a real fact, and suppressing it would make the summary's shape vary between swimmers. |
| 6 | Data cleanup ticket | **Raised** — `task_910b57f1`, backfill 27 country codes + split the EUROPE domain per EXPANDING.md |

Decisions 4 and 5 were open questions rather than yes/no; resolved as above on
the reasoning given, and flagged in chat rather than assumed silently.

With the cleanup ticket done, decision 1's restriction becomes a no-op (every
domain resolves to one country) and the EUROPE→"Europe" label oddity in §10
disappears. The Passport code needs no change when that lands — it is
self-correcting by design.
