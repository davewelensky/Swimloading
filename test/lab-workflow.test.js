// The Aquasharks Lab workflow behind HTTP: auth, parse (mock vision), save, readiness, publish gating, public page, withdrawal, PDF.
// Runs the REAL handlers with the in-memory store, a stub admin check and mock model/renderer (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAdminHandler, makePublicHandler, makePdfHandler } from '../api/_lib/lab-report/handlers.js';
import { memoryStore } from '../api/_lib/lab-report/store.js';
import { cleanForStorage, readiness, buildSnapshot, isToken, newToken, parseUpload } from '../api/_lib/lab-report/workflow.js';
import { renderPublicPage, pdfFileName } from '../api/_lib/lab-report/page.js';
import { buildDocx, synDocxBlocks } from './lab-doc-builders.js';
import { emptyAnalysis } from '../aquasharks-lab/analysis/model.js';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const docxB64 = (over, withImage = true) => { const b = synDocxBlocks(over); if (withImage) b.splice(5, 0, { image: 'rId20' }); return Buffer.from(buildDocx(b, withImage ? { media: [{ name: 'image2.png', bytes: PNG }] } : {})).toString('base64'); };
const mockModel = async () => ({ force_field_panels: [{ title_text: null, leftward_pct: 9, propulsive_pct: 41, rightward_pct: 8, upward_pct: 1, hand_drag_pct: 3, downward_pct: 38, avg_impulse_left: 60, avg_impulse_right: 80, avg_impulse_unit: 'W', legible: true }], phase_panels: [] });

function fakeRes() { const r = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { r.headers[k.toLowerCase()] = v; }, end(b) { r.body = b; } }; return r; }
async function call(handler, req) { const res = fakeRes(); await handler({ method: 'POST', headers: {}, query: {}, url: '/x', ...req }, res); return res; }
const json = (res) => JSON.parse(res.body);

function rig({ admin = true } = {}) {
  const store = memoryStore(); let renders = 0;
  const adminH = makeAdminHandler({ store, auth: async () => (admin ? 'admin-1' : null), callModel: mockModel, publicBase: () => 'https://example.test' });
  const pub = makePublicHandler({ store });
  const pdf = makePdfHandler({ store, baseUrl: () => 'https://example.test', render: async (url) => { renders++; return Buffer.from('%PDF-1.4 fake ' + url); } });
  const act = async (body) => { const r = await call(adminH, { body }); return { status: r.statusCode, json: json(r) }; };
  return { store, act, pub, pdf, renders: () => renders };
}
async function parsed(r, over) { const p = await r.act({ action: 'parse', file_base64: docxB64(over), filename: 'x.docx', swimmer_name: 'Test Swimmer C' }); assert.equal(p.status, 200); return p.json; }

test('every admin action requires an Aquasharks club admin; public endpoints need a token', async () => {
  const r = rig({ admin: false });
  for (const action of ['parse', 'save', 'get', 'list', 'readiness', 'publish', 'unpublish']) { const x = await r.act({ action }); assert.equal(x.status, 403, action); assert.equal(x.json.error, 'not_an_admin'); }
  const res = await call(makeAdminHandler({ store: memoryStore(), auth: async () => 'a' }), { method: 'GET' }); assert.equal(res.statusCode, 405);
});

test('an expired or invalid sign-in is reported as session_expired (401), not as "not an admin"', async () => {
  const h = makeAdminHandler({ store: memoryStore(), auth: async () => 'session_expired', callModel: mockModel });
  for (const action of ['parse', 'save', 'list']) { const res = await call(h, { body: { action } }); assert.equal(res.statusCode, 401, action); assert.equal(json(res).error, 'session_expired'); }
});

test('parse: reads the upload, applies the vision step, names the swimmer only from the coach, never invents', async () => {
  const r = rig(), p = await parsed(r);
  assert.equal(p.layout, 'EO_AI_REPORT_V1'); assert.equal(p.format, 'DOCX'); assert.match(p.sha256, /^[0-9a-f]{64}$/);
  assert.equal(p.analysis.swimmer.name, 'Test Swimmer C'); assert.equal(p.analysis.forceFieldReadings.length, 1); assert.equal(p.analysis.leftRight.avgImpulseW.left.value, 60);
  assert.equal(p.analysis.forceFieldReadings[0].lap.status, 'AMBIGUOUS');
  const noName = await r.act({ action: 'parse', file_base64: docxB64(), filename: 'x.docx' });
  assert.equal(noName.json.analysis.swimmer.name, 'Unnamed swimmer');
  assert.equal((await r.act({ action: 'parse', file_base64: '' })).status, 400);
  assert.equal((await r.act({ action: 'parse', file_base64: Buffer.from('not a report at all, just text').toString('base64') })).json.error, 'unsupported_format');
});

