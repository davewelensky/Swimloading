// @ts-check
/**
 * Minimal .xlsx reader (zip + XML, no dependencies). Returns cell values as numbers or strings; empty cells are null.
 * Enough for EO's data exports; not a general spreadsheet library (no formulas, dates or styles).
 */
import { readZip, utf8 } from './zip.js';

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
const attr = (tag, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag); return m ? decode(m[1]) : null; };
/** Column letters to a zero-based index: A=0, B=1, AA=26. */
const colIndex = (ref) => { const m = /^([A-Z]+)/.exec(ref); let n = 0; for (const ch of m ? m[1] : '') n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

/**
 * @param {Uint8Array} bytes @param {{ only?: string[] }} [opts] only: read just these sheets (others are listed but not parsed)
 * @returns {Promise<{ names: string[], sheet: (name: string) => (string | number | null)[][] | null }>}
 */
export async function readXlsx(bytes, opts = {}) {
  const zip = readZip(bytes);
  const text = async (n) => { const b = await zip.read(n); return b ? utf8(b) : ''; };
  const wb = await text('xl/workbook.xml'), rels = await text('xl/_rels/workbook.xml.rels');
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: attr(m[0], 'name') || '', rid: attr(m[0], 'r:id') }));
  const shared = [...(await text('xl/sharedStrings.xml')).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  /** @type {Map<string, (string|number|null)[][]>} */ const parsed = new Map();
  for (const s of sheets) {
    if (opts.only && !opts.only.includes(s.name)) continue;
    let t = target.get(s.rid) || ''; t = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
    const xml = await text(t); /** @type {(string|number|null)[][]} */ const rows = [];
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const r = (parseInt(attr(rm[1], 'r') || '0', 10) || rows.length + 1) - 1, row = rows[r] || (rows[r] = []);
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cm[1], 'r') || '', type = attr(cm[1], 't'), body = cm[2] || '';
        let v = null; const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
        if (type === 'inlineStr') v = decode([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
        else if (raw) v = type === 's' ? (shared[+raw[1]] ?? null) : type === 'str' ? decode(raw[1]) : type === 'b' ? (raw[1] === '1' ? 1 : 0) : Number(raw[1]);
        row[colIndex(ref)] = v;
      }
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    parsed.set(s.name, rows);
  }
  return { names: sheets.map((s) => s.name), sheet: (n) => parsed.get(n) || null };
}
