// Dev harness: run an EO PDF through the extraction prompt/schema (no auth, no DB) and diff it
// against a hand-built fixture. Usage: node scripts/lab-extract-test.mjs <pdf> <fixture.json>
import fs from 'node:fs';
import { extractTool, EXTRACT_SYSTEM, METRIC_KEYS } from '../api/_lib/lab-report/schemas.js';
const [pdfPath, fixPath] = process.argv.slice(2);
const key = process.env.ANTHROPIC_API_KEY; if (!key) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }
const model = process.env.LAB_REPORT_MODEL || 'claude-sonnet-5-5';
const t0 = Date.now();
const r = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({ model, max_tokens: 6000, system: EXTRACT_SYSTEM + '\n\nRespond ONLY by calling the ' + extractTool.name + ' tool.', tools: [extractTool], tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(pdfPath).toString('base64') } }, { type: 'text', text: 'Extract this EO Labs SwimBETTER report. Null for anything not printed.' }] }] }),
});
const j = await r.json();
if (!r.ok) { console.error(JSON.stringify(j).slice(0, 500)); process.exit(1); }
const out = j.content.find(b => b.type === 'tool_use').input;
console.log(`model ${model}, ${((Date.now() - t0) / 1000).toFixed(1)}s, tokens in/out ${j.usage.input_tokens}/${j.usage.output_tokens}`);
fs.writeFileSync(process.env.OUT || '/tmp/extract-out.json', JSON.stringify(out, null, 2));
const fx = JSON.parse(fs.readFileSync(fixPath, 'utf8'));
let match = 0, diff = 0;
for (const k of METRIC_KEYS) {
  const a = out.metrics?.[k] ?? null, b = fx.metrics[k] ?? null;
  if (a === b) { match++; if (a != null) console.log(`  ok    ${k} = ${a} [${out.confidence?.[k]}]`); }
  else { diff++; console.log(`  DIFF  ${k}: extracted ${a} vs fixture ${b} [${out.confidence?.[k]}] ${out.source_notes?.[k] || ''}`); }
}
console.log(`metrics: ${match} equal, ${diff} differ`);
for (const k of Object.keys(fx.eo_observations)) {
  const a = (out.eo_observations?.[k] || []).join(' ').replace(/\s+/g, ' ').trim();
  const b = fx.eo_observations[k].join(' ').replace(/\s+/g, ' ').trim();
  console.log(`  obs ${k}: ${a === b ? 'verbatim match' : a ? 'DIFFERS' : 'EMPTY'}`);
  if (a && a !== b) console.log(`     got: ${a.slice(0, 160)}\n     fix: ${b.slice(0, 160)}`);
}
console.log('single_stroke:', JSON.stringify(out.single_stroke_examples));
console.log('section_pages:', JSON.stringify(out.section_pages));
console.log('missing:', JSON.stringify(out.missing));
