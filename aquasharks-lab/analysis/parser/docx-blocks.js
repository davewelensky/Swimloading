// @ts-check
/** WordprocessingML -> ordered blocks (paragraphs with style/text/images, and tables as rows of cell text). No EO knowledge here. */

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
// NOTE: `<w:t(?: [^>]*)?>` and not `<w:t[^>]*>`: the latter also matches <w:tcPr>, <w:tab/> and <w:tbl>.
const RUN = /<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:br\s*\/>|<w:tab\s*\/>/g;

/** Text of a paragraph or cell. Line breaks become \n, tabs become \t. */
export function textOf(xml) {
  let out = '';
  for (const m of xml.matchAll(RUN)) out += m[1] !== undefined ? m[1] : (m[0].startsWith('<w:br') ? '\n' : '\t');
  return decode(out);
}

/**
 * @param {string} documentXml @param {string} relsXml
 * @returns {Array<{type:'p', index:number, style:string, text:string, image:{rId:string, media:string|null}|null} | {type:'table', index:number, rows:string[][]}>}
 */
export function docxToBlocks(documentXml, relsXml) {
  const media = Object.fromEntries([...relsXml.matchAll(/Id="(rId\d+)"[^>]*Target="media\/([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const blocks = [];
  // a table is matched whole before its inner paragraphs, because it starts first
  for (const m of documentXml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const index = blocks.length;
    if (m[0].startsWith('<w:tbl>')) {
      blocks.push({ type: 'table', index, rows: [...m[0].matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((r) => [...r[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((c) => textOf(c[0]).trim())) });
    } else {
      const style = (/<w:pStyle w:val="([^"]+)"/.exec(m[0]) || [])[1] || '';
      const emb = /<w:drawing>[\s\S]*?r:embed="([^"]+)"/.exec(m[0]);
      blocks.push({ type: 'p', index, style, text: textOf(m[0]), image: emb ? { rId: emb[1], media: media[emb[1]] || null } : null });
    }
  }
  return blocks;
}
