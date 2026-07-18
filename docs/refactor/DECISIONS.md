# Decisions

Architectural and process decisions made during Phase 0 / early Phase 1, and
decisions explicitly deferred to Dave.

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
