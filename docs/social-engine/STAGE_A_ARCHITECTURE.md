# Social Content Engine: Stage A architecture review

Written 2026-10-18. Read-only: nothing was changed, deployed, or published. Every finding below was read from the repository or the live database (read-only queries). Anything I could not verify is marked **UNVERIFIED**.

## 1. Findings in one paragraph

Most of what the brief needs already exists. Caption generation, a password-gated admin page, a headless-Chromium renderer, freshness rules for temperatures, a change-log trigger for events, a cron pattern with auth, and a migrations workflow are all in the repo. What does not exist: any Meta/Facebook/Instagram integration, any stored content library, any server-side image generation for social, and any structured "fact + provenance" layer for spots. The biggest risk is not engineering. It is **fact coverage**: several of the brief's own example facts are not in structured data today (see section 5).

## 2. Existing architecture

| # | Area | Finding |
|---|------|---------|
| 1 | `/caption-agent` | [caption-agent.html](../../caption-agent.html), 1,587 lines, single static page, all JS inline. Routed in `vercel.json`. `noindex`. Nine post types (conditions, crossing, challenge, partner, club, hazard, strava, community, growth). Challenge and stats are live-fetched via `site-sync.js`. |
| 2 | Caption generation | Browser builds a prompt string in `buildPrompt()` from form fields, POSTs it to [api/caption-generate.js](../../api/caption-generate.js), which forwards it to Anthropic and returns the raw response. Client parses JSON. **Output is Instagram-only (3 options). Nothing is stored.** |
| 3 | AI integration | One provider: Anthropic Messages API via raw `fetch`, model hardcoded `claude-sonnet-4-6`, `max_tokens` 1400. Also used by `api/sets/*` and the lab report (`LAB_REPORT_MODEL`). No SDK dependency. |
| 4 | Auth | Caption Agent uses a **shared password** (`CAPTION_PASSWORD`) sent in the request body, held in `sessionStorage`. The login check sends `prompt: '__ping__'`, which makes a real, billed Anthropic call on every login attempt and has no rate limit. Admin pages use Supabase auth with Dave-only RLS (`pp_dave_all` pattern on `partner_pages`). New write endpoints should use the Supabase pattern, not the shared password. |
| 5 | Spot data | `spots` (210 active, 19 UK): name, domain, lat/lng, water_type, area, country_code, timezone, brand. **No description, history, opened year, or image columns.** |
| 6 | Crossings | `crossings` (13 active) has rich optional columns (intro, key_facts, hazards, preparation, prep_benchmarks, faqs, page_copy, record_*, qualifying_*). Only 9 of 13 rows are populated. English Channel, Robben Island and the custom row are **not** (see section 5). |
| 7 | Partners | `partner_pages` (11 rows): name, hero_page, chip_state, blurb, logo, show_on_home. Source of truth for the partner list. **No expiry date and no "approved for social" field.** |
| 8 | Clubs | `clubs` table plus per-club guide pages. Club content is sensitive (youth swimmers); not a candidate source for automation. |
| 9 | Maps | Leaflet in `explore.html`; tiles come from a third party (CARTO key added Sep 2026). **Tile licence for derived social images is UNVERIFIED.** |
| 10 | Image rendering | Two precedents: (a) client canvas, 1080x1920 story card, [app-ig-story.js](../../app-ig-story.js); (b) **server-side headless Chromium** already deployed: [api/_lib/lab-report/pdf.js](../../api/_lib/lab-report/pdf.js) using `puppeteer-core` + `@sparticuz/chromium` (60 s, 1769 MB function). (b) is the reuse path for deterministic HTML/CSS to PNG/JPEG. |
| 11 | Sitemap | [api/sitemap-dynamic.js](../../api/sitemap-dynamic.js): a hand-kept static list plus DB-driven spot, event and crossing URLs, with `isPublicPageIndexable()`. Good for discovery of public URLs, but not for facts. |
| 12 | Cron | `vercel.json` has 9 crons, all authenticated by `requireCronAuth()` ([api/cron/_auth.js](../../api/cron/_auth.js), `CRON_SECRET`). Vercel Pro, so schedule and duration limits are not a constraint. The event crawler is separate (`discovery-worker`, Railway, own scheduler). |
| 13 | Meta | **None.** No Graph API calls, tokens, or env vars anywhere. `instagram.com/swimloading` and a Facebook profile link exist on the site only. |
| 14 | Hosting | Vercel (static HTML plus `api/*.js` functions, no framework) and Supabase. Not Next.js. Deploys on push to `main`. |
| 15 | Analytics | `analytics_events` table, `share_analytics` migration, and `api/_lib/public-analytics.js`. UTM handling on inbound links is **UNVERIFIED**; referral reporting from Meta needs UTM tags on every link we post. |

## 3. Explore architecture

