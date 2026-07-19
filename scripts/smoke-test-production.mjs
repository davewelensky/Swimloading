#!/usr/bin/env node
// Refactor Phase 0/1 smoke test.
//
// SAFETY HISTORY: an earlier version of this script sent bare GET requests
// to /api/cron/purge-audit assuming that was "read-only." purge-audit.js had
// no method check at the time, so those requests actually executed the real
// unauthenticated DELETE against production. See docs/refactor/CHANGELOG.md
// "INCIDENT" section for the full writeup. This version is a rewrite of the
// safety model, not a patch — every request is classified BEFORE it is sent,
// and destructive-endpoint requests require explicit opt-in that is only
// honoured on local/preview targets.
//
// Usage:
//   node scripts/smoke-test-production.mjs --target=production
//   node scripts/smoke-test-production.mjs --target=preview --base=https://<preview>.vercel.app
//   node scripts/smoke-test-production.mjs --target=local --base=http://localhost:3000
//   node scripts/smoke-test-production.mjs --target=preview --allow-destructive   (opt-in, preview/local only)

// ── Arg parsing ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name, fallback = undefined) {
  const pre = `--${name}=`;
  const hit = args.find(a => a.startsWith(pre));
  if (hit) return hit.slice(pre.length);
  return args.includes(`--${name}`) ? true : fallback;
}

const TARGET = String(flag('target', 'production'));
const ALLOW_DESTRUCTIVE = Boolean(flag('allow-destructive', false));

const DEFAULT_BASE = {
  production: 'https://www.swimloading.com',
  preview: null,   // must be supplied via --base for a real preview deployment
  local: 'http://localhost:3000',
};

if (!['local', 'preview', 'production'].includes(TARGET)) {
  console.error(`Unsafe configuration: --target must be one of local | preview | production (got "${TARGET}")`);
  process.exit(1);
}

const BASE = String(flag('base', DEFAULT_BASE[TARGET] || process.env.BASE_URL || ''));
if (!BASE) {
  console.error(`Unsafe configuration: no base URL resolved for target "${TARGET}". Pass --base=<url>.`);
  process.exit(1);
}

if (ALLOW_DESTRUCTIVE && TARGET === 'production') {
  console.error('Unsafe configuration: --allow-destructive is not permitted with --target=production. Aborting before sending any request.');
  process.exit(1);
}

console.log(`Smoke testing [${TARGET}] ${BASE}${ALLOW_DESTRUCTIVE ? '  (destructive tests ENABLED — ' + TARGET + ' only)' : ''}\n`);

// ── Endpoint classification — decided BEFORE any request is sent ──────────
// READ_ONLY             — safe on any target, any time.
// AUTH_REJECTION_TEST    — a request to a sensitive endpoint where the ONLY
//                          acceptable response is a rejection (401/405/500).
//                          Safe on any target because it proves the endpoint
//                          is NOT executing privileged work — but the script
//                          must verify that assumption on every single call
//                          and abort loudly if it's ever violated.
// DESTRUCTIVE_DO_NOT_CALL — a request that would trigger real privileged
//                          work if accepted (i.e. a valid-credential request
//                          to a mutating endpoint). Never sent to production.
//                          Only sent on local/preview, and only with
//                          --allow-destructive. purge-audit is EXCLUDED from
//                          this entirely, on every target, per explicit
//                          instruction — its destructive path is never
//                          exercised by this script, full stop.

const DESTRUCTIVE_CRON_PATHS = [
  '/api/cron/purge-audit',
  '/api/cron/sensor-import',
  '/api/cron/marine-temps',
  '/api/cron/advance-challenge',
];
// Safety net for any future endpoint not explicitly listed above.
const DESTRUCTIVE_PATTERN = /purge|delete|archive|import|mutate|advance|admin-write/i;
const NEVER_EXERCISE_SUCCESS_PATH = new Set(['/api/cron/purge-audit']);

function isDestructivePath(path) {
  if (DESTRUCTIVE_CRON_PATHS.includes(path)) return true;
  // The keyword pattern is a safety net for future *API* endpoints only —
  // scoped to /api/ so static content paths that happen to contain a
  // matching word (e.g. /archive/index.html) aren't misclassified.
  return path.startsWith('/api/') && DESTRUCTIVE_PATTERN.test(path);
}

let pass = 0;
let fail = 0;
let abortedUnsafe = false;

