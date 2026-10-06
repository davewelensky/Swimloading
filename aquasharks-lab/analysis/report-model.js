// @ts-check
/**
 * Builds the ReportModel for one profile from a SwimAnalysis + engine output.
 * A section whose evidence is absent has status MISSING and carries no data: the view omits it.
 * Nothing here invents a value; every number comes from the analysis or from a derivation named as such.
 */
import { present, getPath } from './model.js';
import { f0, f1, f2, mmss, fmtDate, span } from './language.js';
import { progressRows, historyEntry } from './progress.js';
import { classifyAgainst } from './rules.js';
import { buildPlan, retestWeeks, retestDate, pullCount, BOOK_URL } from './plan.js';

const HEADLINES = {
  POWER_EFFECTIVENESS: (a, p) => {
    const hasPower = present(a.metrics.avgPowerW);
    if (!hasPower) return ['MORE OF YOUR FORCE CAN', 'POINT FORWARD.'];
    return p === 'JUNIOR' ? ['YOU’VE GOT THE POWER.', 'LET’S SEND IT FORWARD.'] : ['YOU’RE MAKING THE POWER.', 'LET’S POINT MORE OF IT FORWARD.'];
  },
  LAP_COMPARISON: (a, p, f) => (f.meta.headlineKey === 'POWER_FALLS_MORE' ? ['YOUR FORWARD POWER DROPS', 'MORE THAN YOUR RHYTHM.'] : [`FROM ${f.meta.fromLabel}`, `TO ${f.meta.toLabel}.`]),
  ASYMMETRY_PROFILE: () => ['TWO ARMS.', 'TWO DIFFERENT POWER PATTERNS.'],
};

/** The retest is counted from when the swimmer gets the report (reportDate), never from an earlier swim date: a swim from weeks ago would give a date already past. */
const retestBase = (a) => { const swim = present(a.session.date) ? a.session.date.value : null, rep = /^\d{4}-\d{2}-\d{2}$/.test(a.reportDate || '') ? a.reportDate : null; return rep && (!swim || rep > swim) ? rep : swim; };
const KEYOF = { forward: 'propulsivePct', down: 'downwardPct', inward: 'leftwardPct' };
const targetTextOf = (r) => { const n = (v) => String(Math.round(v * 10) / 10); return r.lo != null && r.hi != null ? (r.lo === r.hi ? `${n(r.lo)}%` : `${n(r.lo)}\u2013${n(r.hi)}%`) : r.hi != null ? `under ${n(r.hi)}%` : `over ${n(r.lo)}%`; };
const METRIC = {
  timeS: (a) => (present(a.session.timeS) ? { label: 'TIME', value: mmss(a.session.timeS.value), unit: '' } : null),
  distanceM: (a) => (present(a.session.distanceM) ? { label: 'DISTANCE', value: f0(a.session.distanceM.value), unit: 'm' } : null),
  distancePerStrokeM: (a) => (present(a.metrics.distancePerStrokeM) ? { label: 'DISTANCE PER STROKE', value: f2(a.metrics.distancePerStrokeM.value), unit: 'm' } : null),
  strokeRate: (a) => (present(a.metrics.strokeRate) ? { label: 'STROKE RATE', value: a.metrics.strokeRate.value.toFixed(1), unit: 'str/min' } : null),
  avgPowerW: (a) => (present(a.metrics.avgPowerW) ? { label: 'AVERAGE POWER', value: a.metrics.avgPowerW.value.toFixed(1), unit: 'W' } : null),
  forwardShare: (a) => (present(a.forceDistribution.overall.propulsivePct) ? { label: 'FORCE GOING FORWARD', value: a.forceDistribution.overall.propulsivePct.value.toFixed(1), unit: '%' } : null),
};
export const BASELINE_LABELS = { timeS: 'Time', distancePerStrokeM: 'Distance per stroke', strokeRate: 'Stroke rate', avgPowerW: 'Average power', propulsivePct: 'Forward share of force', downwardPct: 'Downward share of force' };
const BASELINE_FMT = { timeS: (v) => ({ value: mmss(v), unit: '' }), distancePerStrokeM: (v) => ({ value: f2(v), unit: 'm' }), strokeRate: (v) => ({ value: f2(v), unit: 'str/min' }), avgPowerW: (v) => ({ value: f2(v), unit: 'W' }), propulsivePct: (v) => ({ value: f1(v), unit: '%' }), downwardPct: (v) => ({ value: f1(v), unit: '%' }) };

