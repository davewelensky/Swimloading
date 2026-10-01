// @ts-check
/**
 * TEST SWIMMER B. Synthetic identity, a deliberately THIN source: no distance, time, laps, lap comparison,
 * double-peak data, stroke phases or hand path. Proves the engine and report degrade gracefully instead of inventing values.
 * Numbers are test data; observations are short paraphrases. Not thresholds for any other swimmer.
 */
import { emptyAnalysis, overlay, num, obs, P } from '../model.js';
const POD = 'force-distribution graphic';
export const testSwimmerB = overlay(emptyAnalysis('Test Swimmer B'), {
  swimmer: { communicationProfile: 'PERFORMANCE' },
  session: { stroke: obs('Freestyle', P.eo('title')) },
  source: { format: 'FIXTURE', filename: 'specimen-b', analysisContext: { swimmerType: null }, notes: ['Synthetic fixture. Thin source on purpose.'] },
  forceDistribution: { overall: {
    propulsivePct: num(32.6, '%', P.eo(POD)), downwardPct: num(43.7, '%', P.eo(POD)), upwardPct: num(0.5, '%', P.eo(POD)),
    leftwardPct: num(5.0, '%', P.eo(POD)), rightwardPct: num(9.3, '%', P.eo(POD)), handDragPct: num(8.9, '%', P.eo(POD)),
  } },
  leftRight: {
    impulse: { left: num(2.89, '', P.eo(POD, 'Avg Impulse')), right: num(3.34, '', P.eo(POD, 'Avg Impulse')) },
    relativeOutput: { left: obs('LOWER', P.eo('narrative')), right: obs('HIGHER', P.eo('narrative')) },
  },
  eoObservations: [
    { id: 'eo-obs-1', area: 'FORCE_FIELD', claimType: 'MEASUREMENT_STATEMENT', text: 'EO notes a high downward share alongside the propulsive share.', provenance: P.eo('narrative') },
    { id: 'eo-obs-2', area: 'FORCE_FIELD', claimType: 'DIAGNOSTIC_INTERPRETATION', text: 'EO links elevated hand drag to the pull angle or an early push.', provenance: P.eo('narrative') },
  ],
});
export default testSwimmerB;
