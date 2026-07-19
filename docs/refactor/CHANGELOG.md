# Changelog — Phase 0 / Phase 1

## 2026-07-18 — Phase 0 baseline + first critical containment

Branch: `refactor/phase-0-production-baseline`, merged to `main` at commit
`668cce6` and deployed. Entries below (TASK-01 through TASK-09, both
incidents) are from that work.

---

## TASK-01 — Repo-wide `.md` and `/Sponsors/` public exposure

- **Problem:** Any committed file in the repo is publicly servable by literal
  path (no filesystem exclusions in `vercel.json`). Confirmed live:
  `CLAUDE.md`, `PARTNERS.md`, `GROWTH_HUB.md`, `MIGRATIONS.md`, `EXPANDING.md`,
  `CLUB_ONBOARDING.md`, `14files/ONBOARDING_SQL.md`, `Sponsors/index.html` —
  all HTTP 200, zero auth.
- **Evidence:** `curl -o /dev/null -w "%{http_code}" https://www.swimloading.com/CLAUDE.md` → `200` (and 7 more, see SECURITY_REGISTER.md §1). Confirmed no page references `/Sponsors/*` or fetches any `.md` at runtime (`grep` sweep, zero matches).
- **Files changed:** `vercel.json` (2 new routes added at the top of the `routes` array).
- **Database objects changed:** None.
- **Security impact:** Closes a live, unauthenticated, remotely-exploitable disclosure of internal architecture docs and the full sponsor commercial pipeline. No functional regression identified (verified no inbound references to blocked paths).
- **Test evidence:** `python3 -c "import json; json.load(open('vercel.json'))"` → valid JSON. Manual re-check pending deploy (see SMOKE_TESTS.md).
- **Rollback:** Remove the two added route objects from `vercel.json`.
- **Unresolved risk:** Any future `.md` or `/Sponsors/*` file added to the repo is now safe by default (same wildcard rule), but a *new* sensitive file placed anywhere else (e.g. a `.json`/`.csv` export) would NOT be covered by this rule. This is containment for the two confirmed vectors, not a general solution.

---

## TASK-02 — `Sponsors/index.html` sponsor CRM exposure