function sessionLine(a) {
  const s = a.session, parts = [];
  if (present(s.distanceM)) parts.push(`${f0(s.distanceM.value)} m${present(s.stroke) ? ' ' + s.stroke.value.toLowerCase() : ''}`);
  else if (present(s.stroke)) parts.push(s.stroke.value);
  if (present(s.timeS)) parts.push(mmss(s.timeS.value));
  if (present(s.laps)) parts.push(`${f0(s.laps.value)} laps`);
  if (present(s.poolLengthM)) parts.push(`${f0(s.poolLengthM.value)} m pool`);
  const date = present(s.date) ? fmtDate(s.date.value) : '';
  return { line: parts.join(' • '), date, location: present(s.location) ? s.location.value : '' };
}

/** Resolve an evidence path to a readable value for the coach view. */
export function describeRef(a, ref) {
  const v = getPath(a, ref);
  if (v === undefined) return { ref, text: '(path not found)' };
  if (Array.isArray(v)) return { ref, text: `${v.length} items` };
  if (v && typeof v === 'object' && 'from' in v && 'to' in v && 'change' in v) {
    const part = (m) => (present(m) ? (m.range ? span(m.range[0], m.range[1]) : `${m.approximate ? '~' : ''}${m.value}`) : 'n/a');
    return { ref, text: `from ${part(v.from)} \u2192 to ${part(v.to)}, change ${part(v.change)}${present(v.change) && v.change.unit ? v.change.unit : ''}` };
  }
  if (v && typeof v === 'object' && 'status' in v) {
    if (!present(v)) return { ref, text: 'MISSING' };
    const val = v.range ? `${v.range[0]} to ${v.range[1]}${v.unit || ''}` : (v.value + (v.unit && v.unit !== '' ? (v.unit === '%' ? '%' : ' ' + v.unit) : ''));
    return { ref, text: `${v.approximate || v.range ? '~' : ''}${val}`, status: v.status, origin: v.provenance && v.provenance.origin, location: v.provenance && (v.provenance.location || v.provenance.note) };
  }
  return { ref, text: typeof v === 'object' ? 'group' : String(v) };
}

/**
 * @param {import('./types').SwimAnalysis} a
 * @param {import('./types').Finding[]} findings
 * @param {import('./types').Priority[]} priorities
 * @param {any} quality
 * @param {import('./types').ProfileConfig} profile
 */
