# /ship — the SwimLoading ship loop

Run the FULL ship loop. Dave invoking /ship (or saying "push") is his approval to commit and deploy the current work — but never report "done" until step 5 passes.

## Steps

1. **Summarise what's shipping.** `git status --porcelain` + a one-line-per-file summary of the changes. If there are unrelated or surprising modified files, stop and ask before including them.

2. **Bump cache-bust versions.** Run:
   ```
   bash scripts/ship.sh bump
   ```
   This bumps `?v=N` in every HTML file referencing a changed `.js`/`.css` file. Missing this bump is the #1 historical cause of "deployed but I don't see it". If it reports nothing to bump, that's fine (style.css, sw.js and /app have no-cache headers in vercel.json).

3. **Commit and push.** Stage the changed files BY NAME (never `git add -A` — this repo has stray data files, backups and secrets-adjacent exports at the root). Include any HTML files the bump touched, plus any applied SQL being filed into `sql/applied/`. Commit with a plain one-line message describing the change. Then `git push` (Vercel auto-deploys `main`).

4. **Verify live.** Run:
   ```
   bash scripts/ship.sh verify
   ```
   It polls the live routes (up to ~4 min) until every `?v=N` ref in local HTML is actually served. If a shipped change isn't captured by a version bump (e.g. HTML content change), additionally `curl` the live route and grep for a distinctive string from the change.

5. **Report.** Tell Dave: what deployed (one line), the exact URL(s) to look at, and that live verification passed. If verify reports STALE, say so honestly, check the Vercel dashboard link it prints, and do NOT tell Dave to hard-refresh as a first resort — stale output means the deploy or the bump failed, not his browser.

## Rules

- Never skip step 4. A successful `git push` is not evidence the change is live.
- If Dave says "still the same" after a ship: re-run `bash scripts/ship.sh verify`, then check for failed deployments — in that order.
- No emojis in commit messages or the report.
