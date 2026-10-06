// @ts-check
/**
 * Deterministic rule engine. Reads SOURCE fields of a SwimAnalysis and returns Findings.
 * Rules never edit the analysis, never use a fixed threshold on swimmer data, and only
 * compare values the source actually gave. Missing evidence means the rule does not fire.
 *
 * Relationships implemented (each is a rule, none is collapsed into a score):
 *   POWER + FORCE DISTRIBUTION                                      -> POWER_EFFECTIVENESS
 *   ENDPOINT LAP COMPARISON (stroke rate, pull power, propulsive power, force share) -> LAP_COMPARISON
 *      The signals are CORROBORATED by direction. No equation links them: none is documented by EO.
 *   L/R POWER + L/R POWER SHAPE (+ timing, path)                    -> ASYMMETRY_PROFILE
 *   POWER SHAPE + HAND PATH + HAND PATH & POWER                     -> POSSIBLE_TECHNICAL_OPPORTUNITY
 *   OUTPUT (rate, DPS, power, work, time)                           -> OUTPUT_SUMMARY (context)
 */
import { present, getPath } from './model.js';
import { round, changeOf, largerMagnitude, asymmetry, corroborate, directionOf, confidenceOf, minConfidence, pointChange, printedValues, hasRealConflict } from './calc.js';
import { f0, f1, f2, signed, span, mmss, lapLabel, lapName } from './language.js';

const CLASS_WEIGHT = { MEASURED: 3, OBSERVED: 2, INFERRED: 1, COACH_CONFIRMATION_REQUIRED: 0 };
const CONF_WEIGHT = { HIGH: 3, MODERATE: 2, LOW: 1 };

/** Impact weights are about WHICH KIND of finding matters more for a swimmer, not about any measured value. */
/** POWER_EFFECTIVENESS is 5: when force direction is off EO's target it is the dominant finding, and EO's guide says to fix the dominant error first (its error list starts with force direction). */
export const RULE_IMPACT = { HAND_FORCE_FIELD: 1, HAND_PATH_CROSSOVER: 3, HAND_PATH_WRIST: 3, HAND_PATH_CONSISTENCY: 2, HAND_PATH_FACTS: 1, POWER_EFFECTIVENESS: 5, LAP_COMPARISON: 3, ASYMMETRY_PROFILE: 2, POSSIBLE_TECHNICAL_OPPORTUNITY: 2, OUTPUT_SUMMARY: 1 };

/** @returns {import('./types').Finding} */
function finding(f) {
  const impact = RULE_IMPACT[f.ruleId] || 1;
  return {
    kind: 'CONTEXT', observation: null, interpretation: null, recommendation: null, caveats: [], relationships: [],
    coachConfirmation: { required: false }, impact, ...f, id: f.ruleId.toLowerCase().replace(/_/g, '-'),
    score: CLASS_WEIGHT[f.classification] * CONF_WEIGHT[f.confidence] * impact,
    review: { status: 'PENDING' },
  };
}
const pathOf = (...p) => p.join('.');

/** A comparison endpoint whose lap identity is not fully established. */
function lapRefCaveat(c) {
  const out = [];
  for (const [name, ref] of [['start', c.from], ['end', c.to]]) if (ref.status !== 'COMPLETE') out.push(`The lap behind the ${name} of this comparison is not fully established (${ref.status.toLowerCase()}).`);
  return out;
}
/** Every printed value for a quantity, with where it was printed, and how the used one was selected. Never silently reconciled. */
function conflictCaveat(m, label) {
  const vals = printedValues(m);
  if (vals.length < 2) return [];
  const list = vals.map((v) => `${v.value}%${v.location ? ' (' + v.location + ')' : ''}${v.used ? ' used' : ''}`).join(' / ');
  const kind = hasRealConflict(m) ? 'Printed values disagree' : 'Printed at different precision';
  return [`${kind} for ${label}: ${list}. ${m.selectionBasis ? 'Selection basis: ' + m.selectionBasis + '. ' : ''}This is a source-selection decision, not established ground truth.`];
}


// ---------------------------------------------------------------------------------------------
// EO's own target ranges. They are read from the report (never hardcoded here) and compared with the swimmer's value.
/** EO's own guidance on a value too small to matter (Technical Error Index, Feb 2026: "<3-4%"). */
export const UPWARD_NEGLIGIBLE_PCT = 3;
const TARGET_KEYS = [['propulsivePct', 'Forward', 'forward share'], ['downwardPct', 'Downward', 'downward force'], ['handDragPct', 'Hand drag', 'hand drag'], ['upwardPct', 'Upward', 'upward force'], ['leftwardPct', 'Left', 'sideways force to the left'], ['rightwardPct', 'Right', 'sideways force to the right']];
/** "70–75%", "under 4%", "0%". */
export function targetText(r) {
  const n = (v) => String(round(v, 1));
  if (r.lo != null && r.hi != null) return r.lo === r.hi ? `${n(r.lo)}%` : `${n(r.lo)}\u2013${n(r.hi)}%`;
  if (r.hi != null) return `under ${n(r.hi)}%`;
  return `over ${n(r.lo)}%`;
}
/**
 * EO names the errors in its Technical Error Index: too much downward, sideways, upward or hand-drag force is an error, and too little forward force
 * is an error. The other side of a range is not: downward force UNDER the range is not a fault, and forward force OVER it is not a fault. So a miss only
 * counts on the side EO treats as an error. `key` is the force-share field (propulsivePct, downwardPct, leftwardPct, ...).
 * @param {number} v @param {{lo: number|null, hi: number|null}} ref @param {string} [key]
 */
export function classifyAgainst(v, ref, key) {
  let status = ref.lo != null && v < ref.lo ? 'BELOW' : ref.hi != null && v > ref.hi ? 'ABOVE' : 'ON_TARGET';
  if (key === 'propulsivePct' && status === 'ABOVE') status = 'ON_TARGET';
  if (key && key !== 'propulsivePct' && status === 'BELOW') status = 'ON_TARGET';
  return { status, gap: round(status === 'BELOW' && ref.lo != null ? ref.lo - v : status === 'ABOVE' && ref.hi != null ? v - ref.hi : 0, 1) };
}
/** One row per force direction that has both a value and an EO target. Empty when the report prints no targets. */
export function targetRows(a) {
  const o = a.forceDistribution.overall, out = [];
  for (const [key, label, plain] of TARGET_KEYS) {
    const ref = a.eoReferenceRanges[key], m = o[key];
    if (!ref || (ref.lo == null && ref.hi == null) || !present(m)) continue;
    const v = m.value;
    // EO's Technical Error Index (Feb 2026): upward force under 3-4% at the hand exit is negligible. The lower bound is used.
    const negligible = key === 'upwardPct' && v < UPWARD_NEGLIGIBLE_PCT;
    const c = classifyAgainst(v, ref, key), status = negligible ? 'ON_TARGET' : c.status, gap = negligible ? 0 : c.gap;
    out.push({ key, label, plain, value: v, target: targetText(ref), lo: ref.lo, hi: ref.hi, status, gap });
  }
  return out;
}
/**
 * EO's headline diagnostic sentence for each point it makes in the force-field section. Hidden from swimmers until the coach
 * approves it (coachReview.eoClaims). The first sentence of each EO paragraph is the point; the rest is elaboration and is not offered.
 */
