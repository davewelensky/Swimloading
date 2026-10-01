// DEV SPIKE (not production): runs deterministic extractors over an EO "SwimBETTER Analysis Report" .docx and prints, per
// SwimAnalysis field: method, extracted value, and whether it matches the synthetic fixture's number.
// Output is field-level only; EO prose is never printed or stored. Usage: node scripts/lab-parse-specimen.mjs <file.docx>
import { execFileSync } from 'node:child_process';
import testSwimmerA from '../aquasharks-lab/analysis/fixtures/test-swimmer-a-200m.js';

const file = process.argv[2]; if (!file) { console.error('usage: lab-parse-specimen.mjs <file.docx>'); process.exit(1); }
const xml = execFileSync('unzip', ['-p', file, 'word/document.xml'], { maxBuffer: 1 << 28 }).toString('utf8');
const rels = execFileSync('unzip', ['-p', file, 'word/_rels/document.xml.rels'], { maxBuffer: 1 << 24 }).toString('utf8');
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const paraText = (p) => decode([...p.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:br\s*\/>|<w:tab\s*\/>/g)].map((m) => (m[1] !== undefined ? m[1] : m[0].startsWith('<w:br') ? '\n' : '\t')).join(''));

// ---- 1. structure: ordered blocks with style, table cells, and embedded images ----
const blocks = [];
for (const m of xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g)) {
  if (m[0].startsWith('<w:tbl>')) blocks.push({ type: 'table', rows: [...m[0].matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((r) => [...r[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((c) => paraText(c[0]).trim())) });
  else { const st = /<w:pStyle w:val="([^"]+)"/.exec(m[0]); blocks.push({ type: 'p', style: st ? st[1] : '', text: paraText(m[0]), image: /<w:drawing>/.test(m[0]) ? (/r:embed="([^"]+)"/.exec(m[0]) || [])[1] : null }); }
}
const sections = []; let cur = null;
for (const b of blocks) { if (b.type === 'p' && /^Heading[12]$/.test(b.style)) { cur = { heading: b.text.trim(), level: b.style, blocks: [] }; sections.push(cur); } else if (cur) cur.blocks.push(b); }
const rows = []; const out = (path, method, extracted, expected) => rows.push({ path, method, extracted, expected, ok: expected === undefined ? '' : (String(extracted) === String(expected) ? 'MATCH' : 'DIFF') });

// ---- 2. header + summary (label scanning: labels may run together without separators) ----
const head = blocks.find((b) => b.type === 'p' && /^Swim date and time:/.test(b.text));
const hm = head && /(\w+) (\d{1,2}), (\d{4}) at (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)/.exec(head.text);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
if (hm) { out('session.date', 'TEXT: header', `${hm[3]}-${String(MONTHS.indexOf(hm[1]) + 1).padStart(2, '0')}-${hm[2].padStart(2, '0')}`); out('session.startTime (new)', 'TEXT: header', `${hm[4]}:${hm[5]} ${hm[7]}`); }
const sumBlock = blocks.find((b) => b.type === 'p' && /^Stroke:/.test(b.text));
const LABELS = ['Stroke', 'Swimmer type', 'Distance', 'Pool type', 'Location', 'Laps', 'Time', 'Strokes', 'Avg Stroke rate', 'DPS', 'Avg PPS', 'Work', 'Propulsive', 'swap'];
const fields = {};
if (sumBlock) {
  const pos = LABELS.map((l) => ({ l, i: sumBlock.text.indexOf(l + ':') })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i);
  pos.forEach((p, k) => { fields[p.l] = sumBlock.text.slice(p.i + p.l.length + 1, k + 1 < pos.length ? pos[k + 1].i : undefined).trim(); });
}
const numOf = (s) => { const m = /(-?\d+(?:\.\d+)?)/.exec(s || ''); return m ? +m[1] : null; };
const tm = /(\d+)\s*mins?\s*(\d+(?:\.\d+)?)\s*sec/i.exec(fields.Time || '');
const A = testSwimmerA;
out('session.stroke', 'TEXT: summary label', fields.Stroke || null, A.session.stroke.value);
out('source.analysisContext.swimmerType', 'TEXT: summary label', fields['Swimmer type'] || null, A.source.analysisContext.swimmerType);
out('session.distanceM', 'TEXT: summary label', numOf(fields.Distance), A.session.distanceM.value);
out('session.poolLengthM', 'TEXT: summary label', numOf(fields['Pool type']), A.session.poolLengthM.value);
out('session.location', 'TEXT: summary label (identifying: coach-confirm before storing)', fields.Location ? '(present)' : null);
out('session.laps', 'TEXT: summary label', numOf(fields.Laps), A.session.laps.value);
out('session.timeS', 'TEXT: summary label, "m s" parse', tm ? +tm[1] * 60 + +tm[2] : null, A.session.timeS.value);
out('session.strokeCount', 'TEXT: summary label', numOf(fields.Strokes), A.session.strokeCount.value);
out('metrics.strokeRate', 'TEXT: summary label', numOf(fields['Avg Stroke rate']), A.metrics.strokeRate.value);
out('metrics.distancePerStrokeM', 'TEXT: summary label', numOf(fields.DPS), A.metrics.distancePerStrokeM.value);
out('metrics.avgPowerW', 'TEXT: summary label', numOf(fields['Avg PPS']), A.metrics.avgPowerW.value);
out('metrics.workKj', 'TEXT: summary label', numOf(fields.Work), A.metrics.workKj.value);
out('metrics.propulsivePct', 'TEXT: summary label', numOf(fields.Propulsive), A.metrics.propulsivePct.value);
out('(unmapped) summary "swap"', 'TEXT: summary label', fields.swap || null);

