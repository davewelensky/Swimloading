// The 12 Swims of Christmas (FORM): the app picks the edition by SAST date, shows
// the right rules on every screen, and the page, config and database file agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function engine({ now, search = '', user = { id: 'u1' }, rows = [], config } = {}) {
    const calls = [];
    const toasts = [];
    const RealDate = Date;
    class FakeDate extends RealDate {
        constructor(...a) { super(...(a.length ? a : [now])); }
        static now() { return new RealDate(now).getTime(); }
    }
    const cfg = config || { enabled: true, test_mode: false, launch_date: '2026-11-01', end_date: '2026-11-30', tester_ids: ['tester'] };
    const ctx = {
        console, Intl, Date: FakeDate, setTimeout: () => 0, encodeURIComponent, decodeURIComponent,
        window: { location: { search } },
        document: { getElementById: () => null, body: { style: {} } },
        currentUser: user, currentUserProfile: null,
        initIcons: () => {}, showPage: () => {},
        showToast: m => toasts.push(m),
        supabaseClient: {
            rpc: async name => {
                calls.push(name);
                if (name === 'award_challenge_points') return { data: { awarded: false, reason: 'outside_challenge_window' }, error: null };
                return { data: rows, error: null };
            },
            from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: cfg }) }) }) }),
        },
    };
    vm.createContext(ctx);
    vm.runInContext(read('app-june.js'), ctx);
    const run = code => vm.runInContext(code, ctx);
    return { run, calls, toasts };
}

const IN_CHALLENGE = '2026-12-10T10:00:00+02:00';

test('the FORM edition runs from 00:00 SAST on 1 December to the end of 6 January', () => {
    const key = now => engine({ now }).run('jcEd().key');
    assert.equal(key('2026-11-30T23:59:00+02:00'), 'maurten');
    assert.equal(key('2026-12-01T00:00:00+02:00'), 'form');
    assert.equal(key('2027-01-06T23:59:00+02:00'), 'form');
    assert.equal(key('2027-01-07T00:00:00+02:00'), 'maurten');
});

test('it is active during its window even before the config row is moved', async () => {
    const e = engine({ now: IN_CHALLENGE });
    await e.run('jcInit()');
    assert.equal(e.run('jcIsActive()'), true);
    assert.equal(e.run('jcDateRange().end.toISOString()'), '2027-01-06T21:59:59.000Z');
});

test('a disabled config still switches the challenge off', async () => {
    const e = engine({ now: IN_CHALLENGE, config: { enabled: false } });
    await e.run('jcInit()');
    assert.equal(e.run('jcIsActive()'), false);
});

test('preview works for testers only', async () => {
    const before = '2026-11-28T10:00:00+02:00';
    const tester = engine({ now: before, search: '?preview=form', user: { id: 'tester' } });
    await tester.run('jcInit()');
    assert.equal(tester.run('jcEd().key'), 'form');
    const member = engine({ now: before, search: '?preview=form', user: { id: 'someone' } });
    await member.run('jcInit()');
    assert.equal(member.run('jcEd().key'), 'maurten');
});

test('progress comes from the FORM standings, with bonus days', async () => {
    const rows = [{ user_id: 'u1', temp_logs_rewarded: 13, draw_entries: 2, qualified_for_draw: true, christmas_swim: true, new_year_swim: false }];
    const e = engine({ now: IN_CHALLENGE, rows });
    await e.run('jcInit()');
    const score = await e.run('jcGetMyScore()');
    assert.ok(e.calls.includes('get_form_challenge_standings'));
    assert.ok(!e.calls.includes('get_challenge_leaders'));
    assert.deepEqual([score.logs, score.entries, score.inDraw, score.christmas, score.newYear], [13, 2, true, true, false]);
});

test('a log still shows progress when the points feed refuses it', async () => {
    const rows = [{ user_id: 'u1', temp_logs_rewarded: 5, draw_entries: 0, qualified_for_draw: false }];
    const e = engine({ now: IN_CHALLENGE, rows });
    await e.run("jcAwardPoints('temp_log', { refId: 'x' })");
    assert.deepEqual(e.toasts, ['5/12 swim days to enter']);
});

test('dashboard card and draw view show twelve boxes and no monthly wording', async () => {
    const e = engine({ now: IN_CHALLENGE });
    await e.run('jcInit()');
    const card = e.run("jcRenderDashboardCard({ logs: 4, christmas: false, newYear: false }, 28, null)");
    const view = e.run("jcRenderDrawView([{ user_id: 'u1', display_name: 'A B', temp_logs_rewarded: 4, draw_entries: 0, qualified_for_draw: false }])");
    for (const html of [card, view]) {
        assert.match(html, /4\/12 swim days/);
        assert.match(html, /class="jc-tracker"/);
        assert.equal((html.match(/data-lucide="check"/g) || []).length, 4);
        assert.doesNotMatch(html, /Maurten|October|Gel/);
    }
    assert.match(card, /FORM Smart Swim 2 goggles/);
    assert.match(view, /8 more swim days/);
});

test('share messages name the challenge and prize', async () => {
    const e = engine({ now: IN_CHALLENGE });
    assert.match(e.run("jcBuildShareText('whatsapp_share', {}, { inDraw: false })"), /12 Swims of Christmas.*FORM Smart Swim 2/);
    assert.match(e.run("jcBuildShareText('temp_log', { spotName: 'Big Bay', temp: 15 }, null)"), /15°C at Big Bay/);
});

test('page, config and database file state the same dates and rules', () => {
    const page = read('partners/form.html');
    const config = read('site-config.js');
    const sql = read('sql/applied/2026-11-27_form-12-swims-standings.sql');
    const app = read('app-june.js');
    for (const text of [page, app]) {
        for (const phrase of [/12 different days/, /midnight on 6 January/, /3 entries at most/, /South African address/, /7 January 2027/]) assert.match(text, phrase);
    }
    assert.match(config, /'2026-12': \{[\s\S]{0,300}endDate:\s+'2027-01-06'/);
    assert.match(config, /form:\s+\{ challengeMonth: '2026-12' \}/);
    assert.match(sql, /date '2026-12-01' AS first_day, date '2027-01-06' AS last_day/);
    assert.match(sql, /date '2026-12-25' AS christmas, date '2027-01-01' AS new_year, 12 AS target/);
    assert.doesNotMatch(page, /equal odds|coming soon/i);
});
