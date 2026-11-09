// Swimmers log an injury and the AI suggests easing off. These tests pin what
// still has to hold: invite-only access, consent before anything goes to the
// model, reductions only, and no condition name ever reaching the swimmer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLoadSummary, sanitiseGuidance, createGuidanceHandler } from '../api/_lib/crossing-injury/guidance.js';

const Rules = globalThis.CrossingInjuryRules;
const PETER = '9b1445e8-cce5-4501-a038-489146d15ab2';

const reply = () => {
    const res = { code: 200, body: null, headers: {} };
    res.status = c => { res.code = c; return res; };
    res.json = b => { res.body = b; return res; };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    return res;
};

const modelOutput = over => JSON.stringify({
    understood: { body_part: 'shoulder', side: 'right', pattern: 'after 3 hours' },
    summary: 'You feel it late in long swims.',
    follow_up_questions: [],
    load_observations: ['You swam 16.7 km last week.'],
    training_adjustments: [{ change: 'Remove paddles this week', why: 'You said it hurts on the catch', basis: 'research' }],
    see_physio: false,
    see_physio_reason: '',
    ...over,
});

function harness({ userId = PETER, output, stop = 'end_turn' } = {}) {
    const calls = [];
    const anthropic = {
        beta: { messages: { create: async params => {
            calls.push(params);
            return { stop_reason: stop, content: [{ type: 'text', text: output ?? modelOutput() }] };
        } } },
    };
    const fetch = async url => ({ ok: true, json: async () => (url.includes('/auth/v1/user') ? { id: userId } : []) });
    return { handler: createGuidanceHandler({ anthropic, fetch }), calls };
}

const post = (body, auth = 'Bearer t') => ({ method: 'POST', headers: { authorization: auth }, body });
const baseBody = over => ({ notes: 'Right shoulder sore after 3 hours, worse on the catch', consent: true, type: 'soreness', severity: 'mild', ...over });

test('no token means no access', async () => {
    const { handler } = harness();
    const res = reply();
    await handler(post(baseBody(), ''), res);
    assert.equal(res.code, 401);
});

test('invite only: someone not on the list is refused before the model', async () => {
    const { handler, calls } = harness({ userId: 'someone-else' });
    const res = reply();
    await handler(post(baseBody()), res);
    assert.equal(res.code, 403);
    assert.equal(calls.length, 0);
});

test('consent is required before anything goes to the model', async () => {
    const { handler, calls } = harness();
    const res = reply();
    await handler(post(baseBody({ consent: false })), res);
    assert.equal(res.code, 400);
    assert.equal(calls.length, 0);
});

test('Peter gets guidance and the notes go in as data', async () => {
    const { handler, calls } = harness();
    const res = reply();
    await handler(post(baseBody()), res);
    assert.equal(res.body.status, 'guidance');
    assert.equal(res.body.guidance.training_adjustments.length, 1);
    assert.equal(res.body.notice, null);
    assert.match(calls[0].messages[0].content, /<swimmer_notes>Right shoulder/);
    assert.equal(calls[0].model, 'claude-opus-5-5');
});

test('a worrying word adds a reminder but never blocks guidance', async () => {
    const { handler, calls } = harness();
    const res = reply();
    await handler(post(baseBody({ notes: 'numb fingers late in the swim' })), res);
    assert.equal(res.body.status, 'guidance');
    assert.equal(calls.length, 1);
    assert.equal(res.body.notice.label, 'numbness or pins and needles');
});

test('the most serious mention decides the reminder', () => {
    assert.match(Rules.noticeFor('tingling and some chest tightness').action, /emergency/);
    assert.equal(Rules.noticeFor('sore after long swims'), null);
});

test('a ticked symptom adds a reminder, reaches the model, and blocks nothing', async () => {
    const { handler, calls } = harness();
    const res = reply();
    await handler(post(baseBody({ ticked: ['night', 'not-a-real-id'] })), res);
    assert.equal(res.body.status, 'guidance');
    assert.equal(res.body.notice.label, 'pain at night');
    assert.equal(res.body.guidance.see_physio, true);
    assert.match(calls[0].messages[0].content, /Pain at night that wakes you/);
    assert.doesNotMatch(calls[0].messages[0].content, /not-a-real-id/);
});

test('the optional list has ten symptoms and names no condition', () => {
    assert.equal(Rules.TICK_LIST.length, 10);
    for (const t of Rules.TICK_LIST) assert.equal(Rules.containsConditionName(t.label), false, t.label);
});

test('significant severity keeps the reductions and adds a physio prompt', async () => {
    const { handler, calls } = harness();
    const res = reply();
    await handler(post(baseBody({ severity: 'significant' })), res);
    assert.equal(res.body.guidance.training_adjustments.length, 1);
    assert.equal(res.body.guidance.see_physio, true);
    assert.match(calls[0].messages[0].content, /"severity":"significant"/);
});

test('a condition name in model output is removed', () => {
    const out = sanitiseGuidance(JSON.parse(modelOutput({
        summary: 'This looks like impingement.',
        load_observations: ['Rotator cuff load was high.', 'You swam 16.7 km last week.'],
        training_adjustments: [{ change: 'Rest the tendonitis', why: 'x', basis: 'research' }],
    })), { promptPhysio: false });
    assert.doesNotMatch(JSON.stringify(out), /impingement|rotator|tendonitis/i);
    assert.deepEqual(out.load_observations, ['You swam 16.7 km last week.']);
    assert.deepEqual(out.training_adjustments, []);
});

test('the swimmer-facing rules name no condition', () => {
    assert.equal(Rules.containsConditionName(Rules.DISCLAIMER), false);
    for (const b of Rules.SORENESS) assert.equal(Rules.containsConditionName(b.label + ' ' + b.response), false);
});

test('a truncated or refused model response is reported as unavailable', async () => {
    const { handler } = harness({ stop: 'refusal' });
    const res = reply();
    await handler(post(baseBody()), res);
    assert.equal(res.body.status, 'unavailable');
});

test('load summary buckets by SAST week and marks the onset week', () => {
    const now = Date.parse('2026-11-09T12:00:00Z'); // a Monday
    const rows = [
        { start_date: '2026-11-08T21:59:00Z', distance_m: 3000, moving_time_seconds: 3600, start_latlng: [] }, // Sun 23:59 SAST
        { start_date: '2026-11-08T22:01:00Z', distance_m: 2000, moving_time_seconds: 1800, start_latlng: [-33, 18] }, // Mon 00:01 SAST
    ];
    const s = buildLoadSummary(rows, '2026-11-05', now);
    assert.equal(s.weeks.length, 8);
    const last = s.weeks[7], prev = s.weeks[6];
    assert.deepEqual([last.week_starting, last.km, last.open_water_sessions], ['2026-11-09', 2, 1]);
    assert.deepEqual([prev.week_starting, prev.km, prev.contains_onset], ['2026-11-02', 3, true]);
});
