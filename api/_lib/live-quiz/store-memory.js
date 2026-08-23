// In-memory store — tests and scripts/live-quiz-dev.mjs. Same contract as
// store-supabase.js; never touches the network.
import { FIXTURE_EVENT, FIXTURE_QUESTIONS, FIXTURE_USERS } from './fixture.js';

let seq = 0;
const uid = () => `mem-${++seq}`;

export function createMemoryStore({ seed = true } = {}) {
  const db = { events: [], questions: [], participants: [], answers: [], profiles: [], analytics: [] };

  if (seed) {
    const ev = { id: uid(), created_at: new Date().toISOString(), ...FIXTURE_EVENT };
    db.events.push(ev);
    for (const q of FIXTURE_QUESTIONS) db.questions.push({ id: uid(), event_id: ev.id, ...q });
    for (const u of Object.values(FIXTURE_USERS)) db.profiles.push({ ...u });
  }

  return {
    db,
    async getEventBySlug(slug) { return db.events.find((e) => e.slug === slug) || null; },
    async createEvent(data) { const ev = { id: uid(), created_at: new Date().toISOString(), ...data }; db.events.push(ev); return ev; },
    async updateEvent(id, patch) { const ev = db.events.find((e) => e.id === id); Object.assign(ev, patch); return ev; },
    async listQuestions(eventId) {
      return db.questions.filter((q) => q.event_id === eventId).sort((a, b) => a.sort_order - b.sort_order).map((q) => ({ ...q }));
    },
    async upsertQuestion(q) {
      const i = db.questions.findIndex((x) => x.id === q.id);
      if (i >= 0) { db.questions[i] = { ...db.questions[i], ...q }; return db.questions[i]; }
      const row = { ...q, id: uid() }; db.questions.push(row); return row;
    },
    async deleteQuestion(eventId, id) { db.questions = db.questions.filter((q) => !(q.event_id === eventId && q.id === id)); },
    async createAuthUser({ email, password, full_name }) {
      const ex = db.profiles.find((p) => p.email === email);
      if (ex) return { id: ex.id, existed: true };
      const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
      db.profiles.push({ id, email, full_name, display_name: '', is_admin: false, created_at: new Date().toISOString(), _password: password });
      return { id, existed: false };
    },
    async upsertProfile(id, patch) { const p = db.profiles.find((x) => x.id === id); if (p) Object.assign(p, patch); else db.profiles.push({ id, ...patch }); },
    async getProfile(userId) { return db.profiles.find((p) => p.id === userId) || null; },
    async getParticipant(eventId, userId) { return db.participants.find((p) => p.event_id === eventId && p.user_id === userId) || null; },
    async createParticipant(eventId, userId, at) {
      const existing = db.participants.find((p) => p.event_id === eventId && p.user_id === userId);
      if (existing) return existing; // unique(event_id,user_id)
      const row = { id: uid(), event_id: eventId, user_id: userId, joined_at: at.toISOString(), total_score: 0, answered_count: 0, total_response_ms: 0 };
      db.participants.push(row); return row;
    },
    async listParticipants(eventId) {
      return db.participants.filter((p) => p.event_id === eventId).map((p) => {
        const prof = db.profiles.find((x) => x.id === p.user_id) || {};
        return { ...p, full_name: prof.full_name, display_name: prof.display_name };
      });
    },
    async setParticipantTotals(id, t) { Object.assign(db.participants.find((p) => p.id === id), t); },
    async listAnswers(participantId) { return db.answers.filter((a) => a.participant_id === participantId).map((a) => ({ ...a })); },
    async getAnswer(participantId, questionId) { return db.answers.find((a) => a.participant_id === participantId && a.question_id === questionId) || null; },
    async createServedAnswer(participantId, questionId, at) {
      const ex = db.answers.find((a) => a.participant_id === participantId && a.question_id === questionId);
      if (ex) return ex; // unique(participant_id,question_id)
      const row = { id: uid(), participant_id: participantId, question_id: questionId, served_at: at.toISOString(), selected_answer: null, is_correct: null, response_ms: null, points: 0, is_late: false, answered_at: null };
      db.answers.push(row); return row;
    },
    async recordAnswer(id, patch) {
      const a = db.answers.find((x) => x.id === id);
      if (!a || a.selected_answer != null) return null;
      Object.assign(a, patch, { answered_at: patch.answered_at.toISOString() }); return a;
    },
    async resetEvent(eventId) {
      const ps = db.participants.filter((p) => p.event_id === eventId).map((p) => p.id);
      const before = db.answers.length;
      db.answers = db.answers.filter((a) => !ps.includes(a.participant_id));
      db.participants = db.participants.filter((p) => p.event_id !== eventId);
      return { participants: ps.length, answers: before - db.answers.length };
    },
    async logAnalytics(event_name, user_id, properties) { db.analytics.push({ event_name, user_id, properties, created_at: new Date().toISOString() }); },
  };
}
