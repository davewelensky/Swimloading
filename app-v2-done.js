// SwimLoading v2 — the ONE screen after a log. Inert unless <html class="ui-v2" (see app-v2.js).
//
// v1 chains up to four screens after submitTempLog() succeeds:
//   story card -> (passport moment | identity swim card | share sheet)
// Only the LAST link is a terminal screen, and submitTempLog / the Strava import both `await` it
// before returning to Home. This module replaces the terminal screens with one: it overrides
//   identityPostLogShare(ctx, fallback)   (carries the default share sheet for everyone)
//   showPassportMoment(ctx)
// so BOTH call V2.postLog(ctx). submitTempLog() itself is untouched: same insert, points, badges,
// challenge credit, then it awaits our promise and runs showPage('dashboard').
//
// The promise ALWAYS resolves (Done, X, scrim, Escape, or any navigation away) so the caller can
// never hang. Badges already announce as toasts and are left alone.
//
// STORY CARD (folded in): v1's story card is a separate full-screen card. The native log flow never
// showed it (the passport moment is on for everyone and replaces that whole tail); only the Strava
// import did. v2 shows the swimmer's lead story event as a "Story moment" row inside this one
// screen for BOTH paths (same flag, story_cards_v1, same RPC, same one-time guard), with a link to
// the story timeline. storyCardPostLog is overridden to a pass-through so it never stacks a second
// screen. The story is fetched BEFORE the sheet slides up (max ~450ms) so the layout never shifts.
//
// What the screen shows, only when the data exists:
//   - what was logged, and thanks (the swimmer just gave other swimmers a reading)
//   - challenge: tickets gained by this log, or progress to the draw (via jcGetMyScore)
//   - passport: Nth swim here / new spot (only when the passport flag is on)
//   - primary: share on WhatsApp (same message as the v1 share sheet)
//   - secondary: share as a card (identity flag), Done, and "Fix this log" (wrong temperature)
(function () {
    'use strict';
    if (!(window.V2 && window.V2.enabled)) return;

    var st = { resolve: null, preScore: null, ctx: null };

    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function icons() { if (typeof initIcons === 'function') initIcons(); else if (window.lucide) window.lucide.createIcons(); }
    function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function ordinal(n) {
        if (typeof _ppOrdinal === 'function') return _ppOrdinal(n);
        var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    // The challenge score BEFORE the log, so the screen can say what this log earned.
    var _enter = window.V2.enterLog;
    if (typeof _enter === 'function') {
        window.V2.enterLog = function () {
            var r = _enter.apply(this, arguments);
            st.preScore = null;
            try {
                if (typeof jcIsActive === 'function' && jcIsActive() && typeof jcGetMyScore === 'function') {
                    jcGetMyScore().then(function (s) { st.preScore = s ? { entries: s.entries || 0, logs: s.logs || 0 } : null; }).catch(function () {});
                }
            } catch (e) { /* optional */ }
            return r;
        };
    }
    // Any navigation away closes the screen and releases the caller.
    var _exit = window.V2.exitLog;
    window.V2.exitLog = function () { finish(); if (typeof _exit === 'function') return _exit.apply(this, arguments); };

    function mount() {
        var app = $('mainApp');
        if (!app || $('v2Done')) return;
        var scrim = document.createElement('div');
        scrim.id = 'v2DoneScrim';
        scrim.className = 'v2-scrim v2-scrim-top';
        scrim.addEventListener('click', finish);
        var sheet = document.createElement('div');
        sheet.id = 'v2Done';
        sheet.className = 'v2-done';
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-label', 'Logged');
        app.appendChild(scrim);
        app.appendChild(sheet);
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st.resolve) finish(); });
    }

    // The swimmer's lead story event for this log (same source and one-time guard as v1's story card)
    async function fetchStory(ctx) {
        try {
            if (!ctx || !ctx.logId) return null;
            if (typeof storyCardsEnabled !== 'function' || !(await storyCardsEnabled())) return null;
            var r = await supabaseClient.rpc('get_my_story_events_for_log_v1', { p_temp_log_id: ctx.logId });
            var events = r && Array.isArray(r.data) ? r.data : [];
            // Same event, same properties, same moment as the classic story card, so the two designs stay comparable
            try { analytics.track('story_card_eligible', { source: ctx.source || null, event_count: events.length }); } catch (e) { /* optional */ }
            if (!events.length) return null;
            var lead = events[0];
            var guardKey = 'storyCardShown:' + ctx.logId + ':' + lead.id;
            try { if (sessionStorage.getItem(guardKey)) return null; } catch (e) { /* storage blocked: show it */ }
            var timeline = false;
            try { timeline = typeof storyTimelineEnabled === 'function' && await storyTimelineEnabled(); } catch (e) { timeline = false; }
            return { lead: lead, extra: events.length - 1, timeline: timeline, guardKey: guardKey };
        } catch (e) { return null; }
    }

    function storyRow(story) {
        var l = story.lead;
        var cat = (typeof SC_CATEGORY_LABEL_BY_TYPE !== 'undefined' && SC_CATEGORY_LABEL_BY_TYPE[l.story_type]) || 'Story moment';
        var when = (typeof _scFormatDate === 'function') ? _scFormatDate(l.story_date) : '';
        var hasValue = l.primary_value !== null && l.primary_value !== undefined && l.unit;
        return '<div class="v2-done-story">' +
            '<div class="v2-eyebrow">Story moment · ' + esc(cat) + '</div>' +
            '<div class="v2-done-story-title">' + esc(l.title || 'A moment in your swimming story') + '</div>' +
            (l.summary ? '<div class="v2-sub">' + esc(l.summary) + '</div>' : '') +
            (hasValue ? '<div class="v2-done-story-val">' + esc(l.primary_value) + esc(l.unit) + '</div>' : '') +
            '<div class="v2-cap">' + esc((l.spot_name ? l.spot_name + (when ? ' · ' : '') : '') + when) + (story.extra > 0 ? (l.spot_name || when ? ' · ' : '') + story.extra + ' more in your story' : '') + '</div>' +
            (story.timeline && l.id ? '<button type="button" class="v2-link" id="v2DoneStory">View in your story</button>' : '') +
            '</div>';
    }

    function postLog(ctx) {
        ctx = ctx || {};
        return new Promise(function (resolve) {
            if (st.resolve) finish();               // never leave an earlier caller hanging
            mount();
            st.resolve = resolve; st.ctx = ctx;
            // Story first (bounded wait), so the sheet opens once and nothing moves afterwards
            var story = null;
            Promise.race([fetchStory(ctx), sleep(450).then(function () { return null; })]).then(function (s) {
                story = s;
                if (st.ctx !== ctx) return;                    // dismissed while we waited
                render(ctx, story);
                try { analytics.track('post_log_shown', { surface: 'v2_logged', source: ctx.source || null, has_story: !!story }); } catch (e) { /* optional */ }
                var lg2 = $('logTemp'); if (lg2) lg2.classList.add('v2-hide');
                $('v2DoneScrim').classList.add('on');
                $('v2Done').classList.add('on');
                var d2 = $('v2DoneBtn'); if (d2) setTimeout(function () { d2.focus(); }, 60);
                loadRewards(ctx);
            });
        });
    }

    function finish() {
        var r = st.resolve;
        st.resolve = null; st.ctx = null;
        var s = $('v2Done'), sc = $('v2DoneScrim'), lg = $('logTemp');
        if (s) s.classList.remove('on');
        if (sc) sc.classList.remove('on');
        if (lg) lg.classList.remove('v2-hide');
        if (r) r();
    }

    function render(ctx, story) {
        var temp = ctx.temp != null ? Number(ctx.temp).toFixed(1) : '';
        var spot = ctx.spotName || 'this spot';
        var logId = ctx.logId || window._lastLogId || null;
        $('v2Done').innerHTML =
            '<div class="v2-grab"></div>' +
            '<div class="v2-done-head">' +
                '<span class="v2-done-ok"><i data-lucide="check"></i></span>' +
                '<div class="v2-done-title">Logged</div>' +
                '<div class="v2-sub">' + (temp ? esc(temp) + '°C at ' : '') + esc(spot) + '. Thanks, this helps other swimmers.</div>' +
            '</div>' +
            '<div id="v2DoneRewards" aria-live="polite">' + (story ? storyRow(story) : '') + '</div>' +
            '<button type="button" class="v2-btn v2-btn-primary" id="v2DoneShare"><i data-lucide="message-circle"></i>Share on WhatsApp</button>' +
            '<button type="button" class="v2-btn v2-btn-ghost" id="v2DoneCard" style="display:none;margin-top:10px"><i data-lucide="image"></i>Share as a card</button>' +
            '<button type="button" class="v2-btn v2-btn-ghost" id="v2DoneBtn" style="margin-top:10px">Done</button>' +
            (logId ? '<button type="button" class="v2-link v2-done-fix" id="v2DoneFix">Wrong temperature? Fix this log</button>' : '');
        icons();
        if (story) {
            try { sessionStorage.setItem(story.guardKey, 'shown'); } catch (e) { /* best effort */ }
            try { analytics.track('story_moment_shown', { story_type: story.lead.story_type || null, surface: 'v2_logged' }); } catch (e) { /* optional */ }
            var sb = $('v2DoneStory');
            if (sb) sb.addEventListener('click', function () {
                var id = story.lead.id;
                finish();                                        // release the caller first (it goes on to reload Home)
                setTimeout(function () { if (typeof _scOpenTimeline === 'function') _scOpenTimeline(id); }, 60);
            });
        }
        // The challenge row arrives ~1s after the sheet opens. Reserve its space so the buttons do
        // not jump under the swimmer's thumb.
        try { if (typeof jcIsActive === 'function' && jcIsActive()) $('v2DoneRewards').style.minHeight = '68px'; } catch (e) { /* cosmetic */ }

        $('v2DoneBtn').addEventListener('click', finish);
        $('v2DoneShare').addEventListener('click', function () {
            var c = ctx.conditions ? ' • ' + cap(ctx.conditions) : '';
            var msg = spot + ': ' + temp + '°C' + c + '\nLogged on SwimLoading: swimloading.com';   // same text as the v1 share sheet
            window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
            try { analytics.track('whatsapp_shared'); } catch (e) { /* optional */ }
            finish();
        });
        var fix = $('v2DoneFix');
        if (fix) fix.addEventListener('click', function () { if (typeof openMyLogEdit === 'function') openMyLogEdit(logId); });

        // Swim card (identity flag): available on demand instead of being forced
        if (window._v2OrigIdentityShare && typeof identityLayerEnabled === 'function') {
            identityLayerEnabled().then(function (on) {
                var b = $('v2DoneCard');
                if (!on || !b || !st.resolve) return;
                b.style.display = 'flex';
                b.addEventListener('click', function () {
                    var c = ctx;
                    finish();
                    window._v2OrigIdentityShare(c, function () { return Promise.resolve(); });
                });
            }).catch(function () { /* optional */ });
        }
    }

    function reward(icon, colour, title, sub) {
        return '<div class="v2-done-row"><i data-lucide="' + icon + '" style="color:' + colour + '"></i>' +
            '<span class="v2-row-text"><b>' + esc(title) + '</b>' + (sub ? '<br><span class="v2-sub">' + esc(sub) + '</span>' : '') + '</span></div>';
    }

    async function loadRewards(ctx) {
        var box = $('v2DoneRewards');
        if (!box) return;
        var token = ctx;
        var add = function (html) { if (st.ctx === token && box) { box.insertAdjacentHTML('beforeend', html); icons(); } };

        // Challenge: what this log earned. jcAwardPoints() is not awaited by submitTempLog, so give it a moment.
        try {
            if (typeof jcIsActive === 'function' && jcIsActive() && typeof jcGetMyScore === 'function') {
                await sleep(900);
                var post = await jcGetMyScore();
                if (post && st.ctx === token) {
                    var pre = st.preScore;
                    var gained = pre && (post.entries || 0) > pre.entries ? post.entries - pre.entries : 0;
                    var logs = post.logs || 0, tickets = post.entries || 0;
                    if (gained > 0) {
                        add(reward('ticket', 'var(--sl-green)', '+' + gained + (gained > 1 ? ' draw tickets' : ' draw ticket'), tickets + (tickets === 1 ? ' ticket' : ' tickets') + ' in the draw'));
                    } else if (post.inDraw) {
                        add(reward('ticket', 'var(--sl-green)', "You're in the draw", tickets + (tickets === 1 ? ' ticket' : ' tickets') + ' in the draw'));
                    } else if (logs > 0) {
                        add(reward('ticket', 'var(--sl-cyan)', logs + ' of 10 to enter the draw', (10 - logs) + ' to go'));
                    }
                }
            }
        } catch (e) { /* the log itself is already saved */ }

        // Passport: only when the passport flag is on (same gate v1 uses)
        try {
            if (typeof passportMomentEnabled === 'function' && await passportMomentEnabled()) {
                var spotId = ctx.spotId || ((typeof spots !== 'undefined' && spots || []).find(function (s) { return s.name === ctx.spotName; }) || {}).id;
                var res = await supabaseClient.rpc('get_my_swim_passport_v1');
                var data = res && res.data;
                if (data && st.ctx === token) {
                    var total = (data.summary || {}).total_spots_explored;
                    var here = (data.spots || []).find(function (s) { return s.spot_id === spotId; });
                    var n = here && here.total_swims;
                    var title = n === 1 ? 'New spot for your passport' : n ? 'Your ' + ordinal(n) + ' report here' : '';
                    if (title) add(reward('compass', 'var(--sl-cyan)', title, total != null ? total + (total === 1 ? ' spot' : ' spots') + ' explored' : ''));
                }
            }
        } catch (e) { /* optional */ }
    }

    // Take over the two terminal post-log screens
    window._v2OrigIdentityShare = window.identityPostLogShare;
    window.identityPostLogShare = function (ctx) { return postLog(ctx); };
    window.showPassportMoment = function (ctx) { return postLog(ctx); };
    // v1's story card is folded into the screen above; never stack a second screen (Strava import path)
    window.storyCardPostLog = async function (opts) { if (opts && typeof opts.continueFn === 'function') await opts.continueFn(); };

    window.V2.postLog = postLog;
    window.V2.finishPostLog = finish;
})();
