// Shared rules for the injury section on /crossing-prep. Loaded by the page as
// a plain script and imported by api/_lib/crossing-injury/guidance.js.
//
// Product decision (Dave, 9 Nov 2026): swimmers log injuries and the AI suggests
// reducing effort. SwimLoading does not screen or take responsibility for
// injuries, and swimmers see a physio or doctor themselves. So nothing here
// blocks logging or guidance. `SYMPTOM_NOTES` only adds a reminder when the
// swimmer ticks, or their own words mention, something a doctor should hear about. It has not
// had clinical review. Symptoms only: nothing in this file may name a condition.

(function (root) {
    // Invite only. The API enforces this; the page uses it to show the tab.
    const OPEN_TO = [
        'df137255-3add-4153-b368-32e06e2be188', // Dave
        '9b1445e8-cce5-4501-a038-489146d15ab2', // Peter Emslie
    ];

    const DISCLAIMER = 'SwimLoading lets you log this and suggests how to reduce your training. It is not medical advice, and we do not take responsibility for injuries. See a physio or doctor about anything that concerns you.';

    // Highest priority first.
    const TIERS = {
        emergency: { rank: 0, action: 'If this is happening now, call your local emergency number.' },
        same_day: { rank: 1, action: 'Please get this seen by a doctor today.' },
        urgent: { rank: 2, action: 'Please speak to a doctor about this soon.' },
        see_physio: { rank: 3, action: 'A physio or doctor should look at this.' },
    };

    const SYMPTOM_NOTES = [
        { tier: 'emergency', id: 'chest', tick: 'Chest pain or tightness', label: 'chest symptoms', patterns: [/\bchest\b/i] },
        { tier: 'emergency', id: 'breathing', tick: 'Difficulty breathing', label: 'difficulty breathing', patterns: [/\b(can'?t|cannot|struggling to|difficulty) breath/i, /\bshort of breath\b/i] },
        { tier: 'emergency', label: 'collapsing or passing out', patterns: [/\bcollaps/i, /\bpassed out\b/i, /\bblacked out\b/i] },
        { tier: 'same_day', label: 'possible bone damage', patterns: [/\bbroken?\b/i, /\bfractur/i, /\bcracked\b/i] },
        { tier: 'same_day', id: 'out_of_place', tick: 'A shoulder out of place or slipping out', label: 'a joint out of place', patterns: [/\bout of place\b/i, /\bdislocat/i, /\bpopped out\b/i] },
        { tier: 'same_day', id: 'fever', tick: 'Fever or feeling generally unwell', label: 'fever', patterns: [/\bfever\b/i] },
        { tier: 'same_day', id: 'arm_weakness', tick: 'Weakness in an arm', label: 'weakness in an arm', patterns: [/\b(arm|arms)\b.*\bweak/i, /\bweak\b.*\b(arm|arms)\b/i] },
        { tier: 'same_day', id: 'unsteady', tick: 'Dizzy or unsteady', label: 'feeling unsteady or dizzy', patterns: [/\bunsteady\b/i, /\bdizz/i] },
        { tier: 'urgent', id: 'numbness', tick: 'Numbness or pins and needles in an arm or hand', label: 'numbness or pins and needles', patterns: [/\bnumb/i, /\bpins and needles\b/i, /\btingl/i] },
        { tier: 'urgent', id: 'raise_arm', tick: 'Cannot raise your arm', label: 'being unable to raise your arm', patterns: [/\b(can'?t|cannot|unable to) (lift|raise)\b/i] },
        { tier: 'urgent', id: 'lump', tick: 'A lump or swelling', label: 'a lump or swelling', patterns: [/\blump\b/i, /\bswell/i, /\bswollen\b/i] },
        { tier: 'urgent', id: 'night', tick: 'Pain at night that wakes you', label: 'pain at night', patterns: [/\bnight pain\b/i, /\bwakes? me\b/i, /\bkeeps? me up\b/i] },
        { tier: 'see_physio', label: 'a shoulder slipping out', patterns: [/\bslips? out\b/i, /\bgives? way\b/i] },
    ];

    // Unvalidated: assembled from pain-monitoring and yardage-progression sources
    // that were never tested on this problem.
    const SORENESS = [
        { id: 'green', label: 'No pain, or a mild ache gone by the end of warm-up', response: 'Continue, and keep increases gradual.' },
        { id: 'amber', label: 'Pain lasts into warm-up, for over an hour after swimming, or into the next day', response: 'Repeat rather than progress. Cut distance, remove paddles and vary your strokes.' },
        { id: 'red_amber', label: 'Getting worse week on week', response: 'Stop that session and reduce. Arrange a physiotherapist review.' },
        { id: 'refer', label: 'No improvement over several weeks', response: 'Arrange a physiotherapist or doctor review before building further.' },
    ];
    const SORENESS_NOTE = 'These soreness bands are unvalidated: no study has tested them on swimmers\' shoulders.';

    const CONDITION_TERMS = /\b(impingement|tendin(itis|osis|opathy)|tendon(itis|osis)|bursitis|rotator cuff|labr(al|um)|slap (tear|lesion)|capsulitis|frozen shoulder|dislocation|subluxation|osteo\w*|arthritis|sciatica|hernia\w*|slipped disc|radiculopathy|myelopathy|stenosis|neuropathy|pneumonia|heart attack|angina|pulmonary (o)?edema|cancer|tumou?r|fracture|torn|muscle tear|swimmer'?s shoulder|strain(ed)? (muscle|tendon)|diagnos\w*)\b/i;

    function containsConditionName(text) {
        return CONDITION_TERMS.test(String(text || ''));
    }

    // Optional. A tick adds a reminder and tells the AI; it blocks nothing.
    const TICK_LIST = SYMPTOM_NOTES.filter(n => n.tick).map(n => ({ id: n.id, label: n.tick }));

    // A reminder only. It never stops a swimmer logging or getting guidance.
    function noticeFor(text, ticked = []) {
        const hits = SYMPTOM_NOTES.filter(n => ticked.includes(n.id) || n.patterns.some(p => p.test(String(text || ''))));
        if (!hits.length) return null;
        const top = hits.reduce((a, b) => (TIERS[b.tier].rank < TIERS[a.tier].rank ? b : a));
        return { label: top.label, action: TIERS[top.tier].action };
    }

    root.CrossingInjuryRules = {
        OPEN_TO, DISCLAIMER, TICK_LIST, SORENESS, SORENESS_NOTE, containsConditionName, noticeFor,
    };
})(globalThis);