test('parse without a model still returns the deterministic evidence; a report with no pictures has nothing for the vision step', async () => {
  const noPics = await parseUpload({ fileBase64: docxB64({}, false), filename: 'x.docx' }, { callModel: mockModel });
  assert.equal(noPics.vision, null); assert.equal(noPics.analysis.forceFieldReadings.length, 0);
  const out = await parseUpload({ fileBase64: docxB64(), filename: 'x.docx' }, { callModel: null });
  assert.equal(out.vision, null); assert.equal(out.analysis.forceFieldReadings.length, 0); assert.equal(out.analysis.metrics.strokeRate.value, 40.1);
});

test('parse: a failing model never fails the upload', async () => {
  const out = await parseUpload({ fileBase64: docxB64(), filename: 'x.docx' }, { callModel: async () => { throw new Error('model down'); } });
  assert.equal(out.vision.ok, false); assert.ok(out.analysis.sourceIssues.some((i) => i.id === 'vision-failed')); assert.equal(out.analysis.metrics.strokeRate.value, 40.1);
});

test('save validates, strips derived layers, round-trips, and is listable; a name is required', async () => {
  const r = rig(), p = await parsed(r);
  const bad = await r.act({ action: 'save', analysis: { ...p.analysis, schemaVersion: 2 } }); assert.equal(bad.status, 400); assert.equal(bad.json.error, 'analysis_invalid');
  const unnamed = JSON.parse(JSON.stringify(p.analysis)); unnamed.swimmer.name = '   ';
  assert.equal((await r.act({ action: 'save', analysis: unnamed })).json.error, 'swimmer_name_required');
  const dirty = { ...p.analysis, aquaSharksFindings: [{ id: 'x' }], priorities: [{ id: 'y' }] };
  const s = await r.act({ action: 'save', analysis: dirty, profile: 'JUNIOR', filename: 'x.docx', file_base64: docxB64() });
  assert.equal(s.status, 200); assert.equal(s.json.status, 'draft');
  const g = await r.act({ action: 'get', id: s.json.id });
  assert.deepEqual(g.json.assessment.analysis.aquaSharksFindings, []); assert.deepEqual(g.json.assessment.analysis.priorities, []);
  assert.equal(g.json.assessment.communication_profile, 'JUNIOR'); assert.equal(g.json.assessment.swimmer_key, 'test swimmer c'); assert.equal(g.json.assessment.session_date, '2026-05-12');
  assert.ok(g.json.assessment.source_file_path.endsWith('/source.docx')); assert.ok(r.store.files.has(g.json.assessment.source_file_path), 'the original upload is kept privately');
  const l = await r.act({ action: 'list', name: ' TEST swimmer C ' }); assert.equal(l.json.assessments.length, 1); assert.equal(l.json.assessments[0].analysis, undefined, 'list never returns the analysis');
  const s2 = await r.act({ action: 'save', id: s.json.id, analysis: p.analysis, profile: 'PERFORMANCE' }); assert.equal(s2.json.id, s.json.id, 'saving again updates, not duplicates');
  assert.equal((await r.act({ action: 'get', id: 'not-an-id' })).status, 400); assert.equal((await r.act({ action: 'get', id: crypto.randomUUID() })).status, 404);
});

test('cleanForStorage rejects oversized analyses', () => {
  const a = JSON.parse(JSON.stringify({ schemaVersion: 3, swimmer: { name: 'X' }, session: {}, coachReview: { findings: {} }, big: 'x'.repeat(2.1 * 1024 * 1024) }));
  assert.throws(() => cleanForStorage(a), (e) => e.code === 'analysis_too_large');
});

test('readiness: name and evidence block; undecided conflicts and unapproved findings warn', async () => {
  const r = rig(), p = await parsed(r);
  const rd = readiness(p.analysis, 'PERFORMANCE');
  assert.deepEqual(rd.blockers, []); assert.ok(rd.warnings.some((w) => /conflicting printed values/.test(w))); assert.ok(rd.warnings.some((w) => /not been approved/.test(w)));
  assert.ok(readiness(p.analysis, 'COACH').blockers.some((b) => /swimmer-facing profile/.test(b)));
  const empty = (await parseUpload({ fileBase64: docxB64({ noTable: true, force: [], srp: [], pvt: [] }), filename: 'x.docx' }, {})).analysis; empty.swimmer.name = 'Someone';
  assert.ok(readiness(empty, 'PERFORMANCE').blockers.some((b) => /not enough evidence/.test(b)));
  const named = JSON.parse(JSON.stringify(p.analysis)); named.swimmer.name = '';
  assert.ok(readiness(named, 'PERFORMANCE').blockers.some((b) => /name/.test(b)));
});

