// CLDSA live quiz — rules that must hold before anyone in the room plays.
// Runs entirely against the in-memory store; production is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService, QuizError } from '../api/_lib/live-quiz/service.js';
import { createMemoryStore } from '../api/_lib/live-quiz/store-memory.js';
import { scoreAnswer, rankParticipants, publicName, LATE_GRACE_MS } from '../api/_lib/live-quiz/scoring.js';
import { createHandler } from '../api/_lib/live-quiz/http.js';
import { FIXTURE_USERS } from '../api/_lib/live-quiz/fixture.js';
import { resolveLiveEntry, isSafeReturnUrl } from '../api/_lib/live-quiz/entry.js';

const SLUG = 'cldsa2026';
const { admin, alice, bob, carol } = FIXTURE_USERS;

// Controllable clock so speed bonuses are deterministic.
function setup() {
  let t = new Date('2026-09-12T18:00:00Z').getTime();
  const clock = { now: () => new Date(t), tick: (ms) => { t += ms; } };
  const store = createMemoryStore();
  const service = createService(store, { now: clock.now });
  return { store, service, clock };
}

async function playAll(service, clock, userId, { delayMs = 3000, wrongOn = [] } = {}) {
  let last;
  for (;;) {
    const nq = await service.nextQuestion(SLUG, userId);
    if (nq.done) break;
    const correct = (await service.adminGetEvent(admin.id, SLUG)).questions.find((q) => q.id === nq.question.id).correct_answer;
    clock.tick(delayMs);
    const pick = wrongOn.includes(nq.index) ? (correct === 'A' ? 'B' : 'A') : correct;
    last = await service.answer(SLUG, userId, nq.question.id, pick);
  }
  return last;
}

// 1. unauthenticated user is redirected to login and returned correctly
test('unauthenticated visitor is sent to /app and the return URL survives the round trip', () => {
  const entry = resolveLiveEntry({ session: null, href: 'https://www.swimloading.com/live/cldsa2026' });
  assert.equal(entry.action, 'login');
  assert.equal(entry.pendingJoin.url, 'https://www.swimloading.com/live/cldsa2026');
  assert.ok(isSafeReturnUrl(entry.pendingJoin.url, 'https://www.swimloading.com'));
  assert.ok(!isSafeReturnUrl('https://evil.example/live/cldsa2026', 'https://www.swimloading.com'));
  assert.equal(resolveLiveEntry({ session: { user: { id: 'x' } }, href: 'https://www.swimloading.com/live/cldsa2026' }).action, 'play');
});

// 2. member can join once only
test('a member can join once only', async () => {
  const { service, store } = setup();
  const first = await service.join(SLUG, alice.id);
  const second = await service.join(SLUG, alice.id);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.participant.id, second.participant.id);
  assert.equal(store.db.participants.length, 1);
});

// 3. member cannot answer same question twice
test('the same question cannot be answered twice — even after a refresh', async () => {
  const { service, clock } = setup();
  await service.adminSetStatus(admin.id, SLUG, 'live');
  await service.join(SLUG, alice.id);
  const q = await service.nextQuestion(SLUG, alice.id);
  clock.tick(2000);
  await service.answer(SLUG, alice.id, q.question.id, 'B');
  await assert.rejects(service.answer(SLUG, alice.id, q.question.id, 'B'), (e) => e.code === 'already_answered');
  // "Refresh": next question served is question 2, not 1 again.
  const q2 = await service.nextQuestion(SLUG, alice.id);
  assert.equal(q2.index, 2);
  assert.notEqual(q2.question.id, q.question.id);
});

test('a refresh mid-question re-serves the same question with the original clock', async () => {
  const { service, clock } = setup();
  await service.adminSetStatus(admin.id, SLUG, 'live');
  await service.join(SLUG, alice.id);
  const a = await service.nextQuestion(SLUG, alice.id);
  clock.tick(4000);
  const b = await service.nextQuestion(SLUG, alice.id);
  assert.equal(a.question.id, b.question.id);
  assert.equal(a.served_at, b.served_at);
});

// 4. scoring calculation
test('scoring: flat 10 per correct answer, no speed bonus', () => {
  assert.equal(scoreAnswer({ isCorrect: true, responseMs: 0, timeLimitSeconds: 15 }), 10);
  assert.equal(scoreAnswer({ isCorrect: true, responseMs: 7500, timeLimitSeconds: 15 }), 10);
  assert.equal(scoreAnswer({ isCorrect: true, responseMs: 15000, timeLimitSeconds: 15 }), 10);
});

// 5. late answer scores zero
test('a late answer scores zero even when correct', () => {
  assert.equal(scoreAnswer({ isCorrect: true, responseMs: 15000 + LATE_GRACE_MS + 1, timeLimitSeconds: 15 }), 0);
});

