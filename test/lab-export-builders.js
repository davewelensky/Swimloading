// Test-only: builds a tiny SYNTHETIC EO data export (zip of five .xlsx workbooks) with invented numbers. No real swimmer data.
import { buildZip } from './lab-doc-builders.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
/** sheets: [{ name, rows: (string|number|null)[][] }]. Strings are written inline, except when shared:true (then via sharedStrings). */
export function buildXlsx(sheets, { shared = false } = {}) {
  const sst = []; const idx = (s) => { let i = sst.indexOf(s); if (i < 0) { sst.push(s); i = sst.length - 1; } return i; };
  const cell = (v, r, c) => (v == null ? '' : typeof v === 'number' ? `<c r="${col(c)}${r + 1}"><v>${v}</v></c>` : shared ? `<c r="${col(c)}${r + 1}" t="s"><v>${idx(v)}</v></c>` : `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`);
  const sheetXml = (rows) => `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files = {
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns="x" xmlns:r="r"><sheets>${sheets.map((s, i) => `<sheet sheetId="${i + 1}" name="${esc(s.name)}" state="visible" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships>${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s.rows); });
  if (shared) files['xl/sharedStrings.xml'] = `<?xml version="1.0"?><sst>${sst.map((t) => `<si><t>${esc(t)}</t></si>`).join('')}</sst>`;
  return buildZip(files, { deflate: true });
}

export const SWIM_ID = '11111111-2222-3333-4444-555555555555';
const LAP = (n) => 'lap' + String(n).padStart(3, '0');

/** A 3-lap, 75 m freestyle swim in a 25 m pool. Left hand is the stronger one; the left hand crosses the centreline by 5 cm. */
export function buildExportZip({ id = SWIM_ID, omit = [] } = {}) {
  const laps = [1, 2, 3];
  const L = { 1: [120, 40, 30.0], 2: [110, 36, 29.5], 3: [100, 32, 29.0] }, R = { 1: [60, 22, 30.0], 2: [58, 21, 29.5], 3: [54, 19, 29.0] };   // [pps W, propulsive W, rate]
  const summary = buildXlsx([
    { name: 'summary', rows: [['Date', 'Aug 17, 2026', ''], ['Time', '07:08:00 AM', ''], ['Stroke', 'Freestyle', ''], ['Distance', 75, 'm'], ['Duration', '01:20.50', ''], ['Laps', 3, ''], ['Location', 'point (25m)', ''], ['Strokes Left', 24, ''], ['Strokes Right', 26, ''], ['Avg. Stroke Rate', '29.50', 'str/min'], ['Avg. DPS', '1.50', 'm'], ['Avg. FPS', '30.00', 'N'], ['Avg. PPS', '87.00', 'W'], ['Work', '5.00', 'kJ'], ['Propulsive', '36.00', '%']] },
    { name: 'laps', rows: [['Lap', 'Left FPS [N]', 'Left Propulsive [N]', 'Left PPS [W]', 'Left Propulsive [W]', 'Left Stroke Rate [str/min]', 'Right FPS [N]', 'Right Propulsive [N]', 'Right PPS [W]', 'Right Propulsive [W]', 'Right Stroke Rate [str/min]'], ...laps.map((n) => [n, 40, 14, L[n][0], L[n][1], L[n][2], 20, 8, R[n][0], R[n][1], R[n][2]])] },
    ...laps.map((n) => ({ name: LAP(n), rows: [['Time Left (ms)', 'Left Force [N]', 'Left Propulsive [N]', 'Left Power [W]', 'Left Propulsive [W]', 'Left Stroke Rate [str/min]', 'Time Right (ms)', 'Right Force [N]', 'Right Propulsive [N]', 'Right Power [W]', 'Right Propulsive [W]', 'Right Stroke Rate [str/min]'], [1000, 40, 14, L[n][0], 30, 29, 1200, 20, 8, R[n][0], 18, 29], [3000, 40, 14, L[n][0] + 10, 30, 29, 3200, 20, 8, R[n][0] - 10, 18, 29]] })),
  ]);
  // each hand's own force-field shares per lap; the angle table is a tiny polar profile
  const ffRow = (label, l, r) => [label, l, r];
  const forceField = buildXlsx(laps.map((n) => ({ name: LAP(n), rows: [
    ['', 'Left (Lap)', 'Right (Lap)'],
    ffRow('Propulsive [%]', String(30 + n), String(40 + n)), ffRow('Leftward [%]', '0.5', String(30 + n * 4)), ffRow('Rightward [%]', String(10 + n * 3), '0.4'), ffRow('Upward [%]', '0.3', '1.0'),
    ffRow('Downward [%]', String(60 - n * 5), String(25 - n)), ffRow('Hand Drag [%]', '2.0', '0.5'), ffRow('AvgPPS [W]', String(L[n][0]), String(R[n][0])), ffRow('AvgFPS [N]', '40', '20'),
    ['Angle', 'Left [N]', 'Right [N]'], [0, 1.5, 0.5], [1, 1.0, 0.25], [2, 2.0, 1.0],
  ] })));
  // hand path: two strokes per hand per lap. Coordinates in metres: depth negative below the surface, lateral negative = left of the centreline.
  const hdr = (h, i) => [`Time ${h}_00${i} [ms]`, `${h} Fwd 00${i} [m]`, `${h} Depth 00${i} [m]`, `${h} Lateral 00${i} [m]`, `${h} Hand Speed 00${i} [m/s]`];
  const series = (h, depthMax, latFar, latNear) => { const d = [0, -depthMax / 2, -depthMax, -depthMax / 2, 0], l = [latFar, (latFar + latNear) / 2, latNear, latFar, latFar]; return d.map((x, k) => [k * 10, 0.1 * k, x, l[k], 1.0]); };
  const hand = buildXlsx(laps.map((n) => {
    const strokes = [['Left', 0.70, -0.50, 0.05], ['Left', 0.80, -0.54, 0.05], ['Right', 0.74, 0.40, 0.10], ['Right', 0.78, 0.44, 0.10]];
    const cols = strokes.map(([h, dm, far, near], i) => series(h, dm, far, near));
    const head = [...hdr('Left', 1), ...hdr('Left', 2), ...hdr('Right', 1), ...hdr('Right', 2)];
    return { name: LAP(n), rows: [head, ...cols[0].map((_, k) => cols.flatMap((c) => c[k]))] };
  }));
  const phases = buildXlsx(laps.map((n) => ({ name: LAP(n), rows: [['Stroke', 'Left Glide (ms)', 'Left Pull (ms)', 'Left Recovery (ms)', 'Left Stroke Rate [str/min]', 'Right Glide (ms)', 'Right Pull (ms)', 'Right Recovery (ms)', 'Right Stroke Rate [str/min]'], [1, 200, 1000, 800, 30, 100, 1100, 800, 30], [2, 200, 1000, 800, 30, 100, 1100, 800, 30]] })));
  const fpvt = buildXlsx([{ name: 'lap001', rows: [['Time [ms]', 'Left Hand Speed [m/s]'], [0, '0.4800']] }]);
  const files = { [`${id}_SwimSummary.xlsx`]: summary, [`${id}_ForceField.xlsx`]: forceField, [`${id}_HandPathConsistency.xlsx`]: hand, [`${id}_Phases.xlsx`]: phases, [`${id}_FPvsTime.xlsx`]: fpvt };
  for (const o of omit) delete files[`${id}_${o}.xlsx`];
  return buildZip(files, { deflate: true });
}
