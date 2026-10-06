// @ts-check
/**
 * Extractor for the EO "SwimBETTER Analysis Report" layout (Word export, or the same document as a PDF).
 * It produces EVIDENCE only: values, provenance, and source-quality flags. No coaching, no thresholds, no selection
 * between conflicting printed values (the engine/coach decides, and records a selection basis).
 */
import { emptyAnalysis, num, obs, missing, obsMissing, setPath, X } from '../model.js';
import { paragraphs } from './doc-text.js';
import { numUnit, parseDuration, parseSwimDateTime, parseReference, splitSentences, tidy } from './normalise.js';
import { classifyClaim, classifyAudience, isTruncated } from './claims.js';
import { hasRealConflict } from '../calc.js';

export const LAYOUT = 'EO_AI_REPORT_V1';

/** @type {[string, RegExp][]} */
const HEADINGS = [
  ['summary', /^Summary(?=\s|$)/], ['snapshot', /^Your Swim Snapshot(?=\s|$)/], ['insights', /^Key Insights(?=\s|$)/],
  ['force', /^Force Field(?=\s|$)/], ['srp', /^Stroke Rate (?:&|and) Power(?=\s|$)/], ['pvt', /^Power vs\.? Time(?=\s|$)/],
  ['work', /^What to Work On(?=\s|$)/], ['videos', /^Want to go deeper\?/],
];
const DIRS = [['Leftward', 'leftwardPct'], ['Propulsive', 'propulsivePct'], ['Rightward', 'rightwardPct'], ['Upward', 'upwardPct'], ['Hand Drag', 'handDragPct'], ['Downward', 'downwardPct']];
const AREA = { snapshot: 'OVERVIEW', force: 'FORCE_FIELD', srp: 'STROKE_RATE_POWER', pvt: 'POWER_VS_TIME' };
const SUMMARY_LABELS = ['Stroke', 'Swimmer type', 'Distance', 'Pool type', 'Location', 'Laps', 'Time', 'Strokes', 'Avg Stroke rate', 'DPS', 'Avg PPS', 'Work', 'Propulsive', 'swap'];

/** Does this document look like the EO AI report layout? */
export function detect(/** @type {import('./doc-text.js').DocText} */ d) {
  const t = d.lines.map((l) => l.text).join('\n');
  return /eo SwimBETTER Analysis Report/i.test(t) && /\bKey Insights\b/.test(t) && /Target Distribution of Power/i.test(t);
}

/** Split headings that a PDF text layer fused to the paragraph after them, so extractors see one heading per paragraph. */
function structure(/** @type {import('./doc-text.js').DocText} */ d) {
  /** @type {{kind:string|null, text:string, page:number, table:boolean, para:number}[]} */ const out = [];
  const pre = [];
  for (const p of paragraphs(d)) {
    // a PDF can fuse several blocks into one paragraph: cut before a known heading, "Priority n:" or the date line when it follows a finished sentence
    const cut = tidy(p.text).split(/(?<=[.!?%)]|Analysis Report)\s+(?=(?:Force Field\b|Stroke Rate (?:&|and) Power\b|Power vs\.? Time\b|What to Work On\b|Your Swim Snapshot\b|Key Insights\b|Want to go deeper\?|Priority \d+:|Swim date and time:|Summary\s+Stroke:|Target Distribution of Power\b))/);
    cut.forEach((t) => pre.push({ ...p, text: t }));
  }
  pre.forEach((p, para) => {
    let text = tidy(p.text), guard = 0;
    while (text && guard++ < 4) {
      const tdp = /^(Target Distribution of Power\s*-\s*.+?)(?=\s+Leftward\b|$)/i.exec(text);
      if (tdp) { out.push({ kind: 'table-head', text: tdp[1].trim(), page: p.page, table: false, para }); text = text.slice(tdp[0].length).trim(); continue; }
      const sw = /^Swim date and time:\s*\S.*?(?=\s+Summary\b|$)/i.exec(text);
      if (sw) { out.push({ kind: 'date', text: sw[0], page: p.page, table: false, para }); text = text.slice(sw[0].length).trim(); continue; }
      const pr = /^(Priority \d+:)/.exec(text);
      if (pr) { out.push({ kind: 'priority', text, page: p.page, table: false, para }); text = ''; break; }
      const h = HEADINGS.find(([, re]) => re.test(text));
      if (h) { const m = /^[^\s].*?(?=\s|$)/.exec(text); const full = (text.match(h[1]) || [''])[0]; out.push({ kind: 'h:' + h[0], text: full, page: p.page, table: false, para }); text = text.slice(full.length).trim(); continue; }
      break;
    }
    if (text) out.push({ kind: p.table ? 'table' : /^eo SwimBETTER Analysis Report/i.test(text) ? 'title' : null, text, page: p.page, table: p.table, para });
  });
  return out;
}

