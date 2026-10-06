// @ts-check
import { drillFor, drillById } from './drills.js';

/** Priority copy per rule. Titles/feel/cue are Aqua Sharks coaching language; `why` comes from the finding. */
const CONTENT = {
  POWER_EFFECTIVENESS: (f) => {
    // drill tags in order of how far each force direction is from EO's target
    const TAG = { handDragPct: 'handDrag', downwardPct: 'downward', propulsivePct: 'forceDirection' };
    const off = ((f.meta && f.meta.targetRows) || []).filter((r) => r.status !== 'ON_TARGET' && TAG[r.key]).sort((x, y) => y.gap - x.gap);
    return { title: 'Send the water back', feel: 'Pressure moving backwards rather than down.', cue: 'Catch it. Hold it. Send it back.', tags: [...new Set([...off.filter((r) => r.key !== 'propulsivePct').map((r) => TAG[r.key]), 'forceDirection'])] };   // causes first: forward share is the outcome
  },
  LAP_COMPARISON: () => ({ title: 'Keep your forward power to the last lap', feel: 'The same backward push on the last lap as on the first.', cue: 'Last lap, same catch.', tags: ['lapHold'] }),
  ASYMMETRY_PROFILE: (f) => f.meta.persistent ? ({ title: 'Share the work between both arms', feel: 'The same push from each arm, every lap.', cue: 'Both arms. Same push.', tags: ['asymmetry', 'powerShape'] }) : f.meta.lapSwap ? ({ title: 'Keep both arms pushing the same, every lap', feel: 'The same push from each arm, first lap to last.', cue: 'Same push, both arms.', tags: ['asymmetry', 'powerShape'] }) : ({ title: f.meta.multiArm ? `Smooth out your ${f.meta.multiArm} arm` : 'Look at both arms together', feel: 'One even push from every stroke.', cue: 'One smooth push, every stroke.', tags: ['asymmetry', 'powerShape'] }),
  HAND_PATH_CROSSOVER: () => ({ title: 'Stay on your own side', feel: 'Each hand pulling straight back under its own shoulder.', cue: 'Stay on your own side. Pull straight back.', tags: ['crossover'] }),
  HAND_PATH_WRIST: () => ({ title: 'Show the full palm', feel: 'The whole palm facing the back of the pool.', cue: 'Fingers down. Palm back.', tags: ['wrist', 'downward'] }),
  HAND_PATH_CONSISTENCY: (f) => ({ title: f.meta.oneSided ? 'Make every stroke look the same' : 'Make every stroke look the same', feel: 'The same path, stroke after stroke.', cue: 'Slow down. Same path every time.', tags: ['consistency'] }),
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
