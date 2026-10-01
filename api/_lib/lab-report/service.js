// Extract + interpret, shared by /api/lab-report.js and the local dev harness (scripts/lab-report-dev.mjs).
import { allowedNumbers, guardNumbers } from './guard.js';
import { extractTool, EXTRACT_SYSTEM, interpretTool, INTERPRET_SYSTEM, METRIC_KEYS } from './schemas.js';

export const MODEL = process.env.LAB_REPORT_MODEL || 'claude-sonnet-5-5';

async function claude({ system, tool, content, maxTokens }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('ANTHROPIC_API_KEY not set'), { status: 500 });
  // Newer models reject a forced tool_choice, so use auto, instruct, and retry once if no tool call came back.
  const sys = `${system}\n\nRespond ONLY by calling the ${tool.name} tool. Do not write any other text.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens || 8000, system: sys, tools: [tool], tool_choice: { type: 'auto' }, messages: [{ role: 'user', content }] }),
    });
    const j = await r.json();
    if (!r.ok) throw Object.assign(new Error(j?.error?.message || `anthropic ${r.status}`), { status: 502 });
    const block = (j.content || []).find(b => b.type === 'tool_use');
    if (block) return block.input;
  }
  throw Object.assign(new Error('model returned no structured output'), { status: 502 });
}

function cleanMetrics(metrics, confidence) {
  const out = {}, conf = {};
  METRIC_KEYS.forEach(k => {
    const v = metrics && metrics[k];
    out[k] = (typeof v === 'number' && isFinite(v)) ? v : null;
    if (out[k] != null) conf[k] = (confidence && confidence[k]) || 'low';
  });
  return { out, conf };
}


export async function extractReport(pdf) {
  if (!pdf || pdf.length > 28_000_000) throw Object.assign(new Error('pdf_missing_or_too_large'), { status: 400 });
  if (Buffer.from(pdf.slice(0, 16), 'base64').toString('latin1').indexOf('%PDF') !== 0) throw Object.assign(new Error('not_a_pdf'), { status: 400 });
  const out = await claude({
    system: EXTRACT_SYSTEM, tool: extractTool, maxTokens: 6000,
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
      { type: 'text', text: 'Extract this EO Labs SwimBETTER report. Null for anything not printed.' },
    ],
  });
  const { out: metrics, conf } = cleanMetrics(out.metrics, out.confidence);
  return {
    metrics, confidence: conf, source_notes: out.source_notes || {},
    swimmer_found: out.swimmer_found || {}, eo_observations: out.eo_observations || {},
    single_stroke_examples: out.single_stroke_examples || [], section_pages: out.section_pages || {},
    missing: out.missing || [], model: MODEL,
  };
}

export async function interpretReport({ normalized: n, mode, rules, previous }) {
  if (!n || !n.metrics) throw Object.assign(new Error('normalized_required'), { status: 400 });
  mode = ['junior', 'senior', 'masters'].includes(mode) ? mode : 'masters';
  const payload = {
    swimmer: n.swimmer, mode, metrics: n.metrics, eo_observations: n.eo_observations,
    single_stroke_examples: n.single_stroke_examples || [],
    coaching_rules: rules || null, previous_assessment: previous || null,
  };
  const interp = await claude({
    system: INTERPRET_SYSTEM, tool: interpretTool, maxTokens: 14000,
    content: [{ type: 'text', text: `Approved EO data and Aqua Sharks coaching rules (JSON). Write the interpretation for swimmer mode "${mode}".\n\n${JSON.stringify(payload)}` }],
  });
  interp.approval = { status: 'draft', approved_by: null, approved_at: null };
  return { interpretation: interp, warnings: guardNumbers(interp, allowedNumbers(n, rules, previous)), model: MODEL };
}
