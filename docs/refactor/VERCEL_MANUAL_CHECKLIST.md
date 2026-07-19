# Vercel Manual Checklist

This session has no Vercel CLI or dashboard access (no `vercel` binary
installed, no authenticated `plugin:vercel:vercel` MCP connector in this
environment). Everything below that can be resolved via GitHub's API or live
HTTP checks has been marked verified; everything that genuinely requires the
Vercel dashboard is marked pending, with the exact click-path to resolve it.

| Item | Status | How it was (or should be) confirmed |
|---|---|---|
| `CRON_SECRET` in **Production** | ✅ **Verified** | Indirect but solid: before this session's cron fix was deployed, 3 of 4 cron endpoints already had the "skip the check if unset" pattern and still returned 401 for both missing and wrong credentials — only possible if the env var is truthy in Production. Confirmed again post-deploy: all 4 endpoints return 401/405 as expected. |
| `CRON_SECRET` in **Preview** | ⏳ **Pending — dashboard only** | Vercel → Project `swimloading` → Settings → Environment Variables → filter to "Preview" → confirm `CRON_SECRET` is listed. If a preview deployment is ever smoke-tested with `--target=preview`, its cron endpoints need this set the same way. |
| `CRON_SECRET` in **Development** | ⏳ **Pending — dashboard only** | Same path, filter to "Development." Only matters if cron endpoints are ever run via `vercel dev` locally. |
| Project/repository connection | ✅ **Verified** | `gh api repos/davewelensky/Swimloading/commits/<sha>/status` returns a `"Vercel"` check (`state: success`, `Deployment has completed`), target URL `vercel.com/daves-projects-06dd6f95/swimloading/...`. The same SHA queried against `DaveW4153/SwimLoading` (the other remote) returns `total_count: 0` — no Vercel integration there. |
| Production branch | ✅ **Verified** | `gh api repos/davewelensky/Swimloading/deployments` shows `environment: "Production"` on the same commit SHA as `origin/main`'s HEAD at time of check — confirms `main` is the production branch. |
| Scheduled cron execution history | ⏳ **Pending — dashboard only** | Vercel → Project → Cron Jobs (or Deployments → Functions → cron routes) shows each job's last-run time and status. Worth checking after this session's fixes deploy, to confirm `purge-audit`/`sensor-import`/`marine-temps`/`advance-challenge` are still firing on schedule (they should be — the fixes only add auth checks, which Vercel's own cron invocations satisfy automatically via the injected `Authorization` header). |
| Preview deployment exclusions | ⏳ **Pending — dashboard only** | Confirm whether Preview deployments get the same `vercel.json` deny-routes and `.vercelignore` exclusions as Production (they should — both are part of the deployed build, not environment-specific config) — worth a spot-check on the next PR's preview URL rather than assuming. |
| `.vercelignore` behaviour | ⏳ **Partially verified, not fully** | Confirmed the *combination* of `.vercelignore` + the `vercel.json` deny-routes works (all exposure-sweep paths return 404 in Production). **Not independently isolated** — i.e., it wasn't verified that `.vercelignore` alone (without the `vercel.json` rules) would have been sufficient, since both shipped in the same commit. This is intentional per `docs/refactor/DECISIONS.md` D8 (redundant protection by design), but means if `vercel.json` were ever reverted alone, `.vercelignore`'s standalone behavior for this project's "Other" framework preset is unconfirmed. |
| Environment-specific Supabase variables | ⏳ **Pending — dashboard only** | Confirm `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` (and any `SUPABASE_SERVICE_ROLE_KEY` alias used by `advance-challenge.js`) are set consistently across Production/Preview/Development, and specifically that no environment accidentally points at either of the two non-canonical project refs found in `swimmers.html`/`galas.html` (`dwetwxpkqfjwbgkbxgat`, `ykcgbknreftuymhpfwxd` — both confirmed unreachable, see `docs/refactor/SECURITY_REGISTER.md` §9 and this session's investigation). |
| Rollback deployment procedure | ⏳ **Pending — dashboard confirmation of the mechanism; git-level procedure already documented** | Git-level: `git revert <commit(s)>` + `git push origin main` triggers a new Vercel deployment from the reverted state (standard git-based deploy flow). **Not confirmed:** whether Vercel's dashboard "Instant Rollback" (redeploying a specific prior deployment without a new git push) is enabled/available on this project's plan — if so, that's a faster rollback path worth knowing about before it's ever needed under pressure. Check Vercel → Project → Deployments → (three-dot menu on a prior successful deployment) → "Promote to Production". |

## Summary

**Production is fully verified** for everything this session needed
(deploy source, branch, `CRON_SECRET` presence). **Preview and Development
are pending** — nothing in this session depended on them being correct
(no preview deployment was tested against), but they should be checked
before anyone relies on `--target=preview` smoke tests, or before a preview
deployment is used for actual review/testing of cron behavior.
