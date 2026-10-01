// Test-only builders for SYNTHETIC EO-layout documents (invented text, invented numbers). No real report content.
import zlib from 'node:zlib';

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** @param {Record<string, string|Uint8Array>} files @param {{deflate?: boolean}} [o] */
export function buildZip(files, o = {}) {
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  const u16 = (n) => Uint8Array.of(n & 255, (n >> 8) & 255), u32 = (n) => Uint8Array.of(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255);
  const cat = (...a) => { const t = a.reduce((s, x) => s + x.length, 0), out = new Uint8Array(t); let p = 0; for (const x of a) { out.set(x, p); p += x.length; } return out; };
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? enc.encode(content) : content, nm = enc.encode(name);
    const comp = o.deflate ? new Uint8Array(zlib.deflateRawSync(data)) : data, method = o.deflate ? 8 : 0, crc = crc32(data);
    const local = cat(u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0), u32(crc), u32(comp.length), u32(data.length), u16(nm.length), u16(0), nm, comp);
    central.push(cat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0), u32(crc), u32(comp.length), u32(data.length), u16(nm.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nm));
    parts.push(local); offset += local.length;
  }
  const cd = cat(...central);
  return cat(...parts, cd, u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cd.length), u32(offset), u16(0));
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const run = (t) => `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
/** blocks: {p: text|[lines], style?} | {table: string[][]} | {image: rId} */
export function buildDocx(blocks, o = {}) {
  const body = blocks.map((b) => {
    if (b.table) return `<w:tbl>${b.table.map((r) => `<w:tr>${r.map((c) => `<w:tc><w:tcPr><w:tcW w:w="1560" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${esc(c)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
    if (b.image) return `<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${b.image}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    const lines = Array.isArray(b.p) ? b.p : [b.p];
    return `<w:p>${b.style ? `<w:pPr><w:pStyle w:val="${b.style}"/></w:pPr>` : ''}${lines.map((l, i) => (i ? '<w:r><w:br/></w:r>' : '') + run(l)).join('')}</w:p>`;
  }).join('');
  const doc = `<?xml version="1.0"?><w:document xmlns:w="w" xmlns:r="r"><w:body>${body}</w:body></w:document>`;
  const rels = `<?xml version="1.0"?><Relationships>${(o.media || []).map((m, i) => `<Relationship Id="rId${20 + i}" Type="image" Target="media/${m.name}"/>`).join('')}</Relationships>`;
  const files = { '[Content_Types].xml': '<Types/>', 'word/document.xml': doc, 'word/_rels/document.xml.rels': rels };
  for (const m of o.media || []) files['word/media/' + m.name] = m.bytes;
  return buildZip(files, { deflate: o.deflate });
}

/** Minimal single-font PDF with a text layer. pages: array of arrays of {text, gap?} (gap = extra points before the line). */
export function buildPdf(pages) {
  const enc = new TextEncoder(); const objs = []; const add = (s) => { objs.push(s); return objs.length; };
  const fontId = 3 + pages.length * 2;
  const pageIds = pages.map((_, i) => 3 + i * 2), contentIds = pages.map((_, i) => 4 + i * 2);
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${pageIds.map((i) => i + ' 0 R').join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((lines, i) => {
    let y = 780, stream = 'BT /F1 11 Tf\n'; let prev = 0;
    for (const l of lines) { y -= 14 + (l.gap || 0); stream += `1 0 0 1 56 ${y} Tm (${l.text.replace(/([()\\])/g, '\\$1')}) Tj\n`; prev = y; }
    stream += 'ET';
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentIds[i]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return enc.encode(out);
}

/** The SYNTHETIC report body shared by the DOCX and PDF builders: invented values, EO-layout labels. */
export const SYN = {
  title: 'eo SwimBETTER Analysis Report',
  date: 'Swim date and time: May 12, 2026 at 06:10:00 PM',
  summaryLines: ['Stroke: Backstroke Swimmer type: Sprint Distance: 150 metres Pool type: 50 metres', 'Location: Test Pool', 'Laps: 3 Time: 1 mins 5.5 seconds Strokes: 60 Avg Stroke rate: 40.1str/min', 'DPS: 1.65m Avg PPS: 85.5W Work: 5.6kJ Propulsive: 41.25%', 'swap: True'],
  tableHead: 'Target Distribution of Power - OPEN WATER - BACKSTROKE',
  tableRows: [['Leftward', 'Propulsive', 'Rightward'], ['Actual', 'Target', 'Actual', 'Target', 'Actual', 'Target'], ['9.1%', '<5%', '41.3%', '60-65%', '8.2%', '<5%'], ['Upward', 'Hand Drag', 'Downward'], ['Actual', 'Target', 'Actual', 'Target', 'Actual', 'Target'], ['0.9%', '0%', '2.5%', '0%', '38.0%', '20-25%']],
  overview: 'A short invented overview of this test swim.',
  force: ['In this swim you are producing 40.8% propulsive force across the three laps.', 'The downward force (38.04%) sits beside hand drag (2.6) in this note.', 'The pool was 50 metres long and the swim covered 150 metres.', 'Something looks off about the entry, which may point to a catch problem.'],
  srp: ['The right arm produces roughly 20% more power than the left arm in this swim.', 'This held across all 3 laps.', 'Stroke rate eased slightly across the swim.'],
  pvt: ['On the left side double peaks appeared at lap 1 (10%), lap 2 (0%), lap 3 (25%) of strokes.', 'On the right side there were 0% double peaks in each lap.'],
  work: [['Priority 1: Invented drill title', 'Try an invented drill on easy repeats.'], ['Priority 2: Invented second title', 'Consider a physiotherapist assessment if this continues.'], ['Priority 3: Invented third title', 'Keep practising the invented drill until it feels']],
  videos: 'Want to go deeper? These invented videos might help.',
};
export function synDocxBlocks(over = {}) {
  const s = { ...SYN, ...over }; const b = [];
  b.push({ p: s.title, style: 'Heading1' }, { p: s.date, style: 'Heading1' }, { p: 'Summary', style: 'Heading2' }, { p: s.summaryLines });
  b.push({ p: 'Your Swim Snapshot', style: 'Heading2' }, { p: s.overview }, { p: 'Key Insights', style: 'Heading2' }, { p: s.tableHead, style: 'Heading1' });
  if (!over.noTable) b.push({ table: s.tableRows });
  b.push({ p: 'Force Field', style: 'Heading3' }, ...s.force.map((t) => ({ p: t })));
  b.push({ p: 'Stroke Rate & Power', style: 'Heading3' }, ...s.srp.map((t) => ({ p: t })));
  b.push({ p: 'Power vs Time', style: 'Heading3' }, ...s.pvt.map((t) => ({ p: t })));
  b.push({ p: 'What to Work On', style: 'Heading2' });
  for (const [h, t] of s.work) b.push({ p: h, style: 'Heading3' }, { p: t });
  b.push({ p: s.videos });
  return b;
}
/** The same report as PDF text lines (one paragraph per entry; wrap long paragraphs into ~90-char lines). */
export function synPdfPages(over = {}) {
  const s = { ...SYN, ...over }; const lines = [];
  const para = (t, gap = 8) => { const words = t.split(' '); let cur = ''; let first = true; const flush = () => { if (cur) { lines.push({ text: cur, gap: first ? gap : 0 }); first = false; cur = ''; } }; for (const w of words) { if ((cur + ' ' + w).length > 88) flush(); cur = cur ? cur + ' ' + w : w; } flush(); };
  para(s.title, 0); para(s.date); para('Summary', 14); s.summaryLines.forEach((l, i) => para(l, i ? 0 : 4));
  para('Your Swim Snapshot', 14); para(s.overview, 4); para('Key Insights', 14); para(s.tableHead, 10);
  if (!over.noTable) s.tableRows.forEach((r, i) => para(r.join('  '), i ? 0 : 4));
  para('Force Field', 14); s.force.forEach((t) => para(t, 8)); para('Stroke Rate & Power', 14); s.srp.forEach((t) => para(t, 8));
  para('Power vs Time', 14); s.pvt.forEach((t) => para(t, 8)); para('What to Work On', 14);
  for (const [h, t] of s.work) { para(h + ' ' + t, 10); }
  para(s.videos, 10);
  const perPage = over.perPage || 44; const pages = []; for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  return pages;
}
