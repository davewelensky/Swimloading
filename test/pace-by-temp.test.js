// Unit tests for the pure maths behind the "Pace by water temperature" card.
// Run: node --test test/pace-by-temp.test.js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

// app-pace.js is a classic browser script (no exports), so evaluate it in a
// sandbox and pull out the pure-maths object. Its top level touches no DOM.
const src = fs.readFileSync(new URL('../app-pace.js', import.meta.url), 'utf8');
const calc = vm.runInNewContext(src + '\n;SLPaceCalc', {});
// Objects built inside the sandbox have a different Object.prototype, so
// deepStrictEqual needs plain copies.
const plain = (x) => JSON.parse(JSON.stringify(x));

// Build a comparable swim directly (what buildSwims returns).
const swim = (temp, pace, extra) => Object.assign({ temp, pace, wetsuit: null, at: 0, spotId: 's1', distanceM: 2000 }, extra);

test('paceSecPer100: moving seconds per 100m, null on bad input', () => {
    assert.strictEqual(calc.paceSecPer100(2000, 2400), 120);
    assert.strictEqual(calc.paceSecPer100(0, 2400), null);
    assert.strictEqual(calc.paceSecPer100(2000, 0), null);
    assert.strictEqual(calc.paceSecPer100(null, 100), null);
});

test('fmtPace: m:ss, rounds to the nearest second', () => {
    assert.strictEqual(calc.fmtPace(118.4), '1:58');
    assert.strictEqual(calc.fmtPace(125), '2:05');
    assert.strictEqual(calc.fmtPace(59.6), '1:00');
    assert.strictEqual(calc.fmtPace(null), '–');
});

test('isPoolType: any POOL water type, case-insensitive; unknown is not a pool', () => {
    assert.strictEqual(calc.isPoolType('POOL'), true);
    assert.strictEqual(calc.isPoolType('TIDAL_POOL'), true);
    assert.strictEqual(calc.isPoolType('pool'), true);
    assert.strictEqual(calc.isPoolType('OCEAN'), false);
    assert.strictEqual(calc.isPoolType(undefined), false);
});

test('median: odd and even counts', () => {
    assert.strictEqual(calc.median([3, 1, 2]), 2);
    assert.strictEqual(calc.median([4, 1, 3, 2]), 2.5);
    assert.strictEqual(calc.median([]), null);
});

test('bandOf: 3 degree bands, lower bound inclusive', () => {
    assert.strictEqual(calc.bandOf(14.9).label, '12–15°C');
    assert.strictEqual(calc.bandOf(15).label, '15–18°C');
    assert.strictEqual(calc.bandOf(9).label, '9–12°C');
});

test('buildSwims: keeps only comparable open-water swims and maps wetsuit tri-state', () => {
    const waterType = id => ({ ocean: 'OCEAN', pool: 'POOL', tidal: 'TIDAL_POOL', lake: 'LAKE' })[id];
    const logs = [
        { id: 'a', temp_c: '14.0', spot_id: 'ocean', wetsuit: true,  logged_at: '2026-09-01T07:00:00Z' },
        { id: 'b', temp_c: '16.5', spot_id: 'lake',  wetsuit: false, logged_at: '2026-09-02T07:00:00Z' },
        { id: 'c', temp_c: '15.0', spot_id: 'ocean', wetsuit: null,  logged_at: '2026-09-03T07:00:00Z' },
        { id: 'd', temp_c: '27.0', spot_id: 'pool',  wetsuit: null,  logged_at: '2026-09-04T07:00:00Z' },
        { id: 'e', temp_c: '27.0', spot_id: 'tidal', wetsuit: null,  logged_at: '2026-09-05T07:00:00Z' },
        { id: 'f', temp_c: '15.0', spot_id: 'nowhere', wetsuit: null, logged_at: '2026-09-06T07:00:00Z' },
        { id: 'g', temp_c: '15.0', spot_id: 'ocean', wetsuit: null,  logged_at: '2026-09-07T07:00:00Z' },
        { id: 'h', temp_c: 'abc',  spot_id: 'ocean', wetsuit: null,  logged_at: '2026-09-08T07:00:00Z' },
    ];
    const good = (id, extra) => Object.assign({ imported_to_log_id: id, distance_m: 2000, moving_time_seconds: 2400, start_date_local: '2026-09-01T07:00:00' }, extra);
    const imports = [
        good('a'), good('b'), good('c'),
        good('d'),                                   // pool: excluded
        good('e'),                                   // tidal pool: excluded
        good('f'),                                   // spot unknown: excluded
        good('g', { distance_m: 500 }),              // too short: excluded
        good('h'),                                   // temperature not a number: excluded
        good('c', { moving_time_seconds: 600 }),     // 30 s/100m: impossible pace, excluded
        good('missing'),                             // no matching log: excluded
    ];
    const out = calc.buildSwims(imports, logs, waterType);
    assert.strictEqual(out.length, 3);
    assert.deepStrictEqual(plain(out.map(s => s.temp)), [14, 16.5, 15]);
    assert.deepStrictEqual(plain(out.map(s => s.wetsuit)), [true, false, null]);
    assert.strictEqual(out[0].pace, 120);
});

