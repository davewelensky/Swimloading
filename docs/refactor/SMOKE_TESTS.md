# Smoke Tests

Two scripts:

- **`scripts/test-cron-auth.mjs`** — local, in-process unit test of the
  shared cron auth helper (`api/cron/_auth.js`). No network calls, no
  Supabase, doesn't import the actual cron handlers. Safe anywhere, anytime,
  including with real production env vars loaded.
- **`scripts/smoke-test-production.mjs`** — HTTP-level smoke test against a
  real deployment (local/preview/production). Rewritten after two incidents
  (see below) to classify every request before sending it.

## ⚠️ Safety rule, read before running

**Never run the cron section of `smoke-test-production.mjs` against
`--target=production` before a deploy that includes the auth fix.** The
script classifies requests as `READ_ONLY`, `AUTH_REJECTION_TEST`, or a
(never-implemented-for-production) destructive success path — but
`AUTH_REJECTION_TEST` only stays safe if the target already rejects
unauthenticated requests. Testing "does this reject" against an endpoint
that currently accepts everything is not a safe operation, regardless of
how the request is labeled — this caused two real unauthenticated
`purge-audit` runs against production during this work (see
`docs/refactor/CHANGELOG.md`, INCIDENT #1 and #2).

Sequence:
1. Before deploy: only run the plain 404/exposure checks (Section 1 style —
   `curl` or the "Repo docs" / "Expanded exposure sweep" sections), never
   the cron section, against production.
2. Deploy the fix.
3. After deploy: the full script, including the cron section, is safe to
   run against `--target=production`.

## `scripts/test-cron-auth.mjs`

```bash
node scripts/test-cron-auth.mjs
```

Covers: missing secret configuration, missing request credential, invalid
request credential, unsupported method (DELETE and POST), valid credential
in a local test environment. All 6 assertions pass against the current
`api/cron/_auth.js`.

## `scripts/smoke-test-production.mjs`

```bash
node scripts/smoke-test-production.mjs --target=production
node scripts/smoke-test-production.mjs --target=preview --base=https://<preview>.vercel.app
node scripts/smoke-test-production.mjs --target=local --base=http://localhost:3000
node scripts/smoke-test-production.mjs --target=preview --allow-destructive   # opt-in, preview/local only
```

`--target` is required (defaults to `production` if omitted — be deliberate
about this). `--allow-destructive` combined with `--target=production`
aborts immediately, before any request is sent, exit code 1.

### Request classification

| Class | Meaning | Where it can run |
|---|---|---|
| `READ_ONLY` | GET on a non-mutating path (public pages, doc-exposure checks, sitemap) | Any target, anytime |
| `AUTH_REJECTION_TEST` | Missing/invalid credential or wrong method sent to a cron endpoint — the *only* acceptable response is 401/405/500. An unexpected 200 is flagged as **CRITICAL**, not a normal failed assertion. | Any target, **but only once the target's fix is deployed** — see safety rule above |
| destructive success path | A valid-credential call to a mutating endpoint | Never implemented for `/api/cron/purge-audit` at all, on any target, under any flag. For the other three cron endpoints, this script does not send such a call even under `--allow-destructive` — it prints a `SKIP` line explaining that you'd need to call it manually with the real secret if you specifically need to verify the success path on local/preview. |

### What it checks

- Public routes (`/`, `/app`, `/clubs`, `/crossings/english-channel`) → 200/301
- Repo docs (`/CLAUDE.md`, `/PARTNERS.md`, `/GROWTH_HUB.md`, `/MIGRATIONS.md`, `/EXPANDING.md`, `/CLUB_ONBOARDING.md`) → 404
- Expanded exposure sweep (`/Sponsors/`, `/sql/*`, `/scripts/*`, `/docs/*`, `/14files/*`, `/archive/*`, `/Deploy_SwimLoading/*`) → 404
- Trailing-slash bypass on the `.md` block (`/CLAUDE.md/`) → 404
- Internal pages (`/dave`, `/admin`, `/PHtest`, `/growth-hub`, `/content-calendar`, `/caption-agent`) → 200 + `noindex` present in the response body
- Sitemap excludes all internal routes
- All four cron endpoints reject missing credential, wrong credential, and wrong method

## Manual checks (not scripted)

- Load `/dave`, `/admin`, `/PHtest`, `/growth-hub`, `/content-calendar`,
  `/caption-agent` in a **logged-out** browser and confirm each shows a
  login/access-denied state, not the protected content.
- View-source on `/content-calendar` specifically — it still has no auth of
  any kind (see SECURITY_REGISTER.md §3), so "does it load" and "is data
  exposed" are the same question there.
- Confirm `CRON_SECRET` is set in Vercel → Project Settings → Environment
  Variables for **Preview** and **Development**, not just Production (this
  session could only confirm Production — see README.md prerequisite
  checks).
- To verify a cron endpoint's actual *authorised* success path, do it
  manually with the real `CRON_SECRET`, understanding it will actually
  execute the job. This is intentionally not automated.
