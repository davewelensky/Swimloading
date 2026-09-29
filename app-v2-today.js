// SwimLoading v2 — Today screen. Inert unless <html class="ui-v2"> (see app-v2.js).
//
// Replaces the v1 Home blocks (hidden by CSS under html.ui-v2) with four zones:
//   1. the water at MY spot  (hero temperature + hazard banner)
//   2. one action            (log the water; Strava suggestion when a swim is found)
//   3. what's next           (next swim, one challenge card)
//   4. around me             (3 latest spots)
// v1's loadDashboard() keeps running underneath: it fills shared caches (spotTempEstimate,
// conditionsCache, activeHazardsBySpot) other screens rely on. Today runs its own small
// queries and does not depend on those caches. Splitting the cache fill out of the v1 loader
// is a follow-up (see V2_INVENTORY.md, cross-cutting problem 9).
//
// Data only ever comes from what the app already reads: temp_logs, spot_temp_estimate,
// latest_spot_temps, hazard_reports, swim_events, swim_participants, the challenge engine
// (jcInit / jcGetMyScore) and Strava (fetchStravaActivities). Nothing here writes data except
// joinEvent(), which is the existing v1 RSVP path (with its safety-info gate).
(function () {
    'use strict';
    if (!(window.V2 && window.V2.enabled)) return;

    var COPY = window.V2.COPY;   // defined in app-v2.js

    var S = { token: 0, inflight: false, lastRun: 0, mySpots: [], idx: 0, latest: [], hazards: [], heroCache: {} };

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function icons() { if (typeof initIcons === 'function') initIcons(); else if (window.lucide) window.lucide.createIcons(); }
    function ago(iso) {
        var t = typeof getTimeAgo === 'function' ? getTimeAgo(new Date(iso)) : '';
        return t.replace(/^1 (\w+)s ago$/, '1 $1 ago');     // getTimeAgo says "1 days ago"
    }
    // v1's scale ends in red (26C+). In v2 red means danger and nothing else, so hot water is orange.
    function tempColour(t) {
        var c = typeof getTempColor === 'function' ? getTempColor(t) : 'var(--sl-cyan)';
        return /^#(ef4444|dc2626|b91c1c)$/i.test(c) ? '#f97316' : c;
    }
    function isPool(sp) { var w = sp && (sp.water_type || ''); return w === 'POOL' || w === 'TIDAL_POOL'; }
    function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
    function spotById(id) { return (typeof spots !== 'undefined' && spots || []).find(function (s) { return s.id === id; }); }
    function homeDomain() { return (typeof currentUserProfile !== 'undefined' && currentUserProfile && currentUserProfile.home_domain) || null; }
    function fmtWhen(iso) {
        var d = new Date(iso), now = new Date();
        var tom = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        var day = d.toDateString() === now.toDateString() ? 'Today'
            : d.toDateString() === tom.toDateString() ? 'Tomorrow'
            : d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });
        return day + ' · ' + d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
    }

    // ── Shell ──────────────────────────────────────────────────────────────
    function mount() {
        var dash = $('dashboard');
        if (!dash || $('v2Today')) return;
        var t = document.createElement('div');
        t.id = 'v2Today';
        t.innerHTML =
            '<div id="v2tHazard"></div>' +
            '<div id="v2tClubTop"></div>' +
            '<div id="v2tHero" class="v2-hero v2-skel" aria-live="polite"></div>' +
            '<button class="v2-btn v2-btn-primary" id="v2tLog" type="button">' +
                '<i data-lucide="plus"></i>' + esc(COPY.action) + '</button>' +
            '<div class="v2-hint" id="v2tHint">' + esc(COPY.hint) + '</div>' +
            '<div id="v2tStrava"></div>' +
            '<div id="v2tClub"></div>' +
            '<div id="v2tNext"></div>' +
            '<div id="v2tChal"></div>' +
            '<div id="v2tAround"></div>';
        dash.insertBefore(t, dash.firstChild);
        $('v2tLog').addEventListener('click', function () { showPage('logTemp'); });
        icons();
    }

    // ── Data: my spots ─────────────────────────────────────────────────────
    async function loadSpotsAndLatest() {
        var uid = currentUser.id;
        var res = await Promise.all([
            supabaseClient.from('temp_logs').select('spot_id, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(60),
            supabaseClient.from('latest_spot_temps').select('spot_id, spot_name, spot_code, temp_c, updated_at, domain, water_type').order('updated_at', { ascending: false }).limit(300)
        ]);
        var mine = [];
        ((res[0] && res[0].data) || []).forEach(function (r) { if (r.spot_id && mine.indexOf(r.spot_id) < 0) mine.push(r.spot_id); });
        S.latest = (res[1] && res[1].data) || [];

        var list = mine.slice(0, 3).map(spotById).filter(Boolean);
        if (!list.length) {
            // New swimmer: fall back to the freshest spot in their home region, then anywhere.
            var dom = homeDomain();
            var pool = S.latest.filter(function (l) { return !dom || l.domain === dom; });
            if (!pool.length) pool = S.latest;
            list = pool.slice(0, 3).map(function (l) { return spotById(l.spot_id) || { id: l.spot_id, name: l.spot_name, code: l.spot_code, domain: l.domain }; });
        }
        S.mySpots = list;
        if (S.idx >= list.length) S.idx = 0;
    }

    // ── Hero: the water at one spot ────────────────────────────────────────
    async function fetchReading(spotId) {
        var since = new Date(Date.now() - 72 * 3600e3).toISOString();
        var res = await Promise.all([
            supabaseClient.from('temp_logs').select('temp_c, conditions, created_at').eq('spot_id', spotId).gte('created_at', since).order('created_at', { ascending: false }).limit(30),
            supabaseClient.from('spot_temp_estimate').select('best_c, best_source, confidence').eq('spot_id', spotId).maybeSingle()
        ]);
        return { logs: (res[0] && res[0].data) || [], est: res[1] && res[1].data };
    }

    function condPill(c) {
        if (!c) return '';
        var k = String(c).toLowerCase();
        var cls = k === 'calm' ? 'ok' : k === 'extreme' ? 'bad' : 'warn';
        return '<span class="v2-pill v2-pill-' + cls + '">' + esc(cap(c)) + '</span>';
    }

    function renderHero(reading) {
        var el = $('v2tHero'); if (!el) return;
        el.classList.remove('v2-skel');
        var sp = S.mySpots[S.idx];
        var switcher = S.mySpots.length > 1
            ? '<div class="v2-spotswitch" role="tablist">' + S.mySpots.map(function (s, i) {
                return '<button type="button" role="tab" aria-selected="' + (i === S.idx) + '" class="' + (i === S.idx ? 'on' : '') + '" data-i="' + i + '">' + esc(s.name) + '</button>';
            }).join('') + '</div>'
            : '';
        if (!sp) {
            el.innerHTML = '<div class="v2-hero-name">No spot yet</div><div class="v2-sub" style="margin-top:8px">Report the water once, or pick a spot in Spots, and your temperature shows up here.</div>' +
                '<button class="v2-btn v2-btn-ghost" type="button" style="margin-top:16px" onclick="showPage(\'history\')">Browse spots</button>';
            return;
        }
        var head = switcher || '<div class="v2-hero-name">' + esc(sp.name) + '</div>';
        var body;
        if (reading && reading.logs.length) {
            var l0 = reading.logs[0];
            var t0 = new Date(l0.created_at).getTime();
            var ref = null;
            for (var i = 1; i < reading.logs.length; i++) {
                var dt = t0 - new Date(reading.logs[i].created_at).getTime();
                if (dt >= 12 * 3600e3 && dt <= 48 * 3600e3) { ref = reading.logs[i]; break; }
            }
            var delta = '';
            if (ref) {
                var d = Math.round((Number(l0.temp_c) - Number(ref.temp_c)) * 10) / 10;
                delta = d === 0 ? '<span class="v2-delta">Same as yesterday</span>'
                    : '<span class="v2-delta"><b class="' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '+' : '') + d.toFixed(1) + '°</b> since yesterday</span>';
            }
            var n24 = reading.logs.filter(function (r) { return Date.now() - new Date(r.created_at).getTime() < 86400e3; }).length;
            var pool = isPool(sp);
            body =
                '<div class="v2-temp" style="color:' + (pool ? 'var(--sl-cyan)' : tempColour(Number(l0.temp_c))) + '" aria-label="' + Number(l0.temp_c).toFixed(1) + ' degrees Celsius">' + Number(l0.temp_c).toFixed(1) + '<small>°C</small></div>' +
                '<div class="v2-hero-row">' + (pool ? '<span class="v2-pill">Pool</span>' : condPill(l0.conditions)) + delta + '</div>' +
                '<div class="v2-cap" style="margin-top:12px">Reported ' + esc(ago(l0.created_at)) + (n24 > 1 ? ' · ' + n24 + ' reports in 24 hours' : '') + '</div>';
        } else if (reading && reading.est && reading.est.best_c != null) {
            body =
                '<div class="v2-temp" style="color:' + tempColour(Number(reading.est.best_c)) + '">' + Number(reading.est.best_c).toFixed(1) + '<small>°C</small></div>' +
                '<div class="v2-hero-row"><span class="v2-pill">Estimate</span></div>' +
                '<div class="v2-cap" style="margin-top:12px">No swimmer reports in 3 days. ' + (reading.est.best_source === 'swimmer' ? 'Based on an older swimmer report.' : 'From a sea-surface model, not a swimmer.') + '</div>';
        } else {
            body =
                '<div class="v2-temp v2-temp-empty">--</div>' +
                '<div class="v2-cap" style="margin-top:12px">No reports at ' + esc(sp.name) + ' yet. Be the first.</div>';
        }
        el.innerHTML = head + body;
        el.querySelectorAll('.v2-spotswitch button').forEach(function (b) {
            b.addEventListener('click', function () { S.idx = Number(b.getAttribute('data-i')); showHero(); });
        });
        var name = el.querySelector('.v2-hero-name');
        if (name && sp) { name.style.cursor = 'pointer'; name.addEventListener('click', function () { goToSpotTrend(sp.id, sp.name, sp.code); }); }
    }

    async function showHero() {
        var sp = S.mySpots[S.idx];
        paintHazard();
        if (!sp) { renderHero(null); return; }
        var cached = S.heroCache[sp.id];
        renderHero(cached || null);           // switcher responds instantly; numbers follow
        if (!cached) {
            var token = S.token;
            try {
                var r = await fetchReading(sp.id);
                S.heroCache[sp.id] = r;
                if (token === S.token && S.mySpots[S.idx] && S.mySpots[S.idx].id === sp.id) renderHero(r);
            } catch (e) {
                console.warn('Today hero:', e);
                var el = $('v2tHero');
                if (el) { el.classList.remove('v2-skel'); el.innerHTML += '<div class="v2-cap" style="margin-top:12px">Could not load this spot. <button class="v2-link" type="button" id="v2tRetry">Try again</button></div>'; var b = $('v2tRetry'); if (b) b.onclick = showHero; }
            }
        }
    }

    // ── Hazard banner ──────────────────────────────────────────────────────
    // Active caution/danger reports near the swimmer (fetched once per load) ...
    async function renderHazard() {
        try {
            var res = await supabaseClient.from('hazard_reports').select('spot_id, severity, title, hazard_type, active_until').is('resolved_at', null);
            var dom = homeDomain();
            var relevant = {};
            S.mySpots.forEach(function (s) { relevant[s.id] = 1; });
            (typeof spots !== 'undefined' && spots || []).forEach(function (s) { if (dom && s.domain === dom) relevant[s.id] = 1; });
            var now = Date.now();
            var rank = { danger: 3, caution: 2, info: 1 };
            S.hazards = ((res && res.data) || []).filter(function (h) {
                if (h.active_until && new Date(h.active_until).getTime() <= now) return false;
                return relevant[h.spot_id] && (rank[h.severity] || 0) >= 2;
            }).sort(function (a, b) { return (rank[b.severity] || 0) - (rank[a.severity] || 0); });
        } catch (e) { console.warn('Today hazard:', e); S.hazards = []; }
        paintHazard();
    }

    // ... and the banner shows only what matters for the spot on screen: hazards at that spot or in its
    // region. A sea hazard never shows over a pool. Re-run whenever the hero spot changes.
    function paintHazard() {
        var el = $('v2tHazard'); if (!el) return;
        var sp = S.mySpots[S.idx];
        var rank = { danger: 3, caution: 2, info: 1 };
        var list = (!sp || isPool(sp)) ? [] : S.hazards.filter(function (h) {
            var hs = spotById(h.spot_id);
            return h.spot_id === sp.id || (hs && sp.domain && hs.domain === sp.domain);
        }).sort(function (a, b) { return (rank[b.severity] || 0) - (rank[a.severity] || 0); });
        if (!list.length) { el.innerHTML = ''; return; }
        var h = list[0], hsp = spotById(h.spot_id);
        var until = h.active_until ? ' Active until ' + new Date(h.active_until).toLocaleString('en-ZA', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + '.' : '';
        var label = h.severity === 'danger' ? 'DANGER' : 'CAUTION';
        el.innerHTML =
            '<button class="v2-hazard v2-hazard-' + h.severity + '" type="button" onclick="showPage(\'safety\')">' +
                '<i data-lucide="triangle-alert"></i>' +
                '<span><b><span class="v2-tag">' + label + '</span>' + esc(h.title || cap(String(h.hazard_type || 'Hazard').replace(/_/g, ' '))) + '</b>' +
                '<span class="v2-sub">' + (hsp ? esc(hsp.name) + '.' : '') + esc(until) + (list.length > 1 ? ' +' + (list.length - 1) + ' more.' : '') + ' Tap for details.</span></span>' +
            '</button>';
        icons();
    }

    // ── Strava suggestion ──────────────────────────────────────────────────
    async function renderStrava() {
        var el = $('v2tStrava'); if (!el) return;
        try {
            if (typeof fetchStravaActivities !== 'function') return;
            var acts = await fetchStravaActivities();
            if (!acts || typeof acts === 'string') { el.innerHTML = ''; return; }
            var cutoff = Date.now() - 24 * 3600e3;
            var a = acts.find(function (x) { return !x.already_imported && x.start_date_local && new Date(x.start_date_local).getTime() > cutoff; });
            if (!a) { el.innerHTML = ''; return; }
            var time = new Date(a.start_date_local).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
            el.innerHTML =
                '<button class="v2-suggest" type="button" onclick="openStravaImportModal()">' +
                    '<i data-lucide="activity"></i>' +
                    '<span class="v2-row-text"><b>Swim at ' + esc(time) + ' found on Strava</b><br><span class="v2-sub">' +
                        (a.matched_spot_name ? esc(a.matched_spot_name) + '. ' : '') + 'Add the water temperature.</span></span>' +
                    '<i data-lucide="chevron-right" class="v2-chev"></i>' +
                '</button>';
            icons();
        } catch (e) { /* Strava is optional */ }
    }

    // ── Club (swim-club members and parents; Aquasharks) ─────────────────────────
    // Training today (or the next session) with the attendance control, and the next gala. Uses the Club
    // module's own week model, rows and save (app-v2-club.js), so a mark made here shows on the Club page
    // and the coach register sees it on the right (local) date. It leads the screen on a training day and
    // sits below the log button otherwise. Non-members and open-water clubs (DUC) get nothing.
    function paintClub() {
        var api = window.V2 && window.V2.club, top = $('v2tClubTop'), low = $('v2tClub');
        if (!api || !top || !low) return;
        var st = api.state;
        top.innerHTML = ''; low.innerHTML = '';
        if (!st || !st.ctx || !st.week) return;
        var week = st.week, ro = st.ctx.readOnly;
        var today = week.list.filter(function (w) { return w.dateStr === week.todayStr; });
        var next = today.length ? null : week.list.filter(function (w) { return !api.started(w, week); })[0];
        var rows = today.length ? today : (next ? [next] : []);
        var g = st.events && st.events[0];
        if (!rows.length && !g) return;

        var days = g ? Math.round((new Date(g.event_date + 'T12:00:00') - new Date(new Date().setHours(0, 0, 0, 0))) / 86400000) : null;
        var deadline = g && g.entry_deadline ? api.fmtDay(g.entry_deadline) : '';
        var who = ro ? esc(st.ctx.roster.display_name) + ' · ' : '';
        var html =
            '<section class="v2-card v2-club-card v2-today-club' + (today.length ? ' is-today' : '') + '">' +
                '<div class="v2-between"><div class="v2-eyebrow">' + who + esc(st.ctx.club.name) + ' · ' + (today.length ? 'Training today' : 'Next training') + '</div>' +
                '<button type="button" class="v2-link" onclick="showPage(\'club\')">Club</button></div>' +
                rows.map(function (w) { return api.sessionRow(w, week, ro); }).join('') +
                (g ? '<button type="button" class="v2-today-gala" onclick="showPage(\'club\')">' +
                        '<span class="v2-row-text"><span class="v2-row-title">' + esc(g.title) + '</span><br><span class="v2-cap">' + days + (days === 1 ? ' day' : ' days') + ' to go' + (deadline ? ' · entries close ' + esc(deadline) : '') + '</span></span>' +
                        '<i data-lucide="chevron-right" class="v2-chev"></i></button>' : '') +
            '</section>';
        (today.length ? top : low).innerHTML = html;
        api.bindRows(today.length ? top : low);
        icons();
    }

    async function renderClub(tries) {
        var api = window.V2 && window.V2.club;
        if (!api) return;
        var st = null;
        try { st = await api.prepare(); } catch (e) { console.warn('Today club:', e); return; }
        if (!st) {
            paintClub();                                             // clears any stale card
            // club memberships load asynchronously after login; look again for a few seconds
            if ((tries || 0) < 10) setTimeout(function () { renderClub((tries || 0) + 1); }, 800);
            return;
        }
        api.state.onChange = paintClub;
        paintClub();
    }

    // ── Next swim ──────────────────────────────────────────────────────────
    async function renderNext() {
        var el = $('v2tNext'); if (!el) return;
        try {
            var res = await supabaseClient.from('swim_events').select('id, title, location_name, start_at').gte('start_at', new Date().toISOString()).neq('status', 'cancelled').order('start_at', { ascending: true }).limit(1);
            var ev = res && res.data && res.data[0];
            if (!ev) { el.innerHTML = ''; return; }
            var part = await Promise.all([
                supabaseClient.from('swim_participants').select('rsvp, status').eq('swim_event_id', ev.id).eq('user_id', currentUser.id).maybeSingle(),
                supabaseClient.from('swim_participants').select('*', { count: 'exact', head: true }).eq('swim_event_id', ev.id).eq('rsvp', 'going')
            ]);
            var mine = part[0] && part[0].data, going = (part[1] && part[1].count) || 0;
            var action = mine
                ? '<span class="v2-going"><i data-lucide="check"></i>' + (mine.rsvp === 'going' ? "You're going" : 'You said maybe') + '</span>'
                : '<button class="v2-btn v2-btn-ghost v2-btn-sm" type="button" id="v2tGoing">I\'m going</button>';
            el.innerHTML =
                '<div class="v2-h2">Next swim</div>' +
                '<div class="v2-card v2-tappable" id="v2tNextCard" role="button" tabindex="0">' +
                    '<div class="v2-between"><b class="v2-card-title">' + esc(ev.title) + '</b><span class="v2-sub">' + esc(fmtWhen(ev.start_at)) + '</span></div>' +
                    '<div class="v2-sub" style="margin:2px 0 14px">' + esc(ev.location_name || '') + (going ? ' · ' + going + ' going' : '') + '</div>' +
                    action +
                '</div>';
            $('v2tNextCard').addEventListener('click', function () { viewEventDetails(ev.id); });
            var g = $('v2tGoing');
            if (g) g.addEventListener('click', async function (e) {
                e.stopPropagation();
                g.disabled = true;
                try { await joinEvent(ev.id, 'going'); } catch (err) { console.warn(err); }
                renderNext();
            });
            icons();
        } catch (e) { console.warn('Today next swim:', e); }
    }

    // Where the swimmer stands in the monthly draw. Shared with the Board (app-v2-board.js) so
    // Today and Challenges always say the same thing. Same facts as the v1 dashboard card.
    function challengeStatus(score) {
        var logs = (score && score.logs) || 0, tickets = (score && score.entries) || 0;
        if (score && score.inDraw) return { headline: "You're in the draw", sub: tickets + (tickets === 1 ? ' ticket' : ' tickets') + ' in the hat', bar: 0 };
        if (logs > 0) return { headline: logs + ' of 10 to enter the draw', sub: (10 - logs) + ' to go', bar: Math.min(100, logs * 10) };
        return { headline: 'Enter the draw', sub: 'Log 10 times this month to enter', bar: 0 };
    }
    window.V2.challengeStatus = challengeStatus;

    // ── One challenge card ─────────────────────────────────────────────────
    async function renderChallenge() {
        var el = $('v2tChal'); if (!el) return;
        try {
            if (typeof jcInit !== 'function') return;
            await jcInit();
            if (typeof jcIsActive !== 'function' || !jcIsActive()) { el.innerHTML = ''; return; }
            var range = jcDateRange();
            var daysLeft = Math.max(0, Math.ceil((range.end - new Date()) / 86400000));
            var score = await jcGetMyScore();
            var month = range.end.toLocaleDateString('en-ZA', { month: 'long' });
            var st = challengeStatus(score);
            var headline = st.headline, sub = st.sub;
            var bar = st.bar ? '<div class="v2-prog"><div style="width:' + st.bar + '%"></div></div>' : '';
            var extra = ((typeof eoIsActive === 'function' && eoIsActive()) ? 1 : 0) + ((typeof ukIsActive === 'function' && ukIsActive()) ? 1 : 0);
            el.innerHTML =
                '<div class="v2-h2">Challenge</div>' +
                '<button class="v2-card v2-tappable v2-chal" type="button" onclick="showPage(\'leaderboard\')">' +
                    '<span class="v2-between"><span class="v2-eyebrow">' + esc(month) + ' · ' + daysLeft + (daysLeft === 1 ? ' day' : ' days') + ' left</span><i data-lucide="chevron-right" class="v2-chev"></i></span>' +
                    '<span class="v2-card-title" style="display:block;margin:6px 0 2px">' + esc(headline) + '</span>' +
                    '<span class="v2-sub">' + esc(sub) + (extra ? ' · ' + extra + ' more running' : '') + '</span>' + bar +
                '</button>';
            icons();
        } catch (e) { console.warn('Today challenge:', e); }
    }

    // ── Around you ─────────────────────────────────────────────────────────
    function renderAround() {
        var el = $('v2tAround'); if (!el) return;
        var dom = homeDomain();
        var skip = S.mySpots[S.idx] && S.mySpots[S.idx].id;
        var pool = S.latest.filter(function (l) { return l.spot_id !== skip; });
        var local = dom ? pool.filter(function (l) { return l.domain === dom; }) : [];
        var rows = (local.length >= 3 ? local : local.concat(pool.filter(function (l) { return local.indexOf(l) < 0; }))).slice(0, 3);
        if (!rows.length) { el.innerHTML = ''; return; }
        var flagged = {};
        S.hazards.forEach(function (h) { flagged[h.spot_id] = 1; });
        el.innerHTML =
            '<div class="v2-h2 v2-between"><span>Around you now</span><button class="v2-link" type="button" onclick="showPage(\'history\')">See all</button></div>' +
            '<div class="v2-card v2-list">' + rows.map(function (r, i) {
                return '<button class="v2-row" type="button" data-i="' + i + '">' +
                    '<span class="v2-row-text"><span class="v2-row-title">' + esc(r.spot_name) + '</span><br><span class="v2-cap">' + esc(ago(r.updated_at)) + '</span></span>' +
                    (flagged[r.spot_id] ? '<span class="v2-flag"><i data-lucide="triangle-alert"></i>Hazard</span>' : '') +
                    '<span class="v2-rowtemp" style="color:' + tempColour(Number(r.temp_c)) + '">' + Number(r.temp_c).toFixed(1) + '°</span>' +
                '</button>';
            }).join('') + '</div>';
        el.querySelectorAll('.v2-row').forEach(function (b) {
            b.addEventListener('click', function () {
                var r = rows[Number(b.getAttribute('data-i'))];
                goToSpotTrend(r.spot_id, r.spot_name, r.spot_code);
            });
        });
        icons();
    }

    // ── Orchestration ──────────────────────────────────────────────────────
    async function loadToday(force) {
        if (!(typeof currentUser !== 'undefined' && currentUser)) return;
        if (S.inflight) return;
        if (!force && Date.now() - S.lastRun < 4000) return;    // dedupe v1 calling loadDashboard twice at boot
        S.inflight = true; S.lastRun = Date.now(); S.token++;
        mount();
        S.heroCache = {};
        try {
            await loadSpotsAndLatest();
            showHero();
            // Zones fill independently so a slow one never blocks the rest
            renderHazard().then(renderAround);
            renderStrava();
            renderNext();
            renderChallenge();
            renderClub(0);
        } catch (e) {
            console.warn('Today load:', e);
            var el = $('v2tHero');
            if (el) { el.classList.remove('v2-skel'); el.innerHTML = '<div class="v2-hero-name">Water report</div><div class="v2-sub" style="margin-top:8px">Could not load. <button class="v2-link" type="button" id="v2tRetry">Try again</button></div>'; var b = $('v2tRetry'); if (b) b.onclick = function () { loadToday(true); }; }
        } finally { S.inflight = false; }
    }
    window.V2.loadToday = loadToday;

    // v1's loadDashboard() runs on login and whenever Home is opened. Wrap it so Today loads
    // alongside (v1 still fills the shared caches).
    if (typeof window.loadDashboard === 'function') {
        var _orig = window.loadDashboard;
        window.loadDashboard = function () {
            loadToday(false);
            return _orig.apply(this, arguments);
        };
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
