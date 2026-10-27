# Autopilot: the weekly generator that refills the Tue/Thu/Sat queue

Status: **built and tested, not deployed, not scheduled, publishing still paused.** Nothing here writes to the database unless you run it with `--write` (CLI) or set `SOCIAL_AUTOPILOT_ENABLED=true` (Vercel).

## What it does

Each run looks at the next 14 days of slots (Tue/Thu/Sat 10:00 SAST) and fills the free ones from real data:

1. Posts you already approved but not yet slotted go first (same order as `social-queue.mjs schedule`).
2. For each remaining slot it picks the group furthest below its target in `SOCIAL_DEFAULTS.mix` (Explore 30, locations 25, crossings 15, ocean 10, partners 10, clubs/platform 10) **that has a usable candidate**. A group with nothing usable is skipped and the others absorb its share.
3. A candidate must pass `validatePost` (facts sourced, quotes found in source files, freshness, 90-day de-duplication) and, when rendered, the image and pixel checks (clipping, contrast, licence, rotation).
4. **AUTO_ELIGIBLE** becomes `SCHEDULED` in the slot. **REVIEW_REQUIRED** becomes `PENDING_REVIEW` and never takes a slot (max 3 per run). **BLOCKED** is skipped and reported.
5. If nothing usable exists the slot is **left empty**, never padded. The hourly publisher already emails you about an empty slot.
6. It keeps at least 6 evergreen reserves (APPROVED, AUTO_ELIGIBLE, unslotted). A shortfall is reported in the run and emailed.

Rules worth knowing:

* **De-duplication** checks `social_posts.source_key` (any non-rejected row, 90 days) **and** `social-poc/publish-ledger.json` (mapped to source keys through `social-poc/posts.json`, so the English Channel post published on 20 Oct counts). **On Vercel the local ledger does not exist.** The English Channel post published by hand on 20 Oct is a `REJECTED` row in `social_posts`, which de-duplication ignores, so before the Vercel run is switched on its row should be set to `PUBLISHED` (see "Open items").
* **Partner cap:** a partner post is only chosen if partners stay at or below 10% of the last 20 posts.
* **Measured conditions are late-bound.** A reading ages, so the slot is *held* until it is 30 h away; the daily run then builds the post from readings that will still be inside the 48 h freshness ceiling when it goes out. The publisher re-checks them again at publish time.
* An Explore event already featured in a post from the last 14 days is not repeated.

## The series

| Series | Source | Notes |
|---|---|---|
| This week in open water | `event_editions` via `exploreUpcoming` (existing eligibility rules) | window widens 7, 14, 21 days; events re-checked at build and at publish |
| Measured conditions (`OPEN WATER INTEL`, the "ocean" group) | `spot_conditions_live`, primary station within 10 km, 3 to 4 spots | reading, source, station and observation time on every line; never model data; never says "live" |
| Regional discovery maps | `spots` (active, with coordinates) | every country and every South African region with 3+ spots; 3 nearby spots per map, up to 3 maps per region; single-sex ponds excluded |
| Crossing angles | `crossings` columns only | qualifying swim (legacy key kept), season, route map (needs all four coordinates); `qualifying_temp_limit_c` is never used (English Channel conflicts with the page) |
| Live partners | `partner_pages` with `chip_state = live` and `section = active` | the row's `blurb` quoted verbatim; `status_note` is internal and never used; re-checked live at publish |

## Rendering: recommendation

**Run it as a Vercel function** (`api/cron/social-generate.js`, `maxDuration` 300, 1769 MB, `@sparticuz/chromium` as the lab PDFs already do), not as a scheduled task on your Mac.

* It must run unattended and daily. A Mac task depends on the laptop being awake, logged in, with a Supabase service key stored on disk; a Vercel cron has none of those problems and the key is already a Vercel secret.
* Everything it needs is now bundled or remote: Bebas Neue and DM Sans are embedded (no font CDN), map tiles are fetched from CARTO, original photos come from the private `social-media` bucket into the function's temp dir, generated images go to the public `social-posts` bucket.
* A run renders about 5 to 12 posts of 1 to 5 slides; locally a slide takes a few seconds, well inside 300 s.
* **What is not proven:** the renderer has only been run on macOS Chrome. `@sparticuz/chromium` is proven for the lab PDF but not for this renderer, so do one **preview deploy with `SOCIAL_AUTOPILOT_ENABLED=true` and call `/api/cron/social-generate` once** (it writes PENDING/SCHEDULED rows while publishing is still paused) before relying on it. If it fails there, the fallback is the same code run by `node scripts/social-autopilot.mjs --write` from a launchd job; nothing else changes.
* The cron is deliberately **not** in `vercel.json` `crons` (only the `functions` entry with `maxDuration` and `includeFiles` is). To start it: add `{ "path": "/api/cron/social-generate", "schedule": "30 3 * * *" }` (05:30 SAST, about 28 h before a Saturday slot) and set `SOCIAL_AUTOPILOT_ENABLED=true`, `CARTO_KEY` if `explore.html` is not bundled.

## Running it

```bash
node scripts/social-autopilot.mjs --dry-run            # prints the plan, writes nothing (default)
node scripts/social-autopilot.mjs --dry-run --snapshot snap.json   # offline: partner_pages + social_posts from a JSON file
node scripts/social-autopilot.mjs --write              # renders locally, uploads, inserts (needs SUPABASE_SERVICE_KEY)
```

`--dry-run` without `SUPABASE_SERVICE_KEY` or a snapshot stops at `partner_pages` and `social_posts`, which are not publicly readable.

## Open items for you

1. **Brockwell Lido** has `spots.area = NULL`, so its curated spotlight is skipped (it needs an area for the caption). Setting `area = 'London'` is a data change (migration workflow).
2. **Before the Vercel cron is enabled:** the English Channel post you published by hand (source key `crossing:8c086e60-ea21-4445-ba2a-b5b1f2bcce41`) is a `REJECTED` row. Set it to `PUBLISHED` so the 90-day rule sees it without the local ledger, otherwise the autopilot can post it again. I did not touch the database.
3. **CC BY-SA photos** still route to review (`media.acceptShareAlike = false`) until you decide the policy.
4. **Clubs/platform** (10% of the mix) has no automatable source yet, so its share is redistributed. Candidates: club milestones from `club_*` tables, platform stats from `site-config.js`.
5. `spots.area` holds raw codes for some rows (`SAN_DIEGO`); the series prettify them for display, the column itself is untouched.

## Update 27 Oct 2026: weekly cron registered

`/api/cron/social-generate` now runs **Mondays 08:00 UTC (10:00 SAST)** (`vercel.json`). It does nothing but report a plan until `SOCIAL_AUTOPILOT_ENABLED=true` is set on Vercel. A Monday run builds the next two weeks, and Tuesday's measured-conditions post (slot 24 h later, inside its 30 h window). Thursday and Saturday conditions posts would need a daily schedule (`0 8 * * *`); the handler is idempotent, so switching to daily is safe.
First live run on Vercel is the first time this renderer runs outside macOS Chrome: check the function logs and your email on the day.
