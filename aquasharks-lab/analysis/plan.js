// @ts-check
/**
 * The come-back pieces of a swimmer report: a practice plan for the weeks before the retest, a date for that retest, and a
 * pull count the swimmer can check on any length with no sensors. Everything is built from the report's own priorities,
 * drills and numbers. Nothing here is a training prescription: it says what to focus on and which drill, never how many reps.
 */
import { present } from './model.js';
import { round } from './calc.js';

export const RETEST_WEEKS = [4, 6, 8];
export const DEFAULT_RETEST_WEEKS = 6;
export const BOOK_URL = 'https://www.swimloading.com/aquasharks-lab#book';

/** @param {any} v */
export const retestWeeks = (v) => (RETEST_WEEKS.includes(Number(v)) ? Number(v) : DEFAULT_RETEST_WEEKS);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-10-06" + 6 weeks -> "17 November 2026". Calendar maths in UTC; never toISOString (SAST shifts the day back). */
export function retestDate(isoDate, weeks) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + weeks * 7));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * One focus per stretch of weeks, in the order of the report's priorities, then a final week to put it together.
 * @param {{title: string, cue: string, drill: {name: string, what: string} | null}[]} focuses @param {number} weeks
 */
export function buildPlan(focuses, weeks) {
  if (!focuses.length) return [];
  const build = weeks - 1, n = focuses.length, base = Math.floor(build / n), extra = build % n;
  let w = 1;
  const steps = focuses.map((f, i) => {
    const len = base + (i < extra ? 1 : 0), from = w, to = w + len - 1; w += len;
    return { kind: 'FOCUS', weeks: from === to ? `Week ${from}` : `Weeks ${from}–${to}`, title: f.title, cue: f.cue, drill: f.drill ? { name: f.drill.name, what: f.drill.what } : null };
  });
  steps.push({ kind: 'TOGETHER', weeks: `Week ${weeks}`, title: 'Put it together', cue: '', drill: null });
  return steps;
}

/** Strokes per length: total strokes over the swim divided by its laps (EO's laps are pool lengths). Null unless both are printed. @param {any} a */
export function pullCount(a) {
  const s = a.session;
  if (!present(s.strokeCount) || !present(s.laps) || !(s.laps.value > 0)) return null;
  return round(s.strokeCount.value / s.laps.value, 1);
}
