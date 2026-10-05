// Regression tests for the three sponsor data-corruption bugs found in the
// Oct 2026 audit, now pinned against the surviving write paths on /Sponsors,
// plus proof the Growth Hub no longer has any way to write sponsor data.
//
// History: before the fix these ran against the Growth Hub editor and FAILED
// (status blanked, category wiped, country rewritten to UK). The Hub editor is
// retired; the same guarantees are enforced on /Sponsors and in the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWriters, HUB_HTML, PIPELINE_HTML } from './helpers/sponsor-writers-harness.js';
import '../sponsors-core.js';
const C = globalThis.SponsorsCore;

const row = (over = {}) => ({ id: 's1', sponsor_name: 'Zero BS', category: 'Sunscreen & skincare', status: 'Contacted',
  country: 'SA', next_action: null, notes: 'n', ...over });

// ── Bug 1: status mismatch ───────────────────────────────────────────────
for (const status of C.STATUSES) {
  test(`status "${status}" is written exactly as chosen, and nothing else`, async () => {
    const start = status === 'Idea' ? 'Contacted' : 'Idea';
    const h = loadWriters({ sponsors: [row({ status: start })], drawerId: 's1' });
    await h.run(`saveBrandStatus({ value: ${JSON.stringify(status)}, dataset: {} })`);
    assert.deepEqual(h.calls.update[0].row, { status });
  });
}
test('a legacy Hub status can never be written: it maps to a canonical one or is refused', async () => {
  const h = loadWriters({ sponsors: [row()], drawerId: 's1' });
  await h.run(`saveBrandStatus({ value: 'Banana', dataset: {} })`);
  assert.equal(h.calls.update.length, 0);
  assert.equal(C.canonicalStatus('Interested'), 'In Discussion');
  assert.equal(C.canonicalStatus('Not Now'), 'In Discussion');   // deferred, still alive: matches the DB migration
});

test('re-selecting the current status is a true no-op (no write at all)', async () => {
  const h = loadWriters({ sponsors: [row({ status: 'Contacted' })], drawerId: 's1' });
  await h.run(`saveBrandStatus({ value: 'Contacted', dataset: {} })`);
  assert.equal(h.calls.update.length, 0);
});

// ── Bug 2: category wipe ─────────────────────────────────────────────────
for (const category of ['Sunscreen & skincare', 'Travel & adventure (Crossing Africa)', 'Wetsuits & open water kit']) {
  test(`editing another field never touches category "${category}"`, async () => {
    const h = loadWriters({ sponsors: [row({ category })], drawerId: 's1' });
    await h.run(`saveBrandField('next_action', 'Call Warren')`);
    assert.deepEqual(h.calls.update[0].row, { next_action: 'Call Warren' });
  });
}
test('category edits reuse the existing spelling instead of creating a duplicate', async () => {
  const h = loadWriters({ sponsors: [row({ category: 'Recovery', id: 's1' }), row({ id: 's2', category: 'Recovery' })], drawerId: 's1' });
  await h.run(`saveBrandField('category', '  recovery ')`);
  assert.equal(h.calls.update.length, 0); // same canonical category: no write at all
  await h.run(`saveBrandField('category', 'New label')`);
  assert.deepEqual(h.calls.update[0].row, { category: 'New label' });
});

// ── Bug 3: country overwrite / "ALL" persisted ───────────────────────────
test('no edit path ever writes country', async () => {
  const h = loadWriters({ sponsors: [row({ country: 'SA' })], drawerId: 's1' });
  await h.run(`saveBrandField('notes', 'x')`);
  await h.run(`saveBrandStatus({ value: 'Passed', dataset: {} })`);
  for (const u of h.calls.update) assert.ok(!('country' in u.row), JSON.stringify(u.row));
});
for (const bad of ['ALL', 'all', '', '   ', 'United Kingdom']) {
  test(`adding a sponsor with country "${bad}" is refused, never stored`, async () => {
    const h = loadWriters({ addForm: { 'add-name': 'Brand', 'add-country': bad } });
    await h.run('submitAddSponsor()');
    assert.equal(h.calls.insert.length, 0);
    assert.ok(h.calls.toasts.some((t) => t.isErr));
  });
}
test('adding a sponsor stores the explicit country, normalised', async () => {
  const h = loadWriters({ addForm: { 'add-name': 'Brand', 'add-country': ' sa ', 'add-category': ' wetsuits   & kit ' } });
  await h.run('submitAddSponsor()');
  const r = h.calls.insert[0].row;
  assert.equal(r.country, 'SA'); assert.equal(r.status, 'Idea'); assert.equal(r.category, 'wetsuits & kit');
});

