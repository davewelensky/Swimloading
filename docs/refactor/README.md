# SwimLoading v2 Platform Refactor — Phase 0/1 Baseline

## Objective

Establish a verified production baseline, a complete route/metric inventory, and
close the most serious public-access and security risks — without redesigning
the app, adding features, or performing large architectural refactors.

This directory is the working record for that effort. Update it as work
continues in later phases.

## Baseline snapshot (recorded before any code change)

- **Repo:** `davewelensky/SwimLoading` (local path `/Users/davewelensky/SwimLoading`)
- **Branch at start:** `main`
- **HEAD at start:** `d8f706b3d3dbd810b06cb2afa7209db086a9f043` — "Make spots/swimmers/tempsLogged live-fetched from Supabase, not static" (2026-07-18)
- **Working branch created:** `refactor/phase-0-production-baseline` (off the above commit)
- **Uncommitted changes present at start:** `PARTNERS.md` modified (tracked, from same-session partner work); a large number of untracked files (sponsor asset images, CSVs, JSON exports, `.bak` files, scratch scripts, a `.dump` file, `welcome-motion.html`, `index.html.bak`/`.bak2`, `api/sitemap-dynamic.js.save`). None of these were touched, discarded, or committed by this work — see "Untracked files" below.
- **Two git remotes configured — now RESOLVED via GitHub API:**
  - `origin` → `https://github.com/davewelensky/Swimloading.git` — **confirmed the Vercel-connected repo.** `gh api repos/davewelensky/Swimloading/commits/<HEAD-sha>/status` returns a `"Vercel"` check, `state: "success"`, `"Deployment has completed"`, target URL `vercel.com/daves-projects-06dd6f95/swimloading/...` (matches `.vercel/project.json`'s `projectName: "swimloading"`). `gh api repos/davewelensky/Swimloading/deployments` confirms `environment: "Production"` on the same commit SHA as current `origin/main` HEAD.
  - `vercel-repo` → `https://github.com/DaveW4153/SwimLoading.git` — **confirmed NOT connected.** The same commit SHA queried against this repo returns `total_count: 0` for status checks — no Vercel integration posting to it. Likely a stale/leftover remote from earlier setup.
  - **Deploy target for this work: `origin/main`.** No longer a manual-check item.
- **Archive/legacy directories present (not touched):** `archive/` (4 old `swimloading_v2_*` HTML snapshots + an `index.html`), `14files/` (legal text + onboarding docs, one of which — `ONBOARDING_SQL.md` — is publicly fetchable, see SECURITY_REGISTER.md), `Deploy_SwimLoading/` (a single `index.html`, purpose unclear — flagged as INVESTIGATE in ROUTE_REGISTER.md).

## What changed in this pass (summary — full detail in CHANGELOG.md)

1. **`vercel.json`** — added two deny-routes: block all `*.md` files and all of `/Sponsors/*` (return 404). This closes a confirmed, live, unauthenticated public-data exposure (see SECURITY_REGISTER.md §1).
2. **`robots.txt`** — added `Disallow` entries for `/dave`, `/PHtest`, `/growth-hub`, `/content-calendar`, `/caption-agent`, `/Sponsors/`, `/*.md$`.
3. **Five internal HTML pages** — added `<meta name="robots" content="noindex,nofollow">` (`dave.html`, `admin.html`, `PHtest.html`, `caption-agent.html`, `content-calendar.html`; `growth-hub.html` already had it).
4. **Four cron endpoints** (`api/cron/*.js`) — added/hardened `CRON_SECRET` validation so every one now rejects requests with a missing *or* invalid secret before doing any privileged work. `purge-audit.js` previously had **no validation at all** and ran an unauthenticated service-role `DELETE` on every request — this was the most severe confirmed finding in Phase 1.

None of the above changes touch application logic, branding, challenge calculations, member onboarding, public statistics, RLS policies, or the admin-role model. All are additive/reversible.

## What was investigated but NOT changed (needs Dave's decision — see DECISIONS.md)

- **`Sponsors/index.html` itself** — access is now blocked at the routing layer (404), but the file still contains the full sponsor pipeline (91 brands, commercial notes, Carina Bruwer's advisor-memo targeting strategy) hardcoded in a client-side `BRANDS` array. It has not been rebuilt behind real authentication. The routing block is containment, not the permanent fix.
- **A shared admin/internal-page role mechanism** — `growth-hub.html` already has a real one (`growth_founders` table, looked up by email after Supabase auth). `admin.html` checks a single hardcoded `ADMIN_EMAIL`. `dave.html` and `PHtest.html` check hardcoded Supabase user IDs. `content-calendar.html` has no auth at all. Per your own constraint ("do not create a hardcoded admin email or user-ID allow list unless there is no existing role mechanism and you stop for approval first") — a mechanism *does* already exist (`growth_founders`) — so building something new needs your sign-off, not a unilateral decision by me.
- **Deleting `/Sponsors/`, changing RLS, changing the admin-role structure** — none of these were done; all are on your explicit pause list.

## Rollback

Everything in this pass is a single branch with small, isolated commits (see
CHANGELOG.md for exact file lists per change). To roll back entirely:

```bash
git checkout main
git branch -D refactor/phase-0-production-baseline   # local only, nothing pushed
```

If any individual commit on the branch has already been merged to `main` and
deployed, revert it specifically:

```bash
git revert <commit-sha>
git push origin main
```

Because every change here is additive (new routes, new meta tags, new auth
checks that fail closed), reverting any of them simply restores the prior
(less safe) behavior — no data is deleted or migrated by this pass.

## Production verification after deploy

See SMOKE_TESTS.md for the full checklist and `scripts/smoke-test-production.mjs`
for the executable version. At minimum, after merging + deploying, confirm:

- `https://www.swimloading.com/Sponsors/` → 404
- `https://www.swimloading.com/PARTNERS.md`, `/CLAUDE.md`, `/GROWTH_HUB.md`, `/MIGRATIONS.md`, `/EXPANDING.md`, `/CLUB_ONBOARDING.md` → all 404
- `https://www.swimloading.com/dave`, `/PHtest`, `/admin`, `/growth-hub`, `/content-calendar`, `/caption-agent` still load for authenticated users, still show `noindex` in page source
- `POST https://www.swimloading.com/api/cron/purge-audit` with no `Authorization` header → 401 (was previously: runs the delete)
