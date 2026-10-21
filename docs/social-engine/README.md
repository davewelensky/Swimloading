# Social Content Engine: Stage B proof of concept

Status: **proof of concept. Nothing is published, deployed or committed. No Meta credentials exist or are requested.**
Architecture and reasoning: [STAGE_A_ARCHITECTURE.md](STAGE_A_ARCHITECTURE.md).

## What was built

| Piece | File |
|---|---|
| Defaults: cadence (Tue/Thu/Sat 10:00 SAST), mix targets, dedupe, reserve size, event rules | [api/_lib/social/config.js](../../api/_lib/social/config.js) |
| Fact = claim + source (+ time-sensitivity); date formatting that never shifts by timezone | [facts.js](../../api/_lib/social/facts.js) |
| Extractors from real data (spots, curated venue facts, crossings, partner page, Explore) | [sources.js](../../api/_lib/social/sources.js) |
| Validation, publish-time event re-check, caption number grounding | [validate.js](../../api/_lib/social/validate.js) |
| Deterministic captions built only from facts (Facebook + Instagram) | [captions.js](../../api/_lib/social/captions.js) |
| HTML/CSS templates, 1080x1350 (Instagram 4:5; Facebook reuses it) | [templates.js](../../api/_lib/social/templates.js) |
| Headless Chromium renderer with a clipping check (same launcher as the lab PDF) | [render.js](../../api/_lib/social/render.js) |
| POC generator (read-only against the DB) | [scripts/render-social-poc.mjs](../../scripts/render-social-poc.mjs) |
| Review UI: "Auto-post preview" tab in the existing Caption Agent (existing generators untouched) | [caption-agent.html](../../caption-agent.html) |
| Tests (31, no network) | [test/social-engine.test.js](../../test/social-engine.test.js) |
| Library schema, **proposed only, not applied** | [sql/proposed/2026-10-18_social-engine_PROPOSED.sql](../../sql/proposed/2026-10-18_social-engine_PROPOSED.sql) |

Run: `node scripts/render-social-poc.mjs` (needs network for fonts and one photo; uses local Chrome). Output goes to `social-poc/` (images + `posts.json`). `social-poc/` is generated; it is public if deployed, so decide whether to keep it out of the deploy.

## The six examples (generated 18 Oct 2026)

| # | Example | Eligibility | Why |
|---|---|---|---|
| 1 | Behind the Brand: **Maurten** (EO Lab substituted: it is still `soon`) | AUTO | Live partner; every line is quoted from partners/maurten.html; the sponsored challenge is excluded |
| 2 | Swim Spotlight: **Tooting Bec Lido** | REVIEW | Facts verified (curated venue config). Photo is CC BY-SA 2.0 (share-alike); needs Dave's yes. Config's own photo URL returns 404, so a Commons image was verified and substituted. No live temperature exists for this spot, so none is shown |
| 3 | Crossing Intelligence: **English Channel** | AUTO | From `crossings` columns only. Temperature limit deliberately omitted (see findings) |
| 4 | Discovers: **outdoor swimming around London** | AUTO | Three real spots, varied water types, single-sex ponds excluded |
| 5 | Swim Spotlight: **Clifton 4th Beach (South Africa)** | REVIEW | Only name/type/region exist; thin content is never auto-selected. A modelled temperature exists but is not used (a model, not a measurement) |
| 6 | **This Week in Open Water** carousel (cover + 3 events) | AUTO, re-check at publish | Real Explore editions. Only 3 qualified in 7 days, so the window widened to 14 and the title honestly reads "Coming up", not "This week" |

## Findings from real data (action for you, not code)

1. **Explore mis-tags some events.** Pool meets (`Winter Blast 2026 (25m)`, `Lokakuun uinnit 2026 (25m)`, `SELECTIVO MUNDIAL 25 MTS`) and artistic swimming (`PANAMERICANO MASTER`) carry `discipline = open_water`. The engine holds them back with a title heuristic, but they are wrong in the catalogue itself.
2. **Some editions have no venue or country** (e.g. `Cruce de Bahía San Carlos 2026`, `SELECTIVO MUNDIAL 25 MTS`). They are excluded from social and are incomplete on Explore too.
3. **English Channel temperature conflict:** `crossings.qualifying_temp_limit_c = 16` but the page says CSA 15.5 C vs CS&PF 16 C. The post omits it. Worth reconciling in the DB.
4. **Broken photo URL:** `VENUE_MAP['tooting-bec-lido'].ogImage` returns 404, so that spot page's og:image/social card is broken today.
5. **Registration status is `unknown` for every future edition**, so no copy may say "open for registration".
6. **EO Lab** is not `live` and Get Stoked, FORM, TRIHARD and JAKED are `soon`: only Maurten, SiS, Blu Smooth, Magic5 and BlueSeventy UK qualify as approved today.

## Caveats