function report(ok, label, detail) {
  if (ok) { pass++; console.log(`  OK   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}

async function request(path, { method = 'GET', headers = {} } = {}) {
  const res = await fetch(BASE + path, { method, headers, redirect: 'manual' });
  const body = await res.text().catch(() => '');
  return { status: res.status, body };
}

// A READ_ONLY call — any endpoint not on the destructive list/pattern.
async function readOnly(path) {
  if (isDestructivePath(path)) {
    throw new Error(`Internal error: readOnly() called on a destructive-classified path "${path}" — this is a bug in the test script, not the target.`);
  }
  return request(path);
}

// An AUTH_REJECTION_TEST call — only ever sends missing/invalid credentials
// or a disallowed method to a sensitive endpoint. Verifies the response is
// actually a rejection; treats an unexpected 200 as a critical failure, not
// just a normal failed assertion.
async function authRejectionTest(path, opts, expectLabel) {
  const { status } = await request(path, opts);
  const rejected = status === 401 || status === 405 || status === 500;
  if (status === 200) {
    fail++;
    console.log(`  FAIL ${path} (${expectLabel}) -> 200 — CRITICAL: endpoint accepted an unauthorised/malformed request and likely ran privileged work`);
  } else {
    report(rejected, `${path} (${expectLabel}) -> ${status}`, rejected ? undefined : 'expected 401/405/500');
  }
}

async function main() {
  console.log('Public routes (expect 200 or 301):');
  for (const path of ['/', '/app', '/clubs', '/crossings/english-channel']) {
    const { status } = await readOnly(path);
    report(status === 200 || status === 301, `GET ${path} -> ${status}`);
  }

  console.log('\nRepo docs (expect 404 — must not be publicly servable):');
  for (const path of ['/CLAUDE.md', '/PARTNERS.md', '/GROWTH_HUB.md', '/MIGRATIONS.md', '/EXPANDING.md', '/CLUB_ONBOARDING.md']) {
    const { status } = await readOnly(path);
    report(status === 404, `GET ${path} -> ${status}`, status !== 404 ? 'still publicly readable' : undefined);
  }

  console.log('\nExpanded exposure sweep (expect 404 — sql/, scripts/, docs/, 14files/, archive/, Sponsors/):');
  for (const path of [
    '/Sponsors/', '/Sponsors/index.html',
    '/sql/MIGRATION_TEMPLATE.sql', '/sql/applied/rls_policies.sql',
    '/scripts/ship.sh', '/scripts/smoke-test-production.mjs',
    '/docs/refactor/README.md',
    '/14files/ONBOARDING_SQL.md', '/14files/liability-waiver.txt',
    '/archive/index.html', '/Deploy_SwimLoading/index.html',
  ]) {
    const { status } = await readOnly(path);
    report(status === 404, `GET ${path} -> ${status}`, status !== 404 ? 'still publicly readable' : undefined);
  }

  console.log('\nTrailing-slash / case bypass checks on the .md block (expect 404):');
  for (const path of ['/CLAUDE.md/', '/CLAUDE.MD']) {
    const { status } = await readOnly(path);
    // Note: /CLAUDE.MD is expected 404 regardless (no such file exists by that
    // case), so this mainly re-confirms the trailing-slash fix specifically.
    report(status === 404, `GET ${path} -> ${status}`);
  }

  console.log('\nInternal pages (expect to load, but with noindex present):');
  for (const path of ['/dave', '/admin', '/PHtest', '/growth-hub', '/content-calendar', '/caption-agent']) {
    const { status, body } = await readOnly(path);
    const hasNoindex = /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(body);
    report(status === 200, `GET ${path} -> ${status}`);
    report(hasNoindex, `  ${path} has noindex meta tag`, !hasNoindex ? 'missing robots noindex tag' : undefined);
  }

  console.log('\nSitemap must not list internal routes:');
  const { status: smStatus, body: sitemap } = await readOnly('/sitemap.xml');
  if (smStatus === 200) {
    for (const needle of ['/dave', '/admin', '/PHtest', '/growth-hub', '/content-calendar', '/caption-agent', '/Sponsors']) {
      report(!sitemap.includes(needle), `sitemap.xml excludes ${needle}`, sitemap.includes(needle) ? 'internal route present in sitemap' : undefined);
    }
  } else {
    report(false, 'GET /sitemap.xml', `expected 200, got ${smStatus}`);
  }

  console.log('\nCron endpoints — AUTH_REJECTION_TEST only (missing/invalid credential, wrong method).');
  console.log('The authorised success path is never called by this script for any of these.');
  for (const path of DESTRUCTIVE_CRON_PATHS) {
    await authRejectionTest(path, { method: 'GET', headers: {} }, 'no auth header');
    await authRejectionTest(path, { method: 'GET', headers: { Authorization: 'Bearer definitely-not-the-real-secret' } }, 'wrong auth header');
    await authRejectionTest(path, { method: 'POST', headers: { Authorization: 'Bearer definitely-not-the-real-secret' } }, 'unsupported method');
  }

  // ── Optional, gated destructive-path check ───────────────────────────────
  if (ALLOW_DESTRUCTIVE) {
    if (TARGET === 'production') {
      // Belt-and-suspenders — already aborted above, this should be unreachable.
      abortedUnsafe = true;
    } else {
      console.log(`\n--allow-destructive set on target "${TARGET}": would attempt authorised-path checks for non-excluded endpoints.`);
      console.log('purge-audit is hard-excluded from this on every target and is never called with a valid credential by this script.');
      for (const path of DESTRUCTIVE_CRON_PATHS) {
        if (NEVER_EXERCISE_SUCCESS_PATH.has(path)) {
          console.log(`  SKIP ${path} — permanently excluded from success-path testing`);
          continue;
        }
        console.log(`  SKIP ${path} — this script does not implement a valid-secret call even under --allow-destructive; supply CRON_SECRET manually and call it directly if you specifically need to verify the success path on ${TARGET}.`);
      }
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (abortedUnsafe) {
    console.error('Aborted: unsafe destructive configuration detected mid-run.');
    process.exit(1);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