test('summarise: need_more below 5 swims', () => {
    const s = calc.summarise([swim(14, 120), swim(15, 121), swim(16, 122)], 'all');
    assert.strictEqual(s.status, 'need_more');
    assert.strictEqual(s.total, 3);
    assert.strictEqual(s.needed, 2);
});

test('summarise: need_spread when everything sits in one band', () => {
    const swims = [12.1, 12.5, 13, 13.5, 14].map(t => swim(t, 125));
    const s = calc.summarise(swims, 'all');
    assert.strictEqual(s.status, 'need_spread');
    assert.strictEqual(s.total, 5);
});

test('summarise: ready, band medians, ignores single-swim bands, sign of the headline difference', () => {
    const swims = [
        swim(13, 130, { at: 5 }), swim(14, 126, { at: 1 }), swim(12.5, 134, { at: 2 }),   // 12-15 band: median 130
        swim(19, 120, { at: 3 }), swim(20, 124, { at: 4 }),                               // 18-21 band: median 122
        swim(16, 125, { at: 0 }),                                                         // 15-18: one swim, not shown
    ];
    const s = calc.summarise(swims, 'all');
    assert.strictEqual(s.status, 'ready');
    assert.strictEqual(s.total, 6);
    assert.deepStrictEqual(plain(s.bands.map(b => [b.label, b.n, b.medianPace])), [['12–15°C', 3, 130], ['18–21°C', 2, 122]]);
    assert.strictEqual(s.coldest.label, '12–15°C');
    assert.strictEqual(s.warmest.label, '18–21°C');
    assert.strictEqual(s.diff, 8);                       // colder is 8 s/100m slower
    // latest swim is the 13 degree one (at: 5); two others share its band, median 130
    assert.strictEqual(s.latest.temp, 13);
    assert.deepStrictEqual(plain(s.compare), { label: '12–15°C', n: 2, medianPace: 130 });
});

test('summarise: compare is null when fewer than 2 other swims share the latest swim\'s band', () => {
    const swims = [
        swim(13, 130, { at: 1 }), swim(14, 126, { at: 2 }), swim(12.5, 134, { at: 3 }),
        swim(19, 120, { at: 4 }), swim(20, 124, { at: 9 }),    // latest: only one other swim in 18-21
    ];
    const s = calc.summarise(swims, 'all');
    assert.strictEqual(s.status, 'ready');
    assert.strictEqual(s.latest.temp, 20);
    assert.strictEqual(s.compare, null);
});

test('summarise: gear filter separates wetsuit from no-wetsuit swims and ignores untagged', () => {
    const wet = [13, 13.5, 14, 19, 19.5].map(t => swim(t, 125, { wetsuit: true }));
    const skins = [13, 19].map(t => swim(t, 140, { wetsuit: false }));
    const untagged = [swim(16, 130)];
    const all = wet.concat(skins, untagged);

    assert.deepStrictEqual(plain(calc.gearCounts(all)), { all: 8, wetsuit: 5, skins: 2, untagged: 1 });
    assert.strictEqual(calc.summarise(all, 'wetsuit').total, 5);
    assert.strictEqual(calc.summarise(all, 'wetsuit').status, 'ready');
    assert.strictEqual(calc.summarise(all, 'skins').status, 'need_more');   // only 2 tagged swims
    assert.strictEqual(calc.summarise(all, 'all').total, 8);
});
