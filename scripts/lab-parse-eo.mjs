// Parse an EO report (PDF or DOCX) with the production parser and print the debug rows.
//   node scripts/lab-parse-eo.mjs <file> [--vision]      (--vision needs ANTHROPIC_API_KEY; PDFs are rasterised with pdftoppm)
// Output is field-level (path, source value, normalised value, location, method, status): no EO prose is printed.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { parseEoReport } from '../aquasharks-lab/analysis/parser/index.js';
import { readImageLabels } from '../aquasharks-lab/analysis/parser/vision.js';
import { debugRows, summariseRows } from '../aquasharks-lab/analysis/parser/debug-rows.js';
const [file, flag] = process.argv.slice(2); if (!file) { console.error('usage: lab-parse-eo.mjs <file.pdf|file.docx> [--vision]'); process.exit(1); }
const bytes = new Uint8Array(fs.readFileSync(file));
const r = await parseEoReport(bytes, { filename: path.basename(file) });
console.log(`format ${r.format}, layout ${r.layout}, images ${r.images}, fields extracted ${r.diagnostics.extracted.length}`);
if (flag === '--vision') {
  const { claude } = await import('../api/_lib/lab-report/service.js');
  let src;
  if (r.format === 'DOCX') src = { images: (r.imageData || []).map((x) => ({ base64: Buffer.from(x.bytes).toString('base64'), mediaType: x.mediaType })) };
  else { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-')); execFileSync('pdftoppm', ['-r', '130', '-jpeg', '-jpegopt', 'quality=75', file, path.join(d, 'p')]); src = { images: fs.readdirSync(d).sort().map((f) => ({ base64: fs.readFileSync(path.join(d, f)).toString('base64'), mediaType: 'image/jpeg' })) }; }
  const v = await readImageLabels(r.analysis, src, ({ system, tool, content }) => claude({ system, tool, content, maxTokens: 3000 }));
  console.log('vision:', JSON.stringify({ ok: v.ok, forceField: v.forceField, phaseLap: v.phaseLap, phaseStroke: v.phaseStroke, skipped: v.skipped }));
}
const rows = debugRows(r.analysis); const w = (s, n) => String(s ?? '').slice(0, n).padEnd(n);
console.log(`\n${w('FIELD', 52)} ${w('SOURCE', 14)} ${w('NORMALISED', 16)} ${w('LOCATION', 40)} ${w('METHOD', 10)} STATUS`);
for (const x of rows) console.log(`${w(x.path, 52)} ${w(x.sourceValue, 14)} ${w(x.normalised, 16)} ${w(x.location, 40)} ${w(x.method + (x.confidence ? ':' + x.confidence[0] : ''), 10)} ${x.status}${x.absence ? ' (' + x.absence + ')' : ''}`);
console.log('\n' + JSON.stringify(summariseRows(rows)));
console.log('source issues:', r.analysis.sourceIssues.map((i) => i.kind + ':' + i.id).join(' | ') || 'none');
console.log('coach must supply:', r.diagnostics.coachRequired.join('; '));