// ── Growth Hub is read-only for sponsors ─────────────────────────────────
test('Growth Hub has no sponsor write path', () => {
  assert.ok(!/from\(\s*['"]growth_sponsors['"]\s*\)\s*\.(update|insert|upsert|delete)/.test(HUB_HTML));
  assert.ok(!/confirmDelete\(\s*['"]growth_sponsors/.test(HUB_HTML));
  for (const gone of ['saveSponsor', 'editSponsor', 'sponsorModal', '_sConvPending', 'sConvThread']) assert.ok(!HUB_HTML.includes(gone), gone);
});
test('Growth Hub sponsor data comes from growth_sponsors and links to /Sponsors', () => {
  assert.match(HUB_HTML, /from\('growth_sponsors'\)\.select/);
  assert.match(HUB_HTML, /\/Sponsors\?brand=/);
});
test('Hub partner lists are generated: no hand-typed partner names remain in the Master Index', () => {
  const sec = HUB_HTML.slice(HUB_HTML.indexOf('id="mi-sponsors"'), HUB_HTML.indexOf('<!-- 8. Email'));
  for (const name of ['Maurten', 'Science in Sport', 'BluSmooth', 'Outdoor Swimming Society', 'Styrkr', 'SwimTrek']) {
    assert.ok(!sec.includes(name), `hand-typed "${name}" still in the Master Index sponsors section`);
  }
  assert.match(sec, /ghActivePartners/); assert.match(sec, /ghTargetPartners/);
});

// ── Canonical rules: one status list, one category treatment, one country rule ──
test('canonical status list is the six pipeline statuses, in order', () => {
  assert.deepEqual(C.STATUSES, ['Idea', 'Researching', 'Contacted', 'In Discussion', 'Confirmed', 'Passed']);
});
test('legacy Hub statuses map to canonical ones; unknown values are not invented', () => {
  assert.equal(C.canonicalStatus('  confirmed '), 'Confirmed');
  assert.equal(C.canonicalStatus('Banana'), null);
  assert.equal(C.canonicalStatus(''), null);
});
test('category: trimmed, whitespace-collapsed, reuses the existing spelling', () => {
  assert.equal(C.canonicalCategory('  recovery ', ['Recovery']), 'Recovery');
  assert.equal(C.canonicalCategory('New   thing', ['Recovery']), 'New thing');
  assert.equal(C.canonicalCategory('   ', []), null);
});
test('country: ALL / blank / junk are never a persistable country', () => {
  for (const bad of ['ALL', 'all', '', null, undefined, '  ', 'United Kingdom', '1']) assert.equal(C.countryForWrite(bad), null, String(bad));
  assert.equal(C.countryForWrite(' sa '), 'SA'); assert.equal(C.countryForWrite('UK'), 'UK');
});
test('stats use the single list: legacy Interested counts as In Discussion; Passed is not overdue', () => {
  const rows = [{ status: 'In Discussion', follow_up_date: '2026-01-01' }, { status: 'Interested' },
    { status: 'Confirmed', follow_up_date: '2026-01-01' }, { status: 'Passed', follow_up_date: '2026-01-01' },
    { status: 'Idea', follow_up_date: '2026-12-31' }];
  const s = C.sponsorStats(rows, '2026-10-05');
  assert.equal(s.inDiscussion, 2); assert.equal(s.confirmed, 1); assert.equal(s.overdue.length, 1);
});
test('pages use the shared status list instead of literal arrays', () => {
  assert.match(PIPELINE_HTML, /SponsorsCore\.STATUSES/);
  assert.ok(!/\['Idea','Researching'/.test(PIPELINE_HTML));
  assert.ok(!/s\.status === 'Interested'/.test(HUB_HTML));
});

test('commercial script starts itself if the pipeline loaded first (load-order race)', async () => {
  const { COMMERCIAL_JS } = await import('./helpers/sponsor-writers-harness.js');
  assert.match(COMMERCIAL_JS, /SPONSORS\.length\) initCommercial\(\)/);
});
