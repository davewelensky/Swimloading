// sb-fallback.js: keeps the app working when a network (school Wi-Fi) blocks supabase.co by retrying through /sb/*.
// Reads race the proxy after a silence; data writes are never duplicated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../sb-fallback.js', import.meta.url), 'utf8');
const O = 'https://szgkzuswelntnevobnoh.supabase.co', P = 'https://www.swimloading.com/sb';
const never = () => new Promise(() => {}), wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Loads a fresh copy of the script with a fake fetch and storage. */
function load(fetchImpl, flag) {
  const ls = flag !== undefined ? { sl_sb_via_proxy: flag } : {}, calls = [];
  const win = { SL_SB_SLOW_MS: 60 };
  const ctx = { window: win, location: { origin: 'https://www.swimloading.com' }, localStorage: { getItem: (k) => ls[k] ?? null, setItem: (k, v) => { ls[k] = v; }, removeItem: (k) => { delete ls[k]; } }, TypeError, Request: class {}, Number, String, Date, Promise, setTimeout, clearTimeout, fetch: (u, i) => { calls.push(u); return fetchImpl(u, i); } };
  vm.runInNewContext(SRC, ctx);
  return { f: win.slSupabaseFetch, ls, calls };
}

test('a direct request that hangs is answered by the proxy after the silence, and the browser remembers', async () => {
  const { f, ls, calls } = load((u) => (u.startsWith(O) ? never() : Promise.resolve({ via: 'proxy' })));
  const t = Date.now(); const r = await f(O + '/rest/v1/clubs');
  assert.equal(r.via, 'proxy'); assert.ok(Date.now() - t >= 50); assert.equal(calls.length, 2); assert.ok(Number(ls.sl_sb_via_proxy) > 1);
});
test('a fast direct request never touches the proxy', async () => {
  const { f, ls, calls } = load(() => Promise.resolve({ ok: true })); await f(O + '/x'); await wait(120);
  assert.deepEqual(calls, [O + '/x']); assert.equal(ls.sl_sb_via_proxy, undefined);
});
test('a hard failure goes to the proxy at once; both failing rejects', async () => {
  const a = load((u) => (u.startsWith(O) ? Promise.reject(new TypeError('x')) : Promise.resolve({ ok: true }))); const t = Date.now(); await a.f(O + '/x'); assert.ok(Date.now() - t < 40); assert.equal(a.calls.length, 2);
  await assert.rejects(load(() => Promise.reject(new TypeError('boom'))).f(O + '/x'), /boom/);
});
test('a fresh proxy flag goes proxy-first; if the proxy hangs, direct answers and the flag is cleared; a legacy or old flag is ignored', async () => {
  const a = load((u) => (u.startsWith(O) ? Promise.resolve({ via: 'direct' }) : never()), String(Date.now()));
  assert.equal((await a.f(O + '/x')).via, 'direct'); assert.equal(a.calls[0], P + '/x'); assert.equal(a.ls.sl_sb_via_proxy, undefined);
  const b = load(() => Promise.resolve({ ok: true }), '1'); await b.f(O + '/x'); assert.equal(b.calls[0], O + '/x');
  const c = load(() => Promise.resolve({ ok: true }), String(Date.now() - 25 * 3600 * 1000)); await c.f(O + '/x'); assert.equal(c.calls[0], O + '/x');
});
test('sign-in and session refresh are raced, but data writes and logout are never duplicated', async () => {
  const a = load((u) => (u.startsWith(O) ? never() : Promise.resolve({ via: 'proxy' }))); assert.equal((await a.f(O + '/auth/v1/token?grant_type=password', { method: 'POST', body: 'x' })).via, 'proxy');
  const b = load(() => never()); b.f(O + '/rest/v1/x', { method: 'POST', body: '{}' }); b.f(O + '/storage/v1/object/x', { method: 'POST', body: 'x' }); b.f(O + '/auth/v1/logout', { method: 'POST' }); await wait(200);
  assert.equal(b.calls.length, 3, 'each write started once, none raced');
  const c = load((u) => (u.startsWith(O) ? Promise.reject(new TypeError('x')) : Promise.resolve({ ok: true }))); await c.f(O + '/rest/v1/x', { method: 'POST', body: '{}' }); assert.equal(c.calls.length, 2, 'a hard failure still retries once');
});
test('an abort is not retried and other hosts are untouched', async () => {
  const a = load(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); await assert.rejects(a.f(O + '/x'), /aborted/); await wait(100); assert.equal(a.calls.length, 1);
  const b = load(() => Promise.resolve({ ok: true })); await b.f('https://example.com/a'); assert.deepEqual(b.calls, ['https://example.com/a']);
});
