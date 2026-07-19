#!/usr/bin/env node
// Refactor Phase 0/1 smoke test.
//
// SAFETY HISTORY — read docs/refactor/CHANGELOG.md for full detail:
//   INCIDENT #1: an early version sent bare GET requests to
//   /api/cron/purge-audit assuming that was "read-only." The endpoint had
//   no method check at the time, so those requests executed the real
//   unauthenticated DELETE against production.
//   INCIDENT #2: a rewritten, classification-based version still hit the
//   same endpoint's AUTH_REJECTION calls against production BEFORE the fix
//   was deployed — classification alone doesn't guarantee safety if the
//   target hasn't deployed the protection yet.
//
// THE PERMANENT FIX: this script no longer decides classification inline.
// Every request comes from scripts/lib/endpoint-registry.mjs, looked up by
// a unique id, and classifyCall() is the single hard stop — it structurally
// cannot be bypassed by a CLI flag, because production requests never reach
// the branch that even looks at --allow-destructive. See that file's
// comments and scripts/test-endpoint-registry.mjs for the proof.
//
// Usage:
//   node scripts/smoke-test-production.mjs --target=production
//   node scripts/smoke-test-production.mjs --target=preview --base=https://<preview>.vercel.app
//   node scripts/smoke-test-production.mjs --target=local --base=http://localhost:3000
//
// ⚠️ Only run the cron section against --target=production AFTER a deploy
// that includes the auth fix — see docs/refactor/SMOKE_TESTS.md.

import { classifyCall, lookup, REGISTRY } from './lib/endpoint-registry.mjs';

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
const CONFIRM_TOKEN = flag('confirm-token', null);

const DEFAULT_BASE = {
  production: 'https://www.swimloading.com',
  preview: null,
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

console.log(`Smoke testing [${TARGET}] ${BASE}${ALLOW_DESTRUCTIVE ? '  (--allow-destructive set)' : ''}\n`);

let pass = 0;
let fail = 0;

function report(ok, label, detail) {
  if (ok) { pass++; console.log(`  OK   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}

async function rawRequest(path, { method = 'GET', headers = {} } = {}) {
  const res = await fetch(BASE + path, { method, headers, redirect: 'manual' });
  const body = await res.text().catch(() => '');
  return { status: res.status, body };
}

// The ONLY function in this script that sends a network request. It always
// goes through classifyCall() first — there is no code path that calls
// rawRequest() directly for anything in the registry.
async function callRegisteredEndpoint(id) {
  const decision = classifyCall(id, { target: TARGET, allowDestructive: ALLOW_DESTRUCTIVE, confirmToken: CONFIRM_TOKEN });
  if (!decision.allowed) {
    return { skipped: true, reason: decision.reason };
  }
  const { entry } = decision;
  const { status, body } = await rawRequest(entry.path, { method: entry.method, headers: entry.headers || {} });
  return { skipped: false, status, body, entry };
}

async function main() {
  console.log('Public routes:');
  for (const id of ['home', 'app-shell', 'clubs', 'english-channel']) {
    const r = await callRegisteredEndpoint(id);
    const entry = lookup(id);
    report(!r.skipped && entry.expected_status.includes(r.status), `${entry.method} ${entry.path} -> ${r.skipped ? 'SKIPPED: ' + r.reason : r.status}`);
  }

  console.log('\nRepo docs + expanded exposure sweep (expect 404):');
  for (const entry of REGISTRY.filter(e => e.classification === 'PUBLIC_READ' && e.expected_status.includes(404))) {
    const r = await callRegisteredEndpoint(entry.id);
    report(!r.skipped && entry.expected_status.includes(r.status), `${entry.method} ${entry.path} -> ${r.skipped ? 'SKIPPED: ' + r.reason : r.status}`, (!r.skipped && r.status !== 404) ? 'still publicly readable' : undefined);
  }

  console.log('\nSitemap:');
  {
    const r = await callRegisteredEndpoint('sitemap');
    report(!r.skipped && r.status === 200, `GET /sitemap.xml -> ${r.skipped ? 'SKIPPED: ' + r.reason : r.status}`);
    if (!r.skipped && r.status === 200) {
      for (const route of ['/dave', '/admin', '/PHtest', '/growth-hub', '/content-calendar', '/caption-agent', '/Sponsors']) {
        // Exact <loc> match — a loose substring match previously false-
        // flagged the legitimate public page
        // /english-channel/swim/dave-berry-2022 as if it were /dave.
        const exactMatch = new RegExp(`<loc>https?://[^<]*${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/)?</loc>`, 'i').test(r.body);
        report(!exactMatch, `sitemap.xml excludes ${route}`, exactMatch ? 'internal route present in sitemap' : undefined);
      }
    }
  }

  console.log('\nInternal pages (expect to load, but with noindex present):');
  for (const name of ['dave', 'admin', 'PHtest', 'growth-hub', 'content-calendar', 'caption-agent']) {
    const id = `internal-page:${name}`;
    const r = await callRegisteredEndpoint(id);
    const entry = lookup(id);
    report(!r.skipped && r.status === 200, `GET ${entry.path} -> ${r.skipped ? 'SKIPPED: ' + r.reason : r.status}`);
    if (!r.skipped && r.status === 200) {
      const hasNoindex = /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(r.body);
      report(hasNoindex, `  ${entry.path} has noindex meta tag`, !hasNoindex ? 'missing robots noindex tag' : undefined);
    }
  }

  console.log('\nCron endpoints — AUTH_REJECTION calls only.');
  console.log('The authorised success path ids exist in the registry but are never invoked by this script on production,');
  console.log('and purge-audit-success is permanently excluded on every target regardless of any flag.');
  for (const cron of ['purge-audit', 'sensor-import', 'marine-temps', 'advance-challenge']) {
    for (const suffix of ['no-auth', 'wrong-auth', 'wrong-method']) {
      const id = `${cron}-${suffix}`;
      const entry = lookup(id);
      const r = await callRegisteredEndpoint(id);
      if (r.skipped) {
        report(false, `${entry.method} ${entry.path} (${entry.description}) — SKIPPED`, r.reason);
        continue;
      }
      if (r.status === 200) {
        fail++;
        console.log(`  FAIL ${entry.method} ${entry.path} (${entry.description}) -> 200 — CRITICAL: endpoint accepted an unauthorised/malformed request and likely ran privileged work`);
        continue;
      }
      report(entry.expected_status.includes(r.status), `${entry.method} ${entry.path} (${entry.description}) -> ${r.status}`, !entry.expected_status.includes(r.status) ? `expected ${entry.expected_status.join('/')}` : undefined);
    }
  }

  // Destructive/success-path ids exist in the registry for documentation,
  // but this script never calls them — classifyCall() would refuse them on
  // production unconditionally, and refuses purge-audit-success everywhere.
  // No code path here even attempts it; nothing to gate at runtime.

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
