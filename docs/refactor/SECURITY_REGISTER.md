# Security Register

Every finding below was reproduced against the current repository and, where
noted, against live production (`https://www.swimloading.com`) via direct HTTP
checks on 2026-07-18. Severity is my assessment, not the original audit's.

---

## §1 — CRITICAL (fixed this pass, containment only): Repo-wide static file exposure

**What:** Vercel's static file serving returns any committed file in the repo
by its literal path unless a route explicitly blocks it. `vercel.json` uses
the legacy `routes` array format and has no filesystem-serving exclusions.
This was not scoped to `/Sponsors/` — it is a platform-level behavior
affecting every file in the tree.

**Confirmed live before this pass (all HTTP 200, unauthenticated):**

- `https://www.swimloading.com/Sponsors/` → full sponsor pipeline (see §2)
- `https://www.swimloading.com/PARTNERS.md`
- `https://www.swimloading.com/CLAUDE.md`
- `https://www.swimloading.com/GROWTH_HUB.md`
- `https://www.swimloading.com/MIGRATIONS.md`
- `https://www.swimloading.com/EXPANDING.md`
- `https://www.swimloading.com/CLUB_ONBOARDING.md`
- `https://www.swimloading.com/14files/ONBOARDING_SQL.md`
- (by the same mechanism, every other `*.md` file in the repo: `CLUBS.md`, `DEVELOPER_GUIDE.md`, `ROADMAP.md`, `TODO.md`)

**Confirmed NOT exposed (404):** `README.md`, `package.json`, `vercel.json`,
`.env`, `.env.example`, `.gitignore`, `supabase/config.toml`. Note `sql/`
as a **bare directory listing** 404s (no directory index), but individual
files inside it do not — see §7, this was an incomplete read of the evidence
in the first pass of this register. `.gitattributes` (dotfile, no secrets)
does return 200 — the dotfile exclusion isn't consistent enough to rely on
either. Vercel appears to exclude a small set of conventional/reserved
filenames from static serving, but this is not a general protection — it
does not extend to arbitrary content files, directories, or most dotfiles.

