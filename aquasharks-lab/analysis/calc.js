// @ts-check
/** Pure calculations. No text, no thresholds. Every result says whether it was reported or derived. */
import { present } from './model.js';

/** Low/high bounds of a Measured: point value -> [v,v], range -> sorted, missing -> null. */
export function bounds(m) {
  if (!present(m)) return null;
  if (m.range) return [m.range[0], m.range[1]];
  return [m.value, m.value];
}

/** Percent change from `a` to `b`. Null when `a` is 0 or either side is missing. */
export function pctChange(a, b) {
  if (a == null || b == null || a === 0) return null;
  return ((b - a) / Math.abs(a)) * 100;
}
export const pointChange = (a, b) => (a == null || b == null ? null : b - a);

/** Round half away from zero to dp places, avoiding -0. */
export function round(n, dp = 1) {
  if (n == null || !isFinite(n)) return null;
  const f = 10 ** dp, r = Math.round(Math.abs(n) * f) / f * Math.sign(n);
  return r === 0 ? 0 : r;
}

/**
 * Change between two lap endpoints: uses the change the SOURCE reported if there is one,
 * otherwise derives it from `from` and `to` when both are real point values. Never invents either.
 * @returns {{lo:number, hi:number, via:'REPORTED'|'DERIVED', approximate:boolean} | null}
 */
export function changeOf(el) {
  const rep = bounds(el.change);
  if (rep) return { lo: rep[0], hi: rep[1], via: 'REPORTED', approximate: !!(el.change.approximate || el.change.range) };
  if (present(el.from) && present(el.to) && !el.from.range && !el.to.range) {
    const c = pctChange(el.from.value, el.to.value);
    if (c !== null) return { lo: c, hi: c, via: 'DERIVED', approximate: !!(el.from.approximate || el.to.approximate) };
  }
  return null;
}

/**
 * Which change is larger in magnitude? Conservative: A is larger only if its SMALLEST possible
 * magnitude exceeds B's LARGEST possible magnitude. Overlapping ranges are UNCLEAR.
 * @returns {'A'|'B'|'UNCLEAR'}
 */
export function largerMagnitude(a, b) {
  const mag = (c) => { const lo = Math.min(Math.abs(c.lo), Math.abs(c.hi)), hi = Math.max(Math.abs(c.lo), Math.abs(c.hi)); return [lo, hi]; };
  const [aLo, aHi] = mag(a), [bLo, bHi] = mag(b);
  if (aLo > bHi) return 'A';
  if (bLo > aHi) return 'B';
  return 'UNCLEAR';
}

/**
 * Left/right asymmetry from two point values. Reported three ways so the reader can see the basis:
 *   ratio             higher / lower
 *   differencePctOfLower   (higher - lower) / lower * 100
 *   symmetryIndexPct  (right - left) / mean * 100, signed (positive = right higher)
 */
export function asymmetry(left, right) {
  if (left == null || right == null) return null;
  const hi = Math.max(left, right), lo = Math.min(left, right);
  if (lo <= 0) return null;
  const mean = (left + right) / 2;
  return {
    higher: left === right ? 'EQUAL' : (right > left ? 'RIGHT' : 'LEFT'),
    ratio: hi / lo,
    differencePctOfLower: ((hi - lo) / lo) * 100,
    symmetryIndexPct: ((right - left) / mean) * 100,
  };
}

/** Direction of a change from its bounds: DOWN if surely negative, UP if surely positive, else UNCLEAR. */
export function directionOf(change) {
  if (!change) return 'UNCLEAR';
  if (change.hi < 0) return 'DOWN';
  if (change.lo > 0) return 'UP';
  return 'UNCLEAR';
}

/**
 * Corroboration: do INDEPENDENT measures point the same way? This is deliberately NOT an equation. No formula
 * relating pull power, force share and propulsive power is assumed (none is documented by EO), so the signals are
 * only compared by direction.
 *   CORROBORATED  >= 2 signals, all with a clear and identical direction
 *   CONFLICTING   at least one clear DOWN and one clear UP
 *   PARTIAL       otherwise (one signal, or unclear directions)
 *   NOT_TESTABLE  no signals
 * @param {{id:string,label:string,direction:'DOWN'|'UP'|'UNCLEAR'}[]} signals
 */
export function corroborate(signals) {
  if (!signals.length) return { status: 'NOT_TESTABLE' };
  const down = signals.filter((s) => s.direction === 'DOWN').length, up = signals.filter((s) => s.direction === 'UP').length;
  if (down && up) return { status: 'CONFLICTING' };
  if (signals.length >= 2 && (down === signals.length || up === signals.length)) return { status: 'CORROBORATED' };
  return { status: 'PARTIAL' };
}

/**
 * Confidence from the quality of the inputs. HIGH only if every input is a complete, exact, printed value
 * with no conflicting alternates. Approximate, ranged, or conflicting inputs cap at MODERATE. Ambiguous inputs are LOW.
 * @returns {'HIGH'|'MODERATE'|'LOW'}
 */
export function confidenceOf(measureds) {
  let c = 'HIGH';
  for (const m of measureds) {
    if (!present(m)) return 'LOW';
    if (m.status === 'AMBIGUOUS') return 'LOW';
    if (m.status === 'PARTIAL') c = 'MODERATE';
    if (m.approximate || m.range) c = 'MODERATE';
    if (m.provenance && m.provenance.origin === 'COACH_SUPPLIED' && (m.approximate || m.range)) c = 'MODERATE';
    if (m.alternates && m.alternates.some((a) => Math.abs(a.value - m.value) > 0.05)) c = 'MODERATE';
  }
  return /** @type {any} */ (c);
}
export const CONF_RANK = { HIGH: 3, MODERATE: 2, LOW: 1 };
export const minConfidence = (list) => list.reduce((a, b) => (CONF_RANK[a] <= CONF_RANK[b] ? a : b), 'HIGH');

/** Sum of the shares that are present, and how many were present. */
export function shareSum(shares, keys) {
  let sum = 0, n = 0;
  for (const k of keys) if (present(shares[k]) && !shares[k].range) { sum += shares[k].value; n++; }
  return { sum, n };
}

/** Every printed value for a quantity: the one used plus all alternates, each with its location. */
export function printedValues(m) {
  if (!present(m)) return [];
  const used = { value: m.value, location: (m.provenance && m.provenance.location) || '', used: true };
  const alts = (m.alternates || []).map((a) => ({ value: a.value, location: a.location, used: false }));
  return [used, ...alts];
}
/** True when printed values differ by more than rounding (beyond 0.05). A 34.67 vs 34.7 pair is a precision variant, not a conflict. */
export function hasRealConflict(m) {
  return !!(m && m.alternates && m.alternates.some((a) => Math.abs(a.value - m.value) > 0.05));
}
