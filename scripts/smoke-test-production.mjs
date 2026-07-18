#!/usr/bin/env node
// Refactor Phase 0/1 smoke test — read-only. Never sends a valid CRON_SECRET
// (that would actually trigger a cron run, including the audit purge).
// Usage: node scripts/smoke-test-production.mjs [--base https://...]

const BASE = process.env.BASE_URL || process.argv.find(a => a.startsWith('--base='))?.slice(7) || 'https://www.swimloading.com';

let pass = 0;
let fail = 0;

function report(ok, label, detail) {
  if (ok) {
    pass++;
    console.log(`  OK   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`);
  }
}

async function get(path, headers = {}) {
  const res = await fetch(BASE + path, { headers, redirect: 'manual' });
  const body = await res.text().catch(() => '');
  return { status: res.status, body };
}

async function main() {
  console.log(`Smoke testing ${BASE}\n`);

  console.log('Public routes (expect 200 or 301):');
  for (const path of ['/', '/app', '/clubs', '/crossings/english-channel']) {
    const { status } = await get(path);
    report(status === 200 || status === 301, `GET ${path} -> ${status}`);
  }

  console.log('\nRepo docs (expect 404 — must not be publicly servable):');
  for (const path of ['/CLAUDE.md', '/PARTNERS.md', '/GROWTH_HUB.md', '/MIGRATIONS.md', '/EXPANDING.md', '/CLUB_ONBOARDING.md']) {
    const { status } = await get(path);
    report(status === 404, `GET ${path} -> ${status}`, status !== 404 ? 'still publicly readable' : undefined);
  }

  console.log('\nSponsors (expect 404 — full block, not just noindex):');
  for (const path of ['/Sponsors/', '/Sponsors/index.html']) {
    const { status } = await get(path);
    report(status === 404, `GET ${path} -> ${status}`, status !== 404 ? 'sponsor pipeline still publicly readable' : undefined);
  }

  console.log('\nInternal pages (expect to load, but with noindex present):');
  for (const path of ['/dave', '/admin', '/PHtest', '/growth-hub', '/content-calendar', '/caption-agent']) {
    const { status, body } = await get(path);
    const hasNoindex = /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(body);
    report(status === 200, `GET ${path} -> ${status}`);
    report(hasNoindex, `  ${path} has noindex meta tag`, !hasNoindex ? 'missing robots noindex tag' : undefined);
  }

  console.log('\nSitemap must not list internal routes:');
  const { status: smStatus, body: sitemap } = await get('/sitemap.xml');
  if (smStatus === 200) {
    for (const needle of ['/dave', '/admin', '/PHtest', '/growth-hub', '/content-calendar', '/caption-agent', '/Sponsors']) {
      report(!sitemap.includes(needle), `sitemap.xml excludes ${needle}`, sitemap.includes(needle) ? 'internal route present in sitemap' : undefined);
    }
  } else {
    report(false, 'GET /sitemap.xml', `expected 200, got ${smStatus}`);
  }

  console.log('\nCron endpoints — no Authorization header (expect 401 or 500, never 200):');
  for (const path of ['/api/cron/purge-audit', '/api/cron/sensor-import', '/api/cron/marine-temps', '/api/cron/advance-challenge']) {
    const { status } = await get(path);
    report(status === 401 || status === 500, `GET ${path} (no auth) -> ${status}`, status === 200 ? 'CRON RAN UNAUTHENTICATED — CRITICAL' : undefined);
  }

  console.log('\nCron endpoints — wrong Authorization header (expect 401):');
  for (const path of ['/api/cron/purge-audit', '/api/cron/sensor-import', '/api/cron/marine-temps', '/api/cron/advance-challenge']) {
    const { status } = await get(path, { Authorization: 'Bearer definitely-not-the-real-secret' });
    report(status === 401, `GET ${path} (wrong secret) -> ${status}`, status === 200 ? 'CRON RAN WITH WRONG SECRET — CRITICAL' : undefined);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