- **Problem:** 754-line page, hardcoded `BRANDS` array (91 brands) containing commercial strategy notes and Carina Brüwer's confidential advisor-memo targeting data, zero auth, zero noindex, live 200 in production.
- **Evidence:** `Sponsors/index.html:416-520+`; live `curl` confirmed 200 before fix.
- **Files changed:** None directly (covered by TASK-01's routing block). File content untouched.
- **Database objects changed:** None.
- **Security impact:** Public access removed. Underlying auth model still absent — see DECISIONS.md D5.
- **Test evidence:** Same as TASK-01 (shared fix).
- **Rollback:** Same as TASK-01.
- **Unresolved risk:** Real authenticated implementation still pending — this is containment, not remediation. See DECISIONS.md D5.

---

## TASK-03 — Missing `noindex` on 5 internal pages

- **Problem:** `dave.html`, `admin.html`, `PHtest.html`, `caption-agent.html`, `content-calendar.html` had no `<meta name="robots" content="noindex,nofollow">`. `growth-hub.html` already had it.
- **Evidence:** `grep -n robots` on each file's `<head>` before the fix returned no match for the 5 listed; matched for `growth-hub.html`.
- **Files changed:** `dave.html`, `admin.html`, `PHtest.html`, `caption-agent.html`, `content-calendar.html` (one line each, in `<head>`).
- **Database objects changed:** None.
- **Security impact:** Defense-in-depth only — does not gate access, only discourages search-engine indexing. Explicitly documented as such per your instructions.
- **Test evidence:** Post-edit `grep -n "noindex"` confirms the tag present on all 6 pages (5 new + growth-hub pre-existing).
- **Rollback:** Remove the added `<meta>` line from each file.
- **Unresolved risk:** None introduced. Underlying auth gaps unchanged — see TASK-05/DECISIONS D4.

---

## TASK-04 — `robots.txt` gaps

- **Problem:** `robots.txt` disallowed `/app`, `/api/`, `/admin`, `/coach`, `/club-admin` but not `/dave`, `/PHtest`, `/growth-hub`, `/content-calendar`, `/caption-agent`, `/Sponsors/`.
- **Files changed:** `robots.txt`.
- **Security impact:** Defense-in-depth only, same caveat as TASK-03.
- **Test evidence:** Manual diff review; file is valid robots.txt syntax (plain Disallow lines).
- **Rollback:** Remove the added `Disallow` lines.
- **Unresolved risk:** None introduced.

---

## TASK-05 — Unauthenticated destructive cron endpoint (`purge-audit.js`)

- **Problem:** `api/cron/purge-audit.js` had no `CRON_SECRET` validation at all. Any unauthenticated request triggered a service-role `DELETE` against `activity_audit`.
- **Evidence:** `grep -n CRON_SECRET api/cron/purge-audit.js` → no match, before fix. Full file read confirmed the handler ran the delete unconditionally.
- **Files changed:** `api/cron/purge-audit.js`.
- **Database objects changed:** None directly by this change (the change *prevents* unauthorized deletes; it does not touch data itself).
- **Security impact:** Closes a live, remotely-triggerable, unauthenticated destructive operation using the service-role key.
- **Test evidence:** `node --check api/cron/purge-audit.js` → OK (syntax valid). Behavioral test script in SMOKE_TESTS.md (not run against production this pass — would require live `CRON_SECRET`, and the instructions explicitly prohibit running destructive cron operations during testing).
- **Rollback:** Revert to the previous handler body (remove the auth block).
- **Unresolved risk:** **Must confirm `CRON_SECRET` is actually set in Vercel's production environment before/after merge** — if unset, this cron (and the other 3, per TASK-06) will now fail closed (500) instead of running. This is correct behavior but is an operational dependency you need to verify.

---

## TASK-06 — Cron endpoints fail-open on missing `CRON_SECRET`

- **Problem:** `sensor-import.js`, `marine-temps.js`, `advance-challenge.js` all validated the secret correctly *if set*, but skipped validation entirely if `CRON_SECRET` was unset in the environment (fail-open).
- **Evidence:** Each file's auth block was `if (cronSecret) { ...check... }` with no `else` — read directly from source before the fix.
- **Files changed:** `api/cron/sensor-import.js`, `api/cron/marine-temps.js`, `api/cron/advance-challenge.js`.
- **Database objects changed:** None.
- **Security impact:** Closes a latent hole that would only manifest if the env var were ever accidentally unset — but your spec explicitly required rejecting a missing secret, not just an invalid one, so this brings all 4 cron endpoints to the same standard.
- **Test evidence:** `node --check` on all 3 files → OK.
- **Rollback:** Revert each file's auth block to the previous `if (cronSecret) {...}` form.
- **Unresolved risk:** Same operational dependency as TASK-05 — confirm `CRON_SECRET` is set in production.

---

---

## TASK-07 — Expanded static-file containment (sql/, scripts/, docs/, 14files/, archive/, Deploy_SwimLoading/) + .vercelignore

- **Problem:** The original `.md` + `/Sponsors/` block (TASK-01) was not the full picture. A full tracked-file inventory plus live checks found **over 100 SQL migration/RLS/schema files** (`sql/applied/*.sql`, `sql/debug/*.sql`, `sql/MIGRATION_TEMPLATE.sql`), operational scripts (`scripts/ship.sh`, `scripts/import_swim_sets.py`), orphaned legal-doc drafts and an onboarding SQL guide (`14files/*`), and legacy app snapshots (`archive/*.html`, `Deploy_SwimLoading/index.html`) all live and publicly fetchable — the same root cause as TASK-01 (Vercel serves any committed file by literal path), just not yet enumerated.
- **Also found:** the original `^/(.*)\.md$` rule had a real bypass — `/CLAUDE.md/` (trailing slash) still returned 200 in production, because the regex required the path to end exactly in `.md` with nothing after it.
- **Evidence:** `curl` sweep — `sql/applied/rls_policies.sql` → 200, `sql/debug/check_spots_and_view.sql` → 200, `scripts/ship.sh` → 200, `14files/liability-waiver.txt` → 200, `/CLAUDE.md/` → 200 (all before this fix). `git ls-tree -r --name-only HEAD` filtered to non-application extensions, to build the full inventory rather than guessing paths one at a time.
- **Files changed:** `vercel.json` (regex fixed to `^/(.*)\.md/?$`; six new deny-routes added: `/sql`, `/14files`, `/scripts`, `/docs`, `/archive`, `/Deploy_SwimLoading`). New file `.vercelignore` added as the structural fix — excludes the same paths from the deployment bundle entirely, per the instruction to prefer excluding non-runtime files over an endless deny-route list (see DECISIONS.md D8). Both mechanisms are kept together, not one replacing the other — see D8 for why.
- **Verified no functional impact:** `grep` confirmed no HTML page references `/sql/`, `/scripts/`, `/docs/`, `/14files/`, or `/archive/` in any `href`/`src`.
- **Database objects changed:** None.
- **Test evidence:** `vercel.json` re-validated as JSON; regex reasoning confirmed each new rule matches the discovered paths, including the bare-directory case (`/Sponsors` with no trailing slash, confirmed live to also serve `index.html`).
- **Rollback:** Remove the six new route objects and revert the `.md` regex; delete `.vercelignore`.
- **Unresolved risk:** This inventory pass was not exhaustive at the individual-file level — it covers every non-standard extension currently tracked, but a new sensitive file added later under a path *not* covered by `.vercelignore` (e.g. directly at repo root) would still be exposed. `.vercelignore` covers directories; anything sensitive committed loose at the repo root still needs a matching rule.

---

## TASK-08 — Shared cron auth helper, method rejection, local unit tests

- **Problem:** Each of the four cron files duplicated near-identical auth logic (already fixed individually in TASK-05/06), and none rejected non-`GET` requests — Vercel Cron always invokes with `GET`, so any other method reaching a cron handler is definitionally not a legitimate scheduled invocation.
- **Files changed:** New `api/cron/_auth.js` (shared `requireCronAuth(req, res, label)` — validates method, then secret-configured, then credential, in that order, before any handler does privileged work). `api/cron/purge-audit.js`, `sensor-import.js`, `marine-temps.js`, `advance-challenge.js` — all four now call the shared helper as the first line of the handler instead of inline duplicated checks.
- **Database objects changed:** None.
- **Security impact:** Removes duplicated logic (one place to get the auth check right, not four), adds method rejection (405) that didn't exist before on any of the four endpoints.
- **No secret/service-key/header logging:** confirmed by reading `_auth.js` — only generic strings are ever passed to `console.error`.
- **Test evidence:** New `scripts/test-cron-auth.mjs` — local, in-process unit test of `requireCronAuth()` in isolation (mock `req`/`res`, manipulated `process.env.CRON_SECRET`). Never imports the actual cron handlers, never makes a network call. Covers: missing secret configuration, missing request credential, invalid request credential, unsupported method (×2: DELETE and POST), valid credential in a local test environment. `node scripts/test-cron-auth.mjs` → 6/6 passed.
- **Rollback:** Revert each cron file's auth block to its TASK-05/06 inline form; delete `api/cron/_auth.js`.
- **Unresolved risk:** None introduced. `_auth.js` is excluded from public deployment by the same `/scripts`... actually note: `_auth.js` lives under `api/cron/`, not `scripts/` — it is a server-side function module, not a static asset, so it is not directly fetchable by URL regardless (Vercel only exposes `api/*` files as invokable functions at their route, and `_auth.js` has no corresponding `vercel.json` route or file-based route mapping to it). Confirmed by design, not by live test (would require a deploy to verify empirically — flagged for post-deploy spot check).

---

## TASK-09 — Smoke test safety rewrite

- **Problem:** See INCIDENT above (original version). The smoke test had no concept of endpoint risk classification and assumed any `GET` request was inherently safe.
- **Files changed:** `scripts/smoke-test-production.mjs` — full rewrite. Adds `--target=local|preview|production` (required, validated), `--allow-destructive` (only honoured on `local`/`preview`; combining it with `--target=production` aborts immediately, before any request is sent). Every request is now classified before sending: `READ_ONLY` (safe anywhere), `AUTH_REJECTION_TEST` (only ever sends missing/invalid credentials or a disallowed method to a sensitive endpoint, and treats an unexpected 200 as a CRITICAL failure rather than a normal assertion failure), or the success path (never implemented for `/api/cron/purge-audit` at all, on any target, under any flag — hard-excluded per explicit instruction).
- **Bug found and fixed during this same task:** the destructive-path keyword pattern (`purge|delete|archive|...`) initially matched `/archive/index.html` as a false positive (the word "archive" appearing in a static content path, not an API endpoint) — the script correctly refused to proceed rather than silently misclassify, which is exactly the fail-safe behavior intended, but the pattern needed scoping to `/api/` paths only. Fixed and re-verified.
- **Database objects changed:** None.
- **Test evidence:** Ran locally with bad `--target` and `--allow-destructive --target=production` — both aborted correctly, exit code 1, zero requests sent. See INCIDENT #2 below for what happened when the (correctly classified, but pre-deploy) `AUTH_REJECTION_TEST` calls were run against still-vulnerable production.
- **Rollback:** Revert to the pre-rewrite version (git history).
- **Documented in:** this file and `docs/refactor/SMOKE_TESTS.md`.

---

## INCIDENT #1 — smoke test triggered a real unauthenticated purge-audit run against production

While validating `scripts/smoke-test-production.mjs` against
`https://www.swimloading.com` (before this branch's fix was deployed), the
script sent two unauthenticated `GET` requests to `/api/cron/purge-audit`
(once with no `Authorization` header, once with a deliberately wrong one) to
confirm the "before" state matched what SECURITY_REGISTER.md §5 documented.

`purge-audit.js` at that point had no auth check **and no HTTP method
check**, so both requests executed the real `DELETE` against
`activity_audit` in production. This directly violates the instruction "Do
not run destructive cron operations during testing" — the error was
assuming a bare `GET` was inherently safe without first confirming the
specific handler doesn't gate on method.

**Impact assessed immediately after, via `mcp__supabase-admin__execute_sql`:**
`activity_audit` currently holds 321 rows, oldest `2026-07-11 17:59:49 UTC`,
newest `2026-07-18 17:22:57 UTC`, **zero rows older than the 7-day cutoff**.
This is exactly the steady-state the daily 3am UTC cron is designed to
maintain — there is no evidence of abnormal data loss beyond rows that were
already past their normal 7-day retention window and would have been purged
within hours by the scheduled run regardless. No other table was touched;
the other three cron endpoints (`sensor-import`, `marine-temps`,
`advance-challenge`) correctly returned 401 both times and did not run.

**Corrective action:** stopped testing further destructive-capable endpoints
against live production. All subsequent verification for `purge-audit`
should happen only after this branch's fix is deployed (at which point an
unauthenticated request will correctly get a 401/500 and never reach the
delete).

---

## INCIDENT #2 — rewritten smoke test still hit unfixed production purge-audit

**2026-07-19, continuation session.** After rewriting
`scripts/smoke-test-production.mjs` with proper request classification
(`READ_ONLY` / `AUTH_REJECTION_TEST` / `DESTRUCTIVE_DO_NOT_CALL`, see
TASK-07), it was run against `--target=production` to validate the new
safety design end-to-end. The classification logic itself worked correctly —
no `DESTRUCTIVE_DO_NOT_CALL` request was ever sent — but the
`AUTH_REJECTION_TEST` calls to `/api/cron/purge-audit` (no-auth, wrong-auth,
wrong-method — three requests) were sent **before this branch's fix had been
merged and deployed**. Since the currently-live `purge-audit.js` still had no
auth or method check at that point, all three "rejection tests" instead
returned 200 and executed the real `DELETE` again.

**Root cause:** `AUTH_REJECTION_TEST` classification only guarantees safety
*if the target already has the protection deployed* — it is not safe to run
against a target that is still running the vulnerable code, regardless of
how the request is classified client-side. This was a process error (running
full smoke tests against production pre-deploy) rather than a script-logic
bug — the script correctly detected and loudly flagged the unexpected 200s
(`CRITICAL: endpoint accepted an unauthorised/malformed request`) rather than
silently passing.

**Impact assessed immediately after, via `mcp__supabase-admin__execute_sql`:**
`activity_audit` now holds 322 rows, oldest `2026-07-12 07:21:28 UTC`, newest
`2026-07-19 06:44:39 UTC`, **zero rows older than the 7-day cutoff** — same
steady-state as INCIDENT #1, no evidence of abnormal loss.

**Corrective action:** `AUTH_REJECTION_TEST` smoke-test runs against
`--target=production` for the cron section must only happen **after** this
branch is merged and deployed (this is what Section 6 / "post-deployment
verification" in the task that authored this incident was already structured
to do — the mistake was running the full script pre-deploy instead of
sticking to the plain read-only 404 checks that Section 1 actually needed).
No further production requests were made to any cron endpoint after this was
caught.

---

## 2026-07-19 — Phase 1 continuation: role model design, Sponsor CRM design, investigations, test-framework hardening

Working directly on `main` per this session's instructions (no new branch —
everything below is investigation + proposals; nothing was applied or
merged that changes live behavior, except the test-tooling files which are
local-only scripts with no production effect until run).