* [explore.html](../../explore.html) (2,479 lines) calls one public endpoint, [api/explore/events.js](../../api/explore/events.js), which runs the `search_events_v2` SQL function with the **anon key** (RLS decides what is public). Companion routes: `map-points.js`, `places.js`.
* Underlying model: `event_series` (808 official_race + 1 swim_festival) to `event_editions` (822 rows) to `event_venues`, `event_distances`, `event_organisers`. Candidates live in private `discovery_candidate_events` and are promoted by `approve_discovery_candidate()`.
* Edition fields we need already exist: `status` (announced / completed / cancelled / postponed / unconfirmed), `date_confirmed`, `date_precision`, `verification_tier` (confirmed / listed / unverified), `last_verified_at`, `registration_status`, `official_url`, `slug`, `is_searchable`, `is_indexable`, `previous_slugs`.
* **Server-side access: yes.** Do not scrape. A server job can read `event_editions` joined to venue and distances directly (service key in a cron/admin route, or the same anon RPC).
* Change tracking already exists: trigger `log_edition_change()` writes `event_change_log` / `event_change_history` for date, venue, status, URL changes. Today: 466 rows, 442 of them are `status/other` (routine announced to completed roll-over). **That ratio is exactly why a raw "changed" signal must not drive posts.**
* Counts today: 357 future searchable editions; 56 in the next 14 days (all `date_confirmed`); future tiers: 24 confirmed, 163 listed, 183 unverified.
* **Registration: every future edition has `registration_status = 'unknown'` (377 of 377).** Under the brief's rule we may never say "open for registration" today.

### Discrepancies with the brief (please confirm)

1. **Regular group swims and bookable/escorted crossings are not in the Explore event model.** `event_series.event_type` contains only `official_race` and `swim_festival`. Group-swim detection ([api/_lib/group-swim-signal.js](../../api/_lib/group-swim-signal.js)) produces human-review *candidates*, not published records. So "new regular group swims" and "bookable crossings" have **no structured source yet**. The POC and v1 can cover races/events and locations; group swims and bookable crossings need a source decision first.
2. Many events carry non-English titles (Portuguese, Spanish). Captions need a language policy.

## 4. Proposed minimal implementation

No new app, CMS, or dependency. Everything extends what exists.

```
Explore tables / spots / crossings / partner_pages / curated facts
        |  (server module, read-only; extractors per category)
        v
fact record = { claim, value, source_ref (table.col/row or file), observed_at, kind: evergreen|time_sensitive }
        |  (validator: freshness, status, partner, privacy rules)
        v
template (HTML/CSS, 4:5) --> Chromium render --> JPEG in Supabase Storage (public bucket)
        |
        v
caption call: existing /api/caption-generate, extended to take a facts list
and return {facebook, instagram}; prompt forbids any claim not in facts
        |
        v
social_posts row (DRAFT / PENDING_REVIEW)  -->  Caption Agent "Library" tab
```

**Data (3 tables, one migration, Dave-only RLS, via the MIGRATIONS.md workflow):**

* `social_posts`: source_type, source_key (stable id, e.g. `edition:<uuid>`), category, angle, facts jsonb (with provenance), image_path(s), fb_caption, ig_caption, status (the 7 suggested statuses), scheduled_for, published_at, results jsonb, expires_at, source_snapshot_hash, review_reason.
* `social_source_state`: source_key, first_seen_at, last_snapshot_hash, last_material_change_at, last_promoted_at. This is the "discovered / changed / last promoted" tracker; also gives the 90-day de-duplication.
* `social_settings`: cadence (days/times, default Tue and Fri 10:00 SAST), category mix targets, pause flag, freshness thresholds.

**Change detection (Explore):** NEW = eligible edition whose key is absent from `social_source_state`. UPDATED/CANCELLED = rows in `event_change_log` with `change_type` in (date_changed, venue_changed, cancelled, postponed) after the post was created; this **suppresses or flags** any scheduled post that references the edition. Ignore `status/other`, `updated_at`, and `last_verified_at` bumps. EXPIRED = start_date past. UPCOMING = confirmed date within the window.

**Event eligibility (v1 rule, needs your OK):** exists; `start_date` in future and `date_confirmed`; `status = 'announced'`; venue with country known; `official_url` present; `verification_tier` in (confirmed, listed) (**not** unverified); `is_searchable`; no unresolved `event_change_log` entry. Copy says "listed on Explore", never "register now", and links to the Explore/event page.

**Freshness:** reuse [api/_lib/temperature-freshness.js](../../api/_lib/temperature-freshness.js) (live <=6 h, recent <=48 h, last-reading <=7 d). Temperatures only from `spot_conditions_live` with reading + source + timestamp, re-validated at publish time; stale means drop the number or swap to evergreen. Hazards, live safety guidance, athlete journeys and club/youth data are never auto-eligible.

**Content selection:** score = category deficit vs the configurable mix (30/25/15/10/10/10) x quality; a category with no strong candidate is skipped and a strong evergreen post substitutes. No quota filling.

## 5. Fact-coverage gaps (the real risk)

