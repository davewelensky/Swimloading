// SwimLoading v2 shell. Inert unless <html class="ui-v2"> (opt in with ?ui=v2, out with ?ui=v1).
//
// What this does today: replaces the sticky top tab bar with a bottom tab bar
// (Today / Spots / Log / Swims / You) and adds the You hub. It does NOT rebuild the
// screens behind the tabs yet — Today, Spots, Swims and Log still render the v1 pages.
//
// Design rules (see V2_INVENTORY.md):
//  - showPage() in app-nav.js stays the single router (30+ inline onclick calls use it).
//    It calls V2.onPage(page) at the end, and V2.renderYou() for the 'you' page.
//  - v1 DOM ids other files depend on stay in place: #headerAvatar, #notifBadge, #bellIcon,
//    #clubNavBtn, #navMoreBtn, #dashBestSpots, #passportDoor, #identityEntryPoint.
//  - Club: the You screen only READS whether the Club entry is available (#clubNavBtn); it
//    adds no club feature and touches no club flag.
(function () {
    'use strict';

    var enabled = document.documentElement.classList.contains('ui-v2');
    // What the swimmer submits is a WATER report: temperature, conditions, hazards. No pace,
    // distance or time. Wording lives here so it is one edit to change everywhere in v2.
    var COPY = {
        action: 'Log the water',
        hint: 'Temperature and conditions. Not your pace.'
    };
    window.V2 = { enabled: enabled, COPY: COPY, onPage: function () {}, renderYou: function () {} };
    // ── Switching designs (works from BOTH designs) ─────────────────────────
    // The design choice lives in localStorage ('sl_ui'), which the installed home-screen app can hold
    // separately from Safari, so the URL switch (?ui=v2) is not enough on its own. These give an
    // in-app way in (Profile Settings, beta testers only) and a way back (always shown in v2).
    window.V2.setUi = function (mode) {
        try { if (typeof analytics !== 'undefined') analytics.track('ui_design_switch', { to: mode }); } catch (e) { /* optional */ }
        try {
            if (mode === 'v2') { localStorage.setItem('sl_ui', 'v2'); localStorage.setItem('sl_ui_src', 'user'); localStorage.removeItem('sl_ui_optout'); }
            else { localStorage.removeItem('sl_ui'); localStorage.removeItem('sl_ui_src'); localStorage.setItem('sl_ui_optout', '1'); }   // a person who chose Classic is never auto-switched again
        } catch (e) { /* storage blocked: the ?ui= link still works */ }
        // small pause so the analytics request can leave, then a clean URL (no ?ui= to fight the choice)
        setTimeout(function () { location.href = location.pathname; }, 150);
    };

    // Who may switch IN to v2 from the classic app: admins (profiles.is_admin), and anyone on the 'ui_v2_beta' flag
    // (feature_flags: enabled_global, or the user id in allowed_user_ids). Fails closed. Anyone
    // already in v2 can always switch back, whatever the flag says.
    var _offer = null;
    window.V2.canOfferV2 = function () {
        if (typeof currentUser === 'undefined' || !currentUser) return Promise.resolve(false);
        if (!_offer) {
            _offer = (async function () {
                try {
                    // NOTE: v1 loads currentUserProfile with a fixed column list that omits is_admin, so read it
                    // directly (own-row select is allowed by RLS).
                    var me = await supabaseClient.from('profiles').select('is_admin').eq('id', currentUser.id).maybeSingle();
                    if (me && me.data && me.data.is_admin) return true;
                    var r = await supabaseClient.from('feature_flags').select('enabled_global, allowed_user_ids').eq('key', 'ui_v2_beta').maybeSingle();
                    var d = r && r.data;
                    return !!(d && (d.enabled_global || (d.allowed_user_ids || []).indexOf(currentUser.id) >= 0));
                } catch (e) { return false; }
            })();
        }
        return _offer;
    };

    // The row inside Profile Settings (a slot, #uiBetaRow, sits under the identity entry in index.html)
    window.V2.refreshUiRow = async function () {
        var slot = document.getElementById('uiBetaRow');
        if (!slot) return;
        var btnStyle = 'width:100%; padding:13px; background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.3); border-radius:12px; color:var(--ocean-light); font-weight:700; font-size:14px; cursor:pointer; min-height:44px;';
        if (enabled) {
            slot.style.display = 'block';
            slot.innerHTML =
                '<div style="margin-bottom:14px;">' +
                '<div style="font-size:13px; color:var(--text-secondary); margin-bottom:8px;">You are using the new design (beta).</div>' +
                '<button type="button" style="' + btnStyle + '" onclick="V2.setUi(\'v1\')">Switch to the classic design</button></div>';
            return;
        }
        var ok = false;
        try { ok = await window.V2.canOfferV2(); } catch (e) { ok = false; }
        if (!ok) { slot.style.display = 'none'; slot.innerHTML = ''; return; }
        slot.style.display = 'block';
        slot.innerHTML =
            '<div style="margin-bottom:14px;">' +
            '<div style="font-size:13px; color:var(--text-secondary); margin-bottom:8px;">A calmer SwimLoading with a bottom tab bar. It is a beta, and you can switch back here any time.</div>' +
            '<button type="button" style="' + btnStyle + '" onclick="V2.setUi(\'v2\')">Try the new design (beta)</button></div>';
    };

    // Refresh that row whenever Profile Settings opens (in either design)
    if (typeof window.showProfileSettings === 'function') {
        var _showProfile = window.showProfileSettings;
        window.showProfileSettings = function () {
            var r = _showProfile.apply(this, arguments);
            try { window.V2.refreshUiRow(); } catch (e) { /* optional */ }
            return r;
        };
    }

    // ── Default design for a club (Aquasharks), rolled out by feature flag ────────────────────────────────
    // Who: Aquasharks swimmers and parents who have NOT chosen a design themselves.
    // Control: feature_flags 'ui_v2_default_aquasharks' (enabled_global, or the user id in allowed_user_ids).
    //   Fails closed: no row / no network / not eligible => nothing changes.
    // People stay in charge: an explicit "Classic design" (sl_ui_optout) is never overridden, and a design
    //   the person chose themselves (sl_ui_src = user) is never reverted.
    // Kill switch: turn the flag off and anyone who was auto-switched (sl_ui_src = auto) goes back to classic.
    // Runs after login (memberships load asynchronously), so it also fixes the installed home-screen app,
    // which keeps its own storage and cannot use a ?ui= link.
    var AQUASHARKS_ID = '385e2c9d-b32e-47d1-bb1d-1e042523de23';

    // Pure, so every combination can be tested: returns 'switch-v2' | 'revert-v1' | 'none'
    // Inputs: enabled (already in v2), member (Aquasharks), flag (ui_v2_default_aquasharks) and flagAll
    // (ui_v2_default_all), each true / false / null (null = row missing or unreadable = unknown), optout, src, guard.
    //   eligible = (Aquasharks member AND flag on) OR flagAll on
    // Unknown never changes anything (fails closed). Only a person who was auto-switched (src = auto) is ever
    // reverted, and only when both switches are known to be off.
    window.V2.autoDesignDecision = function (s) {
        var eligible = (s.member && s.flag === true) || s.flagAll === true;
        var unknown = s.flagAll === null || s.flagAll === undefined || (s.member && (s.flag === null || s.flag === undefined));
        if (!s.enabled) return (eligible && !s.optout && !s.guard) ? 'switch-v2' : 'none';
        return (s.src === 'auto' && !eligible && !unknown) ? 'revert-v1' : 'none';
    };

    function isAquasharks() {
        var cm = (typeof currentUserClubs !== 'undefined' && currentUserClubs) || [];
        var pl = (typeof parentLinks !== 'undefined' && parentLinks) || [];
        return cm.some(function (m) { return m.clubs && m.clubs.id === AQUASHARKS_ID; }) ||
               pl.some(function (l) { return l.clubs && l.clubs.id === AQUASHARKS_ID; });
    }
    // One read for both switches. Returns { aq, all }: true / false, or null when unknown (no row / no network).
    async function autoFlags() {
        var out = { aq: null, all: null };
        try {
            var r = await supabaseClient.from('feature_flags').select('key, enabled_global, allowed_user_ids').in('key', ['ui_v2_default_aquasharks', 'ui_v2_default_all']);
            var rows = (r && r.data) || [];
            rows.forEach(function (d) {
                var on = !!(d.enabled_global || (d.allowed_user_ids || []).indexOf(currentUser.id) >= 0);
                if (d.key === 'ui_v2_default_aquasharks') out.aq = on; else out.all = on;
            });
        } catch (e) { /* leave unknown */ }
        return out;
    }
    function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    async function runAutoDesign() {
        var member = isAquasharks();
        var fl = await autoFlags();
        var flag = fl.aq, flagAll = fl.all;
        var guardKey = 'sl_ui_autoswitched', guard = false;
        try { guard = !!sessionStorage.getItem(guardKey); } catch (e) { /* ignore */ }
        var act = window.V2.autoDesignDecision({ enabled: enabled, member: member, flag: flag, flagAll: flagAll, optout: ls('sl_ui_optout') === '1', src: ls('sl_ui_src'), guard: guard });
        if (act === 'none') return true;
        try { if (typeof analytics !== 'undefined') analytics.track('ui_design_auto', { action: act }); } catch (e) { /* optional */ }
        try {
            if (act === 'switch-v2') {
                localStorage.setItem('sl_ui', 'v2'); localStorage.setItem('sl_ui_src', 'auto'); localStorage.setItem('sl_ui_notice', '1');
                try { sessionStorage.setItem(guardKey, '1'); } catch (e) { /* ignore */ }
            } else {
                localStorage.removeItem('sl_ui'); localStorage.removeItem('sl_ui_src'); localStorage.removeItem('sl_ui_notice');
            }
        } catch (e) { return true; }
        // Keep the rest of the URL (Strava return, invite links, deep links); drop only a ui= switch so it cannot fight this choice
        var keep = location.search.replace(/([?&])ui=[^&]*&?/, '$1').replace(/[?&]$/, '');
        setTimeout(function () { location.href = location.pathname + keep + location.hash; }, 200);
        return true;
    }
    (function pollAuto() {
        var tries = 0;
        (function tick() {
            tries++;
            var haveUser = (typeof currentUser !== 'undefined' && currentUser);
            var haveClubs = haveUser && ((typeof currentUserClubs !== 'undefined' && currentUserClubs && currentUserClubs.length) || (typeof parentLinks !== 'undefined' && parentLinks && parentLinks.length));
            // Club memberships load a moment after login. Wait for them (up to ~6s) so an Aquasharks member is recognised,
            // but a signed-in person with no club must still be decided, so do not wait forever.
            if (haveClubs || (haveUser && tries >= 9)) { runAutoDesign().catch(function () { /* stay as is */ }); return; }
            if (tries < 20) setTimeout(tick, 700);                          // ~14s, then give up quietly (not signed in)
        })();
    })();
    // One-time explanation after an automatic switch
    if (enabled && ls('sl_ui_notice') === '1') {
        try { localStorage.removeItem('sl_ui_notice'); } catch (e) { /* ignore */ }
        setTimeout(function () {
            if (typeof showToast === 'function') showToast('You are now on the new SwimLoading. You can go back any time under You, then Classic design.', 'info');
        }, 3000);
    }

    if (!enabled) return;

    // Which bottom tab lights up for each v1 page id.
    var TAB_OF = {
        dashboard: 'today',
        history: 'spots',
        logTemp: 'log',
        events: 'swims',
        you: 'you',
        safety: 'you',
        leaderboard: 'you',
        club: 'you'
    };
    // v1 page each tab opens.
    var PAGE_OF = { today: 'dashboard', spots: 'history', log: 'logTemp', swims: 'events', club: 'club', you: 'you' };
    // Pages reached from You: show a back link.
    var CHILD_OF_YOU = { safety: 1, leaderboard: 1, club: 1 };

    // ── Club tab for swim-club members (Aquasharks swimmers and parents) ─────────────────────────────
    // Club is a main destination for them (this week's sessions, attendance, announcements, progress), so it
    // takes the fifth tab in place of Swims (tab bars hold five, and Log takes one). Everyone else keeps Swims.
    // Swims stays one tap away for members: Today's "Next swim" card and a row under You. Remembered in
    // localStorage so the bar is right from the first paint; confirmed once memberships load.
    var clubTab = false;
    try { clubTab = localStorage.getItem('sl_v2_clubtab') === '1'; } catch (e) { /* optional */ }
    window.V2.clubTab = function () { return clubTab; };
    function tabOf(page) {
        if (clubTab) { if (page === 'events') return null; if (page === 'club') return 'club'; }
        return TAB_OF[page];
    }
    function isChildOfYou(page) {
        if (clubTab) return page === 'safety' || page === 'leaderboard' || page === 'events';
        return !!CHILD_OF_YOU[page];
    }
    var backTarget = 'you';

    var NSRI_TEL = '0870949774';          // same number as the Safety page (index.html)
    var NSRI_DISPLAY = '087 094 9774';

    var currentPage = 'dashboard';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function icons() {
        if (typeof initIcons === 'function') initIcons();
        else if (window.lucide) window.lucide.createIcons();
    }

    // ── Bottom tab bar + back link ─────────────────────────────────────────
    function mount() {
        var app = document.getElementById('mainApp');
        if (!app || document.getElementById('v2Tabbar')) return;

        var bar = document.createElement('nav');
        bar.className = 'v2-tabbar';
        bar.id = 'v2Tabbar';
        bar.setAttribute('aria-label', 'Main');
        bar.innerHTML =
            tabBtn('today', 'sun', 'Today') +
            tabBtn('spots', 'map-pin', 'Spots') +
            '<button class="v2-tab v2-tab-log" data-v2tab="log" aria-label="' + COPY.action + '"><span class="v2-fab"><i data-lucide="plus"></i></span></button>' +
            (clubTab ? tabBtn('club', 'users', 'Club') : tabBtn('swims', 'waves', 'Swims')) +
            tabBtn('you', 'user-round', 'You');
        app.appendChild(bar);

        bar.addEventListener('click', function (e) {
            var b = e.target.closest('[data-v2tab]');
            if (!b) return;
            var tab = b.getAttribute('data-v2tab');
            var page = PAGE_OF[tab];
            if (tab !== 'log' && tabOf(currentPage) === tab && !isChildOfYou(currentPage)) {
                window.scrollTo({ top: 0, behavior: 'smooth' });   // re-tap: back to top
                return;
            }
            if (typeof showPage === 'function') showPage(page);
        });

        // Back link sits at the top of the page container
        var container = app.querySelector('.container');
        if (container) {
            var back = document.createElement('button');
            back.className = 'v2-back';
            back.id = 'v2Back';
            back.type = 'button';
            back.innerHTML = '<i data-lucide="chevron-left"></i>You';
            back.addEventListener('click', function () { showPage(backTarget); });
            var header = container.querySelector('.header');
            if (header && header.nextSibling) container.insertBefore(back, header.nextSibling);
            else container.appendChild(back);
        }
        icons();
    }
    function tabBtn(id, icon, label) {
        return '<button class="v2-tab" data-v2tab="' + id + '"><i data-lucide="' + icon + '"></i>' + label + '</button>';
    }

    // Called at the end of showPage(); keeps the bar in step with ANY navigation,
    // including v1 inline onclick calls.
    function highlight(page) {
        var tab = tabOf(page);
        var bar = document.getElementById('v2Tabbar');
        if (bar) {
            bar.querySelectorAll('[data-v2tab]').forEach(function (b) {
                b.classList.toggle('on', b.getAttribute('data-v2tab') === tab);
            });
        }
        var back = document.getElementById('v2Back');
        if (back) {
            back.classList.toggle('on', isChildOfYou(page));
            var lbl = backTarget === 'dashboard' ? 'Today' : 'You';
            back.innerHTML = '<i data-lucide="chevron-left"></i>' + lbl;
            icons();
        }
    }
    var prevPage = 'dashboard';

    // Called at the end of showPage(); keeps the bar in step with ANY navigation,
    // including v1 inline onclick calls.
    function onPage(page) {
        if (page === 'logTemp' && window.V2.enterLog) {
            // Log is an action, not a place: it opens as a sheet over the page we came from,
            // and the tab bar keeps showing that page.
            window.V2.enterLog(prevPage);
            return;
        }
        if (window.V2.exitLog) window.V2.exitLog();
        backTarget = (page === 'events' && clubTab && prevPage !== 'you') ? 'dashboard' : 'you';
        prevPage = page;
        currentPage = page;
        highlight(page);
        window.scrollTo(0, 0);
    }
    window.V2.prevPage = function () { return prevPage; };
    window.V2.highlight = highlight;

    // ── You hub ────────────────────────────────────────────────────────────
    function clubAvailable() {
        var b = document.getElementById('clubNavBtn');
        return !!b && b.style.display !== 'none';
    }
    function row(icon, colour, title, sub, onclick) {
        return '<button class="v2-row" type="button" onclick="' + onclick + '">' +
            '<i data-lucide="' + icon + '" style="color:' + colour + '"></i>' +
            '<span class="v2-row-text"><span class="v2-row-title">' + esc(title) + '</span>' +
            (sub ? '<br><span class="v2-cap">' + esc(sub) + '</span>' : '') + '</span>' +
            '<i data-lucide="chevron-right" class="v2-chev"></i></button>';
    }

    function renderYou() {
        var el = document.getElementById('you');
        if (!el) return;
        var p = (typeof currentUserProfile !== 'undefined' && currentUserProfile) || {};
        var name = p.display_name || 'Swimmer';
        var initials = name.trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase() || 'S';

        var swimming =
            (clubTab ? row('waves', 'var(--sl-cyan)', 'Group swims', 'Upcoming swims and who is in the water', "showPage('events')") : '') +
            row('trophy', 'var(--sl-amber)', 'Challenges and board', 'Draws, leaderboard, how to earn points', "showPage('leaderboard')") +
            '<span id="v2IdentityRow"></span>' +
            row('heart-pulse', 'var(--sl-cyan)', 'Health notes', 'Private notes about how you feel after swims', 'openHealthLog()');

        var rl = window._clubRoleLinks || {}, toolRows = '';
        (rl.adminClubs || []).forEach(function (c) { toolRows += row('shield', 'var(--sl-cyan)', c.name, 'Club admin', "location.href='/club-admin/" + esc(c.slug) + "'"); });
        (rl.coachClubs || []).forEach(function (c) { toolRows += row('clipboard-list', 'var(--sl-cyan)', c.name, 'Coach portal', "location.href='/coach/" + esc(c.slug) + "'"); });
        (rl.coachSetsClubs || []).forEach(function (c) { toolRows += row('calendar-days', 'var(--sl-cyan)', c.name, 'Sets planner', "location.href='/sets/" + esc(c.slug) + "'"); });

        var clubSafety =
            (!clubTab && clubAvailable() ? row('users', 'var(--sl-cyan)', 'Club', '', "showPage('club')") : '') +
            row('shield-alert', 'var(--sl-danger)', 'Safety guidance', 'Hazards, marine life, cold water, contacts', "showPage('safety')");

        var account =
            row('bell', 'var(--sl-text-2)', 'Notifications', '', 'showNotifications()') +
            row('settings', 'var(--sl-text-2)', 'Profile and settings', 'Details, alerts, Strava, privacy, sign out', 'showProfileSettings()') +
            row('layout-dashboard', 'var(--sl-text-2)', 'Classic design', 'Switch back to the previous look (beta)', "V2.setUi('v1')");

        el.innerHTML =
            '<div class="h1" style="font-size:var(--sl-fs-h1);font-weight:700;margin-bottom:var(--sl-s4);">You</div>' +
            '<button class="v2-you-head" type="button" onclick="showProfileSettings()" aria-label="Open profile and settings">' +
                '<span class="v2-avatar">' + esc(initials) + '</span>' +
                '<span><span class="v2-you-name">' + esc(name) + '</span><br><span class="v2-sub">Profile and settings</span></span>' +
            '</button>' +
            '<div class="v2-emergency">' +
                '<i data-lucide="phone"></i>' +
                '<span class="v2-row-text"><span class="v2-row-title">Emergency</span><br><span class="v2-sub">NSRI Sea Rescue<br>' + NSRI_DISPLAY + '</span></span>' +
                '<a class="v2-call" href="tel:' + NSRI_TEL + '" aria-label="Call NSRI Sea Rescue">Call</a>' +
            '</div>' +
            (toolRows ? '<div class="v2-h2">Club tools</div><div class="v2-card">' + toolRows + '</div>' : '') +
            '<div class="v2-h2">Swimming</div><div class="v2-card">' + swimming + '</div>' +
            '<div class="v2-h2">' + (clubTab ? 'Safety' : 'Club and safety') + '</div><div class="v2-card">' + clubSafety + '</div>' +
            '<div class="v2-h2">Account</div><div class="v2-card">' + account + '</div>';
        icons();

        // Swimmer identity is flag-gated (identity_layer_v1); add its row only when on.
        if (typeof identityLayerEnabled === 'function' && typeof showIdentityView === 'function') {
            identityLayerEnabled().then(function (on) {
                var slot = document.getElementById('v2IdentityRow');
                if (!on || !slot) return;
                slot.outerHTML = row('compass', 'var(--sl-cyan)', 'Swimmer identity', 'Overview, story, passport', 'showIdentityView()');
                icons();
            }).catch(function () { /* optional */ });
        }
    }

    // Club entry is revealed asynchronously by loadUserClubs(); refresh You when it changes.
    function watchClubEntry() {
        var b = document.getElementById('clubNavBtn');
        if (!b || !window.MutationObserver) return;
        new MutationObserver(function () {
            if (currentPage === 'you') renderYou();
        }).observe(b, { attributes: true, attributeFilter: ['style'] });
    }

    window.V2.onPage = onPage;
    window.V2.renderYou = renderYou;

    // Swap the fourth tab between Swims and Club (and keep the bar, highlight and You screen in step)
    function applyClubTab(flag) {
        if (flag === clubTab) return;
        clubTab = flag;
        try { localStorage.setItem('sl_v2_clubtab', flag ? '1' : '0'); } catch (e) { /* optional */ }
        var bar = document.getElementById('v2Tabbar');
        var btn = bar && bar.querySelector('[data-v2tab="swims"],[data-v2tab="club"]');
        if (btn) {
            var holder = document.createElement('div');
            holder.innerHTML = clubTab ? tabBtn('club', 'users', 'Club') : tabBtn('swims', 'waves', 'Swims');
            btn.replaceWith(holder.firstChild);
        }
        highlight(currentPage);
        if (currentPage === 'you') renderYou();
        icons();
    }
    window.V2.applyClubTab = applyClubTab;

    // Memberships load asynchronously after login: swim-club member (or parent of one) => Club tab.
    // Not a member (or an open-water club member, e.g. DUC) => Swims. Look for ~11s, then settle on "no".
    function isSwimClubMember() {
        var cm = (typeof currentUserClubs !== 'undefined' && currentUserClubs) || [];
        var pl = (typeof parentLinks !== 'undefined' && parentLinks) || [];
        return cm.some(function (m) { return m.clubs && m.clubs.club_type === 'swim_club'; }) ||
               pl.some(function (l) { return l.clubs && l.clubs.club_type === 'swim_club'; });
    }
    (function pollClubTab() {
        var tries = 0;
        (function tick() {
            tries++;
            if (isSwimClubMember()) { applyClubTab(true); return; }
            var anyClub = ((typeof currentUserClubs !== 'undefined' && currentUserClubs && currentUserClubs.length) || (typeof parentLinks !== 'undefined' && parentLinks && parentLinks.length));
            if (anyClub) { applyClubTab(false); return; }               // in a club, but not a swim club
            if (tries < 16) { setTimeout(tick, 700); return; }
            applyClubTab(false);                                        // never resolved: not in a club
        })();
    })();

    function boot() { mount(); watchClubEntry(); onPage(currentPage); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
