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

    var S = { token: 0, inflight: false, lastRun: 0, mySpots: [], idx: 0, latest: [], hazards: [], heroCache: {}, pre: null, spotsReady: null, bootRun: false };
    // Boot gate: Today stays on one skeleton until the hero and the zones above it are ready, then everything
    // shows at once. Nothing is ever inserted above content the person can already see. CAP bounds the wait
    // for the zones above the hero, so a slow one never holds the hero back.
    var G = { revealed: false, heroDone: false, zonesDone: false, t0: 0, timer: null };
    var CAP_MS = 1200;
    function mark(n) { if (window.__perfMark) window.__perfMark(n); }

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
        if (!G.revealed) t.className = 'v2-pending';
        t.innerHTML =
            '<div id="v2tRoles"></div>' +
            '<div id="v2tClubTop"></div>' +
            '<div id="v2tHazard"></div>' +
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
        // Known club member from a previous visit: hold the club card's space from the first paint
        try { if (localStorage.getItem('sl_v2_club') === '1') $('v2tClubTop').classList.add('v2-club-reserve'); } catch (e) { /* optional */ }
        // Known club role from a previous visit: hold the chip row's space too
        try { if (localStorage.getItem('sl_v2_roles') === '1') $('v2tRoles').classList.add('v2-roles-reserve'); } catch (e) { /* optional */ }
        icons();
        renderRoles();
    }

    function settle() {
        if (G.revealed || !G.heroDone) return;
        var left = G.t0 + CAP_MS - Date.now();
        if (G.zonesDone || left <= 0) { reveal(); return; }
        if (!G.timer) G.timer = setTimeout(reveal, left);
    }
    function reveal() {
        if (G.revealed) return;
        G.revealed = true;
        if (G.timer) { clearTimeout(G.timer); G.timer = null; }
        var t = $('v2Today');
        if (t) {
            t.classList.remove('v2-pending');
            t.classList.add('v2-reveal');
            setTimeout(function () { t.classList.remove('v2-reveal'); }, 400);
        }
        mark('today-revealed');
    }
    // Coach / admin / sets-planner entry points (same links and roles as the classic Home chip row).
    function renderRoles() {
        var el = $('v2tRoles'), r = window._clubRoleLinks;
        if (!el || !r) return;
        var chip = function (href, cls, icon, name, role) {
            return '<a href="' + esc(href) + '" class="home-chip ' + cls + '"><i data-lucide="' + icon + '" style="width:15px;height:15px;flex-shrink:0;"></i>' +
                '<span class="home-chip-name">' + esc(name) + '</span><span class="home-chip-role">' + role + '</span></a>';
        };
        var chips = (r.adminClubs || []).map(function (c) { return chip('/club-admin/' + c.slug, 'home-chip--admin', 'shield', c.name, 'Admin'); })
            .concat((r.coachClubs || []).map(function (c) { return chip('/coach/' + c.slug, 'home-chip--coach', 'clipboard-list', c.name, 'Coach'); }))
            .concat((r.coachSetsClubs || []).map(function (c) { return chip('/sets/' + c.slug, 'home-chip--sets', 'calendar-days', c.name, 'Sets'); }));
        el.innerHTML = chips.length ? '<div class="home-chip-row">' + chips.join('') + '</div>' : '';
        el.classList.remove('v2-roles-reserve');
        try { if (chips.length) localStorage.setItem('sl_v2_roles', '1'); else localStorage.removeItem('sl_v2_roles'); } catch (e) { /* optional */ }
        icons();
    }
    document.addEventListener('sl:roles', renderRoles);

    // ── Data: my spots ─────────────────────────────────────────────────────
    function queryMine(uid) { return Promise.resolve(supabaseClient.from('temp_logs').select('spot_id, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(60)); }
    function queryLatest() { return Promise.resolve(supabaseClient.from('latest_spot_temps').select('spot_id, spot_name, spot_code, temp_c, updated_at, domain, water_type').order('updated_at', { ascending: false }).limit(300)); }
    function queryHazards() { return Promise.resolve(supabaseClient.from('hazard_reports').select('spot_id, severity, title, hazard_type, active_until').is('resolved_at', null)); }

    // Start the reads that need only the user id, while the app is still loading spots and the profile.
    // loadToday() picks them up (once, if fresh) instead of asking again.
    function prefetchToday() {
        if (!(typeof currentUser !== 'undefined' && currentUser)) return;
        mark('today-fetch-start');
        var pre = { at: Date.now() };
        pre.mine = queryMine(currentUser.id);
        pre.latest = queryLatest();
        pre.hazard = queryHazards();
        // The hero's own reading depends only on the swimmer's most recent spot id
        pre.heroP = pre.mine.then(function (res) {
            var row = res && res.data && res.data[0];
            return row && row.spot_id ? fetchReading(row.spot_id).then(function (r) { return { id: row.spot_id, r: r }; }) : null;
        }).catch(function () { return null; });
        S.pre = pre;
    }
    window.V2.prefetchToday = prefetchToday;

    async function loadSpotsAndLatest(pre) {
        var uid = currentUser.id;
        // spotsReady: spotById() below needs the spots list, but the queries above do not
        var res = await Promise.all([pre ? pre.mine : queryMine(uid), pre ? pre.latest : queryLatest(), S.spotsReady || null]);
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

    // Trend line from the readings we actually have (last 72h at this spot). Only drawn with 3+ readings spanning
    // 6h+, so a quiet spot shows no line instead of a made-up one. x = real time, y = real temperature.
    function sparkline(logs) {
        var pts = (logs || []).map(function (l) { return { t: new Date(l.created_at).getTime(), v: Number(l.temp_c) }; })
            .filter(function (p) { return isFinite(p.v) && isFinite(p.t); }).sort(function (a, b) { return a.t - b.t; });
        if (pts.length < 3) return '';
        var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
        if (t1 - t0 < 6 * 3600e3) return '';
        var vmin = Math.min.apply(null, pts.map(function (p) { return p.v; })), vmax = Math.max.apply(null, pts.map(function (p) { return p.v; }));
        var pad = Math.max(0.3, (vmax - vmin) * 0.2), lo = vmin - pad, hi = vmax + pad, W = 300, H = 56;
        var xy = pts.map(function (p) { return [((p.t - t0) / (t1 - t0)) * W, H - ((p.v - lo) / (hi - lo)) * H]; });
        var line = xy.map(function (c, i) { return (i ? 'L' : 'M') + c[0].toFixed(1) + ' ' + c[1].toFixed(1); }).join(' ');
        var area = line + ' L' + W + ' ' + H + ' L0 ' + H + ' Z';
        var last = xy[xy.length - 1], spanH = (t1 - t0) / 3600e3;
        return '<div class="v2-spark" aria-label="Temperature trend at this spot">' +
            '<div class="v2-spark-plot"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><path class="fill" d="' + area + '"/><path class="line" d="' + line + '" vector-effect="non-scaling-stroke"/></svg>' +
            '<span class="v2-spark-dot" style="left:' + (last[0] / W * 100).toFixed(1) + '%;top:' + (last[1] / H * 100).toFixed(1) + '%"></span></div>' +
            '<div class="v2-spark-axis"><span>Range ' + vmin.toFixed(1) + '–' + vmax.toFixed(1) + '°</span><span>' + (spanH >= 48 ? Math.round(spanH / 24) + ' days' : Math.round(spanH) + ' hours') + ' of reports</span></div></div>';
    }

    function renderHero(reading) {
        var el = $('v2tHero'); if (!el) return;
        el.classList.remove('v2-skel');
        var sp = S.mySpots[S.idx];
        var switcher = (sp && S.mySpots.length > 1)
            ? '<button type="button" class="v2-spotpick" id="v2SpotPick" aria-haspopup="dialog" aria-label="Change spot"><span class="v2-spotpick-name">' + esc(sp.name) + '</span><span class="v2-spotpick-more">' + (S.idx + 1) + ' of ' + S.mySpots.length + '<i data-lucide="chevrons-up-down"></i></span></button>'
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
            // number on the left, what it means on the right, then the trend across the full width
            body =
                '<div class="v2-hero-main">' +
                    '<div class="v2-temp" style="color:' + (pool ? 'var(--sl-cyan)' : tempColour(Number(l0.temp_c))) + '" aria-label="' + Number(l0.temp_c).toFixed(1) + ' degrees Celsius">' + Number(l0.temp_c).toFixed(1) + '<small>°C</small></div>' +
                    '<div class="v2-hero-side">' + (pool ? '<span class="v2-pill">Pool</span>' : condPill(l0.conditions)) + delta +
                        '<span class="v2-cap">Reported ' + esc(ago(l0.created_at)) + '</span>' +
                        (n24 > 1 ? '<span class="v2-cap">' + n24 + ' reports in 24 hours</span>' : '') + '</div>' +
                '</div>' + sparkline(reading.logs);
        } else if (reading && reading.est && reading.est.best_c != null) {
            var poolEst = isPool(sp);
            body =
                '<div class="v2-hero-main"><div class="v2-temp" style="color:' + (poolEst ? 'var(--sl-cyan)' : tempColour(Number(reading.est.best_c))) + '">' + Number(reading.est.best_c).toFixed(1) + '<small>°C</small></div>' +
                '<div class="v2-hero-side"><span class="v2-pill">' + (poolEst ? 'Pool · estimate' : 'Estimate') + '</span></div></div>' +
                '<div class="v2-cap" style="margin-top:8px">No swimmer reports in 3 days. ' + (reading.est.best_source === 'swimmer' ? 'Based on an older swimmer report.' : 'From a sea-surface model, not a swimmer.') + '</div>';
        } else {
            body =
                '<div class="v2-hero-main"><div class="v2-temp v2-temp-empty">--</div></div>' +
                '<div class="v2-cap" style="margin-top:8px">No reports at ' + esc(sp.name) + ' yet. Be the first.</div>';
        }
        el.innerHTML = head + body;
        var pick = $('v2SpotPick'); if (pick) pick.addEventListener('click', openSpotSheet);
        icons();
        var name = el.querySelector('.v2-hero-name');
        if (name && sp) { name.style.cursor = 'pointer'; name.addEventListener('click', function () { goToSpotTrend(sp.id, sp.name, sp.code); }); }
    }

    // ── Spot picker sheet (replaces the stack of name chips) ─────────────────────────────
    function spotTempText(id) {
        var c = S.heroCache[id];
        if (c && c.logs && c.logs.length) return Number(c.logs[0].temp_c).toFixed(1) + '°';
        if (c && c.est && c.est.best_c != null) return Number(c.est.best_c).toFixed(1) + '° est.';
        var l = (S.latest || []).filter(function (x) { return x.spot_id === id; })[0];
        return l && l.temp_c != null ? Number(l.temp_c).toFixed(1) + '°' : '';
    }
    function closeSpotSheet() {
        var sh = $('v2SpotSheet'), sc = $('v2SpotScrim');
        if (sh) sh.classList.remove('on'); if (sc) sc.classList.remove('on');
        var p = $('v2SpotPick'); if (p) p.focus();
    }
    function openSpotSheet() {
        var app = $('mainApp'); if (!app) return;
        var sc = $('v2SpotScrim'), sh = $('v2SpotSheet');
        if (!sh) {
            sc = document.createElement('div'); sc.id = 'v2SpotScrim'; sc.className = 'v2-scrim v2-scrim-top';
            sc.addEventListener('click', closeSpotSheet);
            sh = document.createElement('div'); sh.id = 'v2SpotSheet'; sh.className = 'v2-done';
            sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-label', 'Choose a spot');
            app.appendChild(sc); app.appendChild(sh);
            document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSpotSheet(); });
        }
        sh.innerHTML =
            '<div class="v2-grab"></div>' +
            '<div class="v2-between" style="margin-bottom:12px"><div class="v2-sheet-title">Your spots</div>' +
            '<button type="button" class="v2-icon-btn" id="v2SpotClose" aria-label="Close"><i data-lucide="x"></i></button></div>' +
            '<div class="v2-card v2-list">' + S.mySpots.map(function (s, i) {
                var type = isPool(s) ? 'Pool' : 'Open water', tt = spotTempText(s.id);
                return '<button type="button" class="v2-row" data-i="' + i + '" aria-current="' + (i === S.idx) + '">' +
                    '<span class="v2-row-text"><span class="v2-row-title">' + esc(s.name) + '</span><br><span class="v2-cap">' + type + (tt ? ' · ' + esc(tt) : '') + '</span></span>' +
                    (i === S.idx ? '<i data-lucide="check" style="color:var(--sl-cyan)"></i>' : '') + '</button>';
            }).join('') + '</div>' +
            '<button type="button" class="v2-link" style="margin-top:8px" onclick="showPage(\'history\')">Browse all spots</button>';
        icons();
        $('v2SpotClose').addEventListener('click', closeSpotSheet);
        sh.querySelectorAll('.v2-row').forEach(function (b) {
            b.addEventListener('click', function () { S.idx = Number(b.getAttribute('data-i')); closeSpotSheet(); showHero(); });
        });
        sc.classList.add('on'); sh.classList.add('on');
        var f = sh.querySelector('.v2-row[aria-current="true"]') || $('v2SpotClose'); setTimeout(function () { f.focus(); }, 60);
    }

    // Load the other spots' readings in the background so the picker sheet can show each spot's last temperature
    function prefetchSpots() {
        S.mySpots.forEach(function (sp) {
            if (S.heroCache[sp.id]) return;
            fetchReading(sp.id).then(function (r) { S.heroCache[sp.id] = r; }).catch(function () { /* picker just shows no temperature */ });
        });
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
    async function renderHazard(pre) {
        try {
            var res = await (pre && pre.hazard ? pre.hazard : queryHazards());
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
        var g = st.events && st.events[0] && api.galaRelevant(st.events[0]) && st.events[0];        // galas are for the kids' squads, never OW Masters
        if (!rows.length && !g) { top.classList.remove('v2-club-reserve'); return; }

        var days = g ? Math.round((new Date(g.event_date + 'T12:00:00') - new Date(new Date().setHours(0, 0, 0, 0))) / 86400000) : null;
        var deadline = g && g.entry_deadline ? api.fmtDay(g.entry_deadline) : '';
        var who = ro ? esc(st.ctx.roster.display_name) + ' · ' : '';
        var html =
            '<section class="v2-card v2-club-card v2-today-club' + (today.length ? ' is-today' : '') + '">' +
                '<div class="v2-between"><div class="v2-eyebrow">' + who + esc((st.schedule && st.schedule.squadName) || st.ctx.club.name) + ' · ' + (today.length ? 'Training today' : 'Next training') + '</div>' +
                '<button type="button" class="v2-link" onclick="showPage(\'club\')">Club</button></div>' +
                rows.map(function (w) { return api.sessionRow(w, week, ro); }).join('') +
                (g ? '<button type="button" class="v2-today-gala" onclick="showPage(\'club\')">' +
                        '<span class="v2-row-text"><span class="v2-row-title">' + esc(g.title) + '</span><br><span class="v2-cap">' + days + (days === 1 ? ' day' : ' days') + ' to go' + (deadline ? ' · entries close ' + esc(deadline) : '') + '</span></span>' +
                        '<i data-lucide="chevron-right" class="v2-chev"></i></button>' : '') +
            '</section>';
        top.classList.remove('v2-club-reserve');
        top.innerHTML = html;
        api.bindRows(top);
        try { localStorage.setItem('sl_v2_club', '1'); } catch (e) { /* optional */ }
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
            if ((tries || 0) < 10) { setTimeout(function () { renderClub((tries || 0) + 1); }, 800); return; }
            var t = $('v2tClubTop'); if (t) t.classList.remove('v2-club-reserve');   // gave up: not a club member
            try { localStorage.removeItem('sl_v2_club'); } catch (e) { /* optional */ }
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
            var swimsIsTab = !(window.V2 && window.V2.clubTab && window.V2.clubTab());   // club members have Club in that tab, so Swims lives here
            if (!ev) {
                el.innerHTML = swimsIsTab ? '' :
                    '<div class="v2-h2">Group swims</div><button type="button" class="v2-card v2-tappable v2-chal" onclick="showPage(\'events\')">' +
                    '<span class="v2-between"><span class="v2-card-title">See upcoming group swims</span><i data-lucide="chevron-right" class="v2-chev"></i></span></button>';
                icons(); return;
            }
            var part = await Promise.all([
                supabaseClient.from('swim_participants').select('rsvp, status').eq('swim_event_id', ev.id).eq('user_id', currentUser.id).maybeSingle(),
                supabaseClient.from('swim_participants').select('*', { count: 'exact', head: true }).eq('swim_event_id', ev.id).eq('rsvp', 'going')
            ]);
            var mine = part[0] && part[0].data, going = (part[1] && part[1].count) || 0;
            var action = mine
                ? '<span class="v2-going"><i data-lucide="check"></i>' + (mine.rsvp === 'going' ? "You're going" : 'You said maybe') + '</span>'
                : '<button class="v2-btn v2-btn-ghost v2-btn-sm" type="button" id="v2tGoing">I\'m going</button>';
            el.innerHTML =
                '<div class="v2-h2 v2-between"><span>Next swim</span><button type="button" class="v2-link" onclick="showPage(\'events\')">All swims</button></div>' +
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
        var pre = (!force && S.pre && Date.now() - S.pre.at < 15000) ? S.pre : null;
        S.pre = null;
        if (!G.revealed) G.t0 = Date.now();
        if (!pre) mark('today-fetch-start');
        // A saved "has club roles" hint that never gets confirmed must not hold blank space forever
        setTimeout(function () {
            if (window._clubRoleLinks) return;
            var r = $('v2tRoles'); if (r) r.classList.remove('v2-roles-reserve');
            try { localStorage.removeItem('sl_v2_roles'); } catch (e) { /* optional */ }
        }, 8000);
        try {
            // Zones that do not depend on spots start straight away; each fills independently
            renderStrava();
            renderNext();
            renderChallenge();
            renderClub(0);
            await loadSpotsAndLatest(pre);
            S.spotsReady = null;
            if (pre && pre.heroP) {
                var h = await pre.heroP, first = S.mySpots[S.idx];
                if (h && first && first.id === h.id) S.heroCache[h.id] = h.r;
            }
            var hazards = renderHazard(pre).then(renderAround);
            var heroDone = showHero();
            prefetchSpots();
            await heroDone;
            mark('hero-painted');
            G.heroDone = true; settle();
            // Zones above the hero (hazard banner) settle with it, bounded by CAP_MS
            hazards.then(function () { G.zonesDone = true; settle(); }, function () { G.zonesDone = true; settle(); });
        } catch (e) {
            console.warn('Today load:', e);
            var el = $('v2tHero');
            if (el) { el.classList.remove('v2-skel'); el.innerHTML = '<div class="v2-hero-name">Water report</div><div class="v2-sub" style="margin-top:8px">Could not load. <button class="v2-link" type="button" id="v2tRetry">Try again</button></div>'; var b = $('v2tRetry'); if (b) b.onclick = function () { loadToday(true); }; }
            G.heroDone = true; G.zonesDone = true; settle();
        } finally { S.inflight = false; }
    }
    window.V2.loadToday = loadToday;

    // Called by loadApp() as soon as the profile is known, in parallel with the spots load
    window.V2.startToday = function (spotsPromise) {
        S.spotsReady = spotsPromise || null;
        S.bootRun = true;
        return loadToday(false);
    };

    // v1's loadDashboard() runs on login and whenever Home is opened. Wrap it so Today loads
    // alongside (v1 still fills the shared caches).
    if (typeof window.loadDashboard === 'function') {
        var _orig = window.loadDashboard;
        window.loadDashboard = function () {
            if (S.bootRun) S.bootRun = false;      // loadApp() already started Today for this boot
            else loadToday(false);
            return _orig.apply(this, arguments);
        };
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
