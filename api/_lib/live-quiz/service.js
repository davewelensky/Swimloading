// Live quiz service — all game rules live here, behind a pluggable store so
// the same code runs against Supabase (production) and an in-memory store
// (tests + scripts/live-quiz-dev.mjs). Nothing in here trusts the client
// for anything but "which letter did you tap".

import {
  scoreAnswer, isLate, normaliseAnswer, rankParticipants, publicName, toPublicRow,
} from './scoring.js';

export const STATUSES = ['draft', 'open', 'live', 'finished'];
export const MIDWAY_AFTER = 3;       // show rank to the player after this many answers
export const LEADERBOARD_SIZE = 10;

export class QuizError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const PUBLIC_EVENT_FIELDS = ['id', 'slug', 'name', 'intro', 'prize', 'status', 'is_active', 'starts_at'];
const pickEvent = (e) => Object.fromEntries(PUBLIC_EVENT_FIELDS.map((k) => [k, e[k] ?? null]));

export function createService(store, { now = () => new Date() } = {}) {
  async function requireEvent(slug) {
    const ev = await store.getEventBySlug(slug);
    if (!ev) throw new QuizError(404, 'event_not_found');
    return ev;
  }

  async function requireActiveEvent(slug) {
    const ev = await requireEvent(slug);
    if (!ev.is_active) throw new QuizError(403, 'event_inactive', 'This challenge is not active.');
    return ev;
  }

  async function requireAdmin(userId) {
    if (!userId) throw new QuizError(401, 'not_authenticated');
    const p = await store.getProfile(userId);
    if (!p || !p.is_admin) throw new QuizError(403, 'admin_only');
    return p;
  }

  async function rankedParticipants(eventId) {
    const rows = await store.listParticipants(eventId);
    return rankParticipants(rows.map((r) => ({ ...r, name: publicName(r) })));
  }

  async function recomputeParticipant(participantId) {
    const answers = await store.listAnswers(participantId);
    const answered = answers.filter((a) => a.selected_answer != null);
    const total = answered.reduce((s, a) => s + (a.points || 0), 0);
    const ms = answered.reduce((s, a) => s + (a.response_ms || 0), 0);
    await store.setParticipantTotals(participantId, {
      total_score: total, answered_count: answered.length, total_response_ms: ms,
    });
    return { total_score: total, answered_count: answered.length };
  }

  // ── Public (unauthenticated) ─────────────────────────────────────────
  async function getPublicState(slug) {
    const ev = await requireEvent(slug);
    const questions = await store.listQuestions(ev.id);
    const ranked = await rankedParticipants(ev.id);
    const finished = ranked.filter((r) => r.answered_count >= questions.length).length;
    const midway = ranked.some((r) => r.answered_count >= MIDWAY_AFTER);
    const showBoard = ev.status === 'finished' || (ev.status === 'live' && midway);
    return {
      event: pickEvent(ev),
      question_count: questions.length,
      player_count: ranked.length,
      finished_count: finished,
      leaderboard: showBoard ? ranked.slice(0, LEADERBOARD_SIZE).map(toPublicRow) : [],
      server_time: now().toISOString(),
    };
  }

  async function getPublicLeaderboard(slug) {
    const ev = await requireEvent(slug);
    const ranked = await rankedParticipants(ev.id);
    return ranked.slice(0, LEADERBOARD_SIZE).map(toPublicRow);
  }

  // ── Fast-lane sign-up (event arrivals only) ──────────────────────────
  // One screen: names, email, password, one consent tick. The account is a
  // real SwimLoading account, created email-confirmed so nobody at the dinner
  // is stuck hunting for a verification mail (52 normal sign-ups have died
  // at that step). Full profile is collected later by the app's own
  // incomplete-profile banner. Normal /app sign-up is untouched.
  async function signup(slug, { first_name, last_name, email, password, consent } = {}) {
    const ev = await requireActiveEvent(slug);
    if (!['open', 'live'].includes(ev.status)) throw new QuizError(403, 'registration_closed', 'Registration is not open.');
    const first = String(first_name || '').trim(), last = String(last_name || '').trim();
    const mail = String(email || '').trim().toLowerCase();
    if (!first || !last) throw new QuizError(400, 'name_required', 'Please enter your first and last name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new QuizError(400, 'bad_email', 'Please enter a valid email address.');
    if (String(password || '').length < 6) throw new QuizError(400, 'weak_password', 'Password must be at least 6 characters.');
    if (consent !== true) throw new QuizError(400, 'consent_required', 'Please accept the terms to continue.');
    const fullName = `${first} ${last}`;
    const created = await store.createAuthUser({ email: mail, password, full_name: fullName });
    if (created.existed) throw new QuizError(409, 'account_exists', 'You already have a SwimLoading account — sign in instead.');
    const at = now().toISOString();
    await store.upsertProfile(created.id, {
      email: mail, full_name: fullName, display_name: first,
      terms_accepted_at: at, privacy_accepted_at: at,
    });
    await store.logAnalytics('live_quiz_signup', created.id, { event: ev.slug });
    return { ok: true, user_id: created.id };
  }

  // ── Player ───────────────────────────────────────────────────────────
  async function join(slug, userId) {
    if (!userId) throw new QuizError(401, 'not_authenticated');
    const ev = await requireActiveEvent(slug);
    const existing = await store.getParticipant(ev.id, userId);
    if (existing) return { participant: existing, created: false };
    if (!['open', 'live'].includes(ev.status)) {
      throw new QuizError(403, 'registration_closed', 'Registration is not open.');
    }
    const participant = await store.createParticipant(ev.id, userId, now());
    const profile = await store.getProfile(userId);
    const createdAt = profile?.created_at ? new Date(profile.created_at) : null;
    const newMember = createdAt ? (now() - createdAt) < 24 * 3600 * 1000 : null;
    await store.logAnalytics('live_quiz_joined', userId, {
      event: ev.slug, new_member: newMember,
    });
    return { participant, created: true };
  }

  async function me(slug, userId) {
    if (!userId) throw new QuizError(401, 'not_authenticated');
    const ev = await requireEvent(slug);
    const questions = await store.listQuestions(ev.id);
    const p = await store.getParticipant(ev.id, userId);
    if (!p) return { joined: false, event: pickEvent(ev), question_count: questions.length };
    const ranked = await rankedParticipants(ev.id);
    const mine = ranked.find((r) => r.id === p.id);
    return {
      joined: true,
      event: pickEvent(ev),
      question_count: questions.length,
      answered_count: p.answered_count || 0,
      total_score: p.total_score || 0,
      rank: mine?.rank ?? null,
      player_count: ranked.length,
      done: (p.answered_count || 0) >= questions.length,
    };
  }

  /** Serve the next unanswered question. Idempotent: a refresh re-serves the
   *  same question with the ORIGINAL served_at, so the clock keeps running. */
  async function nextQuestion(slug, userId) {
    if (!userId) throw new QuizError(401, 'not_authenticated');
    const ev = await requireActiveEvent(slug);
    if (ev.status !== 'live') throw new QuizError(409, 'not_live', 'The quiz has not started.');
    const p = await store.getParticipant(ev.id, userId);
    if (!p) throw new QuizError(403, 'not_joined');
    const questions = await store.listQuestions(ev.id);
    const answers = await store.listAnswers(p.id);
    const answeredIds = new Set(answers.filter((a) => a.selected_answer != null).map((a) => a.question_id));
    const idx = questions.findIndex((q) => !answeredIds.has(q.id));
    if (idx === -1) return { done: true, question_count: questions.length };
    const q = questions[idx];
    let served = answers.find((a) => a.question_id === q.id);
    if (!served) served = await store.createServedAnswer(p.id, q.id, now());
    return {
      done: false,
      index: idx + 1,
      question_count: questions.length,
      served_at: new Date(served.served_at).toISOString(),
      server_time: now().toISOString(),
      question: {
        id: q.id, question: q.question,
        answer_a: q.answer_a, answer_b: q.answer_b, answer_c: q.answer_c, answer_d: q.answer_d,
        time_limit_seconds: q.time_limit_seconds,
      },
    };
  }

  async function answer(slug, userId, questionId, rawSelected) {
    if (!userId) throw new QuizError(401, 'not_authenticated');
    const ev = await requireActiveEvent(slug);
    if (ev.status !== 'live') throw new QuizError(409, 'not_live');
    const p = await store.getParticipant(ev.id, userId);
    if (!p) throw new QuizError(403, 'not_joined');
    const questions = await store.listQuestions(ev.id);
    const q = questions.find((x) => x.id === questionId);
    if (!q) throw new QuizError(404, 'question_not_found');
    const selected = normaliseAnswer(rawSelected);
    if (!selected) throw new QuizError(400, 'bad_answer');

    const served = await store.getAnswer(p.id, q.id);
    if (!served) throw new QuizError(409, 'not_served', 'Question was never served.');
    if (served.selected_answer != null) throw new QuizError(409, 'already_answered');

    const responseMs = Math.max(0, now() - new Date(served.served_at));
    const correct = selected === q.correct_answer;
    const late = isLate(responseMs, q.time_limit_seconds);
    const points = scoreAnswer({ isCorrect: correct, responseMs, timeLimitSeconds: q.time_limit_seconds });

    // Conditional update: only lands if still unanswered (guards a double
    // submit racing the check above — the store enforces selected_answer IS NULL).
    const updated = await store.recordAnswer(served.id, {
      selected_answer: selected, is_correct: correct, response_ms: responseMs,
      points, is_late: late, answered_at: now(),
    });
    if (!updated) throw new QuizError(409, 'already_answered');

    const totals = await recomputeParticipant(p.id);
    const out = {
      is_correct: correct, is_late: late, points, correct_answer: q.correct_answer,
      explanation: q.explanation || null, response_ms: responseMs,
      total_score: totals.total_score, answered_count: totals.answered_count,
      question_count: questions.length, done: totals.answered_count >= questions.length,
    };
    if (totals.answered_count === MIDWAY_AFTER || out.done) {
      const ranked = await rankedParticipants(ev.id);
      out.rank = ranked.find((r) => r.id === p.id)?.rank ?? null;
      out.player_count = ranked.length;
    }
    if (out.done) {
      await store.logAnalytics('live_quiz_completed', userId, { event: ev.slug, score: totals.total_score });
    }
    return out;
  }

  // ── Admin ────────────────────────────────────────────────────────────
  async function adminGetEvent(userId, slug) {
    await requireAdmin(userId);
    const ev = await requireEvent(slug);
    const questions = await store.listQuestions(ev.id);
    const ranked = await rankedParticipants(ev.id);
    return {
      event: ev, questions,
      participants: ranked.map((r) => ({
        id: r.id, rank: r.rank, name: r.name, total_score: r.total_score,
        answered_count: r.answered_count, joined_at: r.joined_at,
      })),
    };
  }

  async function adminSaveEvent(userId, patch) {
    await requireAdmin(userId);
    const allowed = ['slug', 'name', 'intro', 'prize', 'starts_at'];
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
    if (patch.id) return store.updateEvent(patch.id, clean);
    if (!clean.slug || !clean.name) throw new QuizError(400, 'slug_and_name_required');
    return store.createEvent({ ...clean, status: 'draft', is_active: false });
  }

  async function adminSetStatus(userId, slug, status) {
    await requireAdmin(userId);
    if (!STATUSES.includes(status)) throw new QuizError(400, 'bad_status');
    const ev = await requireEvent(slug);
    return store.updateEvent(ev.id, { status });
  }

  async function adminSetActive(userId, slug, isActive) {
    await requireAdmin(userId);
    const ev = await requireEvent(slug);
    return store.updateEvent(ev.id, { is_active: !!isActive });
  }

  async function adminSaveQuestion(userId, slug, q) {
    await requireAdmin(userId);
    const ev = await requireEvent(slug);
    const correct = normaliseAnswer(q.correct_answer);
    if (!q.question || !q.answer_a || !q.answer_b || !q.answer_c || !q.answer_d || !correct) {
      throw new QuizError(400, 'question_incomplete');
    }
    const limit = Math.min(60, Math.max(5, parseInt(q.time_limit_seconds, 10) || 15));
    return store.upsertQuestion({
      id: q.id || null, event_id: ev.id, question: q.question,
      answer_a: q.answer_a, answer_b: q.answer_b, answer_c: q.answer_c, answer_d: q.answer_d,
      correct_answer: correct, time_limit_seconds: limit,
      sort_order: Number.isFinite(+q.sort_order) ? +q.sort_order : 999,
      explanation: q.explanation || null,
    });
  }

  async function adminDeleteQuestion(userId, slug, questionId) {
    await requireAdmin(userId);
    const ev = await requireEvent(slug);
    await store.deleteQuestion(ev.id, questionId);
    return { ok: true };
  }

  async function adminReorderQuestions(userId, slug, orderedIds) {
    await requireAdmin(userId);
    const ev = await requireEvent(slug);
    const qs = await store.listQuestions(ev.id);
    for (const [i, id] of orderedIds.entries()) {
      const q = qs.find((x) => x.id === id);
      if (q) await store.upsertQuestion({ ...q, sort_order: i + 1 });
    }
    return { ok: true };
  }

  /** Wipe participants + answers (test runs before the real evening). */
  async function adminReset(userId, slug) {
    await requireAdmin(userId);
    const ev = await requireEvent(slug);
    const removed = await store.resetEvent(ev.id);
    await store.updateEvent(ev.id, { status: 'draft' });
    return { ok: true, removed };
  }

  return {
    getPublicState, getPublicLeaderboard, signup, join, me, nextQuestion, answer,
    adminGetEvent, adminSaveEvent, adminSetStatus, adminSetActive,
    adminSaveQuestion, adminDeleteQuestion, adminReorderQuestions, adminReset,
  };
}
