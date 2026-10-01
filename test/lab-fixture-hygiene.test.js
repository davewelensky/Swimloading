// The repository is public. Test fixtures must exercise OUR schema, not reproduce an EO report or identify a person.
//  - no verbatim EO prose anywhere in the lab code (checked by hashed 6-word runs, so the prose itself is not stored)
//  - no real identity in fixtures
//  - no EO images / sample report PDFs committed
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { hashes, tokens, SHINGLE } from '../scripts/lab-eo-fingerprints.mjs';
import A from '../aquasharks-lab/analysis/fixtures/test-swimmer-a-200m.js';
import B from '../aquasharks-lab/analysis/fixtures/test-swimmer-b-sprint.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fp = JSON.parse(readFileSync(path.join(ROOT, 'test/lab-eo-fingerprints.json'), 'utf8'));
const EO = new Set(fp.hashes);

function walkFiles(dir, out = []) {
  for (const f of readdirSync(dir)) { const p = path.join(dir, f); statSync(p).isDirectory() ? walkFiles(p, out) : out.push(p); }
  return out;
}
const textFiles = (dir) => walkFiles(path.join(ROOT, dir)).filter((f) => /\.(js|mjs|json|md|html|css|ts)$/.test(f));

const SCANNED = [
  ...textFiles('aquasharks-lab'),
  path.join(ROOT, 'aquasharks-report-preview.html'), path.join(ROOT, 'aquasharks-lab-report-builder.html'),
  ...walkFiles(path.join(ROOT, 'api/_lib/lab-report')), path.join(ROOT, 'api/lab-report.js'),
  ...walkFiles(path.join(ROOT, 'test')).filter((f) => /lab-/.test(path.basename(f)) && !/fingerprints/.test(f)),
];

test('fingerprint file is real: hashes only, plenty of them, no prose', () => {
  assert.equal(fp.shingle, SHINGLE); assert.ok(fp.count > 1000 && fp.hashes.length === fp.count);
  assert.ok(fp.hashes.every((h) => /^[0-9a-f]{16}$/.test(h)), 'only 16-hex hashes');
});

test('the detector itself works: a copied run of EO words would be caught', () => {
  const made = 'the quick brown swimmer reads seven different words aloud tonight';
  const planted = new Set([...EO, ...hashes(made)]);
  assert.ok([...hashes('prefix ' + made + ' suffix')].some((h) => planted.has(h)), 'a 6-word run in a file is detected once its hash is in the set');
  assert.equal([...hashes('totally unrelated words that were never in any report')].some((h) => EO.has(h)), false);
});

// Table column labels are interoperability vocabulary (the parser and its synthetic test documents must repeat them), not prose.
const LABEL_VOCAB = new Set(['leftward', 'propulsive', 'rightward', 'upward', 'hand', 'drag', 'downward', 'actual', 'target']);
const isLabelRun = (run) => run.split(' ').every((w) => LABEL_VOCAB.has(w) || /^[0-9%.<>-]+$/.test(w));

test('no verbatim EO narrative (any 6-word run) in the lab code, fixtures, preview pages or lab tests', () => {
  assert.ok(SCANNED.length > 20, 'the scan covers real files');
  for (const file of SCANNED) {
    const t = tokens(readFileSync(file, 'utf8')); const hits = [];
    for (let i = 0; i + SHINGLE <= t.length; i++) { const run = t.slice(i, i + SHINGLE); if (EO.has(crypto.createHash('sha256').update(run.join(' ')).digest('hex').slice(0, 16)) && !isLabelRun(run.join(' '))) hits.push(run.join(' ')); }
    assert.equal(hits.length, 0, `${path.relative(ROOT, file)} contains ${hits.length} 6-word run(s) copied from an EO report`);
  }
});

test('fixtures carry no real identity', () => {
  const fixtureFiles = walkFiles(path.join(ROOT, 'aquasharks-lab/analysis/fixtures'));
  assert.ok(fixtureFiles.length >= 2);
  for (const f of fixtureFiles) assert.doesNotMatch(readFileSync(f, 'utf8'), /dave|welensky|johan|wembley|britt|steve\b|k8|aquasharks/i, path.relative(ROOT, f));
  assert.equal(A.swimmer.name, 'Test Swimmer A'); assert.equal(B.swimmer.name, 'Test Swimmer B');
  assert.deepEqual(path.basename(fixtureFiles[0]).match(/dave/i), null);
  for (const fx of [A, B]) assert.doesNotMatch(JSON.stringify(fx), /dave|welensky|wembley|\.docx|\.pdf|eoi report/i, fx.swimmer.name);
  assert.equal(A.session.location.value, 'Test pool');
});

test('fixture prose is short paraphrase: short sentences, no quotation, field labels only in provenance.raw', () => {
  for (const fx of [A, B]) {
    const words = (s) => String(s).trim().split(/\s+/).length;
    for (const o of fx.eoObservations) { assert.ok(words(o.text) <= 20, `${o.id}: ${words(o.text)} words`); assert.doesNotMatch(o.text, /["“”]/); }
    for (const r of fx.eoRecommendations) { assert.ok(words(r.text) <= 20, `${r.id}: ${words(r.text)} words`); assert.doesNotMatch(r.text, /["“”]/); }
    for (const i of fx.sourceIssues) assert.ok(words(i.message) <= 45, `${i.id}: ${words(i.message)} words`);
  }
  (function walk(o, p) {
    if (!o || typeof o !== 'object') return;
    if (o.provenance && typeof o.provenance.raw === 'string') assert.ok(o.provenance.raw.trim().split(/\s+/).length <= 8, `${p}: provenance.raw must be a label, not a sentence`);
    for (const k of Object.keys(o)) walk(o[k], `${p}.${k}`);
  })(A, 'A');
});

test('numeric test data and interoperability labels are retained', () => {
  assert.equal(A.session.distanceM.value, 200); assert.equal(A.metrics.distancePerStrokeM.value, 2.82); assert.equal(A.forceDistribution.overall.downwardPct.value, 40.4);
  assert.equal(A.session.timeS.provenance.raw, 'Time'); assert.equal(A.metrics.avgPowerW.provenance.raw, 'Avg PPS');
  assert.ok(Object.keys(A.eoReferenceRanges).length === 6);
});

test('no EO images, sample report PDFs or EO-prose fixtures remain in the repo tree', () => {
  assert.equal(existsSync(path.join(ROOT, 'aquasharks-lab/report-builder/evidence')), false);
  assert.equal(existsSync(path.join(ROOT, 'aquasharks-lab/report-builder/fixtures')), false);
  assert.equal(existsSync(path.join(ROOT, 'aquasharks-lab/report-builder/samples')), false);
  assert.equal(existsSync(path.join(ROOT, 'aquasharks-report-preview-v1.html')), false);
  const binaries = walkFiles(path.join(ROOT, 'aquasharks-lab')).filter((f) => /\.(jpg|jpeg|png|pdf|docx)$/i.test(f));
  assert.deepEqual(binaries.map((f) => path.relative(ROOT, f)), []);
});