test('late answer is recorded as late with 0 points via the service', async () => {
  const { service, clock } = setup();
  await service.adminSetStatus(admin.id, SLUG, 'live');
  await service.join(SLUG, alice.id);
  const q = await service.nextQuestion(SLUG, alice.id);
  clock.tick(q.question.time_limit_seconds * 1000 + LATE_GRACE_MS + 500);
  const r = await service.answer(SLUG, alice.id, q.question.id, 'B');
  assert.equal(r.is_late, true);
  assert.equal(r.points, 0);
  assert.equal(r.total_score, 0);
});

// 6. wrong answer scores zero
test('a wrong answer scores zero', async () => {
  assert.equal(scoreAnswer({ isCorrect: false, responseMs: 0, timeLimitSeconds: 15 }), 0);
  const { service, clock } = setup();
  await service.adminSetStatus(admin.id, SLUG, 'live');
  await service.join(SLUG, alice.id);
  const q = await service.nextQuestion(SLUG, alice.id);
  clock.tick(1000);
  const r = await service.answer(SLUG, alice.id, q.question.id, 'D'); // Q1 correct is B
  assert.equal(r.is_correct, false);
  assert.equal(r.points, 0);
});

test('the client cannot submit a score or a non-letter answer', async () => {
  const { service } = setup();
  await service.adminSetStatus(admin.id, SLUG, 'live');
  await service.join(SLUG, alice.id);
  const q = await service.nextQuestion(SLUG, alice.id);
  await assert.rejects(service.answer(SLUG, alice.id, q.question.id, { points: 9999 }), (e) => e.code === 'bad_answer');
});

// 7. leaderboard sorting
test('leaderboard sorts by score, then fastest total time as tie-break; ranks are 1-based and contiguous', () => {
  const ranked = rankParticipants([
    { id: 'a', total_score: 50, total_response_ms: 9000 },
    { id: 'b', total_score: 60, total_response_ms: 20000 },
    { id: 'c', total_score: 50, total_response_ms: 4000 },
  ]);
  assert.deepEqual(ranked.map((r) => [r.id, r.rank]), [['b', 1], ['c', 2], ['a', 3]]);
});

test('end to end: two players, 6/6 beats 5/6, winner ranks first', async () => {
  const { service, clock } = setup();
  await service.adminSetStatus(admin.id, SLUG, 'live');
  await service.join(SLUG, alice.id);
  await service.join(SLUG, bob.id);
  const a = await playAll(service, clock, alice.id, { delayMs: 2000 });
  const b = await playAll(service, clock, bob.id, { delayMs: 6000, wrongOn: [4] });
  assert.equal(a.total_score, 60);
  assert.equal(b.total_score, 50);
  assert.equal(a.done, true);
  const state = await service.getPublicState(SLUG);
  assert.equal(state.leaderboard[0].name, 'Alice A.');
  assert.equal(state.leaderboard[0].rank, 1);
  assert.equal(state.leaderboard[1].name, 'Bob B.');
  assert.equal(state.finished_count, 2);
});

test('mid-quiz rank is returned after question 3 and not before', async () => {
  const { service, clock } = setup();
  await service.adminSetStatus(admin.id, SLUG, 'live');
  await service.join(SLUG, alice.id);
  const results = [];
  for (let i = 0; i < 4; i++) {
    const nq = await service.nextQuestion(SLUG, alice.id);
    clock.tick(1000);
    results.push(await service.answer(SLUG, alice.id, nq.question.id, 'A'));
  }
  assert.equal(results[0].rank, undefined);
  assert.equal(results[1].rank, undefined);
  assert.equal(results[2].rank, 1);
  assert.equal(results[3].rank, undefined);
});

// 8. private information is never returned by the public leaderboard endpoint
test('public state/leaderboard expose only name, score, rank, answered', async () => {
  const { service, clock } = setup();
  await service.adminSetStatus(admin.id, SLUG, 'live');
  await service.join(SLUG, alice.id);
  await service.join(SLUG, carol.id);
  await playAll(service, clock, alice.id);
  await playAll(service, clock, carol.id);
  const rows = await service.getPublicLeaderboard(SLUG);
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), ['answered', 'name', 'rank', 'score']);
    assert.ok(!JSON.stringify(r).includes('@'));
    assert.ok(!JSON.stringify(r).includes('0000-4000'));
  }
  assert.equal(rows.find((r) => r.name === 'Carol')?.name, 'Carol'); // display_name only, capitalised
  const state = await service.getPublicState(SLUG);
  assert.ok(!JSON.stringify(state).includes('example.test'));
  assert.ok(!JSON.stringify(state).includes('user_id'));
});

test('publicName never leaks an email and shortens to first name + initial', () => {
  assert.equal(publicName({ full_name: 'Dave Welensky' }), 'Dave W.');
  assert.equal(publicName({ full_name: 'dave.welensky@gmail.com' }), 'Swimmer');
  assert.equal(publicName({ display_name: 'Italia Bruwer-Smith' }), 'Italia B.');
  assert.equal(publicName({}), 'Swimmer');
});

