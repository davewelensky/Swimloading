// Seed data for local runs and tests. Same 6 questions as the migration's
// seed — keep sql/2026-08-23_live-quiz.sql in step if you edit these.
// Fun set agreed with Dave 23 Aug 2026: relatable cold-water questions, one
// safe factual answer each, joke distractors. No history, no ice swimming.
// Editable in /admin/live-quiz.

export const FIXTURE_EVENT = {
  slug: 'cldsa2026',
  name: 'CLDSA Awards Challenge',
  intro: 'How well do you know your open water? Six questions. One winner.',
  prize: 'Win a personalised SwimLoading Open Water Performance Assessment',
  status: 'open',
  is_active: true,
  starts_at: '2026-09-12T17:00:00Z',
};

export const FIXTURE_QUESTIONS = [
  {
    question: "\"The claw\" \u2014 when your hands stop working mid-swim \u2014 is caused by\u2026",
    answer_a: "Too much coffee", answer_b: "Cold shutting down the nerves and muscles in your forearms", answer_c: "Gripping the tow float", answer_d: "Judging other people's stroke",
    correct_answer: 'B', time_limit_seconds: 30, sort_order: 1,
    explanation: "Cold slows the nerves and muscles in your forearms. Once the claw arrives, it is time to head in.",
  },
  {
    question: "\"Afterdrop\" is\u2026",
    answer_a: "The dip in your Strava kudos", answer_b: "The moment the coffee van closes", answer_c: "Your core temperature carrying on falling after you get out", answer_d: "The walk back to the car in a wet costume",
    correct_answer: 'C', time_limit_seconds: 30, sort_order: 2,
    explanation: "Your core keeps cooling for a while after you leave the water \u2014 which is why you feel worse ten minutes later.",
  },
  {
    question: "Which current keeps the Atlantic side of Cape Town so cold?",
    answer_a: "The Benguela", answer_b: "The Agulhas", answer_c: "The Sea Point Promenade current", answer_d: "Load shedding",
    correct_answer: 'A', time_limit_seconds: 30, sort_order: 3,
    explanation: "The cold Benguela current, plus upwelling along the west coast.",
  },
  {
    question: "After a cold swim, the right move is\u2026",
    answer_a: "Straight into a hot shower", answer_b: "One more lap to warm up", answer_c: "Stand around discussing the temperature", answer_d: "Get dry and dressed fast, top half first, then a warm drink",
    correct_answer: 'D', time_limit_seconds: 30, sort_order: 4,
    explanation: "Dry off, dress quickly from the top down, get out of the wind, warm drink. Hot showers can make afterdrop worse.",
  },
  {
    question: "Robben Island to Blouberg is roughly\u2026",
    answer_a: "3.4 km", answer_b: "7.4 km", answer_c: "12.4 km", answer_d: "Far enough, thanks",
    correct_answer: 'B', time_limit_seconds: 30, sort_order: 5,
    explanation: "About 7.4 km of open Atlantic \u2014 short on paper, not in the water.",
  },
  {
    question: "A brightly coloured tow float is mainly for\u2026",
    answer_a: "Keeping your car keys dry", answer_b: "Scaring off seals", answer_c: "Being seen by boats and safety crew", answer_d: "Floating home when you've had enough",
    correct_answer: 'C', time_limit_seconds: 30, sort_order: 6,
    explanation: "Visibility. Keys stay dry as a bonus, and it is something to hold if you need a breather.",
  },
];

/** Users for the local harness. Never real accounts. */
export const FIXTURE_USERS = {
  admin: { id: '00000000-0000-4000-8000-000000000001', full_name: 'Dave Welensky', email: 'admin@example.test', is_admin: true, created_at: '2026-01-01T00:00:00Z' },
  alice: { id: '00000000-0000-4000-8000-000000000002', full_name: 'Alice Atlantic', email: 'alice@example.test', is_admin: false, created_at: '2026-01-01T00:00:00Z' },
  bob:   { id: '00000000-0000-4000-8000-000000000003', full_name: 'Bob Benguela', email: 'bob@example.test', is_admin: false, created_at: '2026-09-12T18:00:00Z' },
  carol: { id: '00000000-0000-4000-8000-000000000004', display_name: 'carol', email: 'carol@example.test', is_admin: false, created_at: '2026-02-01T00:00:00Z' },
};
