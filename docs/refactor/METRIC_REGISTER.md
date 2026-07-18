# Metric Register

Canonical source for cross-site statistics is `site-config.js` (loaded with
`site-sync.js`), documented in CLAUDE.md under "Site Sync". Pages that tag a
`data-sync="..."` element get the live value automatically. Pages that
**hand-type** a number instead are the drift risk this register exists to
catch. **No values were changed in this pass — evidence only, per instructions.**

## Canonical definitions (from `site-config.js` at time of this audit)

| Metric | Canonical mechanism | Notes |
|---|---|---|
| `countries` | `SITE_CONFIG.countries` array length + 1 (South Africa) | Also drives welcome.html's country pills/grid — adding one object updates count + visuals together |
| `spots` | `SITE_CONFIG.spots` (static number in site-config.js) | **Not live-DB-driven** — a hand-set number Dave updates manually in one place |
| `swimmers` | `SITE_CONFIG.swimmers` (static) *or* live-fetched, per the most recent commit on `main` ("Make spots/swimmers/tempsLogged live-fetched from Supabase, not static", 2026-07-18) | **Not independently re-verified in this pass which pages now use the live path vs the old static `site-config.js` value** — flagged as INVESTIGATE for a follow-up, since that commit landed the same day this audit started and its full page coverage wasn't traced here |
| `tempsLogged` | Same as `swimmers` — recently changed to live-fetch per the same commit | Same caveat |

## Confirmed hardcoded drift (pages NOT using `data-sync`)

| Value found | File | Context | Live in production? |
|---|---|---|---|
| `"90+"` spots | `welcome.html:16,30,1442,1454` (meta description, OG description, and two body stat blocks) | Hardcoded, not `data-sync` | **Yes — welcome.html is the live homepage (`/`)** |
| `"140+"` spots | `welcome-motion.html:873` | Hardcoded | **No — file is untracked, not committed, not deployed** |
| `"90+"` spots (again) | `welcome-motion.html:16,30,1416,1428` | Hardcoded, and internally inconsistent with the "140+" on the same file's hero (line 873) | **No — untracked/undeployed**, but flagging because if this file is ever committed as-is it ships with two different spot counts on one page |
| `"100+"` | `landing.html:865` | Hardcoded stat tile, ambiguous which metric | **Yes — `/landing` is a live route** |
| `"90+"` spots | `blog/may-update_9.html:139` and the untracked duplicate `blog/may-update_9 copy.html:139` | Hardcoded, in an email/blog template | Email template — not a live web route, lower priority |
| `"603 swimmers, 12 countries"` | `content-calendar.html:168-169` | A **planned social post's draft copy**, not a live site statistic | Internal planning tool only — not user-facing, low priority, but worth noting the number doesn't match `welcome.html`'s "90+ spots" framing at all (different metric, but shows nobody is cross-checking numbers between planning docs and the live site) |
| `"637-member"` / `"637 adult members"` | `caption-agent.html:1126,1143,1286` | DUC club member count, hardcoded in AI-prompt context strings for caption generation | Not a site-displayed statistic — an internal tool's prompt data. CLAUDE.md documents DUC as "~637 adult members" so this appears to be a deliberately-set business fact, not accidental drift — **no action needed, included for completeness per the audit's search-term list** |

## Numbers NOT found as-specified in the audit's search list

The original audit's exact-match list (`185`, `600+`, `1,509`, `1,510`,
`2,400+`, `8+ countries`, `13 countries`) did not turn up as literal strings in
any live page — a broad regex sweep for these initially matched hundreds of
false positives (CSS `rgba(16,185,129,...)` color values contain "185"; this
was manually filtered out). **This part of the audit could not be confirmed
against the current repository and should be treated as disproven unless a
narrower source is provided** (e.g. a specific page URL where one of these was
seen).

## Known inconsistency mechanism (documented in CLAUDE.md, still live risk)

CLAUDE.md's own "Site Sync" section already documents a prior real incident:
a hand-written country list on `welcome.html` silently fell to 7 of 12
countries because a manual list wasn't updated when a country was added
elsewhere. The `data-sync` mechanism exists specifically to prevent this class
of bug — the "90+ spots" and "100+" hardcodes above are exactly that same
class of bug recurring on the numeric side (spots/swimmers) rather than the
list side (countries).

## Proposed canonical definition (not implemented — for Phase 2 discussion)

Every user-facing count (`countries`, `spots`, `swimmers`, `tempsLogged`)
should render via `data-sync` with no exceptions, and `welcome.html`,
`landing.html`, and any future `welcome-motion.html` should be brought in line
in one pass together (not one at a time) so they can't drift from each other
again. This is a **product statistics fix, explicitly out of scope for this
phase** per your constraint "do not change public statistics" — documenting
the evidence only.