export function buildReport(a, findings, priorities, quality, profile) {
  const P = profile.id, isCoach = P === 'COACH';
  const live = findings.filter((f) => f.review.status !== 'SUPPRESSED');
  const byRule = (id) => live.find((f) => f.ruleId === id);
  const included = priorities.filter((p) => p.included);
  // the next distance-per-stroke goal is the coach's own decision (EO prints no target for it)
  const rawGoal = a.coachReview && a.coachReview.dpsGoalM;
  const dpsGoal = typeof rawGoal === 'number' && rawGoal > 0.5 && rawGoal < 5 ? rawGoal : null;
  /** @type {import('./types').ReportSection[]} */
  const sections = [];

  // HERO
  const lead = included[0] ? live.find((f) => f.id === included[0].findingIds[0]) : null;
  const head = lead && HEADLINES[lead.ruleId] ? HEADLINES[lead.ruleId](a, P, lead) : ['YOUR SWIM TODAY'];
  const metrics = profile.heroMetricOrder.map((k) => METRIC[k] && METRIC[k](a)).filter(Boolean).slice(0, profile.maxHeroMetrics);
  if (dpsGoal && present(a.metrics.distancePerStrokeM)) { const dps = metrics.find((m) => m.label === 'DISTANCE PER STROKE'); if (dps) dps.goal = `Next goal ${f2(dpsGoal)} m`; }
  const sl = sessionLine(a);
  sections.push({ id: 'HERO', status: quality.sections.HERO, data: { name: a.swimmer.name, sessionLine: sl.line, date: sl.date, location: sl.location, headline: head, keyMetrics: metrics, headlineFinding: lead ? lead.id : null } });

  // NOTE: a short personal note from the coach. Absent unless one was written.
  const rawNote = a.coachReview && a.coachReview.coachNote;
  const note = typeof rawNote === 'string' ? rawNote.trim().slice(0, 1200) : '';
  sections.push({ id: 'NOTE', status: note ? 'COMPLETE' : 'MISSING', data: note ? { text: note, from: 'Britt', club: 'Aqua Sharks' } : null });

  // what the coach has approved of EO's own wording (hidden until approved)
  const claims = (a.coachReview && a.coachReview.eoClaims) || {};
  const approved = (id, text) => { const c = claims[id]; if (!c) return null; if (c.status === 'APPROVED') return text; if (c.status === 'EDITED' && c.editedText && c.editedText.trim()) return c.editedText.trim().slice(0, 600); return null; };
  const peF = byRule('POWER_EFFECTIVENESS');
  const cands = peF && peF.meta.explanationCandidates ? peF.meta.explanationCandidates : [];
  const okClaims = cands.map((c) => ({ ...c, shown: approved(c.id, c.text) })).filter((c) => c.shown);

  // STRENGTHS: what is going well, from EO's own on-target numbers and smooth force delivery. Nothing here is a judgement the data does not support.
  const good = [];
  const trows = peF ? peF.meta.targetRows || [] : [];
  const onT = (k) => trows.find((r) => r.key === k && r.status === 'ON_TARGET');
  if (onT('leftwardPct') && onT('rightwardPct')) good.push({ title: 'Your sideways push is balanced', detail: P === 'JUNIOR' ? 'Almost none of your push goes sideways.' : `Left ${f1(onT('leftwardPct').value)}% and right ${f1(onT('rightwardPct').value)}%, both inside EO's target (${onT('leftwardPct').target}).` });
  else for (const k of ['leftwardPct', 'rightwardPct']) if (onT(k)) good.push({ title: `Your ${k === 'leftwardPct' ? 'leftward' : 'rightward'} drift is on target`, detail: P === 'JUNIOR' ? '' : `${f1(onT(k).value)}%, inside EO's target (${onT(k).target}).` });
  for (const k of ['upwardPct', 'handDragPct']) if (onT(k)) good.push({ title: k === 'upwardPct' ? 'No wasted lift' : 'Your hand drag is on target', detail: P === 'JUNIOR' ? '' : k === 'upwardPct' && onT(k).value > 0 ? `${f1(onT(k).value)}%, small enough that EO treats it as negligible.` : `${f1(onT(k).value)}%, inside EO's target (${onT(k).target}).` });
  for (const [side, name] of [['left', 'left'], ['right', 'right']]) {
    const pp = a.powerProfile[side], ser = pp.doublePeakPctByLap.filter(present);
    if (present(pp.shape) && pp.shape.value === 'SINGLE_PEAK' && ser.length && ser.every((m) => m.value === 0)) good.push({ title: `Your ${name} arm pushes smoothly`, detail: ser.length > 1 ? `One clean push per stroke in every lap.` : 'One clean push per stroke.' });
  }
  const hpr = a.handPathReading;
  if (hpr && present(hpr.crossesMidline) && hpr.crossesMidline.value === 'NO') good.push({ title: 'Your hands stay on their own side', detail: P === 'JUNIOR' ? '' : 'Neither hand crosses the middle of your body as you pull.' });
  if (hpr && ['left', 'right'].every((k) => present(hpr[k].spread) && hpr[k].spread.value === 'TIGHT')) good.push({ title: 'Your hand path is repeatable', detail: P === 'JUNIOR' ? '' : 'Both hands follow almost the same path stroke after stroke.' });
  for (const c of okClaims.filter((x) => x.strength)) good.push({ title: 'From the EO analysis', detail: c.shown, eo: true });
  const goodShown = good.slice(0, 4);
  sections.push({ id: 'STRENGTHS', status: goodShown.length ? 'COMPLETE' : 'MISSING', data: goodShown.length ? { headline: 'WHAT’S GOING WELL', items: goodShown } : null });

  // POWER
  const pe = byRule('POWER_EFFECTIVENESS');
  if (!pe || quality.sections.POWER === 'MISSING') sections.push({ id: 'POWER', status: 'MISSING', data: null });
  else {
    const c = pe.meta.categories, cats = [{ id: 'forward', label: 'FORWARD', pct: c.forward }, { id: 'down', label: 'DOWN', pct: c.down }];
    if (c.side !== null) cats.push({ id: 'side', label: 'SIDEWAYS', pct: c.side, detail: P === 'JUNIOR' ? null : `${f1(c.left)}% left, ${f1(c.right)}% right` });
    if (c.other !== null && P !== 'JUNIOR') cats.push({ id: 'other', label: 'OTHER', pct: c.other, detail: 'upward and hand drag' });
    const miss = trows.filter((r) => r.status !== 'ON_TARGET' && r.key !== 'upwardPct').sort((x, y) => y.gap - x.gap).slice(0, 3);
    const ctx = a.eoReferenceContext || {};
    const ctxText = [ctx.swimmerType, ctx.stroke].filter(Boolean).join(' ').toLowerCase();
    sections.push({ id: 'POWER', status: quality.sections.POWER, data: { headline: 'WHERE YOUR POWER GOES', categories: cats, whatThisMeans: pe.text[P], findingId: pe.id, kind: pe.kind,
      squares: Math.round(c.forward),
      targets: miss.length ? { context: ctxText ? `EO's target for ${ctxText}` : 'EO’s target', rows: miss.map((r) => ({ id: r.key, label: r.label, value: r.value, target: r.target, status: r.status, gap: r.gap })), simple: P === 'JUNIOR' } : null,
      explanations: okClaims.filter((x) => !x.strength).map((x) => x.shown) } });
  }

  // EACH HAND: where each hand sends its force, from the EO data export (EO's own per-hand figures). Targets are EO's printed ranges, when there are any.
  const ffx = a.eoExport && a.eoExport.forceField;
  if (!ffx || !ffx.left || !ffx.right || !ffx.left.mean || !ffx.right.mean || ffx.left.mean.propulsive == null || ffx.right.mean.propulsive == null) sections.push({ id: 'HANDS', status: 'MISSING', data: null });
  else {
    const refs = a.eoReferenceRanges || {}, tText = (k) => (refs[k] && (refs[k].lo != null || refs[k].hi != null) ? targetTextOf(refs[k]) : null);
    const inwardKey = (hand) => (hand === 'left' ? 'rightward' : 'leftward'), inwardRef = (hand) => refs[hand === 'left' ? 'rightwardPct' : 'leftwardPct'];
    const row = (id, label, v, ref) => ({ id, label, value: v, target: ref && (ref.lo != null || ref.hi != null) ? targetTextOf(ref) : null, status: ref && (ref.lo != null || ref.hi != null) ? classifyAgainst(v, ref, KEYOF[id]).status : null });
    const hands = ['left', 'right'].map((k) => { const m = ffx[k].mean; return { id: k, label: k === 'left' ? 'LEFT HAND' : 'RIGHT HAND', rows: [row('forward', 'Forward', m.propulsive, refs.propulsivePct), row('down', 'Down', m.downward, refs.downwardPct), row('inward', 'Sideways, inward', m[inwardKey(k)], inwardRef(k))] }; });
    const first = (k) => ffx[k].byLap[0], last = (k) => ffx[k].byLap[ffx[k].byLap.length - 1];
    const trend = [];
    if (ffx.left.byLap.length >= 2 && ffx.right.byLap.length >= 2) {
      const f = (n) => (Math.round(n * 10) / 10).toFixed(1);
      trend.push(`Inward force, lap ${first('left').lap} to lap ${last('left').lap}: left hand ${f(first('left').rightward)}% to ${f(last('left').rightward)}%, right hand ${f(first('right').leftward)}% to ${f(last('right').leftward)}%.`);
      trend.push(`Downward force, lap ${first('left').lap} to lap ${last('left').lap}: left hand ${f(first('left').downward)}% to ${f(last('left').downward)}%, right hand ${f(first('right').downward)}% to ${f(last('right').downward)}%.`);
    }
    sections.push({ id: 'HANDS', status: 'COMPLETE', data: { fans: ffx.left.fan && ffx.right.fan ? { left: ffx.left.fan, right: ffx.right.fan } : null, headline: 'EACH HAND', context: refs.downwardPct && a.eoReferenceContext && (a.eoReferenceContext.swimmerType || a.eoReferenceContext.stroke) ? `EO's target for ${[a.eoReferenceContext.swimmerType, a.eoReferenceContext.stroke].filter(Boolean).join(' ').toLowerCase()}` : null, hands, trend: P === 'JUNIOR' ? [] : trend, simple: P === 'JUNIOR' } });
  }

  // HANDPATH: the real path of each hand under the water, from the export's hand coordinates (six real strokes per hand), with plain facts
  const hpx = a.eoExport && a.eoExport.handPath;
  if (!hpx || !hpx.left || !hpx.right || !(hpx.left.samples || []).length || !(hpx.right.samples || []).length) sections.push({ id: 'HANDPATH', status: 'MISSING', data: null });
  else {
    const facts = [], cross = ['left', 'right'].filter((k) => hpx[k].crossingCm && hpx[k].crossingCm.median > 0);
    facts.push(cross.length ? cross.map((k) => `Your ${k} hand crosses the centre line by about ${f0(hpx[k].crossingCm.median)} cm in a typical stroke.`).join(' ') : 'Neither hand crosses the centre line.');
    if (P !== 'JUNIOR') {
      if (hpx.left.inwardSweepCm && hpx.right.inwardSweepCm) facts.push(`Each pull sweeps inward: your left hand by about ${f0(hpx.left.inwardSweepCm.median)} cm and your right by about ${f0(hpx.right.inwardSweepCm.median)} cm.`);
      if (hpx.left.depthCm && hpx.right.depthCm) facts.push(`Your hands reach about ${f0(hpx.left.depthCm.median)} cm (left) and ${f0(hpx.right.depthCm.median)} cm (right) below the surface.`);
    }
    sections.push({ id: 'HANDPATH', status: 'COMPLETE', data: { headline: 'YOUR HANDS, UNDERWATER', left: hpx.left.samples, right: hpx.right.samples, facts } });
  }

  // COMPARISON (endpoint lap comparison; never called a trend or a fatigue response)
  const lc = byRule('LAP_COMPARISON');
  if (!lc) sections.push({ id: 'COMPARISON', status: 'MISSING', data: null });
  else {
    let rows = lc.meta.rows;
    if (P === 'JUNIOR') rows = rows.filter((r) => r.id === 'strokeRate' || r.id === 'propulsivePower' || (r.id === 'pullPower' && !rows.some((x) => x.id === 'propulsivePower')));
    else if (P !== 'COACH') rows = rows.filter((r) => r.kind === 'pct' || r.id === 'forwardShare');
    const c = a.lapComparisons[lc.meta.comparisonIndex];
    const refNote = [c.from, c.to].some((r) => r.status !== 'COMPLETE') ? 'The laps behind this comparison are not fully established.' : null;
    sections.push({ id: 'COMPARISON', status: quality.sections.COMPARISON, data: {
      headline: `${lc.meta.fromLabel} \u2192 ${lc.meta.toLabel}`, eyebrow: 'Start to finish', kind: lc.meta.comparisonKind,
      laps: `${lc.meta.fromLap} to ${lc.meta.toLap}`, finding: lc.title, rows, interpretation: lc.text[P], refNote,
      corroboration: isCoach ? lc.corroboration : null, remainder: isCoach ? lc.meta.remainder : null, findingId: lc.id } });
  }

  // ARMS
  const as = byRule('ASYMMETRY_PROFILE');
    if (!as) sections.push({ id: 'ARMS', status: 'MISSING', data: null });
  else {
    const arms = as.meta.arms;
    // JUNIOR gets the pattern, not the arithmetic: drop parenthetical figures such as "(67 W)" or "(5 of 8 laps, up to 44%)"
    const tidy = (pts) => (P === 'JUNIOR' ? pts.map((x) => x.replace(/\s*\([^)]*\)/g, '')) : pts);
    const armsOut = { left: { ...arms.left, points: tidy(arms.left.points) }, right: { ...arms.right, points: tidy(arms.right.points) } };
    const timing = P === 'JUNIOR' ? { left: [], right: [] } : as.meta.timing;      // JUNIOR: no phase arithmetic
    const lapWord = (n) => `LAP ${n}`;
    sections.push({ id: 'ARMS', status: quality.sections.ARMS, data: {
      headline: 'YOUR TWO ARMS',
      // the sales page promises "left against right": the two numbers, plainly (words only for juniors)
      lr: as.meta.outputGap && a.leftRight.avgImpulseW.left.value != null && a.leftRight.avgImpulseW.right.value != null ? { left: a.leftRight.avgImpulseW.left.value, right: a.leftRight.avgImpulseW.right.value, higher: as.meta.outputGap.higher, gapW: Math.abs(a.leftRight.avgImpulseW.left.value - a.leftRight.avgImpulseW.right.value), simple: P === 'JUNIOR' } : null,
      left: { points: armsOut.left.points, timing: timing.left, coachOnly: isCoach ? armsOut.left.coachOnly : [], shape: a.powerProfile.left.shape.value },
      right: { points: armsOut.right.points, timing: timing.right, coachOnly: isCoach ? armsOut.right.coachOnly : [], shape: a.powerProfile.right.shape.value },
      phases: as.meta.phases.left && as.meta.phases.right ? { left: as.meta.phases.left, right: as.meta.phases.right, showNumbers: profile.showNumbers !== 'MINIMAL' } : null,
      doublePeaks: as.meta.doublePeaks, lapLeads: as.meta.lapSwap ? as.meta.lapLeads : [], opportunity: as.meta.opportunity, summary: as.text[P], findingId: as.id } });
  }

  // FOCUS
  const shown = isCoach ? priorities : included;
  sections.push({ id: 'FOCUS', status: quality.sections.FOCUS, data: { headline: 'YOUR FOCUS', priorities: shown.map((p) => ({
    id: p.id, rank: p.rank, title: p.title, why: isCoach ? /** @type {any} */ (findings.find((f) => f.id === p.findingIds[0])).text.COACH : p.why[P], feel: p.feel, cue: p.cue, drill: p.drill,
    swimmerFacing: p.swimmerFacing, included: p.included, coachOnlyReason: p.coachOnlyReason, suppressed: !!p.suppressed,
    classification: p.classification, confidence: p.confidence, findingId: p.findingIds[0],
    evidence: isCoach ? /** @type {any} */ (findings.find((f) => f.id === p.findingIds[0])).evidence.map((r) => describeRef(a, r)) : [] })) } });

  // PROGRESS: since the last session, when an earlier session of this swimmer has been linked
  const prog = progressRows(a);
  const better = prog.filter((r) => r.verdict === 'BETTER').length;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const short = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${+m[3]} ${MON[+m[2] - 1]}` : 'earlier'; };
  // the swimmer's line: every earlier session the chain of reports carries, then this one
  const line = prog.length ? [...((a.baseline && a.baseline.history) || []), historyEntry(a)].filter((x) => x.forward != null && x.down != null) : [];
  const chart = line.length >= 2 ? line.map((x, i) => ({ label: i === line.length - 1 ? short(x.date) || 'now' : short(x.date), forward: x.forward, down: x.down })) : null;
  const tiles = [];
  if (line.length >= 2) {
    const x0 = line[0], x1 = line[line.length - 1], sgn = (n) => (n > 0 ? '+' : n < 0 ? '\u2212' : ''), rel = (u, v) => (u > 0 ? Math.round(((v - u) / u) * 100) : null);
    const fr = rel(x0.forward, x1.forward); if (fr != null) tiles.push({ value: `${sgn(fr)}${Math.abs(fr)}%`, label: fr >= 0 ? 'more of your force going forward' : 'less of your force going forward' });
    const dd = Math.round((x1.down - x0.down) * 10) / 10; tiles.push({ value: `${sgn(dd)}${Math.abs(dd)}`, label: dd <= 0 ? 'points of downward force removed' : 'points of downward force added' });
    if (x0.handDrag != null && x1.handDrag != null) { const hd = rel(x0.handDrag, x1.handDrag); if (hd != null) tiles.push({ value: `${sgn(hd)}${Math.abs(hd)}%`, label: hd <= 0 ? 'hand drag cut' : 'hand drag up' }); }
    if (x0.rate != null && x1.rate != null) { const sr = Math.round((x1.rate - x0.rate) * 10) / 10; tiles.push({ value: sr === 0 ? '0' : `${sgn(sr)}${Math.abs(sr)}`, label: 'change in stroke rate' }); }
  }
  const dpsNow = present(a.metrics.distancePerStrokeM) ? a.metrics.distancePerStrokeM.value : null;
  const ruler = dpsNow != null && a.baseline && a.baseline.metrics && typeof a.baseline.metrics.distancePerStrokeM === 'number' ? { then: a.baseline.metrics.distancePerStrokeM, now: dpsNow, goal: dpsGoal } : null;
  sections.push({ id: 'PROGRESS', status: prog.length ? 'COMPLETE' : 'MISSING', data: prog.length ? {
    chart, tiles: P === 'JUNIOR' ? tiles.slice(0, 2) : tiles, ruler,
    headline: 'SINCE LAST TIME', since: a.baseline.capturedOn ? fmtDate(a.baseline.capturedOn) : null,
    summary: better === prog.length ? 'Every number moved the right way.' : better === 0 ? 'No number has moved yet. That is normal early on: keep working on your focus.' : `${better} of ${prog.length} numbers moved the right way.`,
    rows: prog } : null });

  // PLAN: what to work on in the weeks before the retest, one focus at a time, from this report's own priorities and drills
  const weeks = retestWeeks(a.coachReview && a.coachReview.retestWeeks);
  const steps = buildPlan(included.map((p) => ({ title: p.title, cue: p.cue, drill: p.drill })), weeks);
  const pulls = pullCount(a);
  sections.push({ id: 'PLAN', status: steps.length ? 'COMPLETE' : 'MISSING', data: steps.length ? {
    headline: 'YOUR PRACTICE PLAN', weeks, steps, tip: 'One thing at a time. Slow it down: build each change at an easy pace first, then pick up the pace once it holds.',
    check: pulls != null ? { perLength: pulls, text: 'Count how many times your right hand enters the water on one length, in any session, with no sensors. When that number drops, it is working.' } : null } : null });

  // NEXT
  const baseline = Object.keys(a.baseline.metrics).filter((k) => BASELINE_FMT[k]).map((k) => ({ label: BASELINE_LABELS[k], ...BASELINE_FMT[k](a.baseline.metrics[k]) }));
  const dpsRow = dpsGoal && present(a.metrics.distancePerStrokeM) ? [{ label: 'Distance per stroke', current: `${f2(a.metrics.distancePerStrokeM.value)} m`, target: `${f2(dpsGoal)} m` }] : [];
  const remeasure = [...dpsRow, ...included.flatMap((p) => /** @type {any} */ (live.find((f) => f.id === p.findingIds[0])).meta.remeasure || [])];
  sections.push({ id: 'NEXT', status: quality.sections.NEXT, data: { headline: 'YOUR NEXT SESSION', retest: { weeks, date: retestBase(a) ? retestDate(retestBase(a), weeks) : null }, book: { url: BOOK_URL, label: 'Book your retest' }, baselineDate: a.baseline.capturedOn ? fmtDate(a.baseline.capturedOn) : null, baseline: prog.length ? [] : P === 'JUNIOR' ? baseline.slice(0, 2) : baseline, remeasure: isCoach ? remeasure : remeasure.slice(0, 3) } });

  // order of the story: where you are (going well, power, progress since last time), what to do (focus, plan), come back (next)
  const pi = sections.findIndex((x) => x.id === 'PROGRESS'), fi = sections.findIndex((x) => x.id === 'FOCUS');
  if (pi > -1 && fi > -1 && pi > fi) sections.splice(fi, 0, sections.splice(pi, 1)[0]);
  // left and right belong together: each hand's force, then the two arms' power, then how it changes first lap to last
  const ci = sections.findIndex((x) => x.id === 'COMPARISON'), ai = sections.findIndex((x) => x.id === 'ARMS');
  if (ci > -1 && ai > -1 && ai > ci) sections.splice(ci, 0, sections.splice(ai, 1)[0]);

  if (isCoach) {
    sections.push({ id: 'EVIDENCE', status: 'COMPLETE', data: { findings: findings.map((f) => ({ ...f, resolved: f.evidence.map((r) => describeRef(a, r)) })) } });
    sections.push({ id: 'DATA_QUALITY', status: 'COMPLETE', data: quality });
    sections.push({ id: 'SOURCE', status: 'COMPLETE', data: { observations: a.eoObservations, recommendations: a.eoRecommendations, reference: a.eoReferenceRanges, source: a.source } });
  }
  return { profile, sections };
}
