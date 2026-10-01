// @ts-check
/**
 * parseEoReport(bytes, opts) -> { analysis, diagnostics }
 * One entry point for a PDF or a DOCX. Detects the file format by magic bytes and the report layout by content.
 * Output is the SOURCE layer of a SwimAnalysis plus diagnostics. It never produces coaching.
 */
import { docxToDocText, pdfToDocText } from './doc-text.js';
import { detect as detectAi, extractAiReport, LAYOUT as AI_LAYOUT } from './extract-ai-report.js';
import { emptyAnalysis } from '../model.js';

export const PARSER_VERSION = '0.1.0';

/** @param {Uint8Array} b */
export function sniffFormat(b) {
  if (b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'PDF';
  if (b.length > 4 && b[0] === 0x50 && b[1] === 0x4b) return 'DOCX';
  return null;
}

/**
 * @param {Uint8Array} bytes
 * @param {{ swimmerName?: string, filename?: string|null, sha256?: string|null, now?: string|null }} [opts]
 */
export async function parseEoReport(bytes, opts = {}) {
  const format = sniffFormat(bytes);
  if (!format) throw Object.assign(new Error('Unsupported file: expected a PDF or a Word (.docx) document.'), { code: 'unsupported_format' });
  const doc = format === 'PDF' ? await pdfToDocText(bytes) : await docxToDocText(bytes);
  if (detectAi(doc)) {
    const r = extractAiReport(doc, opts);
    return { ...r, format, layout: AI_LAYOUT, images: doc.images.length, imageData: doc.images.filter((x) => x.bytes).map((x) => ({ index: x.index, mediaType: x.mediaType || 'image/png', bytes: x.bytes })) };
  }
  // Layout not recognised: return an empty analysis and say so. Never guess a layout.
  const a = emptyAnalysis(opts.swimmerName || 'Unnamed swimmer');
  a.source.documents = [{ kind: format === 'PDF' ? 'EO_REPORT_PDF' : 'EO_REPORT_DOCX', filename: opts.filename || null, sha256: opts.sha256 || null, views: [] }];
  return { analysis: a, format, layout: null, images: doc.images.length, diagnostics: { extracted: [], notes: ['Report layout not recognised. No fields were extracted.'], coachRequired: ['everything'] } };
}
