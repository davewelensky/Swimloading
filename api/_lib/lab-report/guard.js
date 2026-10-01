// Flags any figure in the coaching text that is not in the EO data, the previous assessment or the coaching rules.
// ---- number guard: every figure in the coaching text must exist in the data or the rules ----
function numbersIn(s) { return (String(s).match(/\d+(?:\.\d+)?/g) || []).map(n => +n); }
export function allowedNumbers(normalized, rules, previous) {
  const set = new Set();
  const add = v => { if (typeof v === 'number') { set.add(+v.toFixed(4)); set.add(Math.round(v)); set.add(+v.toFixed(1)); } };
  Object.values(normalized.metrics || {}).forEach(add);
  Object.values((previous && previous.metrics) || {}).forEach(add);
  const m = normalized.metrics || {};
  add((m.leftward_force_pct || 0) + (m.rightward_force_pct || 0));
  [normalized.eo_observations, normalized.single_stroke_examples, rules].forEach(x => numbersIn(JSON.stringify(x || '')).forEach(add));
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 25, 50, 100].forEach(n => set.add(n)); // counts, ordinals, generic pool distances
  return set;
}
export function guardNumbers(interp, allowed) {
  const warnings = [];
  (function walk(v, path) {
    if (typeof v === 'string') {
      // ignore bare words like "4 x 25 m" set structure by only checking figures with a % or decimal point
      (v.match(/\d+(?:\.\d+)?\s?%|\d+\.\d+/g) || []).forEach(tok => {
        const n = parseFloat(tok);
        if (!allowed.has(n) && !allowed.has(+n.toFixed(1)) && !allowed.has(Math.round(n))) warnings.push({ path, number: tok.trim(), text: v.slice(0, 140) });
      });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') Object.keys(v).forEach(k => walk(v[k], `${path}.${k}`));
  })(interp, 'interpretation');
  return warnings;
}

