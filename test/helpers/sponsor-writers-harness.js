// Runs the REAL write-path functions out of sponsors-commercial.js and
// sponsor-pipeline.html in a vm with a minimal fake DOM, so regression tests
// exercise shipped code rather than a re-implementation of it.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');
export const PIPELINE_HTML = read('sponsor-pipeline.html');
export const COMMERCIAL_JS = read('sponsors-commercial.js');
export const HUB_HTML = read('growth-hub.html');

function fnSource(src, name) {
  const start = src.search(new RegExp(`(async\\s+)?function\\s+${name}\\s*\\(`));
  if (start < 0) throw new Error(`function ${name} not found`);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

export function loadWriters({ sponsors = [], drawerId = null, addForm = {} } = {}) {
  const calls = { update: [], insert: [], toasts: [] };
  const els = {};
  const el = (id) => (els[id] ||= { id, value: '', disabled: false, dataset: {}, classList: { add() {}, remove() {}, toggle() {} } });
  for (const [id, v] of Object.entries(addForm)) el(id).value = v;
  const plain = (o) => JSON.parse(JSON.stringify(o));   // objects built inside the vm have a different Object prototype
  const chain = (table, extra) => ({
    eq: async (col, id) => { calls.update.push({ table, row: plain(extra), id }); return {}; },
  });
  const sb = {
    from: (table) => ({
      update: (row) => chain(table, row),
      insert: (row) => { calls.insert.push({ table, row: plain(row) }); return { select: async () => ({ data: [{ id: 'new', ...row }], error: null }) }; },
    }),
  };
  const ctx = vm.createContext({
    sb, SPONSORS: sponsors, DRAWER: { id: drawerId }, document: { getElementById: el },
    escapeHtml: (s) => String(s ?? ''), showToast: (m, isErr) => calls.toasts.push({ m, isErr: !!isErr }),
    render() {}, renderDrawer() {}, closeAddModal() {}, console,
    $: el, esc: (s) => String(s ?? ''), dbError: () => false,
  });
  vm.runInContext(read('sponsors-core.js'), ctx);
  ctx.C = ctx.SponsorsCore;
  for (const n of ['saveBrandField', 'saveBrandStatus']) vm.runInContext(fnSource(COMMERCIAL_JS, n), ctx);
  vm.runInContext(fnSource(PIPELINE_HTML, 'submitAddSponsor'), ctx);
  return { ctx, el, calls, run: (code) => vm.runInContext(code, ctx) };
}