### TASK-10 — Investigated current access-control mechanisms (prerequisite for Step 1)

- Queried `information_schema.columns` for `profiles`, `growth_founders`, `growth_sponsors`, `club_admins`. **New finding not in the prior session's register:** `profiles.is_admin` (boolean) exists — used in exactly 2 places (`app-nav.js`, `app.js`), both narrow (a UI toggle visibility check, and a "which admins get notified about new signups" query). Not used by any of the 5 internal tools. Too narrow (binary, no scope/resource) for the new model — documented, not migrated.
- Queried `pg_policies` for RLS on those same tables. **Found `club_admins`' `is_club_manager(club_id)` function** — a `STABLE SECURITY DEFINER` SQL function checking `auth.uid()` against `club_members`/`club_admins` for a specific resource ID. Used as the direct precedent for this session's `has_role()` design.
- **Also found (out of scope, flagged not fixed):** `profiles` has a `"Public profiles are viewable by everyone"` RLS policy with `qual: true` and no role restriction — meaning the `profiles` table (containing `full_name`, `phone`, `date_of_birth`, `address_line1/2`, `emergency_contact_name/phone`, `email`, `last_known_lat/lng` for 645 users) is readable by **anyone with the anon key, unauthenticated**, via a second, broader policy stacked on top of the already-broad `"Authenticated users can view profiles"` policy. This predates this session's work and is unrelated to internal-tool access control, but is severe enough to flag prominently — see "Items requiring Dave's decision" in the final report. **Not fixed — changing RLS requires the same pause-and-approve process as everything else in this phase, and this deserves its own dedicated, careful pass.**
- Re-confirmed the 5 weakest internal pages' current auth (unchanged from the prior session's findings, re-verified against current `main`).

