# Route Register

Built by reading `vercel.json` (source of truth for routing), every top-level
`*.html` file, `robots.txt`, `sitemap.xml`/`api/sitemap-dynamic.js`, and `sw.js`.
Verified against live production (`https://www.swimloading.com`) via direct
HTTP checks on 2026-07-18 where noted.

Action legend: `KEEP_PUBLIC` / `KEEP_AUTHENTICATED` / `KEEP_ADMIN_ONLY` /
`REDIRECT` / `RETIRE` / `INVESTIGATE`.

## Public marketing / product pages

| URL | Source file | Public/Internal | Auth | Sitemap | Action |
|---|---|---|---|---|---|
| `/` | `welcome.html` | Public | None | Yes | KEEP_PUBLIC |
| `/pricing` | `pricing.html` | Public | None | — | KEEP_PUBLIC |
| `/pricing-clubs-za`, `/pricing-clubs-uk`, `/pricing-clubs-aus`, `/pricing-clubs` | `pricing-clubs-za.html` (UK/AUS/bare alias to same file) | Public | None | — | KEEP_PUBLIC — verify UK/AUS aliasing to a ZA-named file is intentional (INVESTIGATE naming only) |
| `/landing` | `landing.html` | Public | None | — | KEEP_PUBLIC |
| `/campaign` | `campaign.html` | Public | None | — | KEEP_PUBLIC |
| `/pro` | `pro.html` | Public | None | — | KEEP_PUBLIC |
| `/intel` | `intel.html` | Public | None | — | KEEP_PUBLIC |
| `/italia` | `italia-race-day.html` | Public | None | — | KEEP_PUBLIC |
| `/join/:code` | `join.html` | Public | None | — | KEEP_PUBLIC |
| `/swimmers` | `swimmers.html` | Public | None | — | **INVESTIGATE — points to a different Supabase project (`dwetwxpkqfjwbgkbxgat.supabase.co`) than the other 51 pages (`szgkzuswelntnevobnoh.supabase.co`). Confirmed live (200), not confirmed whether data actually loads. See SECURITY_REGISTER.md §4.** |
| `/galas` (+`/galas/*`) | `galas.html` | Public | None | — | **INVESTIGATE — same issue: points to `ykcgbknreftuymhpfwxd.supabase.co`, not the canonical project. See SECURITY_REGISTER.md §4.** |
| `/uk-challenge` | `uk-challenge.html` | Public | None | — | KEEP_PUBLIC (updated this session with TRIHARD discount) |

## Crossing intelligence pages

| URL | Source file | Public/Internal | Auth | Action |
|---|---|---|---|---|
| `/robben` | `robben.html` | Public | None | KEEP_PUBLIC |
| `/ri` | `ri.html` | Public | None | KEEP_PUBLIC |
| `/big5` | *redirect only* | Public | None | REDIRECT → `/campaign` (301, confirmed in vercel.json) |
| `/preekstool`, `/capepoint`, `/dassen`, `/westangle` | matching `.html` | Public | None | KEEP_PUBLIC |
| `/crossings` | `crossings.html` | Public | None | KEEP_PUBLIC |
| `/crossings/north-channel`, `/false-bay`, `/catalina-channel`, `/rottnest-channel`, `/manhattan-island`, `/cook-strait`, `/molokai-channel`, `/strait-of-gibraltar`, `/jersey-to-france`, `/tsugaru-strait`, `/english-channel` | matching `.html` (11 total) | Public | None | KEEP_PUBLIC — matches "11 crossing pages" referenced in `dave.html` |
| `/english-channel/swim/*` | `api/channel-swim-handler.js` | Public (API-backed page render) | None | KEEP_PUBLIC |
| `/english-channel/(cost\|training-plan\|qualifying-swim\|pilots\|records\|relay\|jellyfish\|tide-windows\|famous-swims\|data-sources)` | `api/channel-content-handler.js` | Public | None | KEEP_PUBLIC |
| `/journeys/james-english-channel`, `/lindi-english-channel`, `/lynne-english-channel` | matching `journeys/*.html` | Public | None | KEEP_PUBLIC |
| `/crossing-prep` | `crossing-prep.html` | Public (personal-prep dashboard, gated by data not route) | Likely Supabase session client-side | KEEP_PUBLIC — **not deeply audited this pass**, revisit in a later security pass since it's linked as "Your Prep Dashboard" (personal data) |

