# Smoke Tests

Four scripts, in order of what they test:

- **`scripts/lib/endpoint-registry.mjs`** — not a runnable script; the single
  source of truth for every endpoint the test tooling is allowed to call,
  its classification, and whether it mutates state. This is the actual
  enforcement mechanism (see safety rule below) — not documentation of one.
- **`scripts/test-endpoint-registry.mjs`** — local unit tests proving the
  registry's production hard stop cannot be bypassed by any combination of
  flags. No network calls.
- **`scripts/test-cron-auth.mjs`** — local, in-process unit test of the
  shared cron auth helper (`api/cron/_auth.js`). No network calls, no
  Supabase, doesn't import the actual cron handlers.
- **`scripts/smoke-test-production.mjs`** — HTTP-level smoke test against a
  real deployment (local/preview/production). Looks up every request in the
  registry by id before sending it — there is no code path that constructs
  an ad-hoc request.

## ⚠️ Safety rule, read before running

Two production incidents happened during this work (both against
`/api/cron/purge-audit` — full writeup in `docs/refactor/CHANGELOG.md`,
INCIDENT #1 and #2). The lesson from both: **classification alone doesn't
guarantee safety if the target hasn't deployed the protection yet.** Testing
"does this reject" against an endpoint that currently accepts everything is
not safe, no matter how the request is labeled client-side.

**The permanent fix (this session) is a code-level hard stop, not a
convention:** `classifyCall()` in `scripts/lib/endpoint-registry.mjs` decides
whether a request is allowed, and it is the *only* function the smoke-test
script uses to decide that — `--allow-destructive` is never even consulted
when `target === 'production'` for a `MUTATING`/`DESTRUCTIVE` entry; the
code branches away from that flag entirely. `scripts/test-endpoint-registry.mjs`
proves this with 126 passing assertions, including "production refuses X
even with every flag set to try to force it through."

Sequence that still matters operationally (the registry prevents *destructive*
mistakes, not *premature* ones):
1. Before a deploy: only run checks whose registry entries are `PUBLIC_READ`
   (plain 404/200 checks) against production.
2. Deploy the fix.
3. After deploy: the full script, including `AUTH_REJECTION` cron checks, is
   safe to run against `--target=production`.

## `scripts/test-endpoint-registry.mjs`

```bash
node scripts/test-endpoint-registry.mjs
```

126 assertions, 0 network calls. Proves: every `DESTRUCTIVE`/`MUTATING`
registry entry is refused on production regardless of flags; `purge-audit-success`
is refused on *every* target (a second, independent exclusion beyond the
general production rule, given its incident history); unregistered endpoint
ids are refused rather than assumed safe; `AUTH_REJECTION` and `PUBLIC_READ`
entries are allowed on production with no special flags; preview/local
destructive calls require all three of `--allow-destructive` + a
preview/local target + the exact `--confirm-token=CONFIRM-DESTRUCTIVE-TEST`
literal, and refuse if any one of those three is missing or wrong.

## `scripts/test-cron-auth.mjs`

```bash
node scripts/test-cron-auth.mjs
```

Covers: missing secret configuration, missing request credential, invalid
request credential, unsupported method (DELETE and POST), valid credential
in a local test environment. All 6 assertions pass against the current
`api/cron/_auth.js`. Tests the *server-side* auth helper directly — separate
from, and complementary to, the registry (which governs the *test client's*
behavior).

## `scripts/smoke-test-production.mjs`

```bash
node scripts/smoke-test-production.mjs --target=production
node scripts/smoke-test-production.mjs --target=preview --base=https://<preview>.vercel.app
node scripts/smoke-test-production.mjs --target=local --base=http://localhost:3000
```

`--target` is required (defaults to `production` if omitted — be deliberate
about this). This script does not currently attempt any `DESTRUCTIVE`/
`MUTATING` registry entry at all — those ids exist in the registry for
documentation, but `main()` never calls `callRegisteredEndpoint()` on them.
If a future need arises to test a non-excluded endpoint's success path on
preview/local, that would require adding a call in the script AND passing
`--allow-destructive --confirm-token=CONFIRM-DESTRUCTIVE-TEST` on a
preview/local target — `purge-audit-success` specifically can never be
called by this script regardless, per its permanent exclusion in the
registry.

### Classifications (from `scripts/lib/endpoint-registry.mjs`)

| Class | Meaning | Where it can run |
|---|---|---|
| `PUBLIC_READ` | GET with no auth expectation — public pages, 404 exposure checks, sitemap | Any target, anytime |
| `AUTH_READ` | Page loads for anyone, but protected content is client/RLS gated (the 6 internal page shells) | Any target, anytime |
| `AUTH_REJECTION` | Missing/invalid credential or wrong method sent to a cron endpoint — only 401/405 is acceptable | Any target, **but only once the target's fix is deployed** |
| `MUTATING` | Any endpoint that writes/updates without necessarily being catastrophic | Never on production; preview/local only with flag+target+token |
| `DESTRUCTIVE` | A valid-credential call to a cron endpoint (the success path) | Never on production, ever, regardless of flags. `purge-audit-success` never, on any target. |

### What it checks

Every check comes from the registry — see `scripts/lib/endpoint-registry.mjs`
for the exhaustive list. Summary: public routes (200/301), repo-doc and
expanded exposure sweep (`.md` files, `Sponsors/`, `sql/`, `scripts/`,
`docs/`, `14files/`, `archive/`, `Deploy_SwimLoading/` — all 404), the
`.md` trailing-slash/case bypass checks, 6 internal page shells (200 +
`noindex`), sitemap exact-match exclusion of internal routes (fixed from an
earlier loose substring match that false-flagged the legitimate public page
`/english-channel/swim/dave-berry-2022`), and all 4 cron endpoints'
`AUTH_REJECTION` behavior (missing/wrong credential, wrong method).

## Manual checks (not scripted)

- Load `/dave`, `/admin`, `/PHtest`, `/growth-hub`, `/content-calendar`,
  `/caption-agent` in a **logged-out** browser and confirm each shows a
  login/access-denied state, not the protected content.
- View-source on `/content-calendar` specifically — it still has no auth of
  any kind (see SECURITY_REGISTER.md §3), so "does it load" and "is data
  exposed" are the same question there.
- Confirm `CRON_SECRET` is set in Vercel → Project Settings → Environment
  Variables for **Preview** and **Development** — see
  `docs/refactor/VERCEL_MANUAL_CHECKLIST.md`.
- To verify a cron endpoint's actual *authorised* success path, do it
  manually with the real `CRON_SECRET`, understanding it will actually
  execute the job. This is intentionally not automated for any endpoint.