// ---- 3. the one real table: actual vs EO target per direction ----
const tbl = blocks.find((b) => b.type === 'table');
const dir = { Leftward: 'leftwardPct', Propulsive: 'propulsivePct', Rightward: 'rightwardPct', Upward: 'upwardPct', 'Hand Drag': 'handDragPct', Downward: 'downwardPct' };
const tableShape = tbl ? `${tbl.rows.length} rows` : 'none';
// layout: a label row (cells span two columns) -> an "Actual/Target" row -> a values row holding [actual, target] per label
if (tbl) for (let i = 0; i + 2 < tbl.rows.length; i += 3) {
  const labels = tbl.rows[i], vals = tbl.rows[i + 2];
  labels.forEach((name, k) => {
    const key = dir[name]; if (!key) return;
    out(`forceDistribution.overall.${key}`, 'TABLE: label row, then [Actual, Target] pair', numOf(vals[2 * k]), A.forceDistribution.overall[key].value);
    const ref = A.eoReferenceRanges[key]; out(`eoReferenceRanges.${key}`, 'TABLE: Target cell', (vals[2 * k + 1] || '').replace(/\s/g, ''), ref && ref.text);
  });
}

// ---- 4. narrative numbers (alternate values, per-lap double peaks) ----
const body = (name) => (sections.find((s) => s.heading === name) || { blocks: [] }).blocks.filter((b) => b.type === 'p').map((b) => b.text).join('\n');
const allText = blocks.filter((b) => b.type === 'p').map((b) => b.text).join('\n');
const alt = (re) => { const m = re.exec(allText); return m ? +m[1] : null; };
out('metrics.propulsivePct.alternates[narrative]', 'TEXT: narrative regex', alt(/producing (?:only )?(\d+(?:\.\d+)?)% propulsive/i), A.metrics.propulsivePct.alternates[0].value);
out('forceDistribution.overall.downwardPct.alternate[narrative]', 'TEXT: narrative regex', alt(/downward force \((\d+(?:\.\d+)?)%\)/i));
out('forceDistribution.overall.leftwardPct.alternate[narrative]', 'TEXT: narrative regex', alt(/leftward force \((\d+(?:\.\d+)?)%\)/i));
out('forceDistribution.overall.rightwardPct.alternate[narrative]', 'TEXT: narrative regex', alt(/rightward force \((\d+(?:\.\d+)?)%\)/i));
out('(source issue) arm-gap figure', 'TEXT: narrative regex', alt(/(\d+(?:\.\d+)?)% power difference between arms/i));
const laps = [...allText.matchAll(/lap (\d) \((\d+(?:\.\d+)?)%/gi)].map((m) => ({ lap: +m[1], pct: +m[2] }));
const byLap = Array.from({ length: 8 }, (_, i) => (laps.find((l) => l.lap === i + 1) || {}).pct ?? null);
out('powerProfile.right.doublePeakPctByLap', 'TEXT: "lap n (x%)" list', JSON.stringify(byLap), JSON.stringify(A.powerProfile.right.doublePeakPctByLap.map((m) => m.value)));
out('powerProfile.left.doublePeakPctByLap', 'TEXT: "n% double peaks" pattern', /\b0% double peaks/i.test(allText) ? 'all 0' : null);

// ---- 5. structure-only fields ----
const prio = blocks.filter((b) => b.type === 'p' && /^Heading3$/.test(b.style) && /^Priority \d/.test(b.text));
out('eoRecommendations (count by Priority heading)', 'STRUCTURE: Heading3 "Priority n"', prio.length);
const lastRec = (sections.find((s) => s.heading === 'What to Work On') || { blocks: [] }).blocks.filter((b) => b.type === 'p' && b.style !== 'Heading3').slice(-1)[0];
out('eoRecommendations[last].truncated', 'STRUCTURE: no terminal punctuation', lastRec ? !/[.!?]\s*$/.test(lastRec.text.trim()) : null);
const imgs = blocks.filter((b) => b.type === 'p' && b.image); const relMap = Object.fromEntries([...rels.matchAll(/Id="(rId\d+)"[^>]*Target="media\/([^"]+)"/g)].map((m) => [m[1], m[2]]));
const captions = [...allText.matchAll(/^Image \d: (.+)$/gm)].map((m) => m[1]);
out('evidence images (embedded in body)', 'STRUCTURE: w:drawing + caption line', `${imgs.length} images; captions: ${captions.join(' | ')}`);
const h3 = (name) => { const i = blocks.findIndex((b) => b.type === 'p' && b.style === 'Heading3' && b.text.trim() === name); if (i < 0) return ''; const out2 = []; for (let j = i + 1; j < blocks.length && !(blocks[j].type === 'p' && /^Heading/.test(blocks[j].style)); j++) if (blocks[j].type === 'p') out2.push(blocks[j].text); return out2.join('\n'); };
const sentences = (name) => h3(name).split(/(?<=[.!?])\s+/).filter(Boolean).length;
out('eoObservations (sentence counts by section)', 'STRUCTURE: Heading3 + sentence split (claimType needs a classifier)', ['Force Field', 'Stroke Rate & Power', 'Power vs Time'].map((n) => `${n}: ${sentences(n)}`).join(', '));
out('eoReferenceRanges header', 'STRUCTURE: Heading1', (blocks.find((b) => b.type === 'p' && /^Target Distribution of Power/.test(b.text)) || { text: '' }).text.replace(/ - /g, ' / '));
out('swimmer.name / age', 'NOT IN DOCUMENT', null);
console.log(`table shape: ${tableShape}; sections: ${sections.map((s) => s.heading.slice(0, 24)).join(' | ')}`);
const w = (s, n) => String(s).slice(0, n).padEnd(n);
console.log(`\n${w('FIELD', 58)} ${w('METHOD', 52)} ${w('EXTRACTED', 22)} ${w('FIXTURE', 12)} CHECK`);
for (const r of rows) console.log(`${w(r.path, 58)} ${w(r.method, 52)} ${w(r.extracted === null ? 'null' : r.extracted, 22)} ${w(r.expected === undefined ? '' : r.expected, 12)} ${r.ok}`);
const checked = rows.filter((r) => r.ok); console.log(`\nchecked against fixture: ${checked.length}, match ${checked.filter((r) => r.ok === 'MATCH').length}, diff ${checked.filter((r) => r.ok === 'DIFF').length}`);