/**
 * @param {import('./doc-text.js').DocText} d
 * @param {{ swimmerName?: string, filename?: string | null, sha256?: string | null, now?: string | null }} [ctx]
 */
export function extractAiReport(d, ctx = {}) {
  const a = emptyAnalysis(ctx.swimmerName || 'Unnamed swimmer');
  const blocks = structure(d);
  const diag = { extracted: /** @type {string[]} */ ([]), notes: /** @type {string[]} */ ([]), coachRequired: /** @type {string[]} */ ([]) };
  const kindFmt = d.kind === 'DOCX' ? 'EO_REPORT_DOCX' : 'EO_REPORT_PDF';
  a.source.documents = [{ kind: /** @type {any} */ (kindFmt), filename: ctx.filename || null, sha256: ctx.sha256 || null, views: ['OVERVIEW', 'FORCE_FIELD', 'STROKE_RATE_POWER', 'POWER_VS_TIME'] }];
  a.source.layout = LAYOUT; a.source.parserVersion = '0.1.0'; a.source.extractedAt = ctx.now || null;
  const put = (path, v) => { setPath(a, path, v); diag.extracted.push(path); };
  const sectionOf = (kind) => { const i = blocks.findIndex((b) => b.kind === kind); if (i < 0) return []; const out = []; for (let j = i + 1; j < blocks.length && !(blocks[j].kind || '').match(/^(h:|priority|table-head|date|title)/); j++) out.push(blocks[j]); return out; };
  const allText = blocks.map((b) => b.text).join('\n');

  // ---- header: date and time of day, as printed ----
  const dh = blocks.find((b) => b.kind === 'date');
  if (dh) {
    const dt = parseSwimDateTime(dh.text);
    if (dt) {
      put('session.date', obs(dt.date, X.from('TEXT', 'HIGH', { section: 'header', paragraph: dh.para }, dh.text.replace(/^Swim date and time:\s*/i, ''))));
      if (dt.time) put('session.startTime', obs(dt.time, X.from('TEXT', 'HIGH', { section: 'header', paragraph: dh.para }, dt.time)));
    }
  }

  // ---- summary line: scan for `Label:` anywhere (labels may run together) ----
  const sum = sectionOf('h:summary').filter((b) => !b.table).map((b) => b.text).join(' ');
  const pos = SUMMARY_LABELS.map((l) => ({ l, m: new RegExp('(?<![A-Za-z])' + l.replace(/ /g, '\\s+') + ':', 'i').exec(sum) })).filter((x) => x.m).sort((x, y) => /** @type {any} */ (x.m).index - /** @type {any} */ (y.m).index);
  /** @type {Record<string,string>} */ const f = {};
  pos.forEach((p, k) => { const m = /** @type {RegExpExecArray} */ (p.m); f[p.l] = sum.slice(m.index + m[0].length, k + 1 < pos.length ? /** @type {any} */ (pos[k + 1].m).index : undefined).trim(); });
  const loc = { section: 'Summary' };
  const metric = (label, path, unitWanted, unitName) => {
    if (f[label] === undefined) return;
    const nu = numUnit(f[label]);
    if (!nu) { put(path, { ...missing(unitName, 'EXTRACTION_FAILED'), provenance: X.from('TEXT', 'LOW', loc, f[label]) }); return; }
    const okUnit = !unitWanted || nu.unit === '' || unitWanted.test(nu.unit);
    put(path, num(nu.value, unitName, X.from('TEXT', 'HIGH', loc, f[label].replace(/\s+/g, '')), { status: okUnit ? 'COMPLETE' : 'AMBIGUOUS' }));
    if (!okUnit) diag.notes.push(`${label}: unexpected unit "${nu.unit}", value kept as printed and marked AMBIGUOUS (no conversion)`);
  };
  if (f.Stroke) put('session.stroke', obs(f.Stroke, X.from('TEXT', 'HIGH', loc, f.Stroke)));
  if (f['Swimmer type']) a.source.analysisContext.swimmerType = f['Swimmer type'];
  metric('Distance', 'session.distanceM', /^(m|metres?|meters?)$/i, 'm');
  metric('Pool type', 'session.poolLengthM', /^(m|metres?|meters?)$/i, 'm');
  metric('Laps', 'session.laps', null, '');
  metric('Strokes', 'session.strokeCount', null, '');
  if (f.Time) { const s = parseDuration(f.Time); put('session.timeS', s == null ? { ...missing('s', 'EXTRACTION_FAILED'), provenance: X.from('TEXT', 'LOW', loc, f.Time) } : num(s, 's', X.from('TEXT', 'HIGH', loc, f.Time))); }
  metric('Avg Stroke rate', 'metrics.strokeRate', /^str\/min$/i, 'str/min');
  metric('DPS', 'metrics.distancePerStrokeM', /^m$/i, 'm');
  metric('Avg PPS', 'metrics.avgPowerW', /^w$/i, 'W');
  metric('Work', 'metrics.workKj', /^kj$/i, 'kJ');
  metric('Propulsive', 'metrics.propulsivePct', /^%$/, '%');
  if (f.Location) put('session.location', obs(f.Location, X.from('TEXT', 'HIGH', loc, f.Location), 'COMPLETE'));
  if (f.swap !== undefined) a.unmapped.push({ label: 'swap', value: f.swap, location: 'Summary' });

  // ---- the distribution table: label rows followed by [Actual, Target] value rows (works whether rows or flowed text) ----
  const head = blocks.find((b) => b.kind === 'table-head');
  if (head) {
    const ctxm = /Target Distribution of Power\s*-\s*(.+?)\s*-\s*(.+)$/i.exec(head.text);
    if (ctxm) a.eoReferenceContext = { swimmerType: ctxm[1].trim(), stroke: ctxm[2].trim() };
    const i0 = blocks.indexOf(head);
    const region = []; for (let j = i0 + 1; j < blocks.length && !(blocks[j].kind || '').startsWith('h:'); j++) region.push(blocks[j].text);
    const text = region.join(' ');
    const labels = [...text.matchAll(/Leftward|Propulsive|Rightward|Upward|Hand Drag|Downward/g)].map((m) => m[0]);
    const values = [...text.matchAll(/<?>?\d+(?:\.\d+)?-\d+(?:\.\d+)?%|[<>]\d+(?:\.\d+)?%|\d+(?:\.\d+)?%/g)].map((m) => m[0]);
    if (labels.length === 6 && values.length === 12) {
      labels.forEach((name, k) => {
        const key = /** @type {string} */ (DIRS.find((x) => x[0] === name)?.[1]);
        const row = k < 3 ? 'r1' : 'r2', col = (k % 3) * 2;
        const actual = numUnit(values[k * 2]), ref = parseReference(values[k * 2 + 1]);
        const where = { section: 'Target Distribution of Power', tableCell: `${row}c${col}` };
        if (actual) put(`forceDistribution.overall.${key}`, num(actual.value, '%', X.from('TABLE', 'HIGH', where, values[k * 2])));
        if (ref) { a.eoReferenceRanges[key] = { text: ref.text, lo: ref.lo, hi: ref.hi, provenance: X.from('TABLE', 'HIGH', { section: 'Target Distribution of Power', tableCell: `${row}c${col + 1}` }, values[k * 2 + 1]) }; diag.extracted.push(`eoReferenceRanges.${key}`); }
      });
    } else diag.notes.push(`distribution table not read: found ${labels.length} labels and ${values.length} values (expected 6 and 12)`);
  } else diag.notes.push('distribution table heading not found');

  // ---- narrative figures: every other printed value for a quantity is KEPT as an alternate (never chosen between) ----
  const alt = (re, paths, label, note) => {
    const m = re.exec(allText); if (!m) return null;
    const v = +m[1];
    for (const path of paths) {
      const leaf = path.split('.').reduce((o, k) => o[k], /** @type {any} */ (a));
      if (!leaf || leaf.value == null || leaf.value === v) continue;
      (leaf.alternates = leaf.alternates || []).push({ value: v, location: label });
    }
    return { value: v, hasPct: /%/.test(m[0]), text: m[0] };
  };
  alt(/producing (?:only )?(\d+(?:\.\d+)?)%\s+propulsive/i, ['metrics.propulsivePct', 'forceDistribution.overall.propulsivePct'], 'narrative');
  alt(/downward force\s*\((\d+(?:\.\d+)?)%\)/i, ['forceDistribution.overall.downwardPct'], 'narrative');
  alt(/leftward force\s*\((\d+(?:\.\d+)?)%\)/i, ['forceDistribution.overall.leftwardPct'], 'narrative');
  alt(/rightward force\s*\((\d+(?:\.\d+)?)%?\)/i, ['forceDistribution.overall.rightwardPct'], 'narrative');
  // the summary-line propulsive value also gets the table value as an alternate (and vice versa)
  const mp = a.metrics.propulsivePct, fp = a.forceDistribution.overall.propulsivePct;
  if (mp.value != null && fp.value != null && mp.value !== fp.value) {
    if (!(mp.alternates || []).some((x) => x.value === fp.value)) (mp.alternates = mp.alternates || []).push({ value: fp.value, location: 'distribution table' });
    if (!(fp.alternates || []).some((x) => x.value === mp.value)) (fp.alternates = fp.alternates || []).push({ value: mp.value, location: 'summary line' });
  }
  const hd = alt(/hand drag\s*\((\d+(?:\.\d+)?)(%?)\)/i, ['forceDistribution.overall.handDragPct'], 'narrative (no unit printed)');
  if (hd && !hd.hasPct) a.sourceIssues.push({ id: 'hand-drag-unit', severity: 'INFO', kind: 'UNIT_AMBIGUITY', fields: ['forceDistribution.overall.handDragPct'], message: `Hand drag is printed as ${hd.value} with no unit in the narrative; the table prints a percentage. Treated as a percentage.` });
  const gap = /(\d+(?:\.\d+)?)%\s+power difference between arms/i.exec(allText);
  if (gap) a.unmapped.push({ label: 'power difference between arms', value: gap[1] + '%', location: 'narrative' });

  // ---- per-lap double peaks (EO prints the affected side as a lap list; a clean side as one statement) ----
  const lapCount = a.session.laps.value;
  for (const b of blocks) {
    if ([...b.text.matchAll(/lap\s+(\d+)\s*\((\d+(?:\.\d+)?)%/gi)].length < 3) continue;
    const sents = splitSentences(b.text);
    const sideIn = (t) => { const r = /\bright (?:side|arm)\b/i.test(t), l = /\bleft (?:side|arm)\b/i.test(t); return r && !l ? 'right' : l && !r ? 'left' : null; };
    const paraSide = sideIn(b.text);
    /** @type {'left'|'right'|null} */ let last = null;
    for (const sn of sents) {
      const here = sideIn(sn); if (here) last = here;
      const hits = [...sn.matchAll(/lap\s+(\d+)\s*\((\d+(?:\.\d+)?)%/gi)];
      if (hits.length < 3) continue;
      const side = here || last || paraSide;      // this sentence, else the nearest earlier mention, else the paragraph if it names exactly one side
      if (!side) { diag.notes.push('per-lap double-peak list found but the side is ambiguous: not assigned'); a.unmapped.push({ label: 'double peaks by lap', value: hits.map((h) => `lap ${h[1]}: ${h[2]}%`).join(', '), location: 'power vs time' }); continue; }
      const n = lapCount || Math.max(...hits.map((h) => +h[1]));
      const series = Array.from({ length: n }, (_, i) => { const h = hits.find((x) => +x[1] === i + 1); return h ? num(+h[2], '%', X.from('TEXT', 'HIGH', { section: 'Power vs Time', paragraph: b.para }, `lap ${i + 1} (${h[2]}%)`)) : { ...missing('%', 'EXTRACTION_FAILED') }; });
      put(`powerProfile.${side}.doublePeakPctByLap`, series);
    }
  }
  for (const side of ['left', 'right']) {
    const m = new RegExp(`${side} side[^.]*?(\\d+(?:\\.\\d+)?)%\\s+double peaks`, 'i').exec(allText);
    const cur = /** @type {any} */ (a.powerProfile)[side];
    // one percentage quoted for every lap, e.g. "(22.22% occurrence in both laps 1 and 2)"
    if (!cur.doublePeakPctByLap.length && lapCount) {
      const occ = new RegExp(`${side} side[^()]*\\((\\d+(?:\\.\\d+)?)%\\s+occurrence in (?:both|all) laps`, 'i').exec(allText);
      if (occ) cur.doublePeakPctByLap = Array.from({ length: lapCount }, () => num(+occ[1], '%', X.from('TEXT', 'MODERATE', { section: 'Power vs Time' }, `${occ[1]}% in every lap`)));
      else if (new RegExp(`${side} side[^.]*?clean single-peak`, 'i').test(allText)) cur.doublePeakPctByLap = Array.from({ length: lapCount }, () => num(0, '%', X.from('RULE', 'MODERATE', { section: 'Power vs Time' }, 'clean single-peak pattern')));
    }
    if (m && +m[1] === 0 && !cur.doublePeakPctByLap.length && lapCount) cur.doublePeakPctByLap = Array.from({ length: lapCount }, () => num(0, '%', X.from('RULE', 'MODERATE', { section: 'Power vs Time' }, '0% double peaks')));
    const ser = cur.doublePeakPctByLap.filter((x) => x.value != null);
    if (ser.length && ser.length === cur.doublePeakPctByLap.length) {
      cur.shape = obs(ser.some((x) => x.value > 0) ? 'MULTI_PEAK' : 'SINGLE_PEAK', { origin: 'DERIVED', location: 'derived from per-lap double-peak percentages', extraction: { method: 'RULE', confidence: 'MODERATE' } });
      diag.extracted.push(`powerProfile.${side}.shape`);
    }
  }

  // ---- qualitative output statements (EO claims about relative arm output; recorded with a rule basis, MODERATE) ----
  const more = /right arm[^.]*?(?:produces|dominates)[^.]*?(\d+)%\s+more power/i.exec(allText);
  if (more) {
    const p = X.from('RULE', 'MODERATE', { section: 'Stroke Rate & Power' }, `${more[1]}% more power`);
    a.leftRight.relativeOutput.right = obs('HIGHER', p); a.leftRight.relativeOutput.left = obs('LOWER', p); diag.extracted.push('leftRight.relativeOutput');
    if (/across all (?:eight|\d+) laps|throughout the entire set/i.test(allText)) { a.leftRight.persistence = obs('ALL_LAPS', X.from('RULE', 'MODERATE', { section: 'Stroke Rate & Power' }, 'all laps')); diag.extracted.push('leftRight.persistence'); }
  }

  // ---- which arm leads each lap, when EO says so in words (e.g. "lap 1 favouring the left side and lap 2 heavily favouring the right") ----
  const lapLead = [...allText.matchAll(/\blap\s*(\d+)\s+(?:\w+\s+)?favou?ring\s+the\s+(left|right)/gi)];
  if (lapLead.length) {
    const seen = new Set();
    a.leftRight.byLap = lapLead.filter((m) => !seen.has(m[1]) && seen.add(m[1])).map((m) => ({
      lap: +m[1], higher: obs(m[2].toLowerCase() === 'left' ? 'LEFT' : 'RIGHT', X.from('RULE', 'MODERATE', { section: 'Stroke Rate & Power' }, `lap ${m[1]} favouring ${m[2].toLowerCase()}`)),
      leftW: missing('W', 'COACH_REQUIRED'), rightW: missing('W', 'COACH_REQUIRED'),
    })).sort((x, y) => x.lap - y.lap);
    diag.extracted.push('leftRight.byLap');
  }

  // ---- EO observations (sentence level) and recommendations ----
  let n = 0;
  for (const [kind, area] of Object.entries(AREA)) {
    for (const b of sectionOf('h:' + kind)) for (const s of splitSentences(b.text)) {
      if (s.length < 12) continue;
      const c = classifyClaim(s);
      a.eoObservations.push({ id: 'eo-obs-' + (++n), area: /** @type {any} */ (area), text: s, claimType: c.claimType, claimTypeBasis: c.basis, claimTypeConfidence: c.confidence, provenance: X.from('STRUCT', 'HIGH', { section: kind, paragraph: b.para }, undefined) });
    }
  }
  diag.extracted.push(`eoObservations (${n})`);
  let r = 0;
  const pri = blocks.map((b, i) => ({ b, i })).filter((x) => x.b.kind === 'priority' || (d.kind === 'DOCX' && /^Priority \d+:/.test(x.b.text)));
  for (const { b, i } of pri) {
    // DOCX keeps the priority title as its own heading and the advice as the next paragraph; join them so both layouts agree
    let text = b.text;
    const nxt = blocks[i + 1];
    if (/^Priority \d+:[^.]*$/.test(text.trim()) && nxt && !nxt.kind) text = text + ' ' + nxt.text;
    const trunc = isTruncated(text);
    a.eoRecommendations.push({ id: 'eo-rec-' + (++r), area: 'GENERAL', text, audience: classifyAudience(text), truncated: trunc || undefined, provenance: X.from('STRUCT', 'HIGH', { section: 'What to Work On', paragraph: b.para }) });
    if (trunc) a.sourceIssues.push({ id: 'truncated-rec-' + r, severity: 'WARN', kind: 'TRUNCATION', fields: ['eoRecommendations'], message: `Recommendation ${r} appears to end mid-sentence in the source.` });
  }
  const vid = blocks.find((b) => b.kind === 'h:videos');
  if (vid) a.eoRecommendations.push({ id: 'eo-rec-' + (++r), area: 'GENERAL', text: 'EO links to public technique videos.', audience: 'COACH_ONLY', provenance: X.from('STRUCT', 'HIGH', { section: 'further resources' }) });
  diag.extracted.push(`eoRecommendations (${r})`);

  // ---- mechanical source-quality checks (contradictions between CLAIMS still need a coach or a model) ----
  const more50 = /(\d+)%\s+more power/i.exec(allText), less50 = /(\d+)%\s+less power/i.exec(allText);
  if (more50 && less50 && more50[1] === less50[1]) a.sourceIssues.push({ id: 'arm-claim-asymmetry', severity: 'INFO', kind: 'CONTRADICTION', fields: ['leftRight'], message: `One arm is said to produce ${more50[1]}% more power while the other is said to produce ${less50[1]}% less. These are not equivalent statements.` });
  if (more50 && gap && +gap[1] !== +more50[1]) a.sourceIssues.push({ id: 'arm-gap-figures', severity: 'WARN', kind: 'CONTRADICTION', fields: ['leftRight'], message: `The arm power gap is quoted as about ${more50[1]}% and as ${gap[1]}%. The ${gap[1]}% figure is preserved but not used.` });
  if (/left side[^.]*dominant side/i.test(allText) && more) a.sourceIssues.push({ id: 'dominant-side', severity: 'WARN', kind: 'CONTRADICTION', fields: ['powerProfile'], message: 'One passage calls the left side dominant while the report gives the right arm the higher power.' });
  const check = (leaf, path) => { if (leaf && hasRealConflict(leaf)) a.sourceIssues.push({ id: 'conflict-' + path, severity: 'WARN', kind: 'CONFLICTING_VALUES', fields: [path], message: `${path} is printed with different values: ${[leaf.value, ...(leaf.alternates || []).map((x) => x.value)].join(' / ')}. All are preserved with their locations; none is chosen here.` }); };
  check(a.metrics.propulsivePct, 'metrics.propulsivePct');
  for (const [, key] of DIRS) check(/** @type {any} */ (a.forceDistribution.overall)[key], `forceDistribution.overall.${key}`);

  // ---- explicit absences: why a field is empty ----
  a.swimmer.age = missing('years', 'COACH_REQUIRED'); diag.coachRequired.push('swimmer.name', 'swimmer.age');
  a.metrics.avgForceN = missing('N', 'NOT_IN_SOURCE');
  // per-arm figures are printed inside an image: they come from the vision step, which has not run yet
  a.leftRight.avgImpulseW = { left: missing('W', 'NOT_ATTEMPTED'), right: missing('W', 'NOT_ATTEMPTED') };
  a.handPath = { left: obsMissing('NOT_IN_SOURCE'), right: obsMissing('NOT_IN_SOURCE') };
  a.consistency = { left: obsMissing('NOT_IN_SOURCE'), right: obsMissing('NOT_IN_SOURCE'), withinLap: obsMissing('NOT_IN_SOURCE'), betweenLaps: obsMissing('NOT_IN_SOURCE') };
  diag.coachRequired.push('lapComparisons (lap-by-lap values are in a chart with no data labels)', 'strokePhases (stroke-phase view is not in this report)');
  return { analysis: a, diagnostics: diag };
}
