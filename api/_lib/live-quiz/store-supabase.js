// Supabase store — service-role PostgREST calls, same shape as the rest of
// /api (see api/strava/token-helper.js). Only ever runs server-side.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { 'Prefer': prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`supabase ${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const one = (rows) => (Array.isArray(rows) && rows.length ? rows[0] : null);
const enc = encodeURIComponent;

export function createSupabaseStore() {
  return {
    async getEventBySlug(slug) {
      return one(await rest(`live_quiz_events?slug=eq.${enc(slug)}&select=*&limit=1`));
    },
    async createEvent(data) {
      return one(await rest('live_quiz_events', { method: 'POST', body: data, prefer: 'return=representation' }));
    },
    async updateEvent(id, patch) {
      return one(await rest(`live_quiz_events?id=eq.${id}`, { method: 'PATCH', body: patch, prefer: 'return=representation' }));
    },
    async listQuestions(eventId) {
      return (await rest(`live_quiz_questions?event_id=eq.${eventId}&select=*&order=sort_order.asc,id.asc`)) || [];
    },
    async upsertQuestion(q) {
      const { id, ...data } = q;
      if (id) return one(await rest(`live_quiz_questions?id=eq.${id}`, { method: 'PATCH', body: data, prefer: 'return=representation' }));
      return one(await rest('live_quiz_questions', { method: 'POST', body: data, prefer: 'return=representation' }));
    },
    async deleteQuestion(eventId, id) {
      await rest(`live_quiz_questions?event_id=eq.${eventId}&id=eq.${id}`, { method: 'DELETE' });
    },
    async createAuthUser({ email, password, full_name }) {
      // GoTrue admin API — email_confirm:true so the profile trigger fires now.
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name, display_name: full_name.split(' ')[0], source: 'live_quiz' } }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 422 || /already|exists/i.test(data.msg || data.message || data.error_description || '')) return { id: null, existed: true };
      if (!res.ok) throw new Error(`auth admin create -> ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
      return { id: data.id, existed: false };
    },
    async upsertProfile(id, patch) {
      await rest('profiles?on_conflict=id', { method: 'POST', body: { id, ...patch }, prefer: 'resolution=merge-duplicates,return=minimal' });
    },
    async getProfile(userId) {
      return one(await rest(`profiles?id=eq.${userId}&select=id,full_name,display_name,is_admin,created_at&limit=1`));
    },
    async getParticipant(eventId, userId) {
      return one(await rest(`live_quiz_participants?event_id=eq.${eventId}&user_id=eq.${userId}&select=*&limit=1`));
    },
    async createParticipant(eventId, userId, at) {
      // ON CONFLICT DO NOTHING via resolution=ignore-duplicates, then re-read.
      await rest('live_quiz_participants?on_conflict=event_id,user_id', {
        method: 'POST', body: { event_id: eventId, user_id: userId, joined_at: at.toISOString() },
        prefer: 'resolution=ignore-duplicates,return=minimal',
      });
      return this.getParticipant(eventId, userId);
    },
    async listParticipants(eventId) {
      const rows = await rest(`live_quiz_participants?event_id=eq.${eventId}&select=id,user_id,joined_at,total_score,answered_count,total_response_ms,profiles(full_name,display_name)`);
      return (rows || []).map(({ profiles, ...p }) => ({ ...p, full_name: profiles?.full_name, display_name: profiles?.display_name }));
    },
    async setParticipantTotals(id, t) {
      await rest(`live_quiz_participants?id=eq.${id}`, { method: 'PATCH', body: t, prefer: 'return=minimal' });
    },
    async listAnswers(participantId) {
      return (await rest(`live_quiz_answers?participant_id=eq.${participantId}&select=*`)) || [];
    },
    async getAnswer(participantId, questionId) {
      return one(await rest(`live_quiz_answers?participant_id=eq.${participantId}&question_id=eq.${questionId}&select=*&limit=1`));
    },
    async createServedAnswer(participantId, questionId, at) {
      await rest('live_quiz_answers?on_conflict=participant_id,question_id', {
        method: 'POST', body: { participant_id: participantId, question_id: questionId, served_at: at.toISOString() },
        prefer: 'resolution=ignore-duplicates,return=minimal',
      });
      return this.getAnswer(participantId, questionId);
    },
    async recordAnswer(id, patch) {
      // Conditional on selected_answer IS NULL — a racing double-submit gets 0 rows.
      const rows = await rest(`live_quiz_answers?id=eq.${id}&selected_answer=is.null`, {
        method: 'PATCH', body: { ...patch, answered_at: patch.answered_at.toISOString() }, prefer: 'return=representation',
      });
      return one(rows);
    },
    async resetEvent(eventId) {
      const ps = (await rest(`live_quiz_participants?event_id=eq.${eventId}&select=id`)) || [];
      let answers = 0;
      if (ps.length) {
        const ids = ps.map((p) => p.id).join(',');
        const del = await rest(`live_quiz_answers?participant_id=in.(${ids})`, { method: 'DELETE', prefer: 'return=representation' });
        answers = (del || []).length;
      }
      await rest(`live_quiz_participants?event_id=eq.${eventId}`, { method: 'DELETE' });
      return { participants: ps.length, answers };
    },
    async logAnalytics(event_name, user_id, properties) {
      try {
        await rest('analytics_events', { method: 'POST', body: { event_name, user_id, properties }, prefer: 'return=minimal' });
      } catch (e) { console.warn('[live-quiz] analytics failed:', e.message); }
    },
  };
}
