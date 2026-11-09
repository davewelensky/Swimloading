// The injury section's job is to be safe before it is clever. These tests pin
// the order of events: red flags stop everything, the model is only reached
// with consent and a clean check, and a condition name can never get through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLoadSummary, sanitiseGuidance, createGuidanceHandler } from '../api/_lib/crossing-injury/guidance.js';

const Rules = globalThis.CrossingInjuryRules;
const DAVE = 'df137255-3add-4153-b368-32e06e2be188';

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

function harness({ userId = DAVE, output, stop = 'end_turn' } = {}) {
    const calls = [];
    const anthropic = {
        beta: { messages: { create: async params => {
            calls.push(params);
            return { stop_reason: stop, content: [{ type: 'text', text: output ?? modelOutput() }] };
        } } },
    };
    const fetch = async url => ({
        ok: true,
        json: async () => {
            if (url.includes('/auth/v1/user')) return { id: userId };
            if (url.includes('strava_imports')) return [];
            return [];
        },
    });
    return { handler: createGuidanceHandler({ anthropic, fetch }), calls };
}

const post = (body, auth = 'Bearer t') => ({ method: 'POST', headers: { authorization: auth }, body });
const baseBody = over => ({ notes: 'Right shoulder sore after 3 hours, worse on the catch', consent: true, type: 'soreness', severity: 'mild', ...over });

test('every red flag has a known tier and uses symptom words only', () => {
    for (const f of Rules.RED_FLAGS) {
        assert.ok(Rules.TIERS[f.tier], f.id);
        assert.equal(Rules.containsConditionName(f.label), false, f.label);
    }
});

test('the highest-priority tier wins when several are ticked', () => {
    const r = Rules.assess({ flags: ['night_pain', 'chest_pain', 'no_improvement'] });
    assert.equal(r.tier, 'emergency');
});

test('a symptom mentioned in the notes must be confirmed before going further', () => {
    const r = Rules.assess({ text: 'some tingling in my fingers' });
    assert.equal(r.tier, null);
    assert.deepEqual(r.needsConfirm, ['arm_numbness']);
    assert.deepEqual(Rules.assess({ text: 'some tingling', confirmedAbsent: ['arm_numbness'] }).needsConfirm, []);
});

test('no token means no access', async () => {
    const { handler } = harness();
    const res = reply();
    await handler(post(baseBody(), ''), res);
    assert.equal(res.code, 401);
});

test('stays closed to everyone but Dave until clinical review is complete', async () => {
    assert.equal(Rules.CLINICAL_REVIEW.complete, false);
    const { handler, calls } = harness({ userId: 'someone-else' });
    const res = reply();
    await handler(post(baseBody()), res);
    assert.equal(res.code, 403);
    assert.equal(calls.length, 0);
});

test('consent is required', async () => {
    const { handler, calls } = harness();
    const res = reply();
    await handler(post(baseBody({ consent: false })), res);
    assert.equal(res.code, 400);
    assert.equal(calls.length, 0);
});

test('a red flag refers the swimmer and never reaches the model', async () => {
    const { handler, calls } = harness();
    const res = reply();
    await handler(post(baseBody({ flags: ['arm_numbness'] })), res);
    assert.deepEqual([res.body.status, res.body.tier], ['refer', 'urgent']);
    assert.equal(calls.length, 0);
});

test('an unconfirmed symptom in the notes never reaches the model', async () => {
    const { handler, calls } = harness();
    const res = reply();
    await handler(post(baseBody({ notes: 'numb fingers late in the swim' })), res);
    assert.equal(res.body.status, 'confirm');
    assert.equal(calls.length, 0);
});

test('a clean request returns filtered guidance and sends the notes as data', async () => {
    const { handler, calls } = harness();
    const res = reply();
    await handler(post(baseBody()), res);
    assert.equal(res.body.status, 'guidance');
    assert.equal(res.body.guidance.training_adjustments.length, 1);
    assert.match(calls[0].messages[0].content, /<swimmer_notes>Right shoulder/);
    assert.equal(calls[0].model, 'claude-opus-5-5');
});

test('significant severity removes training suggestions even if the model gives some', async () => {
    const { handler } = harness();
    const res = reply();
    await handler(post(baseBody({ severity: 'significant' })), res);
    assert.deepEqual(res.body.guidance.training_adjustments, []);
    assert.equal(res.body.guidance.see_physio, true);
});

test('a condition name in model output is removed', () => {
    const out = sanitiseGuidance(JSON.parse(modelOutput({
        summary: 'This looks like impingement.',
        load_observations: ['Rotator cuff load was high.', 'You swam 16.7 km last week.'],
        training_adjustments: [{ change: 'Rest the tendonitis', why: 'x', basis: 'research' }],
    })), { holdTraining: false });
    assert.doesNotMatch(JSON.stringify(out), /impingement|rotator|tendonitis/i);
    assert.deepEqual(out.load_observations, ['You swam 16.7 km last week.']);
    assert.deepEqual(out.training_adjustments, []);
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

test('the clinician review sheet matches the rules in the code', () => {
    const doc = readFileSync(new URL('../docs/injury-red-flags-for-clinical-review.md', import.meta.url), 'utf8');
    for (const f of Rules.RED_FLAGS) assert.ok(doc.includes(f.label), f.label);
    for (const b of Rules.SORENESS) assert.ok(doc.includes(b.label), b.label);
});
