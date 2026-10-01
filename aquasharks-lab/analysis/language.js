// @ts-check
/** Number formatting and the language guard for swimmer-facing text. */
import { round } from './calc.js';

export const f1 = (n) => { const r = round(n, 1); return r === null ? '' : String(r); };
export const f0 = (n) => { const r = round(n, 0); return r === null ? '' : String(r); };
export const f2 = (n) => { const r = round(n, 2); return r === null ? '' : r.toFixed(2); };
export const signed = (n, dp = 1) => { const r = round(n, dp); return r === null ? '' : (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r); };
/** "33 to 39" for a range, "5.2" for a point. Signs kept: "−33 to −39". */
export function span(lo, hi, dp = 0) {
  // smaller magnitude first, so a decline reads "\u221223 to \u221225", not "\u221225 to \u221223"
  [lo, hi] = [lo, hi].sort((x, y) => Math.abs(x) - Math.abs(y));
  const a = round(lo, dp), b = round(hi, dp);
  const s = (v) => (v < 0 ? '−' : '') + Math.abs(v);
  return a === b ? s(a) : `${s(a)} to ${s(b)}`;
}
export function mmss(seconds) {
  if (seconds == null) return '';
  const m = Math.floor(seconds / 60), s = seconds - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

/**
 * Phrases a swimmer-facing sentence may not use: unsupported causal/diagnostic language,
 * good/bad arm labels, and judgements of efficiency from a pattern alone.
 * Coach-facing text is allowed to QUOTE EO's diagnoses (labelled as EO's), so only swimmer text is linted.
 */
export const BANNED = [
  /\bdropped? elbow\b/i, /\belbow drop\b/i, /\bcatch (mechanics )?(issue|problem|fault|breakdown)\b/i,
  /\bbecause (of )?your\b/i, /\byour .{0,30}\b(causes?|caused|causing)\b/i, /\b(causes?|caused by)\b/i,
  /\b(good|bad|weak|strong|dominant|lazy) arm\b/i, /\b(weaker|stronger) (side|arm)\b/i,
  /\btechnique (breakdown|flaw|fault|deficit)\b/i, /\bshoulder (issue|impingement|problem)\b/i,
  /\bphysio(therap\w*)?\b/i, /\bneuromuscular\b/i, /\binefficien(t|cy)\b/i, /\bwasted?\b/i,
  /\b(left|right) arm is (efficient|inefficient|good|bad|poor|excellent)\b/i,
];
/** @returns {string[]} the banned phrases found in `text` */
export function languageViolations(text) {
  return BANNED.filter((re) => re.test(text || '')).map((re) => String(re));
}

/** Numbers in text that are not in `allowed`. Used by tests to prove copy never invents a figure. */
export function ungroundedNumbers(text, allowed) {
  const out = [];
  for (const m of String(text || '').matchAll(/\d+(?:\.\d+)?/g)) {
    const n = parseFloat(m[0]);
    if (![...allowed].some((a) => Math.abs(a - n) < 0.051 || Math.abs(Math.round(a) - n) < 0.001 || Math.abs((round(a, 1) ?? NaN) - n) < 0.001)) out.push(m[0]);
  }
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-04-06" -> "6 April 2026". Parsed by hand: toISOString/new Date shift the day back in SAST. */
export function fmtDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : '';
}

/**
 * Human label for a lap endpoint, kept honest: the label comes from the actual lap identifiers and distances.
 * "FIRST 25 m" only when the ref is lap 1 starting at 0 m; "LAST 25 m" only when it ends at the swim distance;
 * otherwise "LAP n" / "LAPS a-b". It never turns the words early/late into laps.
 * @param {{laps:number[], distanceM:{from:number,to:number}|null}} ref @param {number|null} swimDistanceM
 */
export function lapLabel(ref, swimDistanceM) {
  if (!ref || !ref.laps || !ref.laps.length) return '';
  const d = ref.distanceM, n = ref.laps.length;
  if (d && d.from === 0 && ref.laps[0] === 1) return `FIRST ${d.to - d.from} m`;
  if (d && swimDistanceM != null && d.to === swimDistanceM) return `LAST ${d.to - d.from} m`;
  return n === 1 ? `LAP ${ref.laps[0]}` : `LAPS ${ref.laps[0]}-${ref.laps[n - 1]}`;
}
export const lapName = (ref) => (!ref || !ref.laps || !ref.laps.length ? '' : ref.laps.length === 1 ? `lap ${ref.laps[0]}` : `laps ${ref.laps[0]}-${ref.laps[ref.laps.length - 1]}`);
