// SwimLoading v2 — Club (swim clubs: Aquasharks swimmer + parent views). Inert unless <html class="ui-v2">.
//
// Club rules (CLAUDE.md), stated for this file:
//   Club: Aquasharks (swim_club, Britt). K8 dormant. DUC's open-water view is NOT changed here.
//   Gate: the swimmer app does not read window._clubFeatures (that is club-admin.html only). Its
//         gates are club_type === 'swim_club', a linked roster, features.progress_reports. This layer is
//         additionally behind the ui-v2 opt-in.
//   Shared code: none edited. app-club.js is untouched; this file wraps two of its functions.
//
// What v1 did for a swimmer: one long page where "My Week" hid the next gala inside it, the
// attendance control was an unlabeled "?" circle that cycled three states, and the coach's
// announcements sat below the fold. v2 puts what a swimmer or parent needs this week first:
//   1. This week   - each session with explicit Going / Can't make it (parents: read-only status)
//   2. Next gala   - countdown, venue, entry deadline, straight to entries
//   3. From the coach (announcements), Progress reports, Health
//   4. My results  - PBs, qualifying-time bars, event graphs (collapsed)
// v1's own renderers still produce those blocks; v2 re-orders them and builds cards 1 and 2 itself.
//
// DATA FIX (do not "simplify" this away): v1 keys attendance by d.toISOString().slice(0,10) on a local
// midnight date, which in South Africa (UTC+2) is the PREVIOUS day. The coach register (coach.html)
// reads club_session_attendance by LOCAL date, so a swimmer's "Going" written by v1 lands on the wrong
// day and the coach does not see it. v2 writes and reads LOCAL dates. Existing rows written by v1 sit a
// day early and are not shown here (reading them would mis-attribute Monday's rows to Tuesday).
// Statuses: attending | absent | catch_up. catch_up is set by the coach; the swimmer cannot overwrite it.
(function () {
    'use strict';
    if (!(window.V2 && window.V2.enabled)) return;

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function icons() { if (typeof initIcons === 'function') initIcons(); else if (window.lucide) window.lucide.createIcons(); }
    function pad(n) { return String(n).padStart(2, '0'); }
    function ld(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }   // LOCAL date, never toISOString
    var DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    var S = { att: {}, ctx: null, mode: 'swimmer', week: null, gala: null, more: 0, events: [], onChange: null };

    function ctxFor(mode) {
        if (mode === 'parent') {
            var l = (typeof parentLinks !== 'undefined' && parentLinks || [])[typeof activeParentIndex !== 'undefined' ? activeParentIndex : 0];
            return l && l.club_roster ? { club: l.clubs, roster: l.club_roster, readOnly: true } : null;
        }
        var m = (typeof currentUserClubs !== 'undefined' && currentUserClubs || [])[typeof activeClubIndex !== 'undefined' ? activeClubIndex : 0];
        return m && m.club_roster ? { club: m.clubs, roster: m.club_roster, readOnly: false } : null;
    }

    // ── This week (same rules as v1 renderPlanningCard, but local dates) ────────
    function buildWeek(club, cat) {
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var dow = today.getDay();
        var monday = new Date(today);
        monday.setDate(today.getDate() + (dow === 0 ? 1 : -(dow - 1)));      // Sunday shows NEXT week, as v1
        var schedule = club.training_schedule || [];
        var out = [];
        for (var i = 0; i < 7; i++) {
            var d = new Date(monday); d.setDate(monday.getDate() + i);
            var dayNum = d.getDay();
            schedule.filter(function (s) {
                if (s.day !== dayNum) return false;
                if (s.type === 'masters') return true;                        // masters always show
                if (cat && s.squads && s.squads.length) {
                    return s.squads.some(function (sq) { return cat.toLowerCase().indexOf(sq.toLowerCase()) >= 0 || sq.toLowerCase().indexOf(cat.toLowerCase()) >= 0; });
                }
                return true;
            }).sort(function (a, b) { return String(a.start).localeCompare(String(b.start)); })
              .forEach(function (s) { out.push({ date: d, dateStr: ld(d), dayName: DAY[dayNum], session: s }); });
        }
        return { list: out, showingNext: dow === 0, todayStr: ld(today) };
    }
    function toMins(t) { var p = String(t || '00:00').split(':').map(Number); return (p[0] || 0) * 60 + (p[1] || 0); }
    function started(ws, week) {
        var now = new Date(); var nm = now.getHours() * 60 + now.getMinutes();
        return ws.dateStr < week.todayStr || (ws.dateStr === week.todayStr && toMins(ws.session.start) <= nm);
    }
    function attKey(dateStr, start) { return dateStr + '|' + start; }

    function statusBlock(ws, week, readOnly) {
        var s = ws.session, st = S.att[attKey(ws.dateStr, s.start)] || null, past = started(ws, week);
        if (s.type === 'dryland') return '<div class="v2-cs-note"><i data-lucide="dumbbell"></i>Dryland' + (s.note ? ' · ' + esc(s.note) : ' · compulsory') + '</div>';
        if (st === 'catch_up') return '<div class="v2-cs-pill v2-cs-catch"><i data-lucide="calendar-check"></i>Catch-up, booked by your coach</div>';
        if (readOnly) {
            var label = st === 'attending' ? (past ? 'Attended' : 'Going') : st === 'absent' ? (past ? 'Missed' : "Can't make it") : 'Not answered yet';
            var cls = st === 'attending' ? 'v2-cs-ok' : st === 'absent' ? 'v2-cs-no' : 'v2-cs-none';
            return '<div class="v2-cs-pill ' + cls + '">' + esc(label) + '</div>';
        }
        var yes = past ? 'I was there' : 'Going', no = past ? 'I missed it' : "Can't make it";
        return '<div class="v2-cs-seg" role="group" aria-label="Attendance">' +
            '<button type="button" data-set="attending" aria-pressed="' + (st === 'attending') + '" class="' + (st === 'attending' ? 'on yes' : '') + '"><i data-lucide="check"></i>' + yes + '</button>' +
            '<button type="button" data-set="absent" aria-pressed="' + (st === 'absent') + '" class="' + (st === 'absent' ? 'on no' : '') + '"><i data-lucide="x"></i>' + no + '</button></div>';
    }

    function sessionRow(ws, week, readOnly) {
        var s = ws.session, isToday = ws.dateStr === week.todayStr, masters = s.type === 'masters';
        return '<div class="v2-cs' + (isToday ? ' today' : '') + '" data-date="' + ws.dateStr + '" data-start="' + esc(s.start) + '">' +
            '<div class="v2-cs-date"><span class="v2-cap">' + ws.dayName + '</span><b>' + ws.date.getDate() + '</b></div>' +
            '<div class="v2-cs-main">' +
                '<div class="v2-cs-time"><b>' + esc(s.start) + (s.end ? ' – ' + esc(s.end) : '') + '</b>' +
                    (isToday ? '<span class="v2-cs-tag now">TODAY</span>' : '') + (masters ? '<span class="v2-cs-tag masters">Masters</span>' : '') + '</div>' +
                '<div class="v2-sub">' + esc(s.label || (masters ? 'Masters' : s.type === 'dryland' ? 'Dryland' : 'Squad')) + (s.arrive_by ? ' · arrive ' + esc(s.arrive_by) : '') + '</div>' +
                statusBlock(ws, week, readOnly) +
            '</div></div>';
    }

    function weekCard(readOnly) {
        var week = S.week, list = week.list;
        if (!list.length) {
            var none = !(S.ctx.club.training_schedule || []).length;
            return '<section class="v2-card v2-club-card" id="v2ClubWeek"><div class="v2-card-title">This week</div>' +
                '<div class="v2-sub" style="margin-top:6px">' + (none ? 'No training schedule set yet.' : 'No sessions this week.') + '</div></section>';
        }
        var squad = list.filter(function (w) { return w.session.type === 'squad' && started(w, week); });
        var squadDone = squad.filter(function (w) { return S.att[attKey(w.dateStr, w.session.start)] === 'attending'; }).length;
        var mastersDone = list.filter(function (w) { return w.session.type === 'masters' && S.att[attKey(w.dateStr, w.session.start)] === 'attending'; }).length;
        var hasMasters = list.some(function (w) { return w.session.type === 'masters'; });
        var earlier = list.filter(function (w) { return w.dateStr < week.todayStr; });
        var current = list.filter(function (w) { return w.dateStr >= week.todayStr; });
        var stats = squad.length ? squadDone + ' of ' + squad.length + ' squad sessions attended' : (readOnly ? '' : 'Tap Going or Can\'t make it for each session');
        return '<section class="v2-card v2-club-card" id="v2ClubWeek">' +
            '<div class="v2-between"><div class="v2-card-title">' + (week.showingNext ? 'Next week' : 'This week') + '</div></div>' +
            (stats ? '<div class="v2-sub" style="margin:2px 0 var(--sl-s2)">' + esc(stats) + '</div>' : '') +
            (earlier.length ? '<details class="v2-cs-earlier"><summary>Earlier this week (' + earlier.length + ')</summary>' + earlier.map(function (w) { return sessionRow(w, week, readOnly); }).join('') + '</details>' : '') +
            (current.length ? current.map(function (w) { return sessionRow(w, week, readOnly); }).join('') : '<div class="v2-sub">No more sessions this week.</div>') +
            (hasMasters ? '<div class="v2-cap" style="margin-top:var(--sl-s3)">Masters this week: ' + mastersDone + '. Masters sessions are optional; Britt recommends at least 1 per week.</div>' : '') +
            '</section>';
    }

    // ── Save attendance: the same table and conflict target v1 uses, with the LOCAL date ──
    async function saveAttendance(date, start, next) {
        var ctx = S.ctx, key = attKey(date, start), prev = S.att[key] || null;
        var target = (prev === next) ? null : next;                          // tapping the active choice clears it
        if (prev === 'catch_up') return;                                      // coach-owned, never overwritten
        if (target) S.att[key] = target; else delete S.att[key];
        rerenderWeek();
        if (S.onChange) S.onChange();
        try {
            var res;
            if (!target) {
                res = await supabaseClient.from('club_session_attendance').delete()
                    .eq('roster_id', ctx.roster.id).eq('session_date', date).eq('session_start', start);
            } else {
                res = await supabaseClient.from('club_session_attendance').upsert(
                    { roster_id: ctx.roster.id, club_id: ctx.club.id, session_date: date, session_start: start, status: target },
                    { onConflict: 'roster_id,session_date,session_start' });
            }
            if (res && res.error) throw res.error;
        } catch (e) {
            console.warn('Attendance save failed:', e);
            if (prev) S.att[key] = prev; else delete S.att[key];
            rerenderWeek();
            if (S.onChange) S.onChange();
            if (typeof showToast === 'function') showToast('Could not save that. Please try again.', 'error');
        }
    }

    function bindWeek() {
        var card = document.getElementById('v2ClubWeek');
        if (!card) return;
        card.querySelectorAll('.v2-cs-seg button').forEach(function (b) {
            b.addEventListener('click', function () {
                var row = b.closest('.v2-cs');
                saveAttendance(row.getAttribute('data-date'), row.getAttribute('data-start'), b.getAttribute('data-set'));
            });
        });
    }
    function rerenderWeek() {
        var card = document.getElementById('v2ClubWeek');
        if (!card) return;
        var open = card.querySelector('.v2-cs-earlier') && card.querySelector('.v2-cs-earlier').open;
        card.outerHTML = weekCard(S.ctx.readOnly);
        var fresh = document.getElementById('v2ClubWeek');
        if (open && fresh && fresh.querySelector('.v2-cs-earlier')) fresh.querySelector('.v2-cs-earlier').open = true;
        icons(); bindWeek();
    }

    // ── Next gala ───────────────────────────────────────────────────────────
    function fmtDay(v) { var d = new Date(String(v).length <= 10 ? v + 'T12:00:00' : v); return isNaN(d) ? '' : d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' }); }
    function galaCard(events, readOnly) {
        var g = events[0];
        if (!g) return '';
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var days = Math.round((new Date(g.event_date + 'T12:00:00') - today) / 86400000);
        var urgent = days <= 7;
        var canEnter = !readOnly && g.sessions_json && g.sessions_json.length;
        var deadline = g.entry_deadline ? fmtDay(g.entry_deadline) : '';
        var hasDetail = g.venue || g.warmup_time || g.event_start || g.logistics;
        var more = events.length - 1;
        return '<section class="v2-card v2-club-card" id="v2ClubGala">' +
            '<div class="v2-between" style="align-items:flex-start">' +
                '<div class="v2-row-text"><div class="v2-eyebrow">Next gala</div>' +
                    '<div class="v2-card-title" style="margin:4px 0 2px">' + esc(g.title) + '</div>' +
                    '<div class="v2-sub">' + esc(fmtDay(g.event_date)) + (g.venue ? ' · ' + esc(g.venue) : '') + '</div></div>' +
                '<div class="v2-gala-days' + (urgent ? ' urgent' : '') + '"><b>' + days + '</b><span>' + (days === 1 ? 'day' : 'days') + '</span></div>' +
            '</div>' +
            (deadline ? '<div class="v2-cs-pill v2-cs-catch" style="margin-top:var(--sl-s3)"><i data-lucide="clock"></i>Entries close ' + esc(deadline) + '</div>' : '') +
            '<div class="v2-ev-row" style="margin-top:var(--sl-s3)">' +
                (canEnter ? '<button type="button" class="v2-btn v2-btn-primary v2-btn-sm" id="v2GalaEnter">Enter or view entries</button>' : '') +
                (hasDetail ? '<button type="button" class="v2-btn v2-btn-ghost v2-btn-sm" id="v2GalaInfo">Info and details</button>' : '') +
            '</div>' +
            (more > 0 && !readOnly ? '<button type="button" class="v2-link" id="v2GalaMore" style="margin-top:var(--sl-s1)">+ ' + more + ' more upcoming ' + (more === 1 ? 'gala' : 'galas') + '</button>' : '') +
            '</section>';
    }
    function bindGala(g) {
        var e = document.getElementById('v2GalaEnter'), i = document.getElementById('v2GalaInfo'), m = document.getElementById('v2GalaMore');
        if (e) e.addEventListener('click', function () { if (typeof showClubSubTab === 'function') showClubSubTab('galas'); });
        if (m) m.addEventListener('click', function () { if (typeof showClubSubTab === 'function') showClubSubTab('galas'); });
        if (i && g) i.addEventListener('click', function () { if (typeof openGalaDetail === 'function') openGalaDetail(g.id); });
    }

    // ── Re-compose v1's rendered Home ────────────────────────────────────────────
    function textOf(n) { return (n.textContent || '').replace(/\s+/g, ' '); }
    async function compose(container, mode) {
        var ctx = ctxFor(mode);
        if (!ctx || !ctx.roster || !ctx.roster.id || !ctx.club || ctx.club.club_type !== 'swim_club') return;
        var home = mode === 'parent' ? container : container.querySelector('#clubSubHome');
        if (!home || home.getAttribute('data-v2')) return;
        S.ctx = ctx; S.mode = mode;

        var from = new Date(); from.setDate(from.getDate() - 28);
        var to = new Date(); to.setDate(to.getDate() + 28);
        var res = await Promise.all([
            supabaseClient.from('club_session_attendance').select('session_date, session_start, status')
                .eq('roster_id', ctx.roster.id).gte('session_date', ld(from)).lte('session_date', ld(to)),
            supabaseClient.from('club_events')
                .select('id, title, event_date, venue, warmup_time, event_start, logistics, entry_deadline, sessions_json')
                .eq('club_id', ctx.club.id).gte('event_date', ld(new Date())).order('event_date').limit(5)
        ]);
        S.att = {};
        ((res[0] && res[0].data) || []).forEach(function (a) { S.att[attKey(a.session_date, a.session_start)] = a.status; });
        var events = (res[1] && res[1].data) || [];
        S.week = buildWeek(ctx.club, ctx.roster.category || '');

        var kids = [].slice.call(home.children), pick = function (fn) { var i = kids.findIndex(fn); return i >= 0 ? kids.splice(i, 1)[0] : null; };
        var banner = mode === 'parent' ? pick(function (n) { return /read only/i.test(textOf(n)); }) : null;
        var planning = pick(function (n) { return /My Week/.test(textOf(n)) && n.classList.contains('card'); });
        var health = pick(function (n) { return n.id === 'clubHealthCard'; });
        var ann = pick(function (n) { return /From the coach/.test(textOf(n)); });
        var progress = pick(function (n) { return /Progress Report/.test(textOf(n)); });
        var hero = kids.shift() || null;                                     // v1's first block is the swimmer hero
        var rest = kids;                                                     // qualifying-time bars, event graphs

        var weekEl = document.createElement('div'); weekEl.innerHTML = weekCard(ctx.readOnly);
        var galaEl = document.createElement('div'); galaEl.innerHTML = galaCard(events, ctx.readOnly);
        if (planning) planning.classList.add('v2-gone');

        var results = document.createElement('details');
        results.className = 'v2-club-results';
        results.innerHTML = '<summary>My results <span class="v2-cap">PBs, qualifying times, event graphs</span></summary>';
        rest.forEach(function (n) { results.appendChild(n); });

        home.setAttribute('data-v2', '1');
        [banner, hero, weekEl.firstElementChild, galaEl.firstElementChild, ann, progress, health, planning].forEach(function (n) { if (n) home.appendChild(n); });
        if (rest.length) home.appendChild(results);

        icons(); bindWeek(); bindGala(events[0]);
    }

    // ── Shared with Today (app-v2-today.js): the same week model, rows and attendance save ─────────────
    // Loads what Today's club card needs for the swimmer (or, for a parent, the linked child). Returns
    // null when the user is not in a swim club with a linked roster. Uses the same state object as the
    // Club page, so an attendance mark made on either shows on both.
    async function prepare() {
        var ctx = ctxFor('swimmer'), mode = 'swimmer';
        if (!ctx) { ctx = ctxFor('parent'); mode = 'parent'; }
        if (!ctx || !ctx.roster || !ctx.roster.id || !ctx.club || ctx.club.club_type !== 'swim_club') return null;
        S.ctx = ctx; S.mode = mode;
        var from = new Date(); from.setDate(from.getDate() - 28);
        var to = new Date(); to.setDate(to.getDate() + 28);
        var res = await Promise.all([
            supabaseClient.from('club_session_attendance').select('session_date, session_start, status')
                .eq('roster_id', ctx.roster.id).gte('session_date', ld(from)).lte('session_date', ld(to)),
            supabaseClient.from('club_events').select('id, title, event_date, venue, entry_deadline, sessions_json')
                .eq('club_id', ctx.club.id).gte('event_date', ld(new Date())).order('event_date').limit(3)
        ]);
        S.att = {};
        ((res[0] && res[0].data) || []).forEach(function (a) { S.att[attKey(a.session_date, a.session_start)] = a.status; });
        S.events = (res[1] && res[1].data) || [];
        S.week = buildWeek(ctx.club, ctx.roster.category || '');
        return S;
    }
    function bindRows(container) {
        container.querySelectorAll('.v2-cs-seg button').forEach(function (b) {
            b.addEventListener('click', function () {
                var row = b.closest('.v2-cs');
                saveAttendance(row.getAttribute('data-date'), row.getAttribute('data-start'), b.getAttribute('data-set'));
            });
        });
    }
    window.V2.club = {
        state: S, prepare: prepare, sessionRow: sessionRow, started: started, attKey: attKey, bindRows: bindRows,
        fmtDay: fmtDay
    };

    function wrap(name, mode) {
        var orig = window[name];
        if (typeof orig !== 'function') return;
        window[name] = async function () {
            var container = document.getElementById('clubPageContent');
            if (container) container.style.visibility = 'hidden';            // no flash of the v1 layout
            try {
                var r = await orig.apply(this, arguments);
                try { await compose(container || document.getElementById('clubPageContent'), mode); } catch (e) { console.warn('Club v2 layout skipped:', e); }
                return r;
            } finally { if (container) container.style.visibility = ''; }
        };
    }
    wrap('renderSwimClub', 'swimmer');
    wrap('renderActiveParentSwimmer', 'parent');

    // Page title
    function mount() {
        var page = document.getElementById('club');
        if (!page || document.getElementById('v2ClubHead')) return;
        var h = document.createElement('div');
        h.id = 'v2ClubHead'; h.className = 'v2-swims-title'; h.textContent = 'Club';
        page.insertBefore(h, page.firstChild);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
