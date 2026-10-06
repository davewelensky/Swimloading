// @ts-check
/**
 * Builds the ReportModel for one profile from a SwimAnalysis + engine output.
 * A section whose evidence is absent has status MISSING and carries no data: the view omits it.
 * Nothing here invents a value; every number comes from the analysis or from a derivation named as such.
 */
import { present, getPath } from './model.js';
import { f0, f1, f2, mmss, fmtDate, span } from './language.js';
import { progressRows } from './progress.js';
import { buildPlan, retestWeeks, retestDate, pullCount, BOOK_URL } from './plan.js';

const HEADLINES = {
  POWER_EFFECTIVENESS: (a, p) => {
    const hasPower = present(a.metrics.avgPowerW);
    if (!hasPower) return ['MORE OF YOUR FORCE CAN', 'POINT FORWARD.'];
    return p === 'JUNIOR' ? ['YOU’VE GOT THE POWER.', 'LET’S SEND IT FORWARD.'] : ['YOU’RE MAKING THE POWER.', 'LET’S MAKE MORE OF IT MOVE YOU FORWARD.'];
  },
  LAP_COMPARISON: (a, p, f) => (f.meta.headlineKey === 'POWER_FALLS_MORE' ? ['YOUR FORWARD POWER DROPS', 'MORE THAN YOUR RHYTHM.'] : [`FROM ${f.meta.fromLabel}`, `TO ${f.meta.toLabel}.`]),
  ASYMMETRY_PROFILE: () => ['TWO ARMS.', 'TWO DIFFERENT POWER PATTERNS.'],
};

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
  /** @type {import('./types').ReportSection[]} */
  const sections = [];

  // HERO
  const lead = included[0] ? live.find((f) => f.id === included[0].findingIds[0]) : null;
  const head = lead && HEADLINES[lead.ruleId] ? HEADLINES[lead.ruleId](a, P, lead) : ['YOUR SWIM TODAY'];
  const metrics = profile.heroMetricOrder.map((k) => METRIC[k] && METRIC[k](a)).filter(Boolean).slice(0, profile.maxHeroMetrics);
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
  for (const k of ['upwardPct', 'handDragPct']) if (onT(k)) good.push({ title: k === 'upwardPct' ? 'No wasted lift' : 'Your hand drag is on target', detail: P === 'JUNIOR' ? '' : `${f1(onT(k).value)}%, inside EO's target (${onT(k).target}).` });
  for (const [side, name] of [['left', 'left'], ['right', 'right']]) {
    const pp = a.powerProfile[side], ser = pp.doublePeakPctByLap.filter(present);
    if (present(pp.shape) && pp.shape.value === 'SINGLE_PEAK' && ser.length && ser.every((m) => m.value === 0)) good.push({ title: `Your ${name} arm pushes smoothly`, detail: ser.length > 1 ? `One clean push per stroke in every lap.` : 'One clean push per stroke.' });
  }
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
      targets: miss.length ? { context: ctxText ? `EO's target for ${ctxText}` : 'EO’s target', rows: miss.map((r) => ({ id: r.key, label: r.label, value: r.value, target: r.target, status: r.status, gap: r.gap })), simple: P === 'JUNIOR' } : null,
      explanations: okClaims.filter((x) => !x.strength).map((x) => x.shown) } });
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
  // a lap swap is already focus #2 on a swimmer's report, so its own page would only repeat it; the coach view keeps the detail
  if (!as || (!isCoach && as.meta.lapSwap)) sections.push({ id: 'ARMS', status: 'MISSING', data: null });
  else {
    const arms = as.meta.arms;
    // JUNIOR gets the pattern, not the arithmetic: drop parenthetical figures such as "(67 W)" or "(5 of 8 laps, up to 44%)"
    const tidy = (pts) => (P === 'JUNIOR' ? pts.map((x) => x.replace(/\s*\([^)]*\)/g, '')) : pts);
    const armsOut = { left: { ...arms.left, points: tidy(arms.left.points) }, right: { ...arms.right, points: tidy(arms.right.points) } };
    const timing = P === 'JUNIOR' ? { left: [], right: [] } : as.meta.timing;      // JUNIOR: no phase arithmetic
    const lapWord = (n) => `LAP ${n}`;
    sections.push({ id: 'ARMS', status: quality.sections.ARMS, data: {
      headline: 'YOUR TWO ARMS',
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
  sections.push({ id: 'PROGRESS', status: prog.length ? 'COMPLETE' : 'MISSING', data: prog.length ? {
    headline: 'SINCE LAST TIME', since: a.baseline.capturedOn ? fmtDate(a.baseline.capturedOn) : null,
    summary: better === prog.length ? 'Every number moved the right way.' : better === 0 ? 'No number has moved yet. That is normal early on: keep working on your focus.' : `${better} of ${prog.length} numbers moved the right way.`,
    rows: prog } : null });

  // PLAN: what to work on in the weeks before the retest, one focus at a time, from this report's own priorities and drills
  const weeks = retestWeeks(a.coachReview && a.coachReview.retestWeeks);
  const steps = buildPlan(included.map((p) => ({ title: p.title, cue: p.cue, drill: p.drill })), weeks);
  const pulls = pullCount(a);
  sections.push({ id: 'PLAN', status: steps.length ? 'COMPLETE' : 'MISSING', data: steps.length ? {
    headline: 'YOUR PRACTICE PLAN', weeks, steps,
    check: pulls != null ? { perLength: pulls, text: 'Count your strokes on any length, in any session, with no sensors. When that number drops, it is working.' } : null } : null });

  // NEXT
  const baseline = Object.keys(a.baseline.metrics).filter((k) => BASELINE_FMT[k]).map((k) => ({ label: BASELINE_LABELS[k], ...BASELINE_FMT[k](a.baseline.metrics[k]) }));
  const remeasure = included.flatMap((p) => /** @type {any} */ (live.find((f) => f.id === p.findingIds[0])).meta.remeasure || []);
  sections.push({ id: 'NEXT', status: quality.sections.NEXT, data: { headline: 'YOUR NEXT SESSION', retest: { weeks, date: present(a.session.date) ? retestDate(a.session.date.value, weeks) : null }, book: { url: BOOK_URL, label: 'Book your retest' }, baselineDate: a.baseline.capturedOn ? fmtDate(a.baseline.capturedOn) : null, baseline: prog.length ? [] : P === 'JUNIOR' ? baseline.slice(0, 2) : baseline, remeasure: isCoach ? remeasure : remeasure.slice(0, 3) } });

  // order of the story: where you are (going well, power, progress since last time), what to do (focus, plan), come back (next)
  const pi = sections.findIndex((x) => x.id === 'PROGRESS'), wi = sections.findIndex((x) => x.id === 'POWER');
  if (pi > -1 && wi > -1 && pi > wi) sections.splice(wi + 1, 0, sections.splice(pi, 1)[0]);

  if (isCoach) {
    sections.push({ id: 'EVIDENCE', status: 'COMPLETE', data: { findings: findings.map((f) => ({ ...f, resolved: f.evidence.map((r) => describeRef(a, r)) })) } });
    sections.push({ id: 'DATA_QUALITY', status: 'COMPLETE', data: quality });
    sections.push({ id: 'SOURCE', status: 'COMPLETE', data: { observations: a.eoObservations, recommendations: a.eoRecommendations, reference: a.eoReferenceRanges, source: a.source } });
  }
  return { profile, sections };
}
