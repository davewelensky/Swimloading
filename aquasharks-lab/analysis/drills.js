// @ts-check
/** Aqua Sharks drill library. DRAFT: a coach chooses and approves. Origins are EO recommendations where they exist. */
/** @type {import('./types').Drill[]} */
export const DRILLS = [
  { id: 'forearm-paddles-catch', name: 'Forearm paddles: feel the catch', tags: ['forceDirection'], status: 'DRAFT',
    what: 'Swim easy freestyle in forearm paddles, keeping your hand in front of your elbow as you start the pull.',
    feel: 'Water pressure along your whole forearm, pushing back.',
    why: 'It makes it easier to feel where the pressure is while you work on where your force points.',
    origin: 'EO recommendation (specimen A, priority 1)' },
  { id: 'snorkel-catch', name: 'Snorkel catch drills', tags: ['asymmetry', 'powerShape'], status: 'DRAFT',
    what: 'Swim catch-focused drills with a front snorkel so breathing does not interrupt the stroke.',
    feel: 'The same pressure and the same smoothness on both arms.',
    why: 'It lets you and your coach compare the two arms without breathing getting in the way.',
    origin: 'EO recommendation (specimen A, priority 2)' },
  { id: 'paddles-snorkel', name: 'Paddles with snorkel', tags: ['lateral', 'asymmetry'], status: 'DRAFT',
    what: 'Swim with paddles and a front snorkel, aiming for equal effort on both sides.',
    feel: 'Equal pressure on both sides, pushing straight back.',
    why: 'Paddles make small differences easier to notice; the snorkel removes breathing from the picture.',
    origin: 'EO recommendation (specimen A, priority 3)' },
  { id: 'fingertip-drag-catch', name: 'Fingertip drag into catch', tags: ['handDrag', 'downward'], status: 'DRAFT',
    what: 'Swim easy freestyle, let your fingertips skim the surface on recovery with a high elbow, then enter and set a flat hand before you start to pull.',
    feel: 'A flat, ready hand the moment it enters, with the elbow staying up.',
    why: 'It slows the start of the stroke down enough to feel where your hand and elbow are before you pull.',
    origin: 'EO recommendation (fingertip drag, catch-up)' },
  { id: 'high-elbow-sculling', name: 'High-elbow sculling', tags: ['downward', 'handDrag'], status: 'DRAFT',
    what: 'Scull out in front with the elbow higher than the hand and the forearm facing back, then add a pull from that position.',
    feel: 'Pressure along the whole forearm, pushing back instead of down.',
    why: 'It trains the elbow to stay up so the push goes backwards.',
    origin: 'EO recommendation (high-elbow drills)' },
  { id: 'tempo-trainer-late', name: 'Tempo-trainer sets', tags: ['lapHold'], status: 'DRAFT',
    what: 'Hold your stroke rhythm to a tempo trainer through a whole set, and check the catch feel on the last repeats.',
    feel: 'The same pressure at the end of the set as at the start.',
    why: 'A rhythm you can hold makes it easier to see whether your catch holds too.',
    origin: 'EO recommended fix (specimen B)' },
];
export const drillById = (id) => DRILLS.find((d) => d.id === id) || null;
/** Tags are in priority order: the first tag with a drill wins. */
export const drillFor = (tags) => { for (const t of tags) { const d = DRILLS.find((x) => x.tags.includes(t)); if (d) return d; } return null; };