| Brief example | What the data actually has |
|---|---|
| Tooting Bec "opened in 1906" | **Available**, but only in the hand-curated [api/mywaterlive-config.js](../../api/mywaterlive-config.js) (`built: 1906`, plus facts). Only **2 venues** (Tooting Bec, Brockwell) have such curation. Every other spot has name / type / area only. |
| Tooting Bec image | Config points to a Wikimedia/Geograph photo (CC BY-SA family). Reuse needs visible attribution and licence check; **UNVERIFIED** per image. |
| Water temperature | Needs a per-spot check of `spot_conditions_live.observed_at`. My probe query used a wrong column name (`water_temperature_c` is correct); not yet run. |
| English Channel intelligence | The `crossings` row has no intro/key_facts/prep. Facts exist only inline in [english-channel.html](../../english-channel.html) (FAQ JSON-LD: e.g. 6 h qualifying swim, record holder). DB has `qualifying_duration_minutes=360`, `qualifying_temp_limit_c=16`, `record_holder`, `record_year`. Extraction from the page, or backfill into `crossings`, is needed ([scripts/extract-crossing-content.mjs](../../scripts/extract-crossing-content.mjs) may help). |
| EO Lab / SwimBETTER | `partner_pages.chip_state = 'soon'` (not `live`), so it is **not a clearly approved/live partner**. Claims on [partners/eolab.html](../../partners/eolab.html) not yet audited. Proceeding needs your explicit approval of this partner for social use. |
| UK locations (3 spots) | 19 UK spots exist; region + water type are verifiable. Region copy would be minimal but true. |
| South African spot | Same as above; nearly all SA spots lack curated facts. Candidates must be chosen by data richness, not randomly. |

Consequence: **spot "did you know" posts will be rare** until curated facts are added. Practical fix: a small `spot_facts` source (or a new curated column) populated deliberately, each with a source URL. That is a content task for you, not code.

## 6. Technical risks and dependencies

1. Fact coverage (section 5).
2. Meta: needs a Meta app, a Facebook Page linked to an Instagram Business/Creator account, and app review for publish permissions. My recollection (**re-verify against current Meta docs before Stage C**): Instagram feed publishing needs a public JPEG URL, carousels up to 10 items, tokens expire and must be refreshed, and there is a daily publish cap. No credentials will be requested before approval.
3. Chromium on Vercel: proven in this repo for PDFs; cold start and font loading (Bebas Neue / DM Sans must be bundled, not fetched) need testing.
4. Map imagery licence (CARTO/OSM attribution) for static maps; alternative is a simple SVG route/pin graphic with no tiles.
5. Image licences for location photos: no licence column exists. Default to brand graphics, partner-supplied assets, or explicit per-image records.
6. Event data is crawler-derived (183 of 370 future announced editions are `unverified`): the eligibility filter above is load-bearing.
7. Shared-password gate: don't extend it to new write routes.
8. Repo hygiene: working tree has many untracked files (including `.claude/`); the work should be a clean branch.

## 7. Files expected to change or be added

Add: `sql/applied/<date>_social-engine.sql` (+ backup/dry-run per MIGRATIONS.md); `api/_lib/social/` (extractors, validator, selector, freshness wrapper, change detection, caption facts builder); `api/_lib/social/templates/` (5 + carousel HTML/CSS); `api/social/render.js`; `api/social/posts.js` (list/update, Supabase-auth, Dave-only); `scripts/render-social-poc.mjs` (POC preview generator, like `render-spot.mjs`); `test/social-*.test.js`; `docs/social-engine/README.md`.
Change: [caption-agent.html](../../caption-agent.html) (Library tab; keep existing generator untouched), [api/caption-generate.js](../../api/caption-generate.js) (accept facts, return FB + IG; keep backward compatible), `growth-hub.html` (required by repo rule), `package.json` (no new deps expected), `vercel.json` (only in Stage C: cron + function config).
Not touched: all existing pages, Explore, spots, crossings data, club code.

## 8. Recommended sequence

1. Approve the decisions in section 9.
2. Stage B-1: fact extractors + validator + tests (no AI, no images).
3. Stage B-2: templates + local render script; six preview files (IG 1080x1350 JPEG; FB reuse unless it looks wrong).
4. Stage B-3: caption facts-to-FB/IG call; strict "only these facts" prompt, post-check that every number/date in the caption appears in the facts.
5. Stage B-4: migration (after dry-run) + Library tab to review/approve/edit.
6. Stage C (separate approval): Meta app, publish job, retries, notifications, pause switch, UTM reporting.

## 9. Decisions needed from you

1. **EO Lab** is `soon`, not `live`: approve it as the Behind-the-Brand POC anyway, or substitute a live partner (Maurten, SiS, Blu Smooth, Magic5, BlueSeventy UK)?
2. **Event verification floor:** include `listed` tier (my recommendation, consistent with your "publish with ranking + disclaimer" model), or `confirmed` only (24 future editions)?
3. **Group swims and bookable crossings:** accept that v1 Explore content means races/events only, until a structured source exists?
4. **Spot facts:** OK to treat the 2 curated venues as the only spots eligible for "did you know" posts for now, with a small curated-facts list added over time?
5. **POC scope:** the six examples may show "not eligible / data gap" where the data is thin, rather than being padded. Agreed?
