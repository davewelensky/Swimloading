# Decisions

Architectural and process decisions made during Phase 0 / early Phase 1, and
decisions explicitly deferred to Dave.

## 2026-07-19 continuation session

### D10 — `user_roles` design follows `is_club_manager()`, not a new pattern

**Decision:** `has_role()` is `STABLE SQL SECURITY DEFINER`, reads
`auth.uid()` internally, takes no user-id parameter from the caller — the
exact shape of the existing `is_club_manager(club_id)` function already
protecting `club_admins`. Writes go through `grant_role()`/`revoke_role()`
(`SECURITY DEFINER`, explicit self-grant rejection, requires caller already
hold `platform_admin`) rather than any direct table policy.

**Why:** consistency with a pattern already proven in this codebase, rather
than inventing a second convention. Also directly satisfies requirement 5
("prevent users from granting themselves roles") at the database level, not
just in a UI — even a direct API call to `grant_role()` with
`p_user_id = auth.uid()` raises an exception.

### D11 — Registry entries are keyed by unique `id`, not `path + method`

**Decision:** `scripts/lib/endpoint-registry.mjs` looks up entries by a
unique `id` string, not by `(path, method)`.

**Why:** building the registry's first draft, two entries for
`GET /api/cron/purge-audit` existed — one `AUTH_REJECTION` ("no auth
header"), one `DESTRUCTIVE` ("valid credential success path"). Both share
the same path and method. A `find by path+method` lookup silently returned
whichever was registered first (the safe one), meaning `classifyCall()`
would have reported the DESTRUCTIVE call as safe on production — the exact
bug class the registry exists to prevent, caught by its own unit test suite
(`scripts/test-endpoint-registry.mjs`) before it ever reached a script
capable of calling production. Keying by `id` makes every distinct *kind*
of call to a URL a genuinely distinct, independently-classified thing.

### D12 — `profiles` public-read RLS finding: documented, not fixed

**Decision:** found during TASK-10's RLS inspection (a `"Public profiles
are viewable by everyone"` policy with `qual: true`, no role restriction,
covering 645 users' names/phone/DOB/address/emergency contacts) but not
fixed in this pass.

**Why:** out of scope for "internal-tool access control" — this is a
different table, a different exposure vector (Supabase REST API directly,
not a web route), and pre-dates this entire refactor effort. Per the
existing constraint ("do not change RLS policies without documenting
existing and proposed behaviour"), a fix here deserves its own dedicated,
carefully-scoped pass — not a rider on an already-large session. Flagged at
the top of the final report specifically so it doesn't get lost in the
volume of this phase's other work.

### D13 — Sponsor CRM notes field: two-phase import, Phase B needs per-entry review

**Decision:** `sponsor_partners.notes` stays `NULL` for all 91 rows in the
first (Phase A) import; only populated in a later, separately-approved
Phase B.

**Why:** sampled `Sponsors/index.html` note strings mix pure sourcing facts
("SA distributor: Fluidlines, Greenpoint + Somerset West") with strategic
commentary ("Approach Fluidlines as the wholesale intro, not Orca
directly") and content tied to Carina Brüwer's personal sponsor search.
Requirement 6/8 say not to migrate this blindly — splitting the import into
two phases makes "blindly" structurally impossible: Phase A literally
cannot include notes because the column is left out of that phase's insert
statement, not just policy-excluded.

## Decided and implemented

### D1 — Contain the repo-wide static-file exposure via routing block, not file moves

**Decision:** Block `*.md` and `/Sponsors/*` at the `vercel.json` routing
layer (404) rather than moving files to a different repo path.

**Why:** Vercel's static serving exposes any committed file by its literal
path regardless of where in the repo it lives — moving `Sponsors/index.html`
to e.g. `internal/sponsor-pipeline.html` would just relocate the same public
exposure to a new URL, not fix it. A routing-layer block is the only
containment that actually works without building real server-side auth.

**Reversibility:** Fully reversible — delete the two route entries.

### D2 — Cron endpoints fail closed, always

**Decision:** All four cron handlers now return 500 if `CRON_SECRET` isn't
set in the environment, rather than skipping the check (previous behavior on
3 of 4 endpoints) or having no check at all (`purge-audit.js`).

**Why:** Your spec explicitly required rejecting a *missing* secret, not just
an invalid one. Fail-open on a missing env var is exactly the kind of
silent, easy-to-reintroduce hole this phase exists to close.

**Consequence you need to act on:** If `CRON_SECRET` is not actually set in
Vercel's production environment, all four crons will stop running (fail
closed with 500) the moment this deploys, instead of silently running
unauthenticated. Confirm the env var is set before/immediately after merging.

### D3 — noindex is defense-in-depth only, applied everywhere it was missing

**Decision:** Added `noindex,nofollow` + `robots.txt` entries to every
internal page that lacked them, regardless of how strong or weak that page's
actual auth is.

**Why:** Cheap, safe, reversible, and explicitly requested. Does not
substitute for real access control (documented in SECURITY_REGISTER.md §4) —
applied alongside real fixes where they existed, and even where they didn't
(`content-calendar.html`), because "the page is unauthenticated" is a
separate, bigger problem this alone doesn't solve.

### D8 — Dual-layer static containment: `.vercelignore` + expanded `vercel.json` deny-routes, not one replacing the other

**Decision:** Keep both. Add `.vercelignore` (excludes `*.md`, `14files/`,
`sql/`, `scripts/`, `docs/`, `archive/`, `Deploy_SwimLoading/`, `Sponsors/`
from the deployment bundle entirely) as the structural fix you asked for
("prefer excluding non-runtime files from deployment rather than
maintaining an endless list of blocked URLs"), but also keep and expand the
`vercel.json` deny-routes covering the same paths.

**Why not just `.vercelignore` alone:** it could not be verified end-to-end
without a live deploy (no Vercel CLI/dashboard access in this session — see
Section 1 findings). If `.vercelignore` behaves differently than expected
for this project's "Other" framework preset (e.g. it excludes files from
static serving but not from being readable by some other path, or interacts
unexpectedly with the existing `routes` array), the `vercel.json` rules are
an independently-verified backstop — each one was checked against the
actual discovered exposure with the same regex logic that already caught
and fixed the `/CLAUDE.md/` trailing-slash bypass. Redundant protection here
costs nothing and removes a single point of failure on a fix this severe.

**Why not just `vercel.json` alone (the original approach):** it requires
enumerating every sensitive path by hand, which is exactly how TASK-01's
initial fix missed `sql/`, `scripts/`, `14files/`, and `archive/` — those
weren't discovered until a full tracked-file inventory was run in this same
session. `.vercelignore` protects by *pattern of directory*, so a new file
added later under an already-covered directory (e.g. a new `sql/applied/*`
migration) is automatically safe without a corresponding `vercel.json` edit.

**Reversibility:** Fully reversible — delete `.vercelignore` and/or revert
the `vercel.json` additions independently of each other.

### D9 — Process lesson from INCIDENT #2: destructive-path smoke testing must be sequenced after deploy, not before

**What happened:** Even with the rewritten, classification-based smoke test
(TASK-09), running the cron section against `--target=production` **before**
this branch was merged/deployed caused three more real, unauthenticated
`purge-audit` executions — because `AUTH_REJECTION_TEST` classification only
guarantees safety if the target already has the fix live. Testing "does this
correctly reject" against something that doesn't yet reject anything is not
a safe operation, no matter how the request itself is labeled.

**Decision:** The smoke test's cron section is only to be run against
`--target=production` **after** a deploy that includes the `_auth.js` fix.
Section 1's "verify vercel.json rules" checks (plain `curl`/`GET` on
non-mutating paths) remain safe to run pre-deploy at any time — the danger
is specific to endpoints that are *currently* unauthenticated, not to
production testing in general. This is now stated explicitly at the top of
`scripts/smoke-test-production.mjs` and in `docs/refactor/SMOKE_TESTS.md`.

## Decided: explicitly NOT implemented this pass (deferred to you)

### D4 — Shared admin/internal-page role mechanism

**Options observed in the existing codebase:**
- `growth_founders` table (email-keyed) — already real, already working for `growth-hub.html`
- Hardcoded single-email check (`admin.html`)
- Hardcoded user-ID allow-lists (`dave.html`, `PHtest.html`)
- Server-side shared-password check (`caption-agent.html`'s generate action)
- Nothing (`content-calendar.html`)

**Why not decided unilaterally:** Your instructions are explicit — a
hardcoded admin allow-list is only acceptable "if there is no existing role
mechanism, and you stop for approval first." One already exists
(`growth_founders`). Extending it (or designing a proper `is_admin`/role
column) to cover the other five pages is a real design decision — table
shape, whether `growth_founders` is even the right table conceptually for a
"platform ops admin" role vs. a "growth/marketing founder" role, and how it
interacts with RLS — that deserves your input, not a unilateral choice
buried in a routing pass.

**What this means in practice right now:** the five weakest pages
(`dave.html`, `admin.html`, `PHtest.html`, `caption-agent.html`,
`content-calendar.html`) are exactly as authenticated (or unauthenticated) as
they were before this pass — only their discoverability (noindex, robots.txt)
changed. **`content-calendar.html` in particular still has zero
authentication and is only protected by the `.md`-and-Sponsors-style
"nobody's found the URL yet" — it was not in the `.md`/`Sponsors` block
because it's an `.html` route.**

### D5 — `Sponsors/index.html` real remediation (Option A vs B)

**What was done:** Option B partial (routing block; data preserved,
unchanged).

**What's deferred:** A full Option A (server-side authenticated admin route)
rebuild. This depends on D4 being resolved first (there needs to be a role
mechanism to gate it with), and rebuilding a 754-line page's data layer
(moving the hardcoded `BRANDS` array to a real Supabase table with RLS, so
notes/status/contacted-state persist server-side instead of only in the
current page's local state) is real, non-trivial work — explicitly out of
scope for "small reversible changes."

### D6 — Git remote / deploy-source ambiguity

**Not resolved.** Two remotes exist (`origin` = `davewelensky/Swimloading`,
`vercel-repo` = `DaveW4153/SwimLoading`). Treated `origin/main` as canonical
based on CLAUDE.md documentation and observed behavior (a same-session push
to `origin/main` for an unrelated change went live), but this was not
independently confirmed against the Vercel project's actual Git integration
settings (no Vercel CLI/dashboard access available in this session). Flagging
as a "duplicated configuration" item for you to confirm directly in the
Vercel dashboard (Project → Settings → Git).

### D7 — RLS review

**Not performed.** Whether Supabase RLS independently protects the data
behind `admin.html`/`growth-hub.html`/etc. (in case the client-side JS gate
is bypassed) was not audited. Per your explicit constraint ("do not change
RLS policies without documenting existing and proposed behaviour"), and since
this pass didn't even get as far as *reading* existing RLS policies, no
proposal is made here — this is a gap to close in a follow-up pass, not a
decision.
