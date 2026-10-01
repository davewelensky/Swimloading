// @ts-check
/**
 * TEST SWIMMER A. Synthetic identity, real-shaped numbers. 200 m freestyle, 25 m pool, 8 laps.
 *
 * Purpose: exercise OUR schema and reasoning. It is not a copy of any EO report:
 *   - numbers are test data;
 *   - every EO observation/recommendation is a SHORT PARAPHRASE, tagged by claim type;
 *   - provenance.raw holds field labels only, never source sentences.
 * Fixture values are not thresholds or rules for any other swimmer.
 *
 * Provenance convention:
 *   P.eo(...)     a value an EO report prints (text, table or image label)
 *   P.coach(...)  a value or lap definition supplied by the coach, not printed by the report
 */
import { emptyAnalysis, emptyComparison, overlay, num, rng, obs, lapRef, phaseSet, P } from '../model.js';

const SUM = 'summary line';
const TBL = 'force-distribution table';
const IMG = 'force-field image';
const LAPS = P.coach('Comparison defined by the coach: lap 1 vs lap 8');

/** @type {import('../types').SwimAnalysis} */
export const testSwimmerA = overlay(emptyAnalysis('Test Swimmer A'), {
  swimmer: { communicationProfile: 'MASTERS_OPEN_WATER' },
  session: {
    date: obs('2026-01-15', P.coach('Neutral test date')),
    stroke: obs('Freestyle', P.eo(SUM, 'Stroke')),
    distanceM: num(200, 'm', P.eo(SUM, 'Distance')),
    timeS: num(195.4, 's', P.eo(SUM, 'Time')),
    laps: num(8, '', P.eo(SUM, 'Laps')),
    strokeCount: num(137, '', P.eo(SUM, 'Strokes')),
    poolLengthM: num(25, 'm', P.eo(SUM, 'Pool type')),
    location: obs('Test pool', P.coach('Neutral test location')),
  },
  source: { documents: [{ kind: 'FIXTURE', filename: 'specimen-a', sha256: null, views: [] }], layout: null, analysisContext: { swimmerType: 'Distance' }, notes: ['Synthetic fixture. Not produced by the parser.'] },
  metrics: {
    strokeRate: num(29.53, 'str/min', P.eo(SUM, 'Avg Stroke rate')),
    distancePerStrokeM: num(2.82, 'm', P.eo(SUM, 'DPS')),
    avgPowerW: num(70.97, 'W', P.eo(SUM, 'Avg PPS')),
    workKj: num(12.4, 'kJ', P.eo(SUM, 'Work')),
    avgForceN: num(30.6, 'N', P.coach('Average force supplied by the coach; not in the report')),
    propulsivePct: num(35.16, '%', P.eo(SUM, 'Propulsive'), {
      alternates: [{ value: 34.67, location: 'force-field narrative' }, { value: 34.7, location: TBL }],
      selectionBasis: 'summary-line headline value, kept for reference; the engine reads the force-distribution table value instead',
    }),
  },
  forceDistribution: {
    overall: {
      propulsivePct: num(34.7, '%', P.eo(TBL, 'Propulsive'), {
        alternates: [{ value: 35.16, location: SUM }, { value: 34.67, location: 'force-field narrative' }],
        selectionBasis: 'the six directional components of this table sum to 100.1% with this value (100.56% with 35.16%)',
      }),
      leftwardPct: num(15.4, '%', P.eo(TBL, 'Leftward')), rightwardPct: num(7.7, '%', P.eo(TBL, 'Rightward')),
      upwardPct: num(0.7, '%', P.eo(TBL, 'Upward')), handDragPct: num(1.2, '%', P.eo(TBL, 'Hand Drag')), downwardPct: num(40.4, '%', P.eo(TBL, 'Downward')),
    },
  },
  leftRight: {
    avgImpulseW: {
      left: num(67, 'W', P.eo(IMG, 'Avg Impulse, left'), { status: 'PARTIAL' }),
      right: num(101, 'W', P.eo(IMG, 'Avg Impulse, right'), { status: 'PARTIAL' }),
    },
    relativeOutput: { left: obs('LOWER', P.eo('narrative')), right: obs('HIGHER', P.eo('narrative')) },
    persistence: obs('ALL_LAPS', P.eo('narrative')),
  },
  // The comparison the coach performed: first 25 m (lap 1) vs final 25 m (lap 8). An ENDPOINT comparison, not a trend.
  lapComparisons: [overlay(emptyComparison('lap1-vs-lap8', 'ENDPOINT_CHANGE'), {
    from: lapRef([1], { from: 0, to: 25 }, LAPS),
    to: lapRef([8], { from: 175, to: 200 }, LAPS),
    strokeRate: {
      from: num(30.5, 'str/min', P.coach('Read from the lap chart; the chart has no data labels'), { approximate: true }),
      to: num(28.9, 'str/min', P.coach('Read from the lap chart; the chart has no data labels'), { approximate: true }),
    },
    pullPower: { change: rng([-25, -23], '%', P.coach('Approximate range read from the lap chart')) },
    propulsivePower: { change: rng([-39, -33], '%', P.coach('Approximate range read from the lap chart')) },
    forceShares: {
      from: {
        propulsivePct: num(37.7, '%', P.eo(IMG, 'Propulsive; lap 1 confirmed by coach')), downwardPct: num(39.8, '%', P.eo(IMG, 'Downward; lap 1 confirmed by coach')),
        leftwardPct: num(13.7, '%', P.eo(IMG, 'Leftward')), rightwardPct: num(6.9, '%', P.eo(IMG, 'Rightward')),
        upwardPct: num(0.8, '%', P.eo(IMG, 'Upward')), handDragPct: num(1.0, '%', P.eo(IMG, 'Hand Drag')),
      },
      to: {
        propulsivePct: num(32.1, '%', P.coach('Lap 8 propulsive share supplied by the coach ("approximately")'), { approximate: true }),
        downwardPct: num(40.5, '%', P.coach('Lap 8 downward share supplied by the coach ("approximately")'), { approximate: true }),
      },
    },
  })],
  // LAP AVERAGES (confirmed by the stroke-phase panel). Individual-stroke readings would go in `individualStrokes`, never here.
  strokePhases: {
    left: { lapAverages: [
      { lap: 1, phases: phaseSet(9, 67, 24, P.eo('stroke-phase lap-average panel (coach-supplied screenshot)')) },
      { lap: 8, phases: phaseSet(15, 66, 19, P.eo('stroke-phase lap-average panel (coach-supplied screenshot)')) },
    ] },
    right: { lapAverages: [
      { lap: 1, phases: phaseSet(12, 62, 27, P.eo('stroke-phase lap-average panel (coach-supplied screenshot)')) },
      { lap: 8, phases: phaseSet(12, 59, 29, P.eo('stroke-phase lap-average panel (coach-supplied screenshot)')) },
    ] },
  },
  powerProfile: {
    left: { shape: obs('SINGLE_PEAK', P.eo('power-vs-time section')), doublePeakPctByLap: [0, 0, 0, 0, 0, 0, 0, 0].map((v, i) => num(v, '%', P.eo('power-vs-time section', 'lap ' + (i + 1)))) },
    right: { shape: obs('MULTI_PEAK', P.eo('power-vs-time section')), doublePeakPctByLap: [12.5, 0, 0, 44.44, 0, 22.22, 37.5, 12.5].map((v, i) => num(v, '%', P.eo('power-vs-time section', 'lap ' + (i + 1)))) },
  },
  eoReferenceRanges: Object.fromEntries([
    ['propulsivePct', '70-75%', 70, 75], ['leftwardPct', '<4%', null, 4], ['rightwardPct', '<4%', null, 4],
    ['upwardPct', '0%', 0, 0], ['handDragPct', '0%', 0, 0], ['downwardPct', '17-22%', 17, 22],
  ].map(([k, text, lo, hi]) => [k, { text, lo, hi, provenance: P.eo(TBL, 'Target column') }])),
  // Short paraphrases only. [area, claimType, location, text]
  eoObservations: [
    ['FORCE_FIELD', 'DIAGNOSTIC_INTERPRETATION', 'force-field section', 'EO names force direction, not power, as the main limiter.'],
    ['FORCE_FIELD', 'DIAGNOSTIC_INTERPRETATION', 'force-field section', 'EO attributes high downward force and hand drag to a catch-phase elbow fault.'],
    ['FORCE_FIELD', 'DIAGNOSTIC_INTERPRETATION', 'force-field section', 'EO says the leftward/rightward imbalance works against forward motion.'],
    ['STROKE_RATE_POWER', 'MEASUREMENT_STATEMENT', 'stroke-rate section', 'EO states the right arm produces about half again as much power as the left.'],
    ['STROKE_RATE_POWER', 'DIAGNOSTIC_INTERPRETATION', 'stroke-rate section', 'EO calls the arm gap structural, not fatigue-related, and blames left-side technique.'],
    ['STROKE_RATE_POWER', 'DIAGNOSTIC_INTERPRETATION', 'stroke-rate section', 'EO calls left-arm conversion of power into propulsion poor.'],
    ['STROKE_RATE_POWER', 'MEASUREMENT_STATEMENT', 'stroke-rate section', 'EO reports stroke rate declining across the set.'],
    ['STROKE_RATE_POWER', 'MEASUREMENT_STATEMENT', 'stroke-rate section', 'EO reports total power falling on both arms across laps.'],
    ['POWER_VS_TIME', 'MEASUREMENT_STATEMENT', 'power-vs-time section', 'EO lists right-side double-peak rates by lap and none on the left.'],
    ['POWER_VS_TIME', 'DIAGNOSTIC_INTERPRETATION', 'power-vs-time section', 'EO links double peaks to incomplete water engagement that worsens under effort.'],
  ].map(([area, claimType, loc, text], i) => ({ id: 'eo-obs-' + (i + 1), area, text, claimType, claimTypeBasis: 'COACH', claimTypeConfidence: 'HIGH', provenance: P.eo(loc) })),
  eoRecommendations: [
    { id: 'eo-rec-1', area: 'FORCE_FIELD', audience: 'SWIMMER', text: 'Forearm paddles to build catch feel; reduce hand drag during the glide.', provenance: P.eo('recommendations section, item 1') },
    { id: 'eo-rec-2', area: 'STROKE_RATE_POWER', audience: 'SWIMMER', text: 'Snorkel in catch-focused drills.', provenance: P.eo('recommendations section, item 2') },
    { id: 'eo-rec-3', area: 'STROKE_RATE_POWER', audience: 'COACH_ONLY', text: 'EO suggests a clinical referral if the arm gap persists after two weeks of drills.', provenance: P.eo('recommendations section, item 2') },
    { id: 'eo-rec-4', area: 'FORCE_FIELD', audience: 'SWIMMER', text: 'Paddles with snorkel to equalise effort between sides.', provenance: P.eo('recommendations section, item 3') },
    { id: 'eo-rec-5', area: 'POWER_VS_TIME', audience: 'COACH_ONLY', truncated: true, text: 'Priority 4 (right-side double peaks) is cut off in the source.', provenance: P.eo('recommendations section, item 4') },
    { id: 'eo-rec-6', area: 'GENERAL', audience: 'COACH_ONLY', text: 'Links to four public technique videos.', provenance: P.eo('further-resources section') },
  ],
  sourceIssues: [
    { id: 'si-propulsive', severity: 'WARN', kind: 'CONFLICTING_VALUES', fields: ['metrics.propulsivePct', 'forceDistribution.overall.propulsivePct'], message: 'The propulsive share is printed as 35.16, 34.67 and 34.7 in different places. All three are preserved with their locations; none is established as correct.' },
    { id: 'si-arm-gap', severity: 'WARN', kind: 'CONTRADICTION', fields: ['leftRight.avgImpulseW'], message: 'The arm power gap is described as about 50% in one place and as 20.44% in another. The printed 67 W vs 101 W is consistent with about 50%. The 20.44% figure is unreconciled and not used.' },
    { id: 'si-left-claim', severity: 'INFO', kind: 'CONTRADICTION', fields: ['leftRight.avgImpulseW'], message: 'The left arm is described as 50% weaker while the right is described as 50% stronger. These are not equivalent statements.' },
    { id: 'si-dominant', severity: 'WARN', kind: 'CONTRADICTION', fields: ['powerProfile.left.shape'], message: 'One section calls the left side dominant while the report gives the right arm the higher power.' },
    { id: 'si-truncated', severity: 'WARN', kind: 'TRUNCATION', fields: ['eoRecommendations'], message: 'Recommendation priority 4 ends mid-sentence in the source.' },
    { id: 'si-handdrag', severity: 'INFO', kind: 'UNIT_AMBIGUITY', fields: ['forceDistribution.overall.handDragPct'], message: 'Hand drag appears as 1.23 with no unit in the narrative and as 1.2% in the table. Treated as 1.2%.' },
    { id: 'si-lap-image', severity: 'INFO', kind: 'UNLABELLED_LAP', fields: ['lapComparisons.0.forceShares.from'], message: 'The force-field image carries no lap label. The coach confirmed it shows lap 1.' },
  ],
  baseline: { capturedOn: '2026-01-15', metrics: { timeS: 195.4, distancePerStrokeM: 2.82, strokeRate: 29.53, avgPowerW: 70.97, propulsivePct: 34.7, downwardPct: 40.4 } },
});

export default testSwimmerA;