**Why this matters:** `CLAUDE.md` alone documents internal architecture,
specific club UUIDs, a named user's Supabase user ID, business logic for
three clubs, and operational processes. `PARTNERS.md` (actively written to
this same session) contains commercial terms, discount codes, and personal
correspondence context (e.g. this session's TRIHARD/Funkita exchanges). None
of this was ever meant to be public.

**Fix applied (updated — see §7 for the full expanded version):** originally
two deny-routes; expanded to eight after a full tracked-file inventory found
this was not scoped correctly the first time, plus a trailing-slash bypass
of the original `.md` rule. Current rules, plus a `.vercelignore` structural
layer — see §7 and DECISIONS.md D8:
```json
{ "src": "^/(.*)\\.md/?$", "status": 404 },
{ "src": "^/Sponsors(/.*)?$", "status": 404 },
{ "src": "^/sql(/.*)?$", "status": 404 },
{ "src": "^/14files(/.*)?$", "status": 404 },
{ "src": "^/scripts(/.*)?$", "status": 404 },
{ "src": "^/docs(/.*)?$", "status": 404 },
{ "src": "^/archive(/.*)?$", "status": 404 },
{ "src": "^/Deploy_SwimLoading(/.*)?$", "status": 404 }
```
Verified: no page in the site links to or fetches any `.md` file at runtime
(`grep` for `fetch(...\.md` returned nothing), and nothing links to
`/Sponsors/*`, `/sql/*`, `/scripts/*`, `/docs/*`, `/14files/*`, or `/archive/*`
from any other page — so this block has no known functional blast radius.

**Not yet fixed:** This is containment (block the route), not remediation
(the confidential data still exists in the file). The .md-blocking approach
is a blanket sitewide rule, appropriate for internal docs. It does **not**
generalize to protecting *future* internal HTML tools the same way — each new
internal page still needs its own auth, as covered in §3.

**Still outstanding — not covered by the `.md` block:** any non-`.md`,
non-`/Sponsors/` internal file placed at a guessable path (e.g. a stray
`.json` export, a `.csv`) would be equally exposed if committed. `Sponsors/`'s
image assets (logos) are also blocked by the `/Sponsors(/.*)?$` rule even
though they aren't confidential — acceptable since nothing else references
them (confirmed above), but worth knowing if someone later wants to reuse a
sponsor logo from that path.

---

## §2 — CRITICAL (contained, not remediated): Sponsor CRM full exposure

**File:** `Sponsors/index.html` (754 lines)

**What was live:** Zero authentication, zero `noindex`, not in `robots.txt`.
The entire commercial pipeline — 91 brands — is a hardcoded JavaScript array
(`const BRANDS = [...]`, lines 416+) embedded directly in the static HTML:
brand names, prize/discount values in Rand, and **freeform strategy notes**
including sentences like *"Approach Fluidlines as the wholesale intro, not
Orca directly"* and the full unresearched "Carina Bruwer advisor memo"
targeting list (swimwear sponsor targets, Crossing Africa travel/hotel
targets, recovery/nutrition/skincare targets) added Jul 2026.

This is retrievable via a plain unauthenticated `curl` or `view-source` —
confirmed live 200 in production before this pass.

**Fix applied this pass:** Blocked at the routing layer (§1). The file and
its data are untouched and preserved in git history — nothing was deleted.

**Not fixed — needs your decision (see DECISIONS.md):** The page still has no
real authentication. Per your own Step 5.1 instructions, the two options are:
(A) rebuild behind a server-side authenticated admin route, or (B) leave it
out of the deployed web root pending that rebuild. This pass implemented the
routing-block version of (B). A proper (A) implementation is real, non-trivial
work (needs the shared access-control approach from §3 to exist first) and
was not attempted without your sign-off, per your explicit pause-before-delete
instruction and the scope limit on this phase ("do not perform large
architectural refactors yet").

**Data-loss risk of the fix:** None. `git log Sponsors/index.html` still has
full history; the file is unchanged, just no longer publicly routable.

---

## §3 — HIGH: No shared access-control mechanism for internal pages; inconsistent auth quality

Six internal pages were inspected. Their authentication is inconsistent in
both *mechanism* and *strength* — this is the "internal operations pages"
finding from the audit, confirmed:

| Page | Auth found | Real (server-verified) or client-trust only? | Authorization check |
|---|---|---|---|
| `growth-hub.html` | Supabase `auth.getUser()` (or Google OAuth) → DB lookup in `growth_founders` table by email | **Real** — role comes from a DB table, not from client-side JS | Row must exist in `growth_founders` |
| `admin.html` | Supabase `auth.getUser()` / `signInWithPassword()` | **Real** — `getUser()` round-trips to Supabase to validate the JWT | `user.email === ADMIN_EMAIL` (hardcoded single email, pre-existing) |
| `PHtest.html` | Supabase `auth.getSession()` / `signInWithPassword()` | Real auth, but... | `[DAVE_ID, CARINA_ID].includes(user.id)` — hardcoded 2-ID allow-list, pre-existing |
| `dave.html` | Supabase `auth.getSession()` only | Real auth, but... | `session.user.id === DAVE_ID` — hardcoded single-ID allow-list, pre-existing |
| `caption-agent.html` | Client-side "password gate" UI; **real check is server-side** in `api/caption-generate.js` (`password === process.env.CAPTION_PASSWORD`) | The generate *action* is properly gated server-side. The page shell itself is not gated at all. | Shared password, not per-user |
| `content-calendar.html` | **None found** | N/A | N/A — anyone who finds the URL sees the full internal content calendar |

**Key finding: a real role mechanism already exists** (`growth_founders`,
used by `growth-hub.html`) — it is simply not reused anywhere else. Per your
own constraint, this means building a *new* hardcoded allow-list anywhere
would be against your explicit rule ("do not create a hardcoded admin
email/user-ID allow list unless there is no existing role mechanism"). One
already exists. Extending `growth_founders` (or a similarly-shaped table) to
cover `dave.html`/`admin.html`/`PHtest.html`/`content-calendar.html`/
`caption-agent.html` is the consistent path — **not implemented this pass,
needs your sign-off since it touches the admin-role structure** (on your
explicit pause list).

**RLS caveat (not audited to completion):** Whether the *data* these pages
display is actually protected by Supabase RLS (in addition to the page-level
JS gate) was not verified table-by-table in this pass. `admin.html` and
`growth-hub.html` both run authenticated Supabase queries after their gate
passes — if RLS is permissive on the underlying tables, a signed-in-but-
unauthorized user (or a user who bypasses the client gate via devtools) could
still read data directly from Supabase. This needs a dedicated RLS review in
a later phase; flagging here so it isn't lost.

**Fix applied this pass:** `noindex,nofollow` added to all 5 pages missing it,
plus `robots.txt` Disallow entries (§4). This is explicitly **defense in
depth, not access control** — none of the underlying auth was rebuilt.

---

## §4 — MEDIUM: Search indexing gaps (now closed)

Before this pass: `growth-hub.html` was the only internal page with
`noindex`. `robots.txt` disallowed `/app`, `/api/`, `/admin`, `/coach`,
`/club-admin` but not `/dave`, `/PHtest`, `/growth-hub`, `/content-calendar`,
`/caption-agent`, or `/Sponsors/`.

**Fix applied:** `noindex,nofollow` added to `dave.html`, `admin.html`,
`PHtest.html`, `caption-agent.html`, `content-calendar.html`. `robots.txt`
updated with the missing `Disallow` lines plus `/*.md$`.

**Confirmed not a real risk on its own:** `api/sitemap-dynamic.js` does not
reference any of these internal routes — they were never in the sitemap. The
indexing gap was a smaller, secondary risk on top of the real problem
(§1–§3), included for completeness since it was explicitly requested.

---

## §5 — CRITICAL (fixed this pass): Unauthenticated destructive cron endpoint

**File:** `api/cron/purge-audit.js`

**Before this pass:** No `CRON_SECRET` check of any kind. Any unauthenticated
`POST` (or `GET`) request to `/api/cron/purge-audit` would immediately run:

```
DELETE https://<supabase>/rest/v1/activity_audit?created_at=lt.<7-days-ago>
```

using the Supabase **service role key** (bypasses RLS). This is a real,
unauthenticated, remotely-triggerable destructive operation. Impact is
bounded (only rows older than 7 days, only one table, and it's an audit-log
table rather than user data) but it is still an open door — anyone who
guessed or found the path could trigger it repeatedly, and it establishes
that service-role-key operations were being exposed without any check.

**The other three cron endpoints** (`sensor-import.js`, `marine-temps.js`,
`advance-challenge.js`) already implemented `CRON_SECRET` validation
correctly in shape (`Authorization: Bearer <CRON_SECRET>` compared, 401 on
mismatch) but all three **failed open if `CRON_SECRET` was unset** in the
environment (`if (cronSecret) { check } ` — no `else`). Your spec explicitly
requires "reject missing secret," which none of the four satisfied before
this pass.

**Fix applied to all four (updated — now via a shared helper, see §8):**
every cron handler calls `requireCronAuth(req, res, label)` from
`api/cron/_auth.js` as its first line, before any other work — validates
method (GET only), then secret-configured, then credential, in that order.
No service-role key, secret, or raw header is ever logged — confirmed by
reading `_auth.js` and each handler's remaining error paths.

**`CRON_SECRET` presence in Production — now confirmed (indirectly), not
just assumed:** in this session's earlier smoke-test run against live
production (before the fix was deployed), `sensor-import`, `marine-temps`,
and `advance-challenge` — which already had the "skip check if unset"
pattern — all returned 401 for both a missing and a wrong `Authorization`
header. A 401 is only reachable if `process.env.CRON_SECRET` was truthy in
that environment; if it were unset, those three would have proceeded past
the `if (cronSecret)` block entirely. This confirms `CRON_SECRET` **is** set
in Vercel Production. **Preview and Development were not checked** — no way
to verify without dashboard/CLI access. See README.md prerequisite checks.

---

## §7 — CRITICAL (fixed this pass): Exposure was far broader than `.md` + `Sponsors/`

A full tracked-file inventory (`git ls-tree -r --name-only HEAD`, filtered to
non-application extensions) plus live re-verification found the original §1
fix significantly under-scoped:

| Confirmed live 200 (before this fix) | What it is |
|---|---|
| `sql/MIGRATION_TEMPLATE.sql` | Migration template |
| `sql/applied/rls_policies.sql`, `sql/applied/create_clubs_schema.sql`, and ~100 more `sql/applied/*.sql` | **Real applied migrations — actual RLS policy source and full DB schema DDL for the production database** |
| `sql/debug/check_spots_and_view.sql`, `sql/debug/check_view_definition.sql` | Debug queries |
| `scripts/ship.sh`, `scripts/import_swim_sets.py` | Operational/deploy scripts |
| `14files/ONBOARDING_SQL.md`, `14files/ONBOARDING_TEST_GUIDE.md` | Internal onboarding docs |
| `14files/liability-waiver.txt`, `14files/privacy-policy.txt`, `14files/terms-of-service.txt` | Legal doc drafts — **confirmed orphaned** (`grep` found zero references anywhere in the app; these are not the live ToS/privacy links users actually see) |
| `archive/index.html` + 4 more `archive/*.html` | Old full-app HTML snapshots |
| `Deploy_SwimLoading/index.html` | Unclear purpose, no route references it |

**Also found:** the original `^/(.*)\.md$` rule had a real bypass —
`/CLAUDE.md/` (trailing slash appended) still returned 200, because the
pathname didn't end in exactly `.md`. Fixed to `^/(.*)\.md/?$`.

**Bypass vectors checked and found NOT exploitable:** case variation
(filesystem is case-sensitive — `/claude.md` already 404'd before any fix),
URL-encoded trailing space, `/./CLAUDE.md` (normalized before routing,
same as bare path), alternate extensions (`.markdown`, no-extension — no
duplicate files exist), non-www host (307-redirects to www, same deployment
and rules apply after redirect), the `*.vercel.app` fallback domain (same
deployment/build output — confirmed `swimloading.vercel.app/CLAUDE.md` was
also live 200 pre-fix, so it is covered by the same fix, not a separate
bypass channel). **Not checked:** a genuine separate Preview deployment URL
(none was available to test against in this session).

**Fix applied:** See updated §1 fix block above — `vercel.json` expanded to
8 deny-routes, plus a new `.vercelignore` as the structural layer (excludes
these paths from the deployment bundle entirely, not just blocking the
route after the fact). See DECISIONS.md D8 for why both layers are kept.

**Not yet fixed / residual risk:** This was a full inventory of *currently
tracked, non-standard-extension* files, not a guarantee against everything
forever. A new sensitive file committed loose at the repo root (not inside
one of the now-excluded directories) would still need its own rule. The
`14files/*.txt` legal drafts are blocked along with everything else in that
directory — confirm with Dave whether the app's actual live ToS/privacy
pages (wherever they really are — not investigated in this pass) are
unaffected.

---

## §8 — Cron hardening: shared auth helper + method rejection

**Before this pass (post-§5 fix):** auth logic was duplicated near-identically
across all four cron files, and none rejected non-`GET` methods.

**Fix applied:** New `api/cron/_auth.js` exports `requireCronAuth(req, res,
label)`, called as the first line of all four handlers. Order of checks:
method (`GET` only, else 405) → secret configured (else 500) → credential
matches (else 401). This is a stricter ordering than before: previously a
non-GET request with a valid secret would have been accepted (no method
check existed at all); now it's rejected before the secret is even compared.

**Verification:** `scripts/test-cron-auth.mjs` — local unit test, 6/6
scenarios pass (missing secret config, missing credential, invalid
credential, unsupported method ×2, valid credential in a local test env).
Never touches Supabase or the real handlers.

---

## §9 — INVESTIGATE (not fixed, not confirmed as broken): Two pages on non-canonical Supabase projects

`swimmers.html` and `galas.html` each hardcode a different Supabase project
URL than the other 51 HTML/JS files in the repo:

- 51 files (including every cron job, `dave.html`, `growth-hub.html`, the
  main app) → `szgkzuswelntnevobnoh.supabase.co` (canonical)
- `swimmers.html` → `dwetwxpkqfjwbgkbxgat.supabase.co`
- `galas.html` → `ykcgbknreftuymhpfwxd.supabase.co`

Both routes (`/swimmers`, `/galas`) are live and public. Whether these
projects are simply old/decommissioned (meaning these pages silently show
empty/broken data) or are legitimately separate projects was **not
determined in this pass** — that requires either checking the Supabase
dashboard for those project refs, or loading the pages and observing network
errors, which was out of scope for a routing/security pass. Flagged as
INVESTIGATE for the next phase; not touched.

---

## Summary table

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Repo-wide static file exposure (`.md` + `Sponsors/`, later expanded) | Critical | Fixed (containment) |
| 2 | Sponsor CRM full exposure | Critical | Contained; real fix pending your decision |
| 3 | No shared internal-page role mechanism | High | Documented; not implemented, needs your sign-off |
| 4 | Missing noindex / robots.txt gaps | Medium | Fixed |
| 5 | Unauthenticated destructive cron endpoint | Critical | Fixed; `CRON_SECRET` confirmed set in Production |
| 6 | (renumbered, see 9) | | |
| 7 | Exposure broader than originally scoped (`sql/`, `scripts/`, `14files/`, `archive/`, `Deploy_SwimLoading/`) + `.md` trailing-slash bypass | Critical | Fixed (containment, dual-layer) |
| 8 | Cron auth duplicated + no method rejection | Medium | Fixed (shared helper) |
| 9 | Two pages on non-canonical Supabase projects | Unknown (needs investigation) | Not touched |
