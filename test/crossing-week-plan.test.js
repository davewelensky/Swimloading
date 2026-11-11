// The weekly planner turns a swimmer's programme and recent swims into sessions.
// What must hold: only the remaining days are planned, the week never silently
// goes over the phase range, no condition name reaches the swimmer, and a plan
// is only made for someone with a programme.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phaseFor, summariseRecent, sanitiseWeekPlan, createWeekPlanHandler } from '../api/_lib/crossing-week-plan/planner.js';

const plan = {
    swim: { week_of: '2027-08-09' },
    phases: [
        { key: 'restart', name: '0. Restart', start: '2026-11-16', end: '2026-12-13', km_min: 15, km_max: 20, long_swim: 'Up to 3 h' },
        { key: 'base', name: '1. Base', start: '2026-12-14', end: '2027-02-28', km_min: 20, km_max: 30, long_swim: '3 to 6 h' },
    ],
    weekly_shape: [{ text: 'Saturday long swim', basis: 'judgment' }],
};

test('phase lookup uses the first phase before the plan starts', () => {
    assert.equal(phaseFor(plan, '2026-11-11').key, 'restart');
    assert.equal(phaseFor(plan, '2026-12-20').key, 'base');
    assert.equal(phaseFor(plan, '2027-09-01'), null);
});

test('recent summary counts this SAST week only up to today', () => {
    const now = Date.parse('2026-11-11T10:00:00Z'); // Wednesday
    const s = summariseRecent([
        { start_date: '2026-11-09T05:00:00Z', distance_m: 3000, moving_time_seconds: 3000, start_latlng: [] },
        { start_date: '2026-11-08T21:30:00Z', distance_m: 4000, moving_time_seconds: 3600, start_latlng: [] }, // Sun 23:30 SAST, last week
        { start_date: '2026-10-23T02:00:00Z', distance_m: 28050, moving_time_seconds: 28800, start_latlng: [-33, 18] },
    ], '2026-11-09', now);
    assert.equal(s.this_week_km, 3);
    assert.equal(s.longest_recent_hours, 8);
});

const raw = over => ({
    summary: 'Easy restart week.',
    planned_km: 12,
    sessions: [
        { day: 'Mon', type: 'pool', title: 'Should be dropped', distance_km: 4, duration_min: 70, main_set: 'x', purpose: 'y', basis: 'judgment' },
        { day: 'Thu', type: 'pool', title: 'Steady aerobic', distance_km: 4.04, duration_min: 75, main_set: '5 x 800 m steady', purpose: 'Rebuild base', basis: 'judgment' },
        { day: 'Sat', type: 'open_water', title: 'Long swim', distance_km: 8, duration_min: 150, main_set: 'Continuous, feed every 30 min', purpose: 'Long swim', basis: 'opinion' },
        { day: 'Fri', type: 'pool', title: 'Ease the tendonitis', distance_km: 2, duration_min: 40, main_set: 'easy', purpose: 'z', basis: 'judgment' },
    ],
    watch_outs: ['Never swim alone in open water.'],
    ...over,
});

test('only remaining days are kept, rounded, in day order, and condition names are dropped', () => {
    const p = sanitiseWeekPlan(raw(), { remainingDays: ['Wed', 'Thu', 'Fri', 'Sat', 'Sun'], phase: plan.phases[0], alreadyKm: 3 });
    assert.deepEqual(p.sessions.map(s => s.day), ['Thu', 'Sat']);
    assert.equal(p.sessions[0].distance_km, 4);
    assert.equal(p.planned_km, 12);
    assert.equal(p.week_total_km, 15);
});

test('a week over the phase range gets a warning', () => {
    const p = sanitiseWeekPlan(raw({ sessions: [{ day: 'Sat', type: 'open_water', title: 'Long', distance_km: 19, duration_min: 300, main_set: 'x', purpose: 'y', basis: 'judgment' }] }),
        { remainingDays: ['Sat', 'Sun'], phase: plan.phases[0], alreadyKm: 3 });
    assert.match(p.watch_outs[0], /22 km for the week, above the phase range of 15 to 20 km/);
});

function harness({ hasPlan = true, cached = [] } = {}) {
    const calls = [];
    const anthropic = { beta: { messages: { create: async params => { calls.push(params); return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(raw()) }] }; } } } };
    const fetch = async (url, opts = {}) => {
        if (url.includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'peter' }) };
        if (url.includes('crossing_programmes')) return { ok: true, json: async () => (hasPlan ? [{ plan }] : []) };
        if (url.includes('crossing_week_plans') && opts.method === 'POST') return { ok: true, status: 201 };
        if (url.includes('crossing_week_plans')) return { ok: true, json: async () => cached };
        return { ok: true, json: async () => [] };
    };
    return { handler: createWeekPlanHandler({ fetch, anthropic, now: () => Date.parse('2026-11-11T10:00:00Z') }), calls };
}
const reply = () => { const r = { code: 200 }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.setHeader = () => {}; return r; };
const post = (body = {}, auth = 'Bearer t') => ({ method: 'POST', headers: { authorization: auth }, body });

test('needs sign-in and a programme', async () => {
    let r = reply(); await harness().handler(post({}, ''), r); assert.equal(r.code, 401);
    const h = harness({ hasPlan: false }); r = reply(); await h.handler(post(), r);
    assert.equal(r.code, 404); assert.equal(h.calls.length, 0);
});

test('returns the stored plan for this week without calling the model', async () => {
    const h = harness({ cached: [{ plan: { sessions: [] }, created_at: 'x' }] });
    const r = reply(); await h.handler(post(), r);
    assert.equal(r.body.cached, true); assert.equal(h.calls.length, 0);
});

test('plans the remaining days with the phase and recent training as facts', async () => {
    const h = harness();
    const r = reply(); await h.handler(post({ refresh: true }), r);
    assert.equal(r.body.status, 'ok');
    assert.deepEqual(r.body.plan.sessions.map(s => s.day), ['Thu', 'Sat']);
    const facts = JSON.parse(h.calls[0].messages[0].content.split('\n\n<swimmer_notes>')[0]);
    assert.deepEqual(facts.days_to_plan, ['Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    assert.equal(facts.current_phase.km_max, 20);
    assert.equal(h.calls[0].model, 'claude-opus-5-5');
});
