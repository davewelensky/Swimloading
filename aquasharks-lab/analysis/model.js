// @ts-check
/** Constructors and helpers for SwimAnalysis. Every field starts MISSING; only a source or coach can fill it. */

/** @typedef {import('./types').SwimAnalysis} SwimAnalysis */
/** @typedef {import('./types').Measured} Measured */
/** @typedef {import('./types').Provenance} Provenance */
/** @typedef {import('./types').DataStatus} DataStatus */

/** @type {Provenance} */
const NONE = { origin: 'EO_REPORT', note: 'not present in source' };

/** @param {string} [unit] @returns {Measured} */
export const missing = (unit) => ({ value: null, unit, status: 'MISSING', provenance: { ...NONE } });

/** @param {number} value @param {string} unit @param {Provenance} provenance
 *  @param {{approximate?: boolean, status?: DataStatus, alternates?: {value:number, location:string}[], selectionBasis?: string}} [o] @returns {Measured} */
export const num = (value, unit, provenance, o = {}) => ({ value, unit, status: o.status || 'COMPLETE', approximate: o.approximate, provenance, alternates: o.alternates, selectionBasis: o.selectionBasis });

/** A range such as "approximately 23-25%". Value stays null: a range is never collapsed to a midpoint.
 *  @param {[number, number]} range @param {string} unit @param {Provenance} provenance @returns {Measured} */
export const rng = (range, unit, provenance) => ({ value: null, unit, range: /** @type {[number,number]} */ ([Math.min(...range), Math.max(...range)]), status: 'COMPLETE', approximate: true, provenance });

/** @template {string} T @param {T} value @param {Provenance} provenance @param {DataStatus} [status] */
export const obs = (value, provenance, status = 'COMPLETE') => ({ value, status, provenance });
export const obsMissing = () => ({ value: null, status: /** @type {DataStatus} */ ('MISSING'), provenance: { ...NONE } });

export const P = {
  /** @param {string} location @param {string} [raw] @returns {Provenance} */
  eo: (location, raw) => ({ origin: 'EO_REPORT', location, raw }),
  /** @param {string} note @returns {Provenance} */
  coach: (note) => ({ origin: 'COACH_SUPPLIED', note }),
  /** @param {string} note @returns {Provenance} */
  derived: (note) => ({ origin: 'DERIVED', note }),
};

const shares = () => ({
  propulsivePct: missing('%'), downwardPct: missing('%'), upwardPct: missing('%'),
  leftwardPct: missing('%'), rightwardPct: missing('%'), handDragPct: missing('%'),
});
const fromTo = (unit) => ({ from: missing(unit), to: missing(unit), change: missing('%'), changeUnit: /** @type {'pct'} */ ('pct') });
const arm = () => ({ lapAverages: [], individualStrokes: [] });
const lapRefMissing = () => ({ laps: [], distanceM: null, status: /** @type {DataStatus} */ ('MISSING'), provenance: { ...NONE } });

/** An empty comparison between two laps. Fill with overlay(). @param {string} id @param {'ENDPOINT_CHANGE'|'MULTI_LAP_TREND'} [kind] */
export function emptyComparison(id, kind = 'ENDPOINT_CHANGE') {
  return { id, kind, from: lapRefMissing(), to: lapRefMissing(), strokeRate: fromTo('str/min'), pullPower: fromTo('W'), propulsivePower: fromTo('W'), forceShares: { from: shares(), to: shares() } };
}
/** @param {number[]} laps @param {{from:number,to:number}|null} distanceM @param {Provenance} provenance @param {DataStatus} [status] */
export const lapRef = (laps, distanceM, provenance, status = 'COMPLETE') => ({ laps, distanceM, status, provenance });
/** One lap-average phase set (percent of the stroke cycle). */
export const phaseSet = (glide, pull, recovery, provenance) => ({ glidePct: num(glide, '%', provenance), pullPct: num(pull, '%', provenance), recoveryPct: num(recovery, '%', provenance) });

/** An analysis in which nothing is known. @param {string} name @returns {SwimAnalysis} */
export function emptyAnalysis(name) {
  return {
    schemaVersion: 2,
    swimmer: { name, age: missing('years'), communicationProfile: 'PERFORMANCE' },
    session: { date: obsMissing(), stroke: obsMissing(), distanceM: missing('m'), timeS: missing('s'), laps: missing(), strokeCount: missing(), poolLengthM: missing('m'), location: obsMissing() },
    source: { provider: 'EO Labs', product: 'SwimBETTER', format: 'FIXTURE', filename: null, analysisContext: { swimmerType: null }, extractedAt: null, parserVersion: null, notes: [] },
    metrics: { strokeRate: missing('str/min'), distancePerStrokeM: missing('m'), avgForceN: missing('N'), avgPowerW: missing('W'), workKj: missing('kJ'), propulsivePct: missing('%') },
    forceDistribution: { overall: shares() },
    leftRight: { avgPowerW: { left: missing('W'), right: missing('W') }, impulse: { left: missing(), right: missing() }, relativeOutput: { left: obsMissing(), right: obsMissing() }, persistence: obsMissing() },
    lapComparisons: [],
    handPath: { left: obsMissing(), right: obsMissing() },
    consistency: { left: obsMissing(), right: obsMissing(), withinLap: obsMissing(), betweenLaps: obsMissing() },
    strokePhases: { left: arm(), right: arm() },
    powerProfile: { left: { shape: obsMissing(), doublePeakPctByLap: [] }, right: { shape: obsMissing(), doublePeakPctByLap: [] } },
    handPathAndPower: { status: 'MISSING' },
    eoObservations: [], eoRecommendations: [], eoReferenceRanges: {}, sourceIssues: [],
    aquaSharksFindings: [], priorities: [], coachNotes: [],
    coachReview: { findings: {} },
    baseline: { capturedOn: null, metrics: {} },
  };
}

/** Deep-merge `patch` into `base` (arrays replaced). Used to overlay a source's known values on the empty skeleton. */
export function overlay(base, patch) {
  if (Array.isArray(patch) || patch === null || typeof patch !== 'object') return patch;
  const out = { ...base };
  for (const k of Object.keys(patch)) out[k] = (base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k]) && !isLeaf(base[k])) ? overlay(base[k], patch[k]) : patch[k];
  return out;
}
/** Measured / Observed leaves are replaced whole, not merged field by field. */
function isLeaf(o) { return o && typeof o === 'object' && ('status' in o) && ('provenance' in o); }

/** @param {any} root @param {string} path */
export function getPath(root, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), root);
}

/** A Measured/Observed counts as present only when the source actually gave a value or a range. */
export function present(m) {
  if (!m || m.status === 'MISSING') return false;
  if ('range' in m && m.range) return true;
  return m.value !== null && m.value !== undefined;
}
