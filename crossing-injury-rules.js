// Fixed safety rules for the injury section on /crossing-prep.
// Loaded by the page as a plain script and imported by
// api/_lib/crossing-injury/guidance.js, so browser and server run the same list.
//
// These rules are code, not AI. They run before any training guidance, and a
// swimmer who ticks one is sent to a professional without the AI being called.
//
// The list came from general-patient NHS sources and has NOT had clinical review.
// `CLINICAL_REVIEW.complete` keeps the feature closed until a clinician signs off.
// Change wording here, then regenerate docs/injury-red-flags-for-clinical-review.md.
// Symptoms only: nothing in this file may name a condition.

(function (root) {
    const CLINICAL_REVIEW = { complete: false, reviewedBy: null, reviewedOn: null };

    // Highest priority first.
    const TIERS = {
        emergency: {
            rank: 0,
            title: 'Call emergency services now',
            action: 'Call your local emergency number. Do not drive yourself.',
        },
        same_day: {
            rank: 1,
            title: 'Get emergency assessment today',
            action: 'Go to an emergency department or see a doctor today. Do not swim until you have been assessed.',
        },
        urgent: {
            rank: 2,
            title: 'Get medical advice as soon as possible',
            action: 'Speak to a doctor as soon as you can. Hold off on training until you have.',
        },
        see_physio: {
            rank: 3,
            title: 'See a physiotherapist or doctor',
            action: 'Book a physiotherapist or doctor before building your training any further.',
        },
    };

    const RED_FLAGS = [
        { id: 'chest_pain', tier: 'emergency', label: 'Chest pain that is tight or squeezing, or spreading to your arms, neck or jaw', patterns: [/\bchest\b/i] },
        { id: 'severe_breathing', tier: 'emergency', label: 'Severe difficulty breathing', patterns: [/\b(can'?t|cannot|struggling to|difficulty) breath/i, /\bshort of breath\b/i] },
        { id: 'colour_change', tier: 'emergency', label: 'Pale, blue or grey skin or lips', patterns: [/\b(blue|grey|gray) (lips|skin)\b/i] },
        { id: 'collapse', tier: 'emergency', label: 'You have collapsed', patterns: [/\bcollaps/i, /\bpassed out\b/i, /\bblacked out\b/i] },

        { id: 'bone_damage', tier: 'same_day', label: 'After an injury, you think a bone may be damaged', patterns: [/\bbroken?\b/i, /\bfractur/i, /\bcracked\b/i] },
        { id: 'out_of_place', tier: 'same_day', label: 'After an injury, a shoulder looks out of place and has not gone back', patterns: [/\bout of place\b/i, /\bdislocat/i, /\bpopped out\b/i] },
        { id: 'red_skin_fever', tier: 'same_day', label: 'Red skin over the joint with fever or feeling generally unwell', patterns: [/\bfever\b/i, /\bred and (hot|swollen)\b/i] },
        { id: 'major_arm_weakness', tier: 'same_day', label: 'Significant weakness in one or both arms, with neck or arm pain', patterns: [/\b(arm|arms)\b.*\bweak/i, /\bweak\b.*\b(arm|arms)\b/i] },
        { id: 'both_arm_nerve_pain', tier: 'same_day', label: 'Nerve pain increasing in both arms together', patterns: [/\bnerve pain\b/i, /\bboth arms\b/i] },
        { id: 'unsteady', tier: 'same_day', label: 'Unsteady on your feet, with neck or arm pain', patterns: [/\bunsteady\b/i, /\bdizz/i] },

        { id: 'hand_clumsy', tier: 'urgent', label: 'Your hands are getting clumsier', patterns: [/\bclums/i] },
        { id: 'arm_numbness', tier: 'urgent', label: 'Worsening numbness, pins and needles or weakness in one or both arms', patterns: [/\bnumb/i, /\bpins and needles\b/i, /\btingl/i] },
        { id: 'balance', tier: 'urgent', label: 'Balance or walking problems since neck pain began', patterns: [/\bbalance\b/i, /\btrouble walking\b/i] },
        { id: 'sudden_weakness', tier: 'urgent', label: 'Sudden weakness in an arm or shoulder', patterns: [/\bsudden\w*\b.*\bweak/i, /\blost (my )?strength\b/i] },
        { id: 'cannot_raise_arm', tier: 'urgent', label: 'Suddenly unable to raise your arm after an injury', patterns: [/\b(can'?t|cannot|unable to) (lift|raise)\b/i] },
        { id: 'lump_or_shape', tier: 'urgent', label: 'A lump, swelling or unexplained change in shape', patterns: [/\blump\b/i, /\bswell/i, /\bswollen\b/i, /\bdeform/i] },
        { id: 'night_pain', tier: 'urgent', label: 'Pain at night', patterns: [/\bnight pain\b/i, /\bat night\b/i, /\bwakes? me\b/i, /\bkeeps? me up\b/i] },
        { id: 'relevant_history', tier: 'urgent', label: 'New shoulder pain and a serious past illness a doctor should know about', patterns: [] },
        { id: 'escalating', tier: 'urgent', label: 'Pain getting worse even though you have cut back training', patterns: [/\b(worse|worsening)\b.*\b(cut|reduc|rest)/i] },
        { id: 'widespread', tier: 'urgent', label: 'Aching and stiffness in several areas beyond the shoulder', patterns: [/\b(all over|everywhere)\b/i] },

        { id: 'slips_out', tier: 'see_physio', label: 'Your shoulder partly or completely slips out', patterns: [/\bslips? out\b/i, /\bgives? way\b/i] },
        { id: 'neck_weeks', tier: 'see_physio', label: 'Neck pain or stiffness that has not gone away after a few weeks', patterns: [] },
        { id: 'no_improvement', tier: 'see_physio', label: 'No improvement after 6 to 12 weeks of exercise', patterns: [] },
    ];

    const IN_WATER_NOTE = 'In the water: stop and alert your escort or crew for any chest symptoms, new arm weakness or numbness, or unexpected breathlessness. Breathlessness with a cough or pink, frothy or bloody sputum means leaving the water.';

    // Unvalidated: assembled from pain-monitoring and yardage-progression sources
    // that were never tested on this problem. A numeric pain band was left out
    // for the clinical reviewer to set or drop.
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

    function assess({ flags = [], text = '', confirmedAbsent = [] } = {}) {
        const ticked = new Set(flags);
        const absent = new Set(confirmedAbsent);
        const matched = RED_FLAGS.filter(f => ticked.has(f.id));
        const needsConfirm = RED_FLAGS
            .filter(f => !ticked.has(f.id) && !absent.has(f.id) && f.patterns.some(p => p.test(text)))
            .map(f => f.id);

        let tier = null;
        for (const f of matched) {
            if (tier === null || TIERS[f.tier].rank < TIERS[tier].rank) tier = f.tier;
        }
        return { tier, flags: matched.map(f => f.id), needsConfirm };
    }

    root.CrossingInjuryRules = {
        CLINICAL_REVIEW, TIERS, RED_FLAGS, IN_WATER_NOTE, SORENESS, SORENESS_NOTE,
        containsConditionName, assess,
    };
})(globalThis);
