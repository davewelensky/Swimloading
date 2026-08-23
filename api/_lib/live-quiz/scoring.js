// Live quiz scoring — pure functions, no I/O. Server-only: the client never
// sends a score, only the letter it picked. See test/live-quiz.test.js.

export const BASE_POINTS = 10;      // flat — Dave, 23 Aug 2026: "just 10 points per answer"
export const MAX_SPEED_BONUS = 0;   // no speed bonus; speed only breaks ties (rankParticipants)
// Network + render slack added to the time limit before an answer is "late".
export const LATE_GRACE_MS = 1500;

/**
 * score = 10 for a correct answer inside the time limit, 0 for wrong, late,
 * or missing. (Speed bonus is switched off via MAX_SPEED_BONUS = 0.)
 */
export function scoreAnswer({ isCorrect, responseMs, timeLimitSeconds }) {
  if (!isCorrect) return 0;
  const limitMs = Math.max(1, Number(timeLimitSeconds) || 0) * 1000;
  const elapsed = Math.max(0, Number(responseMs) || 0);
  if (elapsed > limitMs + LATE_GRACE_MS) return 0;
  const remaining = Math.max(0, limitMs - elapsed);
  return BASE_POINTS + Math.floor(MAX_SPEED_BONUS * remaining / limitMs);
}

export function isLate(responseMs, timeLimitSeconds) {
  const limitMs = Math.max(1, Number(timeLimitSeconds) || 0) * 1000;
  return Number(responseMs) > limitMs + LATE_GRACE_MS;
}

export const ANSWER_LETTERS = ['A', 'B', 'C', 'D'];

export function normaliseAnswer(raw) {
  const s = String(raw || '').trim().toUpperCase();
  return ANSWER_LETTERS.includes(s) ? s : null;
}

/**
 * Ranks participants: score desc, then fewest total response ms (faster
 * overall wins ties), then earliest join. Returns new array with `rank`.
 */
export function rankParticipants(rows) {
  const sorted = [...rows].sort((a, b) =>
    (b.total_score - a.total_score) ||
    ((a.total_response_ms ?? 0) - (b.total_response_ms ?? 0)) ||
    (String(a.joined_at || '').localeCompare(String(b.joined_at || '')))
  );
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
}

/**
 * Public display name: first name + last initial. Never an email.
 * "Dave Welensky" -> "Dave W." ; "dave" -> "Dave" ; null -> "Swimmer".
 */
export function publicName({ full_name, display_name } = {}) {
  const src = (full_name || display_name || '').trim();
  if (!src || src.includes('@')) return 'Swimmer';
  const parts = src.split(/\s+/);
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  if (parts.length === 1) return first;
  return `${first} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

/** Strip a participant row down to what the public screen may see. */
export function toPublicRow(r) {
  return { rank: r.rank, name: r.name, score: r.total_score, answered: r.answered_count ?? 0 };
}
