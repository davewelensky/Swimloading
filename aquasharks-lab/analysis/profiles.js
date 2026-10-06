// @ts-check
/** One analysis engine, four presentation profiles. Profiles change WHAT IS SHOWN and HOW IT IS WORDED, never what is found. */
/** @type {Record<import('./types').ProfileId, import('./types').ProfileConfig>} */
export const PROFILES = {
  JUNIOR: { id: 'JUNIOR', label: 'Junior', maxPriorities: 3, maxHeroMetrics: 2, heroMetricOrder: ['timeS', 'distanceM', 'distancePerStrokeM'], showNumbers: 'MINIMAL', showEvidence: false, showConfidence: false },
  PERFORMANCE: { id: 'PERFORMANCE', label: 'Performance', maxPriorities: 3, maxHeroMetrics: 3, heroMetricOrder: ['timeS', 'distancePerStrokeM', 'strokeRate', 'avgPowerW'], showNumbers: 'STANDARD', showEvidence: false, showConfidence: false },
  MASTERS_OPEN_WATER: { id: 'MASTERS_OPEN_WATER', label: 'Masters / Open water', maxPriorities: 3, maxHeroMetrics: 3, heroMetricOrder: ['distancePerStrokeM', 'avgPowerW', 'forwardShare', 'strokeRate'], showNumbers: 'STANDARD', showEvidence: false, showConfidence: false },
  COACH: { id: 'COACH', label: 'Coach', maxPriorities: 99, maxHeroMetrics: 3, heroMetricOrder: ['timeS', 'distancePerStrokeM', 'avgPowerW', 'forwardShare', 'strokeRate'], showNumbers: 'FULL', showEvidence: true, showConfidence: true },
};
export const PROFILE_IDS = Object.keys(PROFILES);
/** The three swimmer-facing text variants. COACH uses its own text. */
export const textKey = (profileId) => (profileId === 'COACH' ? 'COACH' : profileId);