// 9. admin can reset a test event (and a non-admin cannot)
test('admin reset wipes participants and answers; non-admin is refused', async () => {
  const { service, clock, store } = setup();
  await service.adminSetStatus(admin.id, SLUG, 'live');
  await service.join(SLUG, alice.id);
  await playAll(service, clock, alice.id);
  await assert.rejects(service.adminReset(alice.id, SLUG), (e) => e.code === 'admin_only');
  const r = await service.adminReset(admin.id, SLUG);
  assert.deepEqual(r.removed, { participants: 1, answers: 6 });
  assert.equal(store.db.participants.length, 0);
  assert.equal(store.db.answers.length, 0);
  assert.equal((await service.getPublicState(SLUG)).event.status, 'draft');
});

// 10. inactive event cannot accept entries
test('an inactive or closed event refuses joins and answers', async () => {
  const { service } = setup();
  await service.adminSetActive(admin.id, SLUG, false);
  await assert.rejects(service.join(SLUG, alice.id), (e) => e.code === 'event_inactive');
  await service.adminSetActive(admin.id, SLUG, true);
  await service.adminSetStatus(admin.id, SLUG, 'draft');
  await assert.rejects(service.join(SLUG, alice.id), (e) => e.code === 'registration_closed');
  await service.adminSetStatus(admin.id, SLUG, 'open');
  await service.join(SLUG, alice.id);
  await assert.rejects(service.nextQuestion(SLUG, alice.id), (e) => e.code === 'not_live');
  await service.adminSetStatus(admin.id, SLUG, 'finished');
  await assert.rejects(service.join(SLUG, bob.id), (e) => e.code === 'registration_closed');
});

// HTTP layer: auth + error mapping
test('HTTP handler maps auth and QuizError to status codes', async () => {
  const { service } = setup();
  const handler = createHandler({ service, getUserId: async (h) => (h === 'Bearer alice' ? alice.id : null), qrSvg: async () => '<svg/>' });
  const call = (method, url, headers = {}, body) => new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); }, send(o) { resolve({ code: this.code, body: o }); } };
    handler({ method, url, headers, body }, res);
  });
  assert.equal((await call('POST', '/api/live-quiz?action=join&slug=cldsa2026')).code, 401);
  assert.equal((await call('POST', '/api/live-quiz?action=join&slug=cldsa2026', { authorization: 'Bearer alice' })).code, 200);
  assert.equal((await call('GET', '/api/live-quiz?action=admin-event&slug=cldsa2026', { authorization: 'Bearer alice' })).code, 403);
  assert.equal((await call('GET', '/api/live-quiz?action=state&slug=nope')).code, 404);
  const qr = await call('GET', '/api/live-quiz?action=qr&slug=cldsa2026');
  assert.equal(qr.body, '<svg/>');
  assert.ok(qr.code === 200 && !(await call('GET', '/api/live-quiz?action=state&slug=cldsa2026')).body.event.correct_answer);
});

// Fast-lane sign-up (event arrivals): one screen, real account, no email hunt.
test('fast-lane signup creates a confirmed account with consent stamped; duplicates are refused', async () => {
  const { service, store } = setup();
  const body = { first_name: 'Tracey', last_name: 'Swimmer', email: 'Tracey@Example.Test', password: 'coldwater', consent: true };
  const r = await service.signup(SLUG, body);
  const prof = store.db.profiles.find((p) => p.id === r.user_id);
  assert.equal(prof.email, 'tracey@example.test');
  assert.equal(prof.full_name, 'Tracey Swimmer');
  assert.equal(prof.display_name, 'Tracey');
  assert.ok(prof.terms_accepted_at && prof.privacy_accepted_at);
  assert.equal(prof.is_admin, false);
  await assert.rejects(service.signup(SLUG, body), (e) => e.code === 'account_exists');
  assert.ok(store.db.analytics.some((a) => a.event_name === 'live_quiz_signup' && a.user_id === r.user_id));
  // and they can join + play like any member
  assert.equal((await service.join(SLUG, r.user_id)).created, true);
});

test('fast-lane signup validates input and respects event state', async () => {
  const { service } = setup();
  const ok = { first_name: 'A', last_name: 'B', email: 'a@b.co', password: 'secret1', consent: true };
  await assert.rejects(service.signup(SLUG, { ...ok, consent: false }), (e) => e.code === 'consent_required');
  await assert.rejects(service.signup(SLUG, { ...ok, last_name: '' }), (e) => e.code === 'name_required');
  await assert.rejects(service.signup(SLUG, { ...ok, email: 'nope' }), (e) => e.code === 'bad_email');
  await assert.rejects(service.signup(SLUG, { ...ok, password: '123' }), (e) => e.code === 'weak_password');
  await service.adminSetStatus(admin.id, SLUG, 'draft');
  await assert.rejects(service.signup(SLUG, ok), (e) => e.code === 'registration_closed');
  await service.adminSetActive(admin.id, SLUG, false);
  await assert.rejects(service.signup(SLUG, ok), (e) => e.code === 'event_inactive');
});
