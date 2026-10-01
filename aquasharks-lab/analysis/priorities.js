// @ts-check
import { drillFor, drillById } from './drills.js';

/** Priority copy per rule. Titles/feel/cue are Aqua Sharks coaching language; `why` comes from the finding. */
const CONTENT = {
  POWER_EFFECTIVENESS: () => ({ title: 'Send the water back', feel: 'Pressure moving backwards rather than down.', cue: 'Catch it. Hold it. Send it back.', tags: ['forceDirection'] }),
  LAP_COMPARISON: () => ({ title: 'Keep your forward power to the last lap', feel: 'The same backward push on the last lap as on the first.', cue: 'Last lap, same catch.', tags: ['lapHold'] }),
  ASYMMETRY_PROFILE: (f) => ({ title: f.meta.multiArm ? `Smooth out your ${f.meta.multiArm} arm` : 'Look at both arms together', feel: 'One even push from every stroke.', cue: 'One smooth push, every stroke.', tags: ['asymmetry', 'powerShape'] }),
  POSSIBLE_TECHNICAL_OPPORTUNITY: (f) => ({ title: f.title, feel: '', cue: '', tags: [] }),
};

/**
 * Rank OPPORTUNITY findings. Order: coach override first, then score, then rule order (stable).
 * A priority reaches a swimmer only if its evidence is MEASURED/OBSERVED, or INFERRED and coach-confirmed.
 * @returns {import('./types').Priority[]}
 */
export function buildPriorities(a, findings, profile) {
  const review = a.coachReview || { findings: {} };
  const cands = findings.filter((f) => f.kind === 'OPPORTUNITY' && CONTENT[f.ruleId]);
  const order = review.priorityOrder || [];
  const idx = new Map(findings.map((f, i) => [f.id, i]));
  cands.sort((x, y) => {
    const ox = order.indexOf(x.id), oy = order.indexOf(y.id);
    if (ox !== -1 || oy !== -1) return (ox === -1 ? 1e6 : ox) - (oy === -1 ? 1e6 : oy);
    return y.score - x.score || idx.get(x.id) - idx.get(y.id);
  });
  let shown = 0;
  return cands.map((f, i) => {
    const c = CONTENT[f.ruleId](f);
    const suppressed = f.review.status === 'SUPPRESSED';
    const facing = !suppressed && (f.classification === 'MEASURED' || f.classification === 'OBSERVED' || (f.classification === 'INFERRED' && !!f.review.technicalConfirmed));
    const chosen = review.drillChoice && review.drillChoice[f.id] ? drillById(review.drillChoice[f.id]) : drillFor(c.tags);
    const included = facing && shown < profile.maxPriorities;
    if (included) shown++;
    return {
      id: 'priority-' + f.id, findingIds: [f.id], rank: i + 1, ruleId: f.ruleId, title: c.title,
      why: { JUNIOR: f.text.JUNIOR, PERFORMANCE: f.text.PERFORMANCE, MASTERS_OPEN_WATER: f.text.MASTERS_OPEN_WATER },
      feel: c.feel, cue: c.cue, drillId: chosen ? chosen.id : null, drill: chosen, swimmerFacing: facing, included,
      classification: f.classification, confidence: f.confidence, suppressed,
      coachOnlyReason: suppressed ? 'Suppressed by coach' : facing ? undefined : (f.classification === 'COACH_CONFIRMATION_REQUIRED' ? 'Awaiting coach confirmation' : 'Inferred, not yet confirmed by a coach'),
    };
  });
}