## Club platform

| URL | Source file | Public/Internal | Auth | Action |
|---|---|---|---|---|
| `/duc-guide`, `/aquasharks-guide`, `/k8-coaching-guide` | matching `.html` | Public | None | KEEP_PUBLIC (marketing/onboarding guides) |
| `/aquasharks-swimmers`, `/k8-swimmers` | matching `.html` | Public | None | KEEP_PUBLIC |
| `/aquasharks-coach` | `aquasharks-coach.html` | Public | None | KEEP_PUBLIC (guide page, not the live coach tool) |
| `/coach-guide` | `coach-guide.html` | Public | None | KEEP_PUBLIC |
| `/club-admin` (+`/*`) | `club-admin.html` | Internal | Client-side Supabase auth + `club_admins` row expected | KEEP_ADMIN_ONLY — already in `robots.txt` Disallow. **Not deeply re-audited this pass** — CLAUDE.md documents this as the primary admin surface for 3 clubs; scope for a dedicated pass. |
| `/sets` (+`/*`) | `sets.html` | Internal | `getSession()`-based per CLAUDE.md | KEEP_ADMIN_ONLY — not re-audited this pass |
| `/coach` (+`/*`) | `coach.html` | Internal | Client-side auth | KEEP_ADMIN_ONLY — already in `robots.txt` Disallow |
| `/clubs` (+`/*`) | `clubs.html` | Public (club directory) | None | KEEP_PUBLIC |

## Partner pages

| URL | Source file | Action |
|---|---|---|
| `/partners/maurten`, `/sis`, `/blu-smooth`, `/eolab`, `/blueseventy`, `/form`, `/trihard` | matching `.html` | KEEP_PUBLIC |
| `/partners/themagic5` | redirect | REDIRECT → `/partners/magic5` (301, confirmed) |
| `/partners/magic5` | `magic5.html` | KEEP_PUBLIC |

## App / auth-required

| URL | Source file | Action |
|---|---|---|
| `/app` | `index.html` (+ `app*.js`) | KEEP_AUTHENTICATED — already `robots.txt` Disallow |
| `/countries(/*)`, `/spots(/*)` | `api/spots-handler.js` | KEEP_PUBLIC (SEO spot pages) |

## Internal / operational — HIGH RISK group (full detail in SECURITY_REGISTER.md)

| URL | Source file | Public/Internal | Auth (before this pass) | noindex (before) | robots.txt (before) | Sitemap | Action taken |
|---|---|---|---|---|---|---|---|
| `/dave` | `dave.html` | **Internal** | Client-side check against 1 hardcoded Supabase user ID (`DAVE_ID`) | No | No | No | Added `noindex`; added `robots.txt` Disallow. **Auth mechanism unchanged this pass.** |
| `/admin` | `admin.html` | **Internal** | `supabaseClient.auth.getUser()` (real server round-trip) + hardcoded `ADMIN_EMAIL` check | No | Yes (pre-existing) | No | Added `noindex`. **Auth mechanism unchanged.** |
| `/PHtest` | `PHtest.html` | **Internal** | Client-side check against 2 hardcoded Supabase user IDs (`DAVE_ID`, `CARINA_ID`) | No | No | No | Added `noindex`; added `robots.txt` Disallow. **Auth mechanism unchanged.** |
| `/growth-hub` | `growth-hub.html` | **Internal** | Real DB role lookup (`growth_founders` table by email) after Supabase auth — the *best-protected* internal page found | **Yes (pre-existing)** | No | No | Added `robots.txt` Disallow only (noindex already present). |
| `/content-calendar` | `content-calendar.html` | **Internal** | **None found — no auth of any kind** | No | No | No | Added `noindex`; added `robots.txt` Disallow. **Still has no authentication — content is a July 2026 social post calendar, not customer/financial data, but is not protected.** |
| `/caption-agent` | `caption-agent.html` | **Internal** | Client "password gate" UI (cosmetic) + real server-side password check in `api/caption-generate.js` (`process.env.CAPTION_PASSWORD`) gating the AI-generation action only | No | No | No | Added `noindex`; added `robots.txt` Disallow. **The page shell itself (UI, any static copy) is still publicly loadable — only the generate action is gated.** |
| `/Sponsors/` (+ `index.html`) | `Sponsors/index.html` | **Internal — was fully public** | **None** — confirmed live 200, full 91-brand commercial pipeline (contact strategy, prize values, Carina Brüwer targeting notes) hardcoded in a client-side JS array, readable via plain `curl` | No | No | No | **Blocked entirely at the routing layer (`vercel.json` → 404).** Content unchanged, not yet moved behind real auth. See DECISIONS.md. |

