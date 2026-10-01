// Dev harness: interpret an approved normalized fixture. Usage: node scripts/lab-interpret-test.mjs <normalized.json> [mode]
import fs from 'node:fs';
import { interpretTool, INTERPRET_SYSTEM } from '../api/_lib/lab-report/schemas.js';
import { allowedNumbers, guardNumbers } from '../api/_lib/lab-report/guard.js';
import vm from 'node:vm';
const n = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const mode = process.argv[3] || 'masters';
const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync('aquasharks-lab/report-builder/coaching-rules.js', 'utf8'), ctx);
const rules = JSON.parse(JSON.stringify(ctx.window.AS_RULES));
const key = process.env.ANTHROPIC_API_KEY; const model = process.env.LAB_REPORT_MODEL || 'claude-sonnet-5-5';
const payload = { swimmer: n.swimmer, mode, metrics: n.metrics, eo_observations: n.eo_observations, single_stroke_examples: n.single_stroke_examples || [], coaching_rules: rules, previous_assessment: null };
const t0 = Date.now();
const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({ model, max_tokens: 9000, system: INTERPRET_SYSTEM + '\n\nRespond ONLY by calling the ' + interpretTool.name + ' tool.', tools: [interpretTool], tool_choice: { type: 'auto' }, messages: [{ role: 'user', content: [{ type: 'text', text: `Approved EO data and Aqua Sharks coaching rules (JSON). Write the interpretation for swimmer mode "${mode}".\n\n${JSON.stringify(payload)}` }] }] }) });
const j = await r.json(); if (!r.ok) { console.error(JSON.stringify(j).slice(0, 400)); process.exit(1); }
const out = j.content.find(b => b.type === 'tool_use').input;
fs.writeFileSync(process.env.OUT || '/tmp/interp-out.json', JSON.stringify(out, null, 2));
console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s tokens ${j.usage.input_tokens}/${j.usage.output_tokens}`);
console.log('primary:', out.primary_focus.headline.join(' / '), '| metric', out.primary_focus.metric, '|', out.primary_focus.coach_cue);
console.log('secondary:', out.secondary_focus.map(x => x.id + ': ' + x.title).join(' ; '), '| watch', out.watch_item_id);
console.log('strength:', out.strength.title); console.log('cards:', out.stroke_cards.map(c => c.id + '=' + c.status).join(', '));
console.log('targets:', JSON.stringify(out.retest_targets.map(t => ({ id: t.id, metric: t.metric, dir: t.direction, val: t.target_value }))));
console.log('priorities:', out.priorities.map(p => p.id).join(', '));
console.log('why (words):', out.primary_focus.why_it_matters.split(/\s+/).length, '-', out.primary_focus.why_it_matters);
console.log('GUARD warnings:', JSON.stringify(guardNumbers(out, allowedNumbers(n, rules, null)), null, 1));
