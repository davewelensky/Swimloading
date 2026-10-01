// Model access for the lab report workflow. The only model use is the vision step (reading text printed inside images);
// all interpretation is the deterministic engine in aquasharks-lab/analysis.
export const MODEL = process.env.LAB_REPORT_MODEL || 'claude-sonnet-5-5';

/** One tool-use call. Newer models reject a forced tool_choice, so use auto, instruct, and retry once. */
export async function claude({ system, tool, content, maxTokens }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('ANTHROPIC_API_KEY not set'), { status: 500 });
  const sys = `${system}\n\nRespond ONLY by calling the ${tool.name} tool. Do not write any other text.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens || 4000, system: sys, tools: [tool], tool_choice: { type: 'auto' }, messages: [{ role: 'user', content }] }),
    });
    const j = await r.json();
    if (!r.ok) throw Object.assign(new Error(j?.error?.message || `anthropic ${r.status}`), { status: 502 });
    const block = (j.content || []).find((b) => b.type === 'tool_use');
    if (block) return block.input;
  }
  throw Object.assign(new Error('model returned no structured output'), { status: 502 });
}
