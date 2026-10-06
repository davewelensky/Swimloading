// @ts-check
/** Writing a hand-path reading into an analysis. Only a coach's decision gets here: a model suggestion is never applied by itself. */
import { num, rng, obs, missing, obsMissing, emptyHandPathReading } from './model.js';

const PROV = (note) => ({ origin: /** @type {const} */ ('CHART_READ'), location: 'EO stroke-path chart', note, extraction: { method: /** @type {const} */ ('MANUAL'), confidence: /** @type {const} */ ('MODERATE') } });
const NOTE = 'Read from the EO chart (no printed value) and confirmed by the coach';
const ENUMS = { crossesMidline: ['YES', 'NO', 'UNSURE'], spread: ['TIGHT', 'MODERATE', 'WIDE', 'UNSURE'], wristPitch: ['BROKEN', 'OK', 'UNSURE'] };
const FIELDS = ['crossesMidline', 'left.maxDepthCm', 'left.maxWidthCm', 'left.spread', 'left.wristPitch', 'right.maxDepthCm', 'right.maxWidthCm', 'right.spread', 'right.wristPitch'];
export const HAND_PATH_FIELDS = FIELDS;

/**
 * Set one field. `value` is a number, a [low, high] range, a category string, or null/'' to clear it.
 * Returns false (and changes nothing) for a value that is not valid for the field.
 * @param {any} a @param {string} field @param {number | [number, number] | string | null} value @param {string} [noteExtra]
 */
export function setHandPathField(a, field, value, noteExtra) {
  if (!FIELDS.includes(field)) return false;
  const h = (a.handPathReading = a.handPathReading || emptyHandPathReading());
  const [first, second] = field.split('.');
  const parent = second ? h[first] : h, key = second || first, note = noteExtra ? `${NOTE}. ${noteExtra}` : NOTE;
  const isNum = key === 'maxDepthCm' || key === 'maxWidthCm';
  if (value === null || value === '') { parent[key] = isNum ? missing('cm', 'COACH_REQUIRED') : obsMissing('COACH_REQUIRED'); return true; }
  if (isNum) {
    if (Array.isArray(value)) { const [lo, hi] = value; if (![lo, hi].every((v) => typeof v === 'number' && isFinite(v) && v >= 0 && v <= 300) || hi < lo) return false; parent[key] = lo === hi ? num(lo, 'cm', PROV(note), { approximate: true }) : rng([lo, hi], 'cm', PROV(note)); return true; }
    if (typeof value !== 'number' || !isFinite(value) || value < 0 || value > 300) return false;
    parent[key] = num(value, 'cm', PROV(note), { approximate: true }); return true;
  }
  if (typeof value !== 'string' || !ENUMS[key].includes(value)) return false;
  parent[key] = obs(value, PROV(note)); return true;
}
