// Tool schemas + prompts for the Aquasharks Lab report generator.
// Extraction (EO PDF -> normalized JSON) and interpretation (normalized JSON -> coaching) are
// deliberately separate calls: the first must never coach, the second must never measure.

const nullableNum = { type: ['number', 'null'] };
const conf = { type: 'string', enum: ['high', 'medium', 'low'] };

export const METRIC_KEYS = [
  'propulsion_pct', 'downward_force_pct', 'upward_force_pct', 'leftward_force_pct', 'rightward_force_pct', 'hand_drag_pct',
  'left_impulse', 'right_impulse', 'stroke_rate', 'stroke_rate_left', 'stroke_rate_right', 'distance_per_stroke_m',
  'propulsion_efficiency_pct', 'avg_pps_w', 'total_work_kj', 'time_s',
  'left_glide_pct', 'left_pull_pct', 'left_recovery_pct', 'right_glide_pct', 'right_pull_pct', 'right_recovery_pct',
  'left_glide_s', 'left_pull_s', 'left_recovery_s', 'right_glide_s', 'right_pull_s', 'right_recovery_s',
];

export const OBS_KEYS = [
  'stroke_rate_force', 'power_distribution', 'left_stroke_path', 'right_stroke_path', 'path_consistency',
  'stroke_phase_timing', 'propulsive_force_profile', 'vertical_lateral_forces', 'fixes_drills', 'summary_next_steps',
];

export const extractTool = {
  name: 'record_eo_extraction',
  description: 'Record what the EO Labs SwimBETTER report actually contains. Use null for anything not printed in the report.',
  input_schema: {
    type: 'object',
    required: ['metrics', 'confidence', 'eo_observations', 'section_pages', 'missing'],
    properties: {
      swimmer_found: { type: 'object', properties: { name: { type: ['string', 'null'] }, session_date: { type: ['string', 'null'], description: 'YYYY-MM-DD only if printed' }, analysis_type: { type: ['string', 'null'] } } },
      metrics: { type: 'object', properties: Object.fromEntries(METRIC_KEYS.map(k => [k, nullableNum])) },
      confidence: { type: 'object', description: 'Per metric you filled: high = printed as text/label, medium = read from chart labels or ambiguous colour/column, low = uncertain', properties: Object.fromEntries(METRIC_KEYS.map(k => [k, conf])) },
      source_notes: { type: 'object', description: 'Optional short note per metric explaining where it came from or an ambiguity', additionalProperties: { type: 'string' } },
      eo_observations: { type: 'object', description: 'EO\'s own sentences, copied verbatim, grouped by section. Empty array if the section is absent.', properties: Object.fromEntries(OBS_KEYS.map(k => [k, { type: 'array', items: { type: 'string' } }])) },
      single_stroke_examples: { type: 'array', description: 'Any single-stroke breakdown printed (e.g. "Stroke (1) Left"), kept apart from lap averages', items: { type: 'object', properties: { label: { type: 'string' }, glide_pct: nullableNum, pull_pct: nullableNum, recovery_pct: nullableNum, stroke_rate: nullableNum, note: { type: 'string' } } } },
      section_pages: { type: 'object', description: '1-based PDF page numbers where each section\'s chart/graphic appears. Empty array if none.', properties: Object.fromEntries(['stroke_rate_force', 'power_distribution', 'left_stroke_path', 'right_stroke_path', 'path_consistency', 'stroke_phase_timing', 'propulsive_force_profile', 'vertical_lateral_forces'].map(k => [k, { type: 'array', items: { type: 'integer' } }])) },
      missing: { type: 'array', items: { type: 'string' }, description: 'Human-readable list of expected data the report does not contain' },
    },
  },
};

export const EXTRACT_SYSTEM = `You extract data from an EO Labs SwimBETTER AI paddle-analysis PDF into structured fields.
You are a transcriber, not a coach.
- Record only values that are printed in the report (body text, chart labels, badges). Use null for everything else. Never estimate a number from the shape or height of a chart.
- Percent fields are plain numbers (32.6 not 0.326). Phase times are seconds.
- In EO charts orange is usually the LEFT arm and blue the RIGHT arm; if you rely on that to assign a value, mark it medium confidence and say so in source_notes.
- Lap averages and single-stroke breakdowns are different things. Put lap averages in the *_glide_pct/*_pull_pct fields and any single-stroke figure in single_stroke_examples. EO's narrative may quote a single stroke as if it were the arm's overall behaviour: do not copy it into the lap-average fields.
- Copy EO's observation sentences verbatim into eo_observations under the matching section. Do not paraphrase, merge, or add your own.
- List in "missing" every expected item the report does not give (e.g. distance per stroke, power, time).`;

const rec = {
  type: 'object',
  required: ['id', 'title', 'plain_language_explanation', 'why_it_matters', 'evidence', 'coach_cue', 'recommended_action'],
  properties: {
    id: { type: 'string' }, card_label: { type: 'string', description: 'Max 6 words, for the summary card' },
    title: { type: 'string' }, plain_language_explanation: { type: 'string' }, why_it_matters: { type: 'string', description: 'About 40 words max' },
    evidence: { type: 'array', items: { type: 'object', required: ['origin', 'text'], properties: { origin: { type: 'string', enum: ['eo_measured', 'eo_observation', 'aqua'] }, text: { type: 'string' } } } },
    coach_cue: { type: 'string' }, recommended_action: { type: 'string' },
    variants: { type: 'object', description: 'Optional per-swimmer-type rewrites of plain_language_explanation / why_it_matters / coach_cue', properties: { junior: { type: 'object' }, senior: { type: 'object' }, masters: { type: 'object' } } },
  },
};
const drill = { type: 'object', required: ['title', 'what', 'feel', 'why', 'origin'], properties: { title: { type: 'string' }, what: { type: 'string' }, feel: { type: 'string' }, why: { type: 'string' }, origin: { type: 'string', description: 'Which EO fix this comes from, or "Aqua Sharks coaching"' } } };

