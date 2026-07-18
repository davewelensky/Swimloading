# Smoke Tests

Executable script: `scripts/smoke-test-production.mjs`. Read-only — makes GET
requests only, sends no `Authorization` header on the cron checks (verifying
rejection), and never triggers a real cron run with a valid secret. Safe to
run against production at any time.

```bash
node scripts/smoke-test-production.mjs
# or against a preview deployment:
BASE_URL=https://your-preview-url.vercel.app node scripts/smoke-test-production.mjs
```

## What it checks

**Public routes — expect 200 (or an intentional 301):**
- `/`
- `/app`
- `/clubs`
- `/english-channel/qualifying-swim` (the closest confirmable public route to `/english-channel` — there is no bare `/english-channel` route in `vercel.json`; the real page is `/crossings/english-channel`)
- `/crossings/english-channel`

**Internal routes — expect the page to load (200, since auth is client-side) but:**
- Response body must contain `noindex` in a `<meta name="robots">` tag
- Response body must **not** contain any of a small set of confidential marker strings (sponsor brand names / pipeline-specific phrases) — a weak but useful regression check
- `/Sponsors/` and `/Sponsors/index.html` must return **404** (not 200 — this is the one internal route that should be fully blocked, not just noindexed)

**Repo docs — expect 404:**
- `/CLAUDE.md`, `/PARTNERS.md`, `/GROWTH_HUB.md`, `/MIGRATIONS.md`, `/EXPANDING.md`, `/CLUB_ONBOARDING.md`

**Sitemap:**
- `/sitemap.xml` must not contain `/dave`, `/admin`, `/PHtest`, `/growth-hub`, `/content-calendar`, `/caption-agent`, or `/Sponsors`

**Cron endpoints — expect 401 with no `Authorization` header, and 401 with a wrong one:**
- `/api/cron/purge-audit`
- `/api/cron/sensor-import`
- `/api/cron/marine-temps`
- `/api/cron/advance-challenge`

The script does **not** send a correct `CRON_SECRET` at any point — that would
actually run the jobs (including the audit purge). If you need to confirm the
*positive* case (a correct secret is accepted), do that manually with the
real production secret, understanding that it will actually execute the job.

## Manual checks (not scripted)

- Load `/dave`, `/admin`, `/PHtest`, `/growth-hub`, `/content-calendar`,
  `/caption-agent` in a **logged-out** browser and confirm each shows a
  login/access-denied state, not the protected content.
- View-source (not just rendered DOM) on `/content-calendar` specifically —
  it has no auth of any kind, so this is the one page where "does it load"
  and "is data exposed" are the same question. Confirm you're comfortable
  with what's currently visible there (a July 2026 social content calendar —
  not customer or financial data, but still internal).
- Confirm `CRON_SECRET` is set in Vercel → Project Settings → Environment
  Variables (Production) before relying on the cron fixes taking effect.

## Known-good baseline (recorded before this pass' fixes, for comparison)

| Check | Before | After (expected) |
|---|---|---|
| `GET /Sponsors/` | 200, full data | 404 |
| `GET /CLAUDE.md` | 200, full file | 404 |
| `GET /PARTNERS.md` | 200, full file | 404 |
| `POST /api/cron/purge-audit` (no auth header) | 200, deletes rows | 401 |
| `POST /api/cron/sensor-import` (no auth header, `CRON_SECRET` hypothetically unset) | 200, runs import | 500 (fails closed) |
| `/dave` page source | no `noindex` | `noindex` present |