### TASK-11 — Designed `user_roles` schema, `has_role()`/`grant_role()`/`revoke_role()` functions, RLS (Step 1)

- **File:** `sql/2026-07-19_create-user-roles.sql` — written from `sql/MIGRATION_TEMPLATE.sql` per the mandatory `MIGRATIONS.md` 7-step process. **Status: proposed, not applied.** Awaiting Dave's review and the literal word "apply."
- Generic table (`user_roles`: `id, user_id, role, scope, resource_id, granted_at, granted_by, revoked_at, metadata`), 7 roles, 5 scopes, exactly as specified. `has_role()` follows the `is_club_manager()` precedent. `grant_role()`/`revoke_role()` are the only writable surface (no direct INSERT/UPDATE/DELETE policy for any client role) — `grant_role()` explicitly rejects self-grants (`p_user_id = auth.uid()` → exception) and requires the caller already hold `platform_admin`.
- Does not touch, replace, or migrate `growth_founders`, `club_admins`, or `profiles.is_admin` — all three keep their current, working purpose.
- **Database objects changed: none yet — this is a file on disk, not an applied migration.**

### TASK-12 — Defined the initial access matrix (Step 2)

- **File:** `docs/refactor/ACCESS_MATRIX.md`. Covers all 6 pages named in the task (`/dave`, `/admin`, `/PHtest`, `/caption-agent`, `/content-calendar`, `/Sponsors/`, `/growth-hub`) with allowed roles, scope, mutability, direct-navigation status, unauthorised behavior, and audit requirement per page.
- Key decision: `/growth-hub` keeps its existing `growth_founders` mechanism (it already has real, working RLS) and only gains an *additional* `platform_admin` path — not a full migration. Documented why in the file itself.

