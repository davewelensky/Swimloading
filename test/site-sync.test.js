// Live stats in site-sync.js.
//
// The failure these tests exist to hold: site-sync counted `profiles` with
// the anon key, RLS hid every row, and the count came back 0 — which then
// overwrote the fallback, so any [data-sync="swimmers"] span would read "0".
// Swimmers now come from the public_swimmer_count() RPC, and no live number
// may replace the site-config fallback with something smaller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync('site-sync.js', 'utf8');
const FALLBACK = { spots: 185, swimmers: 642, tempsLogged: 1509, saSpots: 120 };

// routes: { rpc: <json body> | { status }, counts: { '<table>?<filter>': total } }
function run(routes) {
  const requests = [];
  const spans = Object.keys(FALLBACK).map((key) => ({
    key, textContent: '',
    getAttribute: () => key,
  }));
  const fetch = async (url, opts) => {
    requests.push({ url, method: (opts && opts.method) || 'GET' });
    const path = url.split('/rest/v1/')[1];
    if (path.startsWith('rpc/')) {
      const r = routes.rpc;
      if (r && r.status) return { ok: false, status: r.status, json: async () => ({ message: 'not found' }) };
      return { ok: true, status: 200, json: async () => r };
    }
    const [table, query] = path.split('?');
    const filter = query.replace(/^select=id&?/, '').replace(/&?limit=1$/, '');
    const total = routes.counts[filter ? `${table}?${filter}` : table];
    return { ok: true, headers: { get: () => (total == null ? null : `0-0/${total}`) } };
  };
  const window = { SITE_CONFIG: { ...FALLBACK, countries: [] } };
  const document = {
    readyState: 'complete',
    querySelectorAll: (sel) => (sel === '[data-sync]' ? spans : []),
  };
  vm.runInNewContext(SRC, { window, document, fetch, Intl, Promise });
  return { window, spans, requests };
}

const LIVE_COUNTS = {
  'spots?active=eq.true': 208,
  'temp_logs?user_id=not.is.null': 2225,
  'spots?active=eq.true&country_code=eq.ZA': 143,
};
const stamped = (spans, key) => spans.find((s) => s.key === key).textContent;

test('site-sync: swimmers come from the RPC and are stamped', async () => {
  const { window, spans } = run({ rpc: 744, counts: LIVE_COUNTS });
  await window.siteSync.refreshLiveStats();
  assert.equal(window.SITE_CONFIG.swimmers, 744);
  assert.equal(stamped(spans, 'swimmers'), '744');
  assert.equal(stamped(spans, 'tempsLogged'), '2,225');
});

test('site-sync: profiles is never counted directly (RLS hides it from anon)', async () => {
  const { window, requests } = run({ rpc: 744, counts: LIVE_COUNTS });
  await window.siteSync.refreshLiveStats();
  assert.ok(!requests.some((r) => r.url.includes('/rest/v1/profiles')), 'direct profiles count reads 0 for anon');
  const rpc = requests.find((r) => r.url.endsWith('/rest/v1/rpc/public_swimmer_count'));
  assert.ok(rpc, 'public_swimmer_count RPC not called');
  assert.equal(rpc.method, 'POST');
});

test('site-sync: a failed RPC keeps the fallback', async () => {
  const { window, spans } = run({ rpc: { status: 404 }, counts: LIVE_COUNTS });
  await window.siteSync.refreshLiveStats();
  assert.equal(window.SITE_CONFIG.swimmers, FALLBACK.swimmers);
  assert.equal(stamped(spans, 'swimmers'), '642');
});

test('site-sync: a count of 0 never overwrites the fallback', async () => {
  const { window, spans } = run({
    rpc: 0,
    counts: { ...LIVE_COUNTS, 'temp_logs?user_id=not.is.null': 0 },
  });
  await window.siteSync.refreshLiveStats();
  assert.equal(window.SITE_CONFIG.swimmers, FALLBACK.swimmers);
  assert.equal(window.SITE_CONFIG.tempsLogged, FALLBACK.tempsLogged);
  assert.equal(stamped(spans, 'swimmers'), '642');
});

test('site-sync: a count below the fallback never overwrites it', async () => {
  const { window } = run({
    rpc: 12,
    counts: { ...LIVE_COUNTS, 'spots?active=eq.true': 3 },
  });
  await window.siteSync.refreshLiveStats();
  assert.equal(window.SITE_CONFIG.swimmers, FALLBACK.swimmers);
  assert.equal(window.SITE_CONFIG.spots, FALLBACK.spots);
  assert.equal(window.SITE_CONFIG.saSpots, 143, 'a healthy count alongside still upgrades');
});