test('publish: blockers stop it, warnings need acknowledgement, a token and a frozen snapshot are created', async () => {
  const r = rig(), p = await parsed(r), s = await r.act({ action: 'save', analysis: p.analysis, profile: 'PERFORMANCE' });
  const noProfile = await r.act({ action: 'publish', id: s.json.id, analysis: p.analysis, profile: 'COACH' }); assert.equal(noProfile.status, 422); assert.equal(noProfile.json.error, 'not_ready');
  const w = await r.act({ action: 'publish', id: s.json.id, analysis: p.analysis, profile: 'PERFORMANCE' }); assert.equal(w.status, 409); assert.equal(w.json.error, 'warnings_unacknowledged'); assert.ok(w.json.warnings.length);
  assert.equal((await r.store.getById(s.json.id)).status, 'draft', 'nothing is published until acknowledged');
  const ok = await r.act({ action: 'publish', id: s.json.id, analysis: p.analysis, profile: 'PERFORMANCE', acknowledge_warnings: true });
  assert.equal(ok.status, 200); assert.ok(isToken(ok.json.token)); assert.equal(ok.json.url, `https://example.test/aquasharks-lab/report/${ok.json.token}`); assert.equal(ok.json.pdf_url, `https://example.test/api/lab-report-pdf?t=${ok.json.token}`);
  const row = await r.store.getById(s.json.id);
  assert.equal(row.status, 'published'); assert.equal(row.published_report.profile, 'PERFORMANCE'); assert.ok(row.published_report.model.sections.length);
  const again = await r.act({ action: 'publish', id: s.json.id, analysis: p.analysis, profile: 'JUNIOR', acknowledge_warnings: true });
  assert.equal(again.json.token, ok.json.token, 're-publishing keeps the same link');
});

test('the published snapshot and public page contain the swimmer report only: no coach view, EO diagnoses, clinical advice or conflicting figures', async () => {
  const r = rig(), p = await parsed(r), s = await r.act({ action: 'save', analysis: p.analysis, profile: 'PERFORMANCE' });
  const pub = (await r.act({ action: 'publish', id: s.json.id, analysis: p.analysis, profile: 'PERFORMANCE', acknowledge_warnings: true })).json;
  const row = await r.store.getById(s.json.id), snap = JSON.stringify(row.published_report);
  assert.ok(!/EVIDENCE|DATA_QUALITY|"SOURCE"/.test(snap), 'no coach sections in the snapshot');
  const page = await call(r.pub, { method: 'GET', query: { t: pub.token } });
  assert.equal(page.statusCode, 200); assert.match(page.headers['content-type'], /text\/html/); assert.match(page.headers['x-robots-tag'], /noindex/); assert.equal(page.headers['cache-control'], 'no-store'); assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.match(page.body, /Test Swimmer C/); assert.match(page.body, /noindex/); assert.match(page.body, /Download PDF/);
  for (const forbidden of [/physiotherapist/i, /catch problem/i, /EVIDENCE AND CLASSIFICATION/, /Source conflicts/, /Coach confirmation/i, /selection basis/i, /rv-conf-/, /40\.8%/]) assert.doesNotMatch(page.body, forbidden, String(forbidden));
  const printPage = await call(r.pub, { method: 'GET', query: { t: pub.token, print: '1' } }); assert.doesNotMatch(printPage.body, /Download PDF/);
});

test('coach edits and suppressions are what gets published; the swimmer never sees a suppressed finding', async () => {
  const r = rig(), p = await parsed(r), a = JSON.parse(JSON.stringify(p.analysis));
  a.coachReview = { findings: { 'power-effectiveness': { status: 'EDITED', editedText: 'Coach wording for the swimmer.' }, 'asymmetry-profile': { status: 'SUPPRESSED' } } };
  const s = await r.act({ action: 'save', analysis: a, profile: 'PERFORMANCE' });
  const pub = (await r.act({ action: 'publish', id: s.json.id, analysis: a, profile: 'PERFORMANCE', acknowledge_warnings: true })).json;
  const page = (await call(r.pub, { method: 'GET', query: { t: pub.token } })).body;
  assert.match(page, /Coach wording for the swimmer\./); assert.doesNotMatch(page, /data-sec="ARMS"/); assert.doesNotMatch(page, /Smooth out your/);
});

