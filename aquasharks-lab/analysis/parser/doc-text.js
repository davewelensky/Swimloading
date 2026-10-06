// @ts-check
/**
 * DocText: the one input model for every extractor, whatever the file format.
 * A DOCX or a PDF is reduced to ordered lines; extractors never see XML or PDF objects.
 *
 * @typedef {{ text: string, page: number, newPara: boolean, heading: number, table: boolean }} DocLine
 * @typedef {{ index: number, page: number | null, media: string | null, bytes?: Uint8Array, mediaType?: string }} DocImage
 * @typedef {{ kind: 'DOCX' | 'PDF', lines: DocLine[], images: DocImage[], pages: number }} DocText
 */
import { readZip, utf8 } from './zip.js';
import { docxToBlocks } from './docx-blocks.js';

const BULLET = /^[•●▪◦\-\*]\s*/;

/** @param {Uint8Array} bytes @returns {Promise<DocText>} */
export async function docxToDocText(bytes) {
  const zip = readZip(bytes);
  const doc = await zip.read('word/document.xml');
  if (!doc) throw new Error('not a Word document (no word/document.xml)');
  const rels = await zip.read('word/_rels/document.xml.rels');
  const blocks = docxToBlocks(utf8(doc), rels ? utf8(rels) : '');
  /** @type {DocLine[]} */ const lines = []; /** @type {DocImage[]} */ const images = [];
  for (const b of blocks) {
    if (b.type === 'table') {
      // every table row becomes one line, cells separated by two spaces; the extractor reads it as a row
      for (const row of b.rows) lines.push({ text: row.map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean).join('  '), page: 1, newPara: true, heading: 0, table: true });
      continue;
    }
    if (b.image) images.push({ index: images.length, page: null, media: b.image.media });
    const heading = /^Heading(\d)$/.exec(b.style);
    const parts = b.text.split('\n');
    parts.forEach((t, k) => { const text = t.replace(/\s+/g, ' ').trim(); if (text) lines.push({ text: text.replace(BULLET, ''), page: 1, newPara: k === 0 || /^[•]/.test(t.trim()), heading: heading ? +heading[1] : 0, table: false }); });
  }
  // the pictures themselves, for the vision step (media types by extension)
  for (const im of images) if (im.media) { const b = await zip.read('word/media/' + im.media); if (b) { im.bytes = b; im.mediaType = /\.png$/i.test(im.media) ? 'image/png' : /\.jpe?g$/i.test(im.media) ? 'image/jpeg' : 'image/' + im.media.split('.').pop(); } }
  return { kind: 'DOCX', lines, images, pages: 1 };
}

/** pdf.js is injected so Node (pdfjs-dist/legacy) and the browser (CDN build) share this code. @type {any} */
let pdfjs = null;
export function setPdfjs(lib) { pdfjs = lib; }
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  // Node only (the browser injects its own pdf.js via setPdfjs). On Vercel, pdf.js looks for pdf.worker.mjs through a
  // computed path the file tracer cannot see, so the file was missing from the function and every PDF failed with
  // "Setting up fake worker failed". Importing the worker by a LITERAL specifier gets it bundled, and registering it on
  // globalThis.pdfjsWorker hands it to pdf.js directly so it never has to locate the file at runtime.
  const worker = await import(/* @vite-ignore */ 'pdfjs-dist/legacy/build/pdf.worker.mjs');
  if (!globalThis.pdfjsWorker) globalThis.pdfjsWorker = worker;
  pdfjs = await import(/* @vite-ignore */ 'pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

/**
 * Text layer of a PDF -> lines. Items on the same baseline form a line; a gap larger than the usual line spacing,
 * or a bullet glyph, starts a new paragraph.
 * @param {Uint8Array} bytes @returns {Promise<DocText>}
 */
export async function pdfToDocText(bytes) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
  /** @type {DocLine[]} */ const lines = [];
  // pass 1: collect rows per page, and measure ordinary line spacing over the WHOLE document (a sparse page must not skew it)
  const pagesRows = []; const allGaps = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const rows = new Map();
    for (const it of tc.items) { if (!it.str || !it.str.trim()) continue; const y = Math.round(it.transform[5]); const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y; (rows.get(key) || rows.set(key, []).get(key)).push({ s: it.str, x: it.transform[4], h: it.height }); }
    const ys = [...rows.keys()].sort((a, b) => b - a);
    ys.slice(1).forEach((y, i) => allGaps.push(ys[i] - y));
    pagesRows.push({ rows, ys });
  }
  allGaps.sort((a, b) => a - b);
  const normal = allGaps.length ? allGaps[Math.floor(allGaps.length / 3)] : 14;           // lower-third gap = ordinary line spacing
  pagesRows.forEach(({ rows, ys }, pi) => {
    const p = pi + 1;
    const prevLine = lines.length ? lines[lines.length - 1].text : '';
    ys.forEach((y, i) => {
      const items = rows.get(y).sort((a, b) => a.x - b.x);
      let text = ''; items.forEach((it, k) => { if (k) { const prev = items[k - 1]; text += (it.x - (prev.x + prev.s.length * (prev.h * 0.5)) > prev.h * 1.5) ? '  ' : ' '; } text += it.s; });
      const first = text.replace(/\s+$/, '').trim(), bullet = BULLET.test(first);
      const gap = i === 0 ? Infinity : ys[i - 1] - y;
      // the first line on a page continues the previous paragraph only when it starts lowercase after an unfinished sentence
      const pageTopNew = p === 1 || bullet || /[.!?)"'\u201D:%]$/.test(prevLine.trim()) || !/^[a-z(]/.test(first);
      lines.push({ text: first.replace(BULLET, ''), page: p, newPara: i === 0 ? pageTopNew : gap > normal * 1.3 || bullet, heading: 0, table: false });
    });
  });
  return { kind: 'PDF', lines, images: [], pages: doc.numPages };
}

/** Group lines into paragraphs: [{ text, page, heading, table, first }] */
export function paragraphs(/** @type {DocText} */ d) {
  const out = [];
  for (const l of d.lines) {
    const last = out[out.length - 1];
    if (!last || l.newPara || l.table || last.table || (l.heading && !last.heading) || (!l.heading && last.heading)) out.push({ text: l.text, page: l.page, heading: l.heading, table: l.table, lines: [l.text] });
    else { last.text += ' ' + l.text; last.lines.push(l.text); }
  }
  return out;
}