export function explanationCandidates(a) {
  const seen = new Set(), out = [];
  for (const o of a.eoObservations) {
    if (o.area !== 'FORCE_FIELD' || o.claimType !== 'DIAGNOSTIC_INTERPRETATION') continue;
    const para = o.provenance && o.provenance.extraction && o.provenance.extraction.locator ? o.provenance.extraction.locator.paragraph : undefined;
    if (para === undefined || seen.has(para)) continue;
    seen.add(para);
    const key = /hand drag/i.test(o.text) ? 'handDragPct' : /elbow|downward/i.test(o.text) ? 'downwardPct' : /propulsive/i.test(o.text) ? 'propulsivePct' : /left-right|balanc|leftward|rightward|sideways/i.test(o.text) ? 'lateral' : 'other';
    out.push({ id: o.id, text: o.text, key, strength: /strength|balanc|clean|excellent/i.test(o.text) && !/below|drag|drop|collapse|issue/i.test(o.text) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
export function powerEffectiveness(a) {
  const o = a.forceDistribution.overall;
  if (!present(o.propulsivePct) || !present(o.downwardPct)) return null;
  const fwd = o.propulsivePct.value, down = o.downwardPct.value;
  const hasSide = present(o.leftwardPct) && present(o.rightwardPct);
  const side = hasSide ? o.leftwardPct.value + o.rightwardPct.value : null;
  const hasOther = present(o.upwardPct) && present(o.handDragPct);
  const other = hasOther ? o.upwardPct.value + o.handDragPct.value : null;
  const inputs = [o.propulsivePct, o.downwardPct, ...(hasSide ? [o.leftwardPct, o.rightwardPct] : []), ...(hasOther ? [o.upwardPct, o.handDragPct] : [])];
  const power = a.metrics.avgPowerW;
  const order = down > fwd ? 'DOWN_LARGER' : fwd > down ? 'FORWARD_LARGER' : 'EQUAL';
  const trows = targetRows(a), off = trows.filter((r) => r.status !== 'ON_TARGET').sort((x, y) => y.gap - x.gap);
  const title = off.length ? `Force direction is off EO's target on ${off.length} of ${trows.length} measures`
    : order === 'DOWN_LARGER' ? 'More of your force goes down than forward'
    : order === 'FORWARD_LARGER' ? 'More of your force goes forward than down' : 'Forward and downward force are equal';

  const measurement = [`${f1(fwd)}% of force goes forward`, `${f1(down)}% goes down`];
  for (const r of trows) measurement.push(`${r.label}: ${f1(r.value)}% against EO's target of ${r.target}${r.status === 'ON_TARGET' ? ' (on target)' : ` (${f1(r.gap)} points ${r.status === 'BELOW' ? 'below' : 'above'})`}`);
  if (hasSide) measurement.push(`${f1(side)}% goes sideways (${f1(o.leftwardPct.value)}% left, ${f1(o.rightwardPct.value)}% right)`);
  if (hasOther) measurement.push(`${f1(other)}% is upward force and hand drag`);
  if (present(power)) measurement.push(`Average power ${f1(power.value)} W`);
  const lateral = hasSide && o.leftwardPct.value !== o.rightwardPct.value
    ? (o.leftwardPct.value > o.rightwardPct.value ? 'LEFT' : 'RIGHT') : null;

  const evidence = [pathOf('forceDistribution', 'overall', 'propulsivePct'), pathOf('forceDistribution', 'overall', 'downwardPct')];
  if (hasSide) evidence.push('forceDistribution.overall.leftwardPct', 'forceDistribution.overall.rightwardPct');
  if (hasOther) evidence.push('forceDistribution.overall.upwardPct', 'forceDistribution.overall.handDragPct');
  if (present(power)) evidence.push('metrics.avgPowerW');

  const caveats = [...conflictCaveat(o.propulsivePct, 'the propulsive share')];
  if (lateral) caveats.push(`Sideways force is mostly ${lateral.toLowerCase()}ward. The force field shows direction, not cause: any technical reason needs coach confirmation.`);
  const s = (n) => f0(n);
  /** "Forward share is 62% against a target of 70\u201375%." for the two biggest misses, then what is on target. */
  const gapLine = off.slice(0, 2).map((r) => `Your ${r.plain} is ${s(r.value)}%, against a target of ${r.target}.`).join(' ');
  const okRows = trows.filter((r) => r.status === 'ON_TARGET');
  const text = {
    JUNIOR: off.length ? `You make plenty of push. Some of it goes down instead of back, so the job is to point more of it backwards.${okRows.length ? ' Your sideways push is already where it should be.' : ''}` : order === 'DOWN_LARGER' ? 'A lot of your push goes down and sideways instead of forward. Let’s point more of it forward.' : 'Most of your push is going the right way. Let’s keep it pointing forward.',
    PERFORMANCE: off.length ? gapLine : `About ${s(fwd)}% of your force pushes you forward. About ${s(down)}% pushes down${hasSide ? ` and ${s(side)}% goes sideways` : ''}.`,
    MASTERS_OPEN_WATER: off.length ? gapLine : `Around ${s(fwd)}% of your force is propulsive; ${s(down)}% goes down${hasSide ? ` and ${s(side)}% sideways` : ''}. Pointing more of the same effort forward is the route to sustainable propulsion.`,
    COACH: `Force field (whole swim): forward ${f1(fwd)}%, down ${f1(down)}%${hasSide ? `, sideways ${f1(side)}% (L ${f1(o.leftwardPct.value)} / R ${f1(o.rightwardPct.value)})` : ''}${hasOther ? `, upward + drag ${f1(other)}%` : ''}. ${present(power) ? `Average power ${f1(power.value)} W, so output is being produced; the opportunity is direction.` : ''}`.trim(),
  };
  return finding({
    ruleId: 'POWER_EFFECTIVENESS', kind: order === 'DOWN_LARGER' || off.length ? 'OPPORTUNITY' : 'CONTEXT', title,
    classification: 'MEASURED', confidence: confidenceOf(inputs), evidence, measurement, text, caveats,
    observation: order === 'DOWN_LARGER' ? 'The downward share is larger than the forward share.' : null,
    recommendation: order === 'DOWN_LARGER' ? 'Work on where the force points, before adding more force.' : null,
    relationships: ['POWER + FORCE DISTRIBUTION = POWER EFFECTIVENESS'],
    meta: {
      categories: { forward: fwd, down, side, other, left: hasSide ? o.leftwardPct.value : null, right: hasSide ? o.rightwardPct.value : null },
      lateral,
      targetRows: trows, targetContext: a.eoReferenceContext, explanationCandidates: explanationCandidates(a),
      remeasure: [
        { label: 'Forward share of force', current: `${f1(fwd)}%`, target: (trows.find((r) => r.key === 'propulsivePct') || {}).target },
        { label: 'Downward share of force', current: `${f1(down)}%`, target: (trows.find((r) => r.key === 'downwardPct') || {}).target },
        ...off.filter((r) => r.key === 'handDragPct').map((r) => ({ label: 'Hand drag', current: `${f1(r.value)}%`, target: r.target })),
      ],
    },
  });
}

// ---------------------------------------------------------------------------------------------
export function lapComparison(a) {
  const idx = a.lapComparisons.findIndex((x) => x.kind === 'ENDPOINT_CHANGE');
  if (idx < 0) return null;                                  // MULTI_LAP_TREND is not analysed yet: never mislabel an endpoint as a trend
  const c = a.lapComparisons[idx], swimM = present(a.session.distanceM) ? a.session.distanceM.value : null;
  if (!c.from.laps.length || !c.to.laps.length) return null;
  const sr = changeOf(c.strokeRate), pull = changeOf(c.pullPower), prop = changeOf(c.propulsivePower);
  const sf = c.forceShares.from, st = c.forceShares.to;
  const shareOk = present(sf.propulsivePct) && present(st.propulsivePct);
  const downOk = present(sf.downwardPct) && present(st.downwardPct);
  const quantified = [sr, pull, prop].filter(Boolean).length + (shareOk ? 1 : 0);
  if (quantified < 2) return null;

  const fromName = lapLabel(c.from, swimM), toName = lapLabel(c.to, swimM), fromLap = lapName(c.from), toLap = lapName(c.to);
  const base = `lapComparisons.${idx}`;
  const rows = [], inputs = [], evidence = [];
  if (sr) {
    rows.push({ id: 'strokeRate', label: 'Stroke rhythm', kind: 'pct', unit: 'str/min', from: present(c.strokeRate.from) ? c.strokeRate.from.value : null, to: present(c.strokeRate.to) ? c.strokeRate.to.value : null, lo: sr.lo, hi: sr.hi, via: sr.via, approximate: sr.approximate });
    inputs.push(...[c.strokeRate.from, c.strokeRate.to, c.strokeRate.change].filter(present)); evidence.push(`${base}.strokeRate`);
  }
  if (pull) { rows.push({ id: 'pullPower', label: 'Pull power', kind: 'pct', lo: pull.lo, hi: pull.hi, via: pull.via, approximate: pull.approximate }); inputs.push(c.pullPower.change); evidence.push(`${base}.pullPower`); }
  if (prop) { rows.push({ id: 'propulsivePower', label: 'Propulsive power', kind: 'pct', lo: prop.lo, hi: prop.hi, via: prop.via, approximate: prop.approximate }); inputs.push(c.propulsivePower.change); evidence.push(`${base}.propulsivePower`); }
  /** @type {number|null} */ let shareDelta = null;
  /** @type {number|null} */ let remainderFrom = null;
  /** @type {number|null} */ let remainderTo = null;
  if (shareOk) {
    const e = sf.propulsivePct.value, l = st.propulsivePct.value;
    shareDelta = pointChange(e, l);
    rows.push({ id: 'forwardShare', label: 'Forward share of force', kind: 'points', unit: '%', from: e, to: l, lo: shareDelta, hi: shareDelta, via: 'DERIVED', approximate: !!(st.propulsivePct.approximate || sf.propulsivePct.approximate) });
    inputs.push(sf.propulsivePct, st.propulsivePct); evidence.push(`${base}.forceShares.from.propulsivePct`, `${base}.forceShares.to.propulsivePct`);
    if (downOk) {
      const de = sf.downwardPct.value, dl = st.downwardPct.value;
      rows.push({ id: 'downwardShare', label: 'Downward share of force', kind: 'points', unit: '%', from: de, to: dl, lo: dl - de, hi: dl - de, via: 'DERIVED', approximate: !!(st.downwardPct.approximate || sf.downwardPct.approximate) });
      inputs.push(sf.downwardPct, st.downwardPct); evidence.push(`${base}.forceShares.from.downwardPct`, `${base}.forceShares.to.downwardPct`);
      remainderFrom = 100 - e - de; remainderTo = 100 - l - dl;
    }
  }

  // --- title from the SOURCE's own numbers; ranges compared conservatively ---
  let title = `Rhythm and power change between ${fromLap} and ${toLap}`, headlineKey = 'GENERIC';
  /** @type {'A'|'B'|'UNCLEAR'|null} */ let compare = null;
  const declining = (x) => x && x.hi < 0;
  if (prop && sr) compare = largerMagnitude(prop, sr); else if (pull && sr) compare = largerMagnitude(pull, sr);
  const lead = prop ? 'Propulsive' : 'Pull';
  if (compare === 'A' && declining(prop || pull)) { title = `${lead} power falls more than stroke rhythm, ${fromLap} to ${toLap}`; headlineKey = 'POWER_FALLS_MORE'; }
  else if (compare === 'B' && declining(sr)) { title = `Stroke rhythm falls more than ${lead.toLowerCase()} power, ${fromLap} to ${toLap}`; headlineKey = 'RHYTHM_FALLS_MORE'; }

  // --- corroboration by direction (NOT an equation) ---
  const signals = [];
  if (pull) signals.push({ id: 'pullPower', label: 'pull power', direction: directionOf(pull) });
  if (shareOk) signals.push({ id: 'forwardShare', label: 'forward share of force', direction: /** @type {number} */ (shareDelta) < 0 ? 'DOWN' : /** @type {number} */ (shareDelta) > 0 ? 'UP' : 'UNCLEAR' });
  if (prop) signals.push({ id: 'propulsivePower', label: 'propulsive power', direction: directionOf(prop) });
  const co = corroborate(signals);
  const word = (d) => (d === 'DOWN' ? 'fell' : d === 'UP' ? 'rose' : 'was unclear');
  const detail = co.status === 'NOT_TESTABLE' ? 'No independent signals available.'
    : `Between ${fromLap} and ${toLap}: ${signals.map((x) => `${x.label} ${word(x.direction)}`).join('; ')}. ${co.status === 'CORROBORATED' ? 'Independent measures point the same way' : co.status === 'CONFLICTING' ? 'The measures do NOT point the same way' : 'Only partial corroboration'}. No formula links these measures, so this is corroboration, not a calculation.`;
  const corroboration = { status: co.status, signals, detail };

  let confidence = confidenceOf(inputs);
  const caveats = lapRefCaveat(c);
  caveats.push(`Endpoint comparison: it compares ${fromLap} with ${toLap} only. It does not show what happened in between and is not a trend.`);
  let coachConfirmation = { required: false };
  if (co.status === 'CONFLICTING') { confidence = 'LOW'; coachConfirmation = { required: true, reason: 'Independent measures point in different directions.', evidenceNeeded: ['Check the lap definitions and which figures belong to which laps'] }; }

  const measurement = rows.map((r) => {
    if (r.kind === 'pct') {
      const chg = `${span(r.lo, r.hi, r.lo === r.hi ? 1 : 0)}%`;
      return r.from != null && r.to != null ? `${r.label}: ${r.from} → ${r.to} ${r.unit} (${chg}${r.via === 'DERIVED' ? ', derived' : ''}${r.approximate ? ', approximate' : ''})` : `${r.label}: ${chg} (${r.via === 'REPORTED' ? 'as reported' : 'derived'}${r.approximate ? ', approximate' : ''})`;
    }
    return `${r.label}: ${f1(r.from)}% → ${f1(r.to)}% (${signed(r.lo)} points, derived)`;
  });
  if (remainderFrom !== null && remainderTo !== null) measurement.unshift(`Comparison: ${fromLap} (${fromName.toLowerCase()}) to ${toLap} (${toName.toLowerCase()})`), measurement.push(`Everything else (sideways, upward, drag): ${f1(remainderFrom)}% → ${f1(remainderTo)}% (derived as the remainder; the split at ${toLap} is not itemised)`);
  else measurement.unshift(`Comparison: ${fromLap} to ${toLap}`);

  const mag = (x) => { const m = [Math.abs(x.lo), Math.abs(x.hi)].sort((p, q) => p - q); return span(m[0], m[1], 0); };
  const srTxt = sr ? `${f0(Math.abs((sr.lo + sr.hi) / 2))}%` : null;
  const lo = (t) => t.toLowerCase();
  const lines = headlineKey === 'POWER_FALLS_MORE' ? {
    JUNIOR: `By your ${lo(toName)}, your arms keep turning over, but less of your push goes forward.`,
    PERFORMANCE: `Between your ${lo(fromName)} and your ${lo(toName)}, your stroke rhythm changed by about ${srTxt}, while your ${lo(lead)} power fell by roughly ${mag(prop || pull)}%.`,
    MASTERS_OPEN_WATER: `${lead} power fell about ${mag(prop || pull)}% between your ${lo(fromName)} and ${lo(toName)}, while stroke rhythm changed about ${srTxt}. The forward drive dropped more than the rhythm.`,
  } : {
    JUNIOR: 'Your swim looks a little different at the end from the start.',
    PERFORMANCE: `Your rhythm and power both changed between your ${lo(fromName)} and your ${lo(toName)}.`,
    MASTERS_OPEN_WATER: `Rhythm and power both changed between your ${lo(fromName)} and ${lo(toName)}.`,
  };
  const coachText = `${title}. ${measurement.join('; ')}. ${corroboration.detail} ${caveats.join(' ')}`.trim();
  const anyDecline = signals.some((x) => x.direction === 'DOWN') || declining(sr);

  return finding({
    ruleId: 'LAP_COMPARISON', kind: anyDecline ? 'OPPORTUNITY' : 'CONTEXT', title,
    classification: 'MEASURED', confidence, evidence, measurement, caveats, corroboration, coachConfirmation,
    observation: compare === 'A' ? `The fall in ${lo(lead)} power is larger than the change in stroke rhythm, even at the smallest end of the reported range.` : null,
    recommendation: anyDecline ? 'Train the catch to keep its direction through the whole swim.' : null,
    text: { ...lines, COACH: coachText },
    relationships: [`LAP-TO-LAP SIGNALS (rhythm, pull power, force share, propulsive power) = ENDPOINT CHANGE, ${fromLap.toUpperCase()} TO ${toLap.toUpperCase()} (not a trend)`],
    meta: {
      comparisonKind: c.kind, comparisonIndex: idx, fromLabel: fromName, toLabel: toName, fromLap, toLap, headlineKey, rows,
      remainder: remainderFrom !== null ? { from: remainderFrom, to: remainderTo, derived: true } : null,
      remeasure: [...(prop ? [{ label: `Propulsive power, ${fromLap} to ${toLap}`, current: `${mag(prop)}% lower` }] : []), ...(shareOk ? [{ label: `Forward share, ${fromLap} to ${toLap}`, current: `${f1(sf.propulsivePct.value)}% → ${f1(st.propulsivePct.value)}%` }] : [])],
    },
  });
}

// ---------------------------------------------------------------------------------------------
export function asymmetryProfile(a) {
  const lr = a.leftRight, pp = a.powerProfile, ph = a.strokePhases;
  /** @type {{points: string[], coachOnly: string[]}} */ const L = { points: [], coachOnly: [] };
  /** @type {{points: string[], coachOnly: string[]}} */ const R = { points: [], coachOnly: [] };
  /** @type {any[]} */ const inputs = [];
  /** @type {string[]} */ const evidence = [];
  /** @type {string[]} */ const measurement = [];
  let swimmerDims = 0;

  // dimension 1: output
  /** @type {ReturnType<typeof asymmetry>} */ let outputGap = null;
  if (present(lr.avgImpulseW.left) && present(lr.avgImpulseW.right)) {
    const l = lr.avgImpulseW.left.value, r = lr.avgImpulseW.right.value;
    outputGap = asymmetry(l, r);
    if (outputGap && outputGap.higher !== 'EQUAL') {
      const hi = outputGap.higher === 'RIGHT' ? R : L, lo = outputGap.higher === 'RIGHT' ? L : R;
      hi.points.push(`Higher output over the whole swim (${f0(Math.max(l, r))} W)`); lo.points.push(`Lower output over the whole swim (${f0(Math.min(l, r))} W)`);
      measurement.push(`Average impulse (EO label, W): left ${f0(l)} W, right ${f0(r)} W (${outputGap.higher.toLowerCase()} is ${f0(outputGap.differencePctOfLower)}% higher than the other; symmetry index ${signed(outputGap.symmetryIndexPct, 0)}%)`);
    }
    swimmerDims++; inputs.push(lr.avgImpulseW.left, lr.avgImpulseW.right); evidence.push('leftRight.avgImpulseW');
  } else if (present(lr.relativeOutput.left) && present(lr.relativeOutput.right)) {
    const lv = lr.relativeOutput.left.value, rv = lr.relativeOutput.right.value;
    if (lv !== rv) { (rv === 'HIGHER' ? R : L).points.push('Higher output'); (rv === 'HIGHER' ? L : R).points.push('Lower output'); swimmerDims++; evidence.push('leftRight.relativeOutput'); }
  }

  // dimension 1b: which arm leads each lap. Coach-entered per-lap figures win over EO's wording when both are present.
  const lapLeads = (lr.byLap || []).map((b) => {
    const figs = present(b.leftW) && present(b.rightW);
    const higher = figs ? (b.leftW.value > b.rightW.value ? 'LEFT' : b.rightW.value > b.leftW.value ? 'RIGHT' : 'EQUAL') : present(b.higher) ? b.higher.value : null;
    return { lap: b.lap, higher, leftW: figs ? b.leftW.value : null, rightW: figs ? b.rightW.value : null };
  }).filter((x) => x.higher === 'LEFT' || x.higher === 'RIGHT');
  const lapSwap = lapLeads.length >= 2 && new Set(lapLeads.map((x) => x.higher)).size > 1;
  if (lapLeads.length) {
    for (const x of lapLeads) (x.higher === 'RIGHT' ? R : L).points.push(`Stronger in lap ${x.lap}${x.leftW != null ? ` (${f0(x.higher === 'RIGHT' ? x.rightW : x.leftW)} W)` : ''}`);
    measurement.push(`Stronger arm by lap: ${lapLeads.map((x) => `lap ${x.lap} ${x.higher.toLowerCase()}`).join(', ')}${lapSwap ? ' (the stronger arm changes between laps)' : ''}`);
    swimmerDims++; evidence.push('leftRight.byLap'); inputs.push(...(lr.byLap || []).map((b) => b.higher).filter(present));
  }

  // dimension 2: power shape
  const dp = { left: pp.left.doublePeakPctByLap.filter(present), right: pp.right.doublePeakPctByLap.filter(present) };
  const lapsWith = (arr) => arr.filter((m) => m.value > 0).length;
  const maxPct = (arr) => arr.reduce((m, x) => Math.max(m, x.value), 0);
  /** @type {string[]} */ let multiArms = [];
  for (const [arm, side, key] of /** @type {[string, typeof L, 'left'|'right'][]} */ ([['LEFT', L, 'left'], ['RIGHT', R, 'right']])) {
    const sh = pp[key].shape;
    if (!present(sh)) continue;
    evidence.push(`powerProfile.${key}.shape`);
    if (sh.value === 'MULTI_PEAK') {
      multiArms.push(arm);
      const series = dp[key];
      side.points.push(series.length ? `Less smooth force delivery on some strokes (double peaks in ${lapsWith(series)} of ${series.length} laps, up to ${f0(maxPct(series))}% of strokes)` : 'Less smooth force delivery (multiple peaks)');
      if (series.length) measurement.push(`${arm === 'LEFT' ? 'Left' : 'Right'} double peaks by lap: ${series.map((m) => f1(m.value)).join(', ')} (%)`);
    } else if (sh.value === 'SINGLE_PEAK') {
      const series = dp[key];
      side.points.push(series.length && series.every((m) => m.value === 0) ? `Simpler force-delivery pattern (no double peaks in any of ${series.length} laps)` : 'Simpler force-delivery pattern');
      if (series.length) measurement.push(`${arm === 'LEFT' ? 'Left' : 'Right'} double peaks by lap: ${series.map((m) => f1(m.value)).join(', ')} (%)`);
    }
    inputs.push(sh, ...dp[key]);
  }
  if (present(pp.left.shape) || present(pp.right.shape)) swimmerDims++;

  // dimension 3: stroke-phase timing from LAP AVERAGES ONLY. Individual strokes are never read here.
  /** @type {string[]} */ const L_t = [];
  /** @type {string[]} */ const R_t = [];
  const phaseEnds = (key) => {
    const laps = ph[key].lapAverages.filter((x) => present(x.phases.glidePct) && present(x.phases.pullPct) && present(x.phases.recoveryPct)).sort((p, q) => p.lap - q.lap);
    return laps.length >= 2 ? { first: laps[0], last: laps[laps.length - 1] } : null;
  };
  const pe = { left: phaseEnds('left'), right: phaseEnds('right') };
  for (const [side, tl, key] of /** @type {[typeof L, string[], 'left'|'right'][]} */ ([[L, L_t, 'left'], [R, R_t, 'right']])) {
    const e = pe[key]; if (!e) continue;
    const g = (x, k) => x.phases[k].value;
    tl.push(`Lap ${e.first.lap} → lap ${e.last.lap}: glide ${g(e.first, 'glidePct')}% → ${g(e.last, 'glidePct')}%, pull ${g(e.first, 'pullPct')}% → ${g(e.last, 'pullPct')}%, recovery ${g(e.first, 'recoveryPct')}% → ${g(e.last, 'recoveryPct')}% of the stroke (lap averages)`);
    measurement.push(`${key === 'left' ? 'Left' : 'Right'} ${tl[0]}`);
    inputs.push(...[e.first, e.last].flatMap((x) => [x.phases.glidePct, x.phases.pullPct, x.phases.recoveryPct]));
    evidence.push(`strokePhases.${key}.lapAverages`);
    if (ph[key].individualStrokes.length) side.coachOnly.push(`${ph[key].individualStrokes.length} individual-stroke phase reading(s) are present. They are diagnostic only and never replace the lap averages.`);
  }
  if (pe.left && pe.right) swimmerDims++;
  for (const [key, side] of /** @type {['left'|'right', typeof L][]} */ ([['left', L], ['right', R]])) if (!pe[key] && ph[key].individualStrokes.length) side.coachOnly.push('Only individual-stroke phase readings are available. They are not lap averages, so no swimmer-facing timing conclusion is drawn.');
  // dimension 4: path
  if (present(a.consistency.left) || present(a.consistency.right)) { swimmerDims++; evidence.push('consistency'); }

  if (!L.points.length && !R.points.length && !L_t.length && !R_t.length && !lapLeads.length) return null;
  const persists = present(lr.persistence) && lr.persistence.value === 'ALL_LAPS';
  if (persists) measurement.push('The power gap was present across all laps (per EO).');

  const confidence = swimmerDims >= 2 ? confidenceOf(inputs) : minConfidence([confidenceOf(inputs), 'LOW']);
  const multi = multiArms.length ? multiArms[0].toLowerCase() : null;
  const other = multi === 'right' ? 'left' : 'right';
  const leadWords = lapLeads.map((x) => `${x.higher.toLowerCase()} arm in lap ${x.lap}`).join(', ');
  // one arm leads in every lap: say so plainly, with the reasons EO's Technical Error Index lists (breathing, strength, timing)
  const persistent = lapLeads.length >= 2 && !lapSwap && outputGap && outputGap.higher !== 'EQUAL';
  const pSide = persistent ? lapLeads[0].higher.toLowerCase() : null, pGapW = persistent && present(lr.avgImpulseW.left) && present(lr.avgImpulseW.right) ? Math.abs(lr.avgImpulseW.left.value - lr.avgImpulseW.right.value) : null;
  const opportunity = persistent
    ? `Your ${pSide} arm does more of the work in every lap${pGapW != null ? `, by about ${f0(pGapW)} W over the swim` : ''}. The opportunity is to find out why: it can come from which side you breathe to, from strength, or from timing. A difference between arms is not automatically a fault.`
    : lapSwap
    ? `Your stronger arm changes between laps: ${leadWords}. The opportunity is a steady stroke, where neither arm takes over from the other as the swim goes on.${multi ? ` The ${multi} arm’s force delivery is also less smooth than the ${other}.` : ''}`
    : multi
    ? `The ${multi} arm’s force delivery is less smooth than the ${other}. The opportunity is to bring that smoothness across to the ${multi}, and to understand the output gap between the arms. A difference between arms is not automatically a fault.`
    : 'The two arms differ. The opportunity is to understand why, and to see whether the gap matters for you. A difference between arms is not automatically a fault.';
  const text = persistent ? {
    JUNIOR: `Your ${pSide} arm does more of the work than your other arm. Let’s get both arms pushing the same.`,
    PERFORMANCE: `Your ${pSide} arm does more of the work in every lap${pGapW != null ? `, by about ${f0(pGapW)} W` : ''}.`,
    MASTERS_OPEN_WATER: `Your ${pSide} arm does more of the work in every lap${pGapW != null ? `, by about ${f0(pGapW)} W` : ''}. Over a long swim, an even stroke keeps the work shared.`,
    COACH: `Asymmetry profile. LEFT: ${[...L.points, ...L_t, ...L.coachOnly].join('; ') || 'no evidence'}. RIGHT: ${[...R.points, ...R_t, ...R.coachOnly].join('; ') || 'no evidence'}. ${opportunity}`,
  } : lapSwap ? {
    JUNIOR: 'One arm pushes harder in the first lap, and the other takes over in the second. Let’s make both arms push the same, every lap.',
    PERFORMANCE: `Your stronger arm changes between laps: ${leadWords}.`,
    MASTERS_OPEN_WATER: `Your stronger arm changes between laps (${leadWords}). Over a long swim, a steady stroke keeps the work even.`,
    COACH: `Asymmetry profile. LEFT: ${[...L.points, ...L_t, ...L.coachOnly].join('; ') || 'no evidence'}. RIGHT: ${[...R.points, ...R_t, ...R.coachOnly].join('; ') || 'no evidence'}. Stronger arm by lap: ${leadWords}. ${opportunity}`,
  } : {
    JUNIOR: multi ? `Your ${other} arm pushes more smoothly. Let’s help your ${multi} arm push as smoothly.` : 'Your two arms don’t push exactly the same. That’s normal. We’ll look at it together.',
    PERFORMANCE: multi ? `Your ${multi} arm delivers its force less smoothly than your ${other}${outputGap ? `, and the two arms produce different output (${f0(lr.avgImpulseW.left.value)} W left, ${f0(lr.avgImpulseW.right.value)} W right)` : ''}.` : 'Your arms show different power patterns.',
    MASTERS_OPEN_WATER: multi ? `The ${multi}-side force pattern is less smooth than the ${other}${outputGap ? `, with a ${f0(outputGap.differencePctOfLower)}% output gap between the arms` : ''}. Over a long swim, the ${multi}-side pattern is the one to watch.` : 'The two arms show different power patterns.',
    COACH: `Asymmetry profile. LEFT: ${[...L.points, ...L_t, ...L.coachOnly].join('; ') || 'no evidence'}. RIGHT: ${[...R.points, ...R_t, ...R.coachOnly].join('; ') || 'no evidence'}. ${persists ? 'Gap present across all laps (EO). ' : ''}Swimmer-usable dimensions: ${swimmerDims}. ${opportunity}`,
  };
  const classification = (outputGap || dp.left.length || dp.right.length) ? 'MEASURED' : 'OBSERVED';
  return finding({
    ruleId: 'ASYMMETRY_PROFILE', kind: 'OPPORTUNITY', title: persistent ? `Your ${pSide} arm does more of the work` : lapSwap ? 'The stronger arm changes between laps' : multi ? `The ${multi}-side force pattern is less smooth` : 'Your arms show different power patterns',
    classification, confidence, evidence, measurement, text,
    observation: multi ? `${multiArms.join(' and ')} shows multiple force peaks; the other side shows a simpler pattern.` : null,
    recommendation: 'Compare how each arm delivers force through the pull, with a coach watching.',
    caveats: [...(swimmerDims < 2 ? ['Only one dimension of left/right evidence is available.'] : []), ...(outputGap && lr.avgImpulseW.left.status !== 'COMPLETE' ? ['The lap behind the left/right output figures is not labelled in the source.'] : [])],
    relationships: ['LEFT/RIGHT POWER + POWER SHAPE (+ TIMING, PATH) = ASYMMETRY PROFILE'],
    meta: { lapSwap, persistent, lapLeads, arms: { left: L, right: R }, timing: { left: L_t, right: R_t }, phases: { left: pe.left && [pe.left.first, pe.left.last].map((x) => ({ lap: x.lap, glide: x.phases.glidePct.value, pull: x.phases.pullPct.value, recovery: x.phases.recoveryPct.value })), right: pe.right && [pe.right.first, pe.right.last].map((x) => ({ lap: x.lap, glide: x.phases.glidePct.value, pull: x.phases.pullPct.value, recovery: x.phases.recoveryPct.value })) }, opportunity, multiArm: multi, outputGap, doublePeaks: { left: dp.left.map((m) => m.value), right: dp.right.map((m) => m.value) },
      remeasure: [...(lapLeads.length >= 2 ? [{ label: 'Which arm leads, lap by lap', current: new Set(lapLeads.map((x) => x.higher)).size === 1 ? `${lapLeads[0].higher.toLowerCase()}, every lap` : lapLeads.map((x) => `${x.higher.toLowerCase()} (lap ${x.lap})`).join(', ') }] : []), ...(outputGap ? [{ label: 'Left vs right output', current: `${f0(lr.avgImpulseW.left.value)} W vs ${f0(lr.avgImpulseW.right.value)} W` }] : []), ...(multi && dp[multi].length ? [{ label: `${multi === 'left' ? 'Left' : 'Right'}-arm double peaks`, current: `${lapsWith(dp[multi])} of ${dp[multi].length} laps` }] : [])] },
  });
}

// ---------------------------------------------------------------------------------------------
export function technicalOpportunity(a) {
  const pp = a.powerProfile;
  const multiArms = ['left', 'right'].filter((k) => present(pp[k].shape) && pp[k].shape.value === 'MULTI_PEAK');
  if (!multiArms.length) return null;
  const arm = multiArms[0];
  const bridge = a.handPathAndPower.status === 'COMPLETE';
  const pathKnown = present(a.handPath[arm]);
  const needed = [];
  if (!bridge) needed.push('Hand path & power view: where in the underwater stroke the second peak occurs');
  if (!pathKnown) needed.push(`Hand path (side-on and overhead) for the ${arm} arm`);
  if (!present(a.handPath[arm === 'left' ? 'right' : 'left'])) needed.push('Hand path for the other arm, to compare');
  const eoClaims = a.eoObservations.filter((o) => o.claimType === 'DIAGNOSTIC_INTERPRETATION' && (o.area === 'POWER_VS_TIME' || /elbow|catch/i.test(o.text))).map((o) => o.text);
  const classification = bridge && pathKnown ? 'INFERRED' : 'COACH_CONFIRMATION_REQUIRED';
  const confidence = bridge && pathKnown ? 'MODERATE' : 'LOW';
  const side = arm[0].toUpperCase() + arm.slice(1);
  const safe = `The ${arm}-side force pattern is less smooth.`;
  return finding({
    ruleId: 'POSSIBLE_TECHNICAL_OPPORTUNITY', kind: 'OPPORTUNITY', title: `Possible technical opportunity on the ${arm} side`,
    classification, confidence,
    evidence: [`powerProfile.${arm}.shape`, `powerProfile.${arm}.doublePeakPctByLap`, 'handPathAndPower', `handPath.${arm}`],
    measurement: [`${side} arm shows an observed multiple-peak force pattern (EO double-peak detection).`],
    observation: `${side}-arm force delivery shows more than one peak on some strokes.`,
    interpretation: { text: 'This pattern may be consistent with a catch-mechanics issue. Coach confirmation recommended.', classification: 'INFERRED' },
    recommendation: 'Review the hand-path-and-power view for the second peak before assigning any technique change.',
    caveats: ['A multiple-peak pattern is an observed force-production pattern. It does not by itself identify a dropped elbow, a loss of catch, or any other fault.'],
    coachConfirmation: { required: true, reason: 'Technical interpretation is not supported by hand-path evidence.', evidenceNeeded: needed },
    relationships: ['POWER SHAPE + HAND PATH + HAND PATH & POWER = POSSIBLE TECHNICAL OPPORTUNITY'],
    text: { JUNIOR: safe, PERFORMANCE: safe, MASTERS_OPEN_WATER: safe,
      COACH: `${side}-arm multiple-peak pattern. This may be consistent with a catch-mechanics issue; coach confirmation recommended. Evidence still needed: ${needed.join('; ') || 'none'}. ${eoClaims.length ? 'EO states (EO inference, not adopted): "' + eoClaims.join('" / "') + '"' : ''}`.trim() },
    meta: { arm, eoClaims },
  });
}

// ---------------------------------------------------------------------------------------------
export function outputSummary(a) {
  const m = a.metrics, s = a.session;
  const items = [];
  if (present(s.timeS)) items.push(`Time ${mmss(s.timeS.value)}`);
  if (present(s.distanceM)) items.push(`Distance ${f0(s.distanceM.value)} m`);
  if (present(m.strokeRate)) items.push(`Stroke rate ${f2(m.strokeRate.value)} str/min`);
  if (present(m.distancePerStrokeM)) items.push(`Distance per stroke ${f2(m.distancePerStrokeM.value)} m`);
  if (present(m.avgPowerW)) items.push(`Average power ${f2(m.avgPowerW.value)} W`);
  if (present(m.avgForceN)) items.push(`Average force ${f2(m.avgForceN.value)} N`);
  if (present(m.workKj)) items.push(`Work ${f1(m.workKj.value)} kJ`);
  if (!items.length) return null;
  const used = [m.strokeRate, m.distancePerStrokeM, m.avgPowerW, m.avgForceN, m.workKj, s.timeS, s.distanceM].filter(present);
  return finding({
    ruleId: 'OUTPUT_SUMMARY', kind: 'CONTEXT', title: 'Output summary', classification: 'MEASURED', confidence: confidenceOf(used),
    evidence: ['metrics', 'session.timeS', 'session.distanceM'], measurement: items,
    text: { JUNIOR: '', PERFORMANCE: '', MASTERS_OPEN_WATER: '', COACH: items.join('; ') + '.' },
    meta: {},
  });
}


// ---------------------------------------------------------------------------------------------
// HAND PATH. Every input is a CHART_READ entered or confirmed by a coach (see model.js emptyHandPathReading). The mappings below are
// EO's own, from the Technical Error Index (Feb 2026), paraphrased. No threshold is invented: a rule fires on what the coach
// recorded, and magnitudes in cm are reported as facts, never graded.
const hpOf = (a) => a.handPathReading || null;
const ARMS = [['left', 'left'], ['right', 'right']];
const armsWith = (h, field, value) => ARMS.filter(([k]) => present(h[k][field]) && h[k][field].value === value).map(([, n]) => n);
const cmText = (m) => (m.range ? `${f0(m.range[0])} to ${f0(m.range[1])} cm` : `${f0(m.value)} cm`);

/** Hands cross the centreline in the head-on view. EO ties this to sideways force, so a lateral miss strengthens it. */
export function handPathCrossover(a) {
  const h = hpOf(a); if (!h || !present(h.crossesMidline) || h.crossesMidline.value !== 'YES') return null;
  const lat = targetRows(a).filter((r) => (r.key === 'leftwardPct' || r.key === 'rightwardPct') && r.status !== 'ON_TARGET');
  const linked = lat.length > 0;
  const forces = lat.map((r) => `${r.key === 'leftwardPct' ? 'left' : 'right'} ${f1(r.value)}%`).join(' and ');
  const base = 'Your hands cross the middle of your body as you pull.';
  const text = {
    JUNIOR: 'Your hands drift across the middle of your body as you pull. Let’s keep each hand on its own side.',
    PERFORMANCE: linked ? `${base} Your sideways force is above EO’s target (${forces}, target under ${f0(Math.max(...lat.map((r) => r.hi)))}%).` : base,
    MASTERS_OPEN_WATER: linked ? `${base} It shows up as sideways force: ${forces}, against a target of under ${f0(Math.max(...lat.map((r) => r.hi)))}%.` : base,
    COACH: `Hands cross the midline in the head-on view (chart read, coach-confirmed). ${linked ? `Lateral force above EO target: ${forces}. EO links a sweeping or crossing hand path with hand angled out or in to excess lateral force.` : 'Lateral force is within target, so the crossing is not (yet) costing force.'}`,
  };
  return finding({
    ruleId: 'HAND_PATH_CROSSOVER', kind: 'OPPORTUNITY', title: 'Your hands cross the middle of your body',
    classification: 'OBSERVED', confidence: linked ? 'MODERATE' : 'LOW',
    evidence: ['handPathReading.crossesMidline', ...(linked ? lat.map((r) => `forceDistribution.overall.${r.key}`) : [])],
    measurement: ['Hands cross the centreline in the head-on view (read from the chart, confirmed by the coach).', ...lat.map((r) => `${r.label}: ${f1(r.value)}% against EO's target of ${r.target}`)],
    observation: 'The head-on view shows the hands converging across the centreline.', recommendation: 'Pull straight back under the shoulder on your own side.',
    text, caveats: ['Read from a chart with no printed values: confirmed by the coach, never filled automatically.', ...(linked ? [] : ['Sideways force is within target, so the link to lost force is not shown.'])],
    relationships: ['HAND PATH (head-on) + LATERAL FORCE = CROSSOVER'],
    meta: { lateral: lat.map((r) => r.key), remeasure: [{ label: 'Hands crossing the middle', current: 'Yes' }, ...lat.map((r) => ({ label: `${r.label} force`, current: `${f1(r.value)}%`, target: r.target }))] },
  });
}

/** Maximum downward force coincides with maximum propulsion: the hand is still angled down through the pull. */
export function handPathWrist(a) {
  const h = hpOf(a); if (!h) return null;
  const arms = armsWith(h, 'wristPitch', 'BROKEN'); if (!arms.length) return null;
  const who = arms.length === 2 ? 'both hands' : `your ${arms[0]} hand`;
  const text = {
    JUNIOR: 'Your fingers stay pointing down for too long. Let’s show the whole palm to the back of the pool.',
    PERFORMANCE: `${who[0].toUpperCase() + who.slice(1)} stays angled down through the pull, so less of the hand faces backwards.`,
    MASTERS_OPEN_WATER: `${who[0].toUpperCase() + who.slice(1)} stays angled down through the pull. That cuts the surface that pushes you forward, which matters most over distance.`,
    COACH: `Wrist pitch: ${arms.join(' and ')} hand stays angled down beyond the catch (hand-path-and-power chart read, coach-confirmed). EO sequencing: downward force should peak earlier and propulsion peak once the hand is vertical.`,
  };
  return finding({
    ruleId: 'HAND_PATH_WRIST', kind: 'OPPORTUNITY', title: `The ${arms.join(' and ')} hand stays angled down`,
    classification: 'OBSERVED', confidence: 'MODERATE', evidence: arms.map((k) => `handPathReading.${k}.wristPitch`),
    measurement: [`${arms.join(' and ')} hand: maximum downward force coincides with maximum propulsion (chart read, confirmed by the coach).`],
    observation: 'The hand is still angled down at the point of maximum propulsion.', recommendation: 'Fingers pointing down, full palm to the back of the pool.',
    text, caveats: ['Read from a chart with no printed values: confirmed by the coach, never filled automatically.'],
    relationships: ['HAND PATH & POWER = WRIST PITCH'], meta: { arms, remeasure: [{ label: 'Hand angle at the catch', current: 'Angled down' }] },
  });
}

/**
 * Hand-position consistency. Both hands wide: stroke-to-stroke repeatability, a swimmer-facing opportunity.
 * ONE hand wide and the other not: EO says this is not simple technique and may be an early sign of a shoulder problem, so it is held for the
 * coach (never swimmer-facing until confirmed) and a separate coach-only watch finding is raised.
 */
export function handPathConsistency(a) {
  const h = hpOf(a); if (!h) return null;
  const wide = armsWith(h, 'spread', 'WIDE'); if (!wide.length) return null;
  const oneSided = wide.length === 1;
  const text = oneSided ? {
    JUNIOR: 'One hand follows a less repeatable path than the other. We will look at it together.', PERFORMANCE: `Your ${wide[0]} hand follows a less repeatable path than the other.`, MASTERS_OPEN_WATER: `Your ${wide[0]} hand follows a less repeatable path than the other.`,
    COACH: `Hand-position consistency: the ${wide[0]} hand is wide (chart read, coach-confirmed) while the other is not. EO: one-sided, increasing deterioration that does not track pace may be an early sign of shoulder dysfunction rather than skill. Confirm it is not pacing, reduce load, assess the shoulder, and monitor across sessions.`,
  } : {
    JUNIOR: 'Your hands do not follow the same path every stroke. Slow down and make every stroke look the same.', PERFORMANCE: 'Your hand path changes from stroke to stroke, so each pull starts from a slightly different place.', MASTERS_OPEN_WATER: 'Your hand path changes from stroke to stroke. A repeatable path holds up better over distance.',
    COACH: 'Hand-position consistency: both hands show wide dispersion across strokes (consistency chart read, coach-confirmed). EO: reduce stroke rate temporarily to rebuild repeatability, use a snorkel to rule out breathing, then build tempo back.',
  };
  return finding({
    ruleId: 'HAND_PATH_CONSISTENCY', kind: 'OPPORTUNITY', title: oneSided ? `The ${wide[0]} hand path is less repeatable` : 'Your hand path changes from stroke to stroke',
    classification: oneSided ? 'COACH_CONFIRMATION_REQUIRED' : 'OBSERVED', confidence: 'MODERATE', evidence: ARMS.map(([k]) => `handPathReading.${k}.spread`),
    measurement: ARMS.filter(([k]) => present(h[k].spread)).map(([k]) => `${k[0].toUpperCase() + k.slice(1)} hand path spread: ${h[k].spread.value.toLowerCase()}`),
    observation: 'The overlaid strokes in the consistency chart spread widely.', recommendation: 'Slow the stroke down and make each stroke follow the same path.',
    coachConfirmation: oneSided ? { required: true, reason: 'One hand only: may not be technique (EO).', evidenceNeeded: ['Confirm it is not pacing-related', 'Compare with the previous session', 'Consider a shoulder check if it is increasing'] } : { required: false },
    text, caveats: ['Read from a chart with no printed values: confirmed by the coach, never filled automatically.'],
    relationships: ['CONSISTENCY CHART = HAND-POSITION REPEATABILITY'], meta: { wide, oneSided, remeasure: [{ label: 'Hand path consistency', current: wide.map((k) => `${k} wide`).join(', ') }] },
  });
}

/** Per-hand force field and lap-by-lap change, from the EO data export. Context for the coach; the swimmer sees it as "Each hand". */
export function handForceField(a) {
  const ex = a.eoExport; if (!ex || !ex.forceField || !ex.forceField.left || !ex.forceField.right) return null;
  const L = ex.forceField.left, R = ex.forceField.right; if (!L.mean || !R.mean || L.mean.propulsive == null || R.mean.propulsive == null) return null;
  const inward = (k, m) => (k === 'left' ? m.rightward : m.leftward);
  const lines = [];
  for (const [k, H] of [['left', L], ['right', R]]) {
    const n = k[0].toUpperCase() + k.slice(1), m = H.mean;
    lines.push(`${n} hand (average of the laps): forward ${f1(m.propulsive)}%, down ${f1(m.downward)}%, inward ${f1(inward(k, m))}%, upward ${f1(m.upward)}%, hand drag ${f1(m.handDrag)}%`);
    const b = H.byLap; if (b.length >= 2) { const x = b[0], y = b[b.length - 1]; lines.push(`${n} hand, lap ${x.lap} to lap ${y.lap}: down ${f1(x.downward)}% to ${f1(y.downward)}%, inward ${f1(inward(k, x))}% to ${f1(inward(k, y))}%, power ${f0(x.ppsW)} W to ${f0(y.ppsW)} W`); }
  }
  const t = (key) => a.eoReferenceRanges[key];
  if (t('downwardPct')) lines.push(`EO's target for downward force is ${t('downwardPct').text}, and for sideways force ${(t('leftwardPct') || t('rightwardPct') || { text: 'not printed' }).text}.`);
  return finding({
    ruleId: 'HAND_FORCE_FIELD', kind: 'CONTEXT', title: 'Where each hand sends its force', classification: 'MEASURED', confidence: 'HIGH',
    evidence: ['eoExport.forceField'], measurement: lines, text: { JUNIOR: '', PERFORMANCE: '', MASTERS_OPEN_WATER: '', COACH: lines.join('; ') + '.' },
    caveats: ['EO data export: each hand is EO\'s own figure. The combined force field printed in EO\'s report is not rebuilt from these.'], meta: {},
  });
}

/** Coach-only: facts about the path in cm, and nothing that grades them (EO prints no depth or width target). */
export function handPathFacts(a) {
  const h = hpOf(a); if (!h) return null;
  const lines = [];
  const typical = (m) => (m && m.range ? m.range[0] : m && m.value != null ? m.value : null);
  for (const [k] of ARMS) {
    const n = k[0].toUpperCase() + k.slice(1), arm = h[k];
    if (present(arm.maxDepthCm)) lines.push(`${n} hand, deepest point: ${cmText(arm.maxDepthCm)}${arm.maxDepthCm.range && arm.maxDepthCm.provenance.origin === 'EO_EXPORT' ? ' (typical stroke to deepest stroke)' : ''}${arm.depthSdCm != null ? `; varies by ${f1(arm.depthSdCm)} cm from stroke to stroke` : ''}`);
    if (present(arm.maxWidthCm)) lines.push(`${n} hand, furthest from the centreline: ${cmText(arm.maxWidthCm)}${arm.widthSdCm != null ? `; varies by ${f1(arm.widthSdCm)} cm` : ''}`);
    if (arm.inwardSweepCm != null) lines.push(`${n} hand sweeps inward by ${f0(arm.inwardSweepCm)} cm during the pull (widest point to closest point to the centreline, typical stroke)`);
  }
  const dL = typical(h.left.maxDepthCm), dR = typical(h.right.maxDepthCm), wL = typical(h.left.maxWidthCm), wR = typical(h.right.maxWidthCm);
  if (dL != null && dR != null && dL !== dR) lines.push(`Depth differs between hands by ${f0(Math.abs(dL - dR))} cm`);
  if (wL != null && wR != null && wL !== wR) lines.push(`Width differs between hands by ${f0(Math.abs(wL - wR))} cm`);
  if (a.eoExport && a.eoExport.strokePowerCvPct && a.eoExport.strokePowerCvPct.left != null && a.eoExport.strokePowerCvPct.right != null) lines.push(`Stroke-to-stroke power varies by ${f1(a.eoExport.strokePowerCvPct.left)}% (left) and ${f1(a.eoExport.strokePowerCvPct.right)}% (right)`);
  if (!lines.length) return null;
  const down = targetRows(a).find((r) => r.key === 'downwardPct');
  if (down && down.status !== 'ON_TARGET' && ARMS.some(([k]) => present(h[k].maxDepthCm))) lines.push(`Downward force is ${f1(down.value)}% against EO's target of ${down.target}: EO links excessive downward force with poor hand pitch and an early press down. No depth target is printed, so the depth above is not graded.`);
  return finding({
    ruleId: 'HAND_PATH_FACTS', kind: 'CONTEXT', title: 'Hand path measurements', classification: 'OBSERVED', confidence: 'LOW',
    evidence: ARMS.flatMap(([k]) => [`handPathReading.${k}.maxDepthCm`, `handPathReading.${k}.maxWidthCm`]).filter((p) => present(getPath(a, p))), measurement: lines,
    text: { JUNIOR: '', PERFORMANCE: '', MASTERS_OPEN_WATER: '', COACH: lines.join('; ') + '.' }, caveats: ['Chart reads, coach-confirmed. Coach view only.'], meta: {},
  });
}

/** Fixed order = tie-break order for equal scores. */
export const RULES = [powerEffectiveness, lapComparison, asymmetryProfile, technicalOpportunity, handPathCrossover, handPathWrist, handPathConsistency, handForceField, handPathFacts, outputSummary];
export function runRules(a) { return RULES.map((r) => r(a)).filter(Boolean); }
