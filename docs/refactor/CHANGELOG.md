# Changelog — Phase 0 / Phase 1 (2026-07-18)

Branch: `refactor/phase-0-production-baseline`. All entries below are commits
on this branch, not yet merged to `main` — production is **unaffected** until
merge + deploy.

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

## INCIDENT — smoke test triggered a real unauthenticated purge-audit run against production

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

## Not yet done (see DECISIONS.md for why)

- Shared role mechanism for internal pages (D4) — needs your sign-off, touches admin-role structure.
- Real authenticated rebuild of `Sponsors/index.html` (D5) — needs D4 first.
- Git remote / Vercel deploy-source confirmation (D6) — needs you to check the Vercel dashboard directly.
- RLS review of admin-page-backing tables (D7) — not started.
- `swimmers.html` / `galas.html` non-canonical Supabase project investigation (SECURITY_REGISTER.md §6) — not started.
