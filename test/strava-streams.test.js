// Long-swim analysis from Strava per-second streams. The numbers go in front of
// a swimmer preparing for the Channel, so the hour buckets, stop detection and
// fade have to be right, and the endpoint must only touch the caller's own swims.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseSwimStreams } from '../api/_lib/strava-streams.js';
import { createStreamsHandler } from '../api/strava/streams.js';

// A synthetic 3-hour swim sampled every 5 s: 1.0 m/s in hour 1, 0.9 in hour 2,
// 0.8 in hour 3; a 60 s feed stop every 30 min; heart rate drifts 130 -> 140;
// stroke rate 30 -> 27.
function syntheticSwim() {
    const time = [], distance = [], heartrate = [], cadence = [], moving = [], temp = [];
    let d = 0;
    for (let t = 0; t <= 3 * 3600; t += 5) {
        const h = Math.floor(t / 3600);
        const stopped = t >= 1800 && t % 1800 < 60;
        if (!stopped) d += [1.0, 0.9, 0.8][Math.min(h, 2)] * 5;
        time.push(t); distance.push(d); moving.push(!stopped);
        heartrate.push(130 + Math.round(t / 1080)); cadence.push(stopped ? 0 : 30 - h * 1.5); temp.push(20);
    }
    const s = k => ({ data: k });
    return { time: s(time), distance: s(distance), heartrate: s(heartrate), cadence: s(cadence), moving: s(moving), temp: s(temp) };
}

test('splits a long swim into hours with distance, pace and stops', () => {
    const a = analyseSwimStreams(syntheticSwim());
    assert.equal(a.total_minutes, 180);
    assert.equal(a.hours.length, 3);
    assert.ok(Math.abs(a.hours[0].km - 3.48) < 0.1, `hour 1 km ${a.hours[0].km}`);
    assert.ok(a.hours[2].pace_per_100m_s > a.hours[0].pace_per_100m_s, 'later hour is slower');
    assert.equal(a.stops.count, 5);
    assert.deepEqual(a.stops.at_minutes, [30, 60, 90, 120, 150]);
    assert.ok(Math.abs(a.stops.median_seconds - 60) <= 5);
});

test('fade compares the first and last full hours', () => {
    const f = analyseSwimStreams(syntheticSwim()).fade;
    assert.equal(f.compared, 'hour 1 to hour 3');
    assert.ok(f.pace_change_pct > 15 && f.pace_change_pct < 35, `pace change ${f.pace_change_pct}`);
    assert.ok(f.heart_rate_change_bpm > 0);
    assert.ok(f.stroke_rate_change_pct < 0);
});

test('a recording gap counts as stopped time, and missing streams are tolerated', () => {
    const time = [], distance = [];
    for (let t = 0; t <= 3600; t += 10) { time.push(t >= 1800 ? t + 300 : t); distance.push(t); }
    const a = analyseSwimStreams({ time: { data: time }, distance: { data: distance } });
    assert.equal(a.stops.count, 1);
    assert.ok(a.stops.longest_seconds >= 300);
    assert.equal(a.hours[0].heart_rate, null);
    assert.deepEqual(a.streams, ['distance']);
});

test('too little data returns nothing', () => {
    assert.equal(analyseSwimStreams({ time: { data: [0, 1, 2] } }), null);
    assert.equal(analyseSwimStreams(null), null);
});

const reply = () => {
    const res = { code: 200, body: null };
    res.status = c => { res.code = c; return res; };
    res.json = b => { res.body = b; return res; };
    res.setHeader = () => {};
    return res;
};

function harness({ moving = 8 * 3600, cached = [] } = {}) {
    const calls = [];
    const fetch = async (url, opts = {}) => {
        calls.push([url, opts.method || 'GET']);
        if (url.includes('strava_imports')) return { ok: true, json: async () => (moving == null ? [] : [{ moving_time_seconds: moving }]) };
        if (url.includes('strava_swim_analyses') && (opts.method || 'GET') === 'GET') return { ok: true, json: async () => cached };
        if (url.includes('strava_swim_analyses')) return { ok: true, status: 201 };
        if (url.includes('strava.com')) return { ok: true, status: 200, json: async () => syntheticSwim() };
        return { ok: false, status: 404 };
    };
    const handler = createStreamsHandler({ fetch, getUserId: async h => (h ? 'user-1' : null), getValidStravaToken: async () => 'strava-token' });
    return { handler, calls };
}
const post = (body, auth = 'Bearer jwt') => ({ method: 'POST', headers: { authorization: auth }, body });

test('requires sign-in', async () => {
    const { handler } = harness();
    const res = reply();
    await handler(post({ strava_activity_id: '123' }, ''), res);
    assert.equal(res.code, 401);
});

test('refuses an activity that is not the caller\'s, and never calls Strava', async () => {
    const { handler, calls } = harness({ moving: null });
    const res = reply();
    await handler(post({ strava_activity_id: '123' }), res);
    assert.equal(res.code, 404);
    assert.ok(!calls.some(([u]) => u.includes('strava.com')));
});

test('refuses swims under 2 hours', async () => {
    const { handler } = harness({ moving: 3600 });
    const res = reply();
    await handler(post({ strava_activity_id: '123' }), res);
    assert.equal(res.code, 400);
});

test('serves a stored summary without calling Strava', async () => {
    const { handler, calls } = harness({ cached: [{ summary: { hours: [] } }] });
    const res = reply();
    await handler(post({ strava_activity_id: '123' }), res);
    assert.equal(res.body.cached, true);
    assert.ok(!calls.some(([u]) => u.includes('strava.com')));
});

test('fetches, analyses and stores a new long swim', async () => {
    const { handler, calls } = harness();
    const res = reply();
    await handler(post({ strava_activity_id: '123' }), res);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.summary.hours.length, 3);
    assert.ok(calls.some(([u, m]) => u.includes('strava_swim_analyses') && m === 'POST'));
    assert.ok(calls.some(([u]) => u.includes('/activities/123/streams')));
});

test('rejects a malformed activity id', async () => {
    const { handler } = harness();
    const res = reply();
    await handler(post({ strava_activity_id: '1;drop' }), res);
    assert.equal(res.code, 400);
});