### TASK-13 — Designed the Sponsor CRM schema + field classification + import plan (Step 4, schema only)

- **Files:** `sql/2026-07-19_create-sponsor-crm.sql` (schema — `sponsor_partners` + `sponsor_partner_audit` tables, an audit trigger that logs status/contact/value changes and creation automatically, RLS restricted to `platform_admin`/`partner_manager`, **no DELETE policy at all** — hard delete is structurally impossible via the API, only `archived_at`/`status='archived'`). **Status: proposed, not applied**, and depends on `user_roles` existing first.
- `docs/refactor/SPONSOR_CRM_PLAN.md` — field-by-field classification of the source `Sponsors/index.html` `BRANDS` array (operational / commercial-sensitive / personal-sensitive), and a two-phase import plan: Phase A (brand/category/tags/website/value/campaign-relevance — no personal data) then Phase B (the freeform `note` field, only after your explicit per-entry review, since sampled notes include strategic commentary tied to Carina Brüwer's personal sponsor search).
- **No sponsor data has been imported.** Confirmed `growth_sponsors` (9 rows, used by `growth-hub.html`, RLS-gated via `growth_founders` email lookup) is a separate, smaller, unrelated tool — not conflated with this new CRM.

### TASK-14 — Investigated `swimmers.html` and `galas.html` (Step 5)

- **File:** `docs/refactor/ROUTE_INVESTIGATION.md`.
- Confirmed via `curl` that both non-canonical Supabase project refs (`dwetwxpkqfjwbgkbxgat`, `ykcgbknreftuymhpfwxd`) are **unreachable** — DNS does not resolve, connection fails (exit code 6). Both projects are gone, not just misconfigured.
- `/swimmers`: degrades gracefully (the dead RPC call is wrapped in try/catch with an early return on non-OK), IS linked from the live homepage ("Meet all five swimmers"), no visible breakage. **Recommendation: KEEP** (static), clean up the dead fetch separately.
- `/galas`: the bare route shows a clean "No club specified" message (checked before any Supabase call), but a real `/galas/<slug>` would fail its club lookup against the dead project — not live-tested (a mutating tool, "no destructive production tests" constraint). Not linked from anywhere. `club-admin.html` already has an overlapping `hasGalaEntries` feature using the same table names. **Recommendation: RETIRE**, pending your confirmation that `club-admin.html`'s Entries tab covers what this page did.
- **Neither route was deleted, retired, or repointed** — recommendations only, per the explicit approval gate.

### TASK-15 — Verified legal document routes (Step 6)

- **File:** `docs/refactor/ROUTE_INVESTIGATION.md` (same file as above).
- Traced the onboarding consent flow (`index.html`'s Terms/Privacy/Waiver checkboxes → `openConsentModal()` → `app.js`'s hardcoded `consentDocuments` object) — confirmed the real, live legal text is inline in `app.js`, not fetched from any route.
- Confirmed `14files/liability-waiver.txt`, `14files/privacy-policy.txt`, `14files/terms-of-service.txt` are referenced **nowhere** in the app (full-repo grep, zero hits) — orphaned drafts.
- **Confirmed the prior session's `.vercelignore`/`vercel.json` block of `14files/` broke nothing** — nothing pointed to those paths before the block existed.
- Content diff between the drafts and `consentDocuments` not performed (out of scope — no legal content rewriting) — flagged as a quick manual check for Dave.

### TASK-16 — Hardened the test framework with a code-level, registry-based hard stop (Step 7)

- **Problem:** two prior incidents happened even with a classification-aware smoke test, because classification lived as inline logic in the script itself, keyed loosely by path+method.
- **Files:** new `scripts/lib/endpoint-registry.mjs` (every known endpoint call registered by a **unique id**, not path+method — TASK-16 specifically found and fixed a bug where two different-risk calls to the same URL, e.g. "no auth" vs. "valid credential", collided under a path+method key and the lookup silently returned the wrong, more-permissive entry). `classifyCall(id, {target, allowDestructive, confirmToken})` is the single hard stop: production requests to `MUTATING`/`DESTRUCTIVE` entries are refused in a code branch that never even reads `allowDestructive`; `purge-audit-success` is refused on every target unconditionally via a second, independent exclusion list; unregistered ids are refused, not assumed safe; preview/local destructive calls require `--allow-destructive` AND a preview/local target AND `--confirm-token=CONFIRM-DESTRUCTIVE-TEST` (exact literal), all three.
- New `scripts/test-endpoint-registry.mjs` — 126 local assertions, 0 network calls, proving the above (including "production refuses X even with every flag set to try to force it through").
- `scripts/smoke-test-production.mjs` rewritten to route every request through `classifyCall()` — no code path constructs an ad-hoc request outside the registry. Re-run against production post-rewrite: 55/55 passed, zero destructive calls attempted (structurally impossible given the code path — `main()` never calls a `DESTRUCTIVE`/`MUTATING` id at all).
- **No network call was made to any production mutation endpoint while building this** — all 126 registry-behavior assertions and the auth-helper's 6 assertions are pure in-process logic tests.

### TASK-17 — Vercel manual checklist (Step 8)

- **File:** `docs/refactor/VERCEL_MANUAL_CHECKLIST.md`. Production items (deploy source, branch, `CRON_SECRET`) confirmed via GitHub API / prior smoke-test evidence and marked verified. Preview/Development `CRON_SECRET`, cron execution history, `.vercelignore` isolation, and the dashboard rollback mechanism marked pending — genuinely require dashboard access this session doesn't have.

## Not yet done (see DECISIONS.md for why)

- Shared role mechanism for internal pages (D4) — schema designed (TASK-11), **not applied**, needs your sign-off + the literal word "apply."
- Real authenticated rebuild of `Sponsors/index.html` (D5) — schema designed (TASK-13), **no data imported**, needs your sign-off on both the migration and the two-phase import plan.
- Git remote / Vercel deploy-source confirmation (D6) — **RESOLVED** this session (see TASK-10-era investigation last session, confirmed again via `VERCEL_MANUAL_CHECKLIST.md`).
- RLS review of admin-page-backing tables (D7) — partially done as a side effect of TASK-10 (found the `profiles` public-read issue); a full table-by-table review is still not done.
- `swimmers.html` / `galas.html` investigation (SECURITY_REGISTER.md §9) — **RESOLVED** this session (TASK-14) — recommendations made (KEEP / RETIRE), neither route changed pending your approval.
- **NEW: `profiles` table publicly readable by unauthenticated users** (found in TASK-10) — not fixed, needs its own pass.