test('public endpoint: invalid, unknown and withdrawn tokens are all the same 404; withdrawal is immediate', async () => {
  const r = rig(), p = await parsed(r), s = await r.act({ action: 'save', analysis: p.analysis, profile: 'PERFORMANCE' });
  const pub = (await r.act({ action: 'publish', id: s.json.id, analysis: p.analysis, profile: 'PERFORMANCE', acknowledge_warnings: true })).json;
  for (const t of [undefined, '', 'short', 'x'.repeat(40), '../../etc/passwd', 'a'.repeat(100)]) { const x = await call(r.pub, { method: 'GET', query: { t } }); assert.equal(x.statusCode, 404, String(t)); assert.match(x.body, /not available/); }
  assert.equal((await call(r.pub, { method: 'GET', query: { t: pub.token } })).statusCode, 200);
  assert.equal((await r.act({ action: 'unpublish', id: s.json.id })).status, 200);
  assert.equal((await call(r.pub, { method: 'GET', query: { t: pub.token } })).statusCode, 404);
  assert.equal((await r.store.getById(s.json.id)).share_token, null);
  const re = (await r.act({ action: 'publish', id: s.json.id, analysis: p.analysis, profile: 'PERFORMANCE', acknowledge_warnings: true })).json;
  assert.notEqual(re.token, pub.token, 'a withdrawn link is never reused');
});

test('PDF endpoint: only for published tokens, renders the public print page, safe attachment name', async () => {
  const r = rig(), p = await parsed(r), s = await r.act({ action: 'save', analysis: p.analysis, profile: 'PERFORMANCE' });
  const pub = (await r.act({ action: 'publish', id: s.json.id, analysis: p.analysis, profile: 'PERFORMANCE', acknowledge_warnings: true })).json;
  const ok = await call(r.pdf, { method: 'GET', query: { t: pub.token } });
  assert.equal(ok.statusCode, 200); assert.equal(ok.headers['content-type'], 'application/pdf'); assert.match(ok.headers['content-disposition'], /^attachment; filename="Aqua-Sharks-SwimBETTER-Test-Swimmer-C-2026-05-12\.pdf"$/);
  assert.match(String(ok.body), new RegExp(`https://example.test/aquasharks-lab/report/${pub.token}\\?print=1`)); assert.equal(r.renders(), 1);
  const before = r.renders();
  for (const t of ['short', 'x'.repeat(40)]) assert.equal((await call(r.pdf, { method: 'GET', query: { t } })).statusCode, 404);
  await r.act({ action: 'unpublish', id: s.json.id }); assert.equal((await call(r.pdf, { method: 'GET', query: { t: pub.token } })).statusCode, 404);
  assert.equal(r.renders(), before, 'no browser is launched for an unknown or withdrawn token');
});

test('helpers: tokens, file names, escaping', () => {
  assert.ok(isToken(newToken())); assert.notEqual(newToken(), newToken()); assert.equal(isToken('abc'), false); assert.equal(isToken(undefined), false);
  assert.equal(pdfFileName('Zoë O’Brien', '2026-01-02'), 'Aqua-Sharks-SwimBETTER-Zoe-OBrien-2026-01-02.pdf'); assert.equal(pdfFileName('../x"y', null), 'Aqua-Sharks-SwimBETTER-x-y.pdf'.replace('x-y', 'xy'));
  const snap = buildSnapshot(emptyAnalysis('A'), 'COACH');
  assert.equal(snap.profile, 'PERFORMANCE', 'a coach profile can never be published: it falls back to a swimmer profile');
  const html = renderPublicPage({ snapshot: { model: { profile: { id: 'PERFORMANCE' }, sections: [] } }, name: '<script>alert(1)</script>', date: null, token: 't"x', print: false });
  assert.doesNotMatch(html, /<script>alert/); assert.match(html, /&lt;script&gt;/);
});

test('before the migration exists, public and PDF endpoints answer 404 (not 500) and the admin API says storage is not ready', async () => {
  const broken = { getByToken: async () => { throw new Error('db 404 {"code":"PGRST205","message":"Could not find the table \'public.swim_lab_assessments\'"}'); }, list: async () => { throw new Error('db 404 PGRST205 swim_lab_assessments'); } };
  const tok = newToken();
  assert.equal((await call(makePublicHandler({ store: broken }), { method: 'GET', query: { t: tok } })).statusCode, 404);
  assert.equal((await call(makePdfHandler({ store: broken, baseUrl: () => 'x', render: async () => Buffer.from('') }), { method: 'GET', query: { t: tok } })).statusCode, 404);
  const a = await call(makeAdminHandler({ store: broken, auth: async () => 'a' }), { body: { action: 'list' } });
  assert.equal(a.statusCode, 503); assert.equal(json(a).error, 'storage_not_ready');
});