export const interpretTool = {
  name: 'record_interpretation',
  description: 'Record the Aqua Sharks coaching interpretation of the approved EO data.',
  input_schema: {
    type: 'object',
    required: ['strength', 'primary_focus', 'secondary_focus', 'watch_item_id', 'goal', 'free_speed_opportunity', 'stroke_cards', 'left_right', 'plan', 'next_session', 'retest_targets', 'priorities'],
    properties: {
      strength: rec,
      primary_focus: { ...rec, required: [...rec.required, 'headline', 'metric', 'metric_caption'], properties: { ...rec.properties, headline: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3, description: 'Three short uppercase lines, e.g. ["PUSH WATER","BACK","NOT DOWN"]' }, metric: { type: ['string', 'null'], description: 'Key from the metrics object this focus is measured by' }, metric_caption: { type: 'string' } } },
      secondary_focus: { type: 'array', maxItems: 2, items: rec },
      watch_item_id: { type: 'string', description: 'id of one of the secondary_focus items' },
      goal: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, variants: { type: 'object' } } },
      free_speed_opportunity: rec,
      stroke_cards: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object', required: ['id', 'label', 'status', 'saw', 'why', 'feel', 'evidence_ids'], properties: { id: { type: 'string', enum: ['catch', 'pull', 'power'] }, label: { type: 'string', enum: ['CATCH', 'PULL', 'POWER'] }, status: { type: 'string', enum: ['strong', 'watch', 'focus'] }, status_source: { type: 'string' }, saw: { type: 'string' }, why: { type: 'string' }, feel: { type: 'string' }, evidence_ids: { type: 'array', items: { type: 'string' } } } } },
      left_right: { type: 'object', required: ['headline_plain', 'note', 'rows'], properties: { headline_plain: { type: 'string' }, note: { type: 'string' }, rows: { type: 'array', items: { type: 'object', required: ['key', 'label', 'left', 'right', 'plain'], properties: { key: { type: 'string', enum: ['impulse', 'glide', 'pull', 'recovery', 'path'] }, label: { type: 'string' }, left: { type: 'string' }, right: { type: 'string' }, plain: { type: 'string' }, origin: { type: 'string' } } } } } },
      plan: { type: 'object', required: ['feel_it', 'build_it', 'hold_it'], properties: { feel_it: drill, build_it: drill, hold_it: drill } },
      next_session: { type: 'object', required: ['volume_note', 'blocks'], properties: { volume_note: { type: 'string' }, blocks: { type: 'array', items: { type: 'object', required: ['name', 'detail'], properties: { name: { type: 'string', enum: ['WARM UP', 'FEEL IT', 'BUILD IT', 'HOLD IT', 'TEST IT'] }, detail: { type: 'string' }, editable: { type: 'boolean' } } } } } },
      retest_targets: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, metric: { type: ['string', 'null'] }, title: { type: 'string' }, direction: { type: 'string', enum: ['lower', 'higher'] }, target_value: nullableNum, reference_note: { type: 'string' }, current_text: { type: 'string' }, target_text: { type: 'string' } } } },
      priorities: { type: 'array', items: { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' } } }, description: 'ids must match primary_focus.id and secondary_focus ids' },
    },
  },
};

export const INTERPRET_SYSTEM = `You are the Aqua Sharks Lab coaching layer. EO Labs measured the swim; you interpret it for the swimmer.
HARD RULES
- Use ONLY numbers that appear in the supplied EO data (metrics, EO observations) or the supplied coaching rules. Never invent, round into a new figure, or estimate a measurement. If a value is null, do not talk about it.
- Do not invent good/bad thresholds. A threshold or target number may be used only if it is in the supplied coaching rules; otherwise a retest target is a direction only (target_value null). Rules marked approved:false are references, not verdicts.
- Do not promise a specific speed improvement.
- Do not set volume or intensity from age. Session blocks are drafts the coach edits; keep distances modest and generic.
- Prioritise: exactly ONE primary_focus and at most TWO secondary_focus. Do not list every issue.
- Every recommendation needs evidence tagged by origin: eo_measured (a number from the data), eo_observation (an EO sentence), or aqua (your own coaching reasoning). Quote eo_observation text from the supplied sentences.
- Drills must come from EO's own recommended fixes where available, explained as WHAT TO DO / WHAT TO FEEL / WHY. No generic drill lists.
- Left/right differences: do not imply 50/50 symmetry is required. Orange = left, blue = right in EO charts. The leftward/rightward force percentages are whole-stroke force directions, NOT per-arm values.
- stroke_cards status is a DRAFT rating the coach will confirm; set status_source to "draft: pending coach approval".
- Plain language, short sentences, no emojis, no em dashes. Swimmer mode: junior = simple, fun but not childish, little jargon; senior = coaching-first with training targets; masters = coaching-first with full technical detail. Write the base text for the given mode and add variants only where the other modes need genuinely different wording.
- The report must answer: what am I doing well, what is costing me speed, what should I change, how do I train it, how will we know it improved.`;
