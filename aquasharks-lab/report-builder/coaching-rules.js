/* Aqua Sharks coaching rules (configurable).
   Nothing here is a universal threshold. Every rule is DRAFT until a coach approves it,
   and an unapproved rule never produces a good/bad label. Seeded from the analyst's
   language in an earlier Aquasharks Lab analyst report. */
window.AS_RULES = {
  status: 'draft',
  source: 'Seeded from the analyst language in an earlier Aquasharks Lab report. Pending coach approval.',
  metrics: {
    downward_force_pct:   { label: 'Downward force', unit: '%', dp: 1, direction: 'lower',  approved: false, reference: 'Below 25% was the analyst primary-focus target (earlier analyst report)' },
    propulsion_pct:       { label: 'Propulsion', unit: '%', dp: 1, direction: 'higher', approved: false, reference: null },
    hand_drag_pct:        { label: 'Hand drag', unit: '%', dp: 1, direction: 'lower',  approved: false, reference: '1.2% was called excellent (earlier analyst report)' },
    distance_per_stroke_m:{ label: 'Distance per stroke', unit: ' m', dp: 2, direction: 'higher', approved: false, reference: null },
    right_impulse:        { label: 'Right impulse', unit: '', dp: 2, direction: null, approved: false, reference: null },
    left_impulse:         { label: 'Left impulse', unit: '', dp: 2, direction: null, approved: false, reference: null }
  },
  /* Describe a change. Tone is 'neutral' unless the rule is approved and has a direction. */
  describeChange: function (key, prev, cur) {
    var r = this.metrics[key] || {};
    if (prev == null || cur == null) return null;
    var d = +(cur - prev).toFixed(r.dp != null ? r.dp : 1);
    var arrow = d > 0 ? '↑' : d < 0 ? '↓' : '→';
    var tone = 'neutral';
    if (r.approved && r.direction && d !== 0) tone = ((d < 0) === (r.direction === 'lower')) ? 'better' : 'worse';
    return { delta: d, arrow: arrow, tone: tone, ruleDraft: !r.approved };
  }
};