* Captions are **deterministic templates**, not AI output (no Anthropic key was available locally and it keeps every claim traceable). The AI rewrite step plugs into `api/caption-generate.js` later and must pass `ungroundedNumbers()`.
* Fonts load from Google Fonts at render time. Production rendering must bundle Bebas Neue and DM Sans (Vercel functions should not depend on a font CDN).
* Local Chrome was used; `@sparticuz/chromium` on Vercel is proven for PDFs here but not yet for this renderer.
* Not built (Stage C, needs your authorisation): Meta connection, scheduler/cron, publish + retry, notifications, performance reporting, applying the migration, the reserve-queue refill job.

## Unattended design (from the final product requirement, for Stage C)

Cadence is **Tue, Thu, Sat 10:00 SAST** (three posts a week, about 156 a year per platform), stored in settings, never hardcoded in the publisher.

```
cron (hourly, requireCronAuth)  ->  find posts SCHEDULED within the next slot
   -> re-validate at publish time (events re-checked against event_change_log; temperatures re-checked for freshness)
   -> still valid?  yes: publish.  no: swap in the best APPROVED/AUTO_ELIGIBLE reserve post and log why
   -> publish Facebook and Instagram as two separate attempts, each with its own idempotency key
   -> record fb_result / ig_result separately; retry only the failed platform, with backoff, never re-posting the one that succeeded
   -> failure after N retries: status FAILED + notification (Resend), schedule continues with the next slot
nightly job: refill the reserve queue to >= 6 validated evergreen posts; build the next 2 weeks of candidates by mix target
```

* **Review-required items never block the schedule:** they sit in PENDING_REVIEW and the selector simply picks another AUTO_ELIGIBLE item.
* **Manual posts** are `origin = 'manual'`: separate rows, they do not consume or move a scheduled slot unless you explicitly assign one.
* **Global pause** is `social_settings.paused`, shipped ON. Nothing posts until you turn it off.
* **Token handling:** a long-lived Page token stored as a Vercel env secret (never in the DB or browser), expiry checked daily, alert 14 days before expiry. Re-verify Meta's current requirements before Stage C.
* **Pilot first:** run with `paused = true` generating and validating for two weeks, then publish to a test Page/IG account, then enable approved categories only.

## Update: photography-first visuals (v2)

See [MEDIA_LIBRARY.md](MEDIA_LIBRARY.md). The six examples were regenerated with the media catalogue, deterministic image selection with rotation, three visual approaches (photography-led, map-led, product-led) and pixel-level quality checks. `social-poc/` now shows before (v1) and after (v2) side by side in the Caption Agent "Auto-post preview" tab.

## Update: publishing step built, dormant (Stage C)

Built and unit-tested; **nothing posts**: `social_settings.paused` ships TRUE, and without Meta credentials the cron only reports what it would do.

| Piece | File |
|---|---|
| Rules: pause, one post per run, publish-time re-check, reserve swap, per-platform idempotency/retry/backoff, FAILED + notify | [publisher.js](../../api/_lib/social/publisher.js) |
| Meta Graph client (Facebook Page + Instagram, single + carousel; token only in POST body, scrubbed from errors; `dry` mode) | [meta.js](../../api/_lib/social/meta.js) |
| Supabase REST store (public image URLs, idempotency claim) | [store.js](../../api/_lib/social/store.js) |
| Hourly cron (`0 * * * *`, `requireCronAuth`) | [api/cron/social-publish.js](../../api/cron/social-publish.js) |
| Operate the queue: status, list, enqueue, approve, reject, reserve, schedule, pause, resume | [scripts/social-queue.mjs](../../scripts/social-queue.mjs) |
| Tables + public `social-posts` bucket (generated images only) | [sql/applied/2026-10-18_social-publishing.sql](../../sql/applied/2026-10-18_social-publishing.sql) (once applied) |
| Tests (13) | [test/social-publish.test.js](../../test/social-publish.test.js) |

Flow: `render-social-poc.mjs` (local Chromium) -> `social-queue.mjs enqueue` (uploads slides to the public bucket, inserts rows: AUTO_ELIGIBLE -> APPROVED, REVIEW_REQUIRED -> PENDING_REVIEW) -> `approve`/`reserve` -> `schedule` (next Tue/Thu/Sat 10:00 SAST) -> cron publishes at the slot. Rendering stays off Vercel on purpose (Chromium on Vercel is unproven for this renderer, fonts must be bundled first).

**To go live (all yours, none done):** create a Meta app + Facebook Page linked to an Instagram Business account and pass app review; set `META_PAGE_ID`, `META_IG_USER_ID`, `META_PAGE_TOKEN` (and optionally `META_GRAPH_VERSION`) as Vercel env secrets; `meta.js` was checked against Meta's docs on 19 Oct 2026 (Graph v26.0; see its header for what is still unconfirmed: Facebook multi-photo `attached_media`, and the Instagram daily cap) - confirm both on a test Page; pilot on a test Page/IG account; then `node scripts/social-queue.mjs resume --confirm-live`. Token expiry monitoring is not built yet.

## Update: autopilot (weekly generator)

See [AUTOPILOT.md](AUTOPILOT.md): `scripts/social-autopilot.mjs`, `api/_lib/social/autopilot*.js`, `series.js`, bundled fonts, dormant `api/cron/social-generate.js`. Tests: `test/social-autopilot.test.js`.