## Repo-root files confirmed publicly served (structural finding, not in original per-page list)

Confirmed live 200 before this pass, now blocked via a blanket `*.md` deny-route:

`CLAUDE.md`, `PARTNERS.md`, `GROWTH_HUB.md`, `MIGRATIONS.md`, `EXPANDING.md`,
`CLUB_ONBOARDING.md`, `14files/ONBOARDING_SQL.md` (and by the same pattern,
every other `.md` file in the repo — `CLUBS.md`, `DEVELOPER_GUIDE.md`,
`ROADMAP.md`, `TODO.md`). `README.md` and common config files (`package.json`,
`vercel.json`, `.env`) returned 404 — Vercel appears to exclude a small set of
reserved filenames from static serving, but does **not** exclude arbitrary
`.md`/`.html`/other content files by extension. This is a platform-level
static-serving behavior, not a per-page bug — see SECURITY_REGISTER.md §1 for
the full writeup and DECISIONS.md for the fix rationale.

## Orphan / legacy / non-routed files (present in repo, no vercel.json route)

| Path | Notes | Action |
|---|---|---|
| `archive/index.html`, `archive/swimloading_v2_FIXED*.html`, `archive/swimloading_v2_WORKING_NO_ONBOARDING.html` | Old full-app snapshots, no route points to them | INVESTIGATE — likely servable directly by path (same static-serving behavior as above) even with no vercel.json route; not yet checked live. Recommend a follow-up pass. |
| `Deploy_SwimLoading/index.html` | No route, unclear purpose/age | INVESTIGATE |
| `welcome-motion.html` | **Untracked** (not in git) — an in-progress variant of `welcome.html` with drifted hardcoded stats (see METRIC_REGISTER.md). Not deployed since it's not committed. | No action — flag for Dave: commit it deliberately or delete it, don't leave it in limbo |
| `index.html.bak`, `index.html.bak2` | Untracked backup files at repo root | INVESTIGATE — same static-serving exposure risk as the `.md` files if ever committed; currently safe only because they're untracked |
| `api/sitemap-dynamic.js.save` | Untracked stray editor-save file, meaningfully different (older) code than `api/sitemap-dynamic.js` | RETIRE (recommend deleting — untracked, not deployed, confusing to leave in the tree) — not deleted this pass per "don't touch unrelated files" |

## Cron endpoints (not page routes, but routed/scheduled — full detail in SECURITY_REGISTER.md §5)

| Path | Schedule | CRON_SECRET check before this pass | Action taken |
|---|---|---|---|
| `/api/cron/sensor-import` | hourly | Present but fail-open if unset | Hardened to fail-closed |
| `/api/cron/marine-temps` | every 3h | Present but fail-open if unset | Hardened to fail-closed |
| `/api/cron/purge-audit` | daily 3am UTC | **Absent entirely** — ran an unauthenticated service-role DELETE | Fixed — now fail-closed |
| `/api/cron/advance-challenge` | daily 22:00 UTC | Present but fail-open if unset | Hardened to fail-closed |

## Sitemap

`api/sitemap-dynamic.js` was checked for accidental inclusion of any internal
route — it does **not** reference `/dave`, `/admin`, `/PHtest`, `/growth-hub`,
`/content-calendar`, `/caption-agent`, or `/Sponsors` anywhere. It builds spot
URLs from the live `spots` table plus a static list of marketing/crossing
pages. **This part of the original audit's "sitemap inclusion" concern was
investigated and not confirmed** — no fix needed here.
