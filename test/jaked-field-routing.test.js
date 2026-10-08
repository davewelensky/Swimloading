import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const routes = JSON.parse(read('vercel.json')).routes;
// Vercel stops at the first matching route that does not say `continue` (the global security-headers rule does)
const match = (url) => routes.find((r) => r.src && !r.continue && new RegExp(r.src).test(url));

test('the public /jaked short link is untouched and still serves the partner page', () => {
  assert.equal(match('/jaked').dest, '/partners/jaked.html');
  assert.equal(match('/partners/jaked').dest, '/partners/jaked.html');
});

test('the private field-test page is routed with no-cache and its scripts are never cached stale', () => {
  const page = match('/jaked-field-test');
  assert.equal(page.dest, '/jaked-field-test.html');
  assert.match(page.headers['Cache-Control'], /no-store/);
  for (const f of ['/test-programme-lib.js', '/jaked-field-app.js']) {
    const r = match(f);
    assert.ok(r, f + ' needs a no-cache route');
    assert.match(r.headers['Cache-Control'], /no-store/);
    assert.equal(r.dest, '/$1');
  }
});

test('the page is private: noindex, not in the sitemap, loads the files that exist, no emojis', () => {
  const html = read('jaked-field-test.html');
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  for (const m of html.matchAll(/<script src="\/([^"?]+)/g)) assert.ok(fs.existsSync(path.join(root, m[1])), m[1] + ' must exist');
  for (const f of ['sitemap-dynamic.js', 'sitemap.xml']) if (fs.existsSync(path.join(root, f)) || fs.existsSync(path.join(root, 'api', f))) {
    const t = fs.existsSync(path.join(root, f)) ? read(f) : read('api/' + f);
    assert.doesNotMatch(t, /jaked-field-test/, f + ' must not list the private page');
  }
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  for (const f of ['jaked-field-test.html', 'jaked-field-app.js', 'test-programme-lib.js']) assert.doesNotMatch(read(f), emoji, f + ' must not contain emojis (brand rule)');
});

test('the browser code never hard-codes who may see the data: access comes from programme membership in the database', () => {
  const app = read('jaked-field-app.js');
  assert.doesNotMatch(app, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, 'no user ids in client code');
  assert.match(app, /test_program_members/);
  assert.doesNotMatch(app, /service_role|SUPABASE_SERVICE/, 'only the public anon key belongs in the browser');
});

test('the engine library is partner-neutral: no partner name, no brand, no Jaked-specific global', () => {
  assert.doesNotMatch(read('test-programme-lib.js'), /jaked/i);
});
