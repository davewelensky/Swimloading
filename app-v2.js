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
        try { if (mode === 'v2') localStorage.setItem('sl_ui', 'v2'); else localStorage.removeItem('sl_ui'); } catch (e) { /* storage blocked: the ?ui= link still works */ }
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
    var PAGE_OF = { today: 'dashboard', spots: 'history', log: 'logTemp', swims: 'events', you: 'you' };
    // Pages reached from You: show a back link.
    var CHILD_OF_YOU = { safety: 1, leaderboard: 1, club: 1 };

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
            tabBtn('swims', 'waves', 'Swims') +
            tabBtn('you', 'user-round', 'You');
        app.appendChild(bar);

        bar.addEventListener('click', function (e) {
            var b = e.target.closest('[data-v2tab]');
            if (!b) return;
            var tab = b.getAttribute('data-v2tab');
            var page = PAGE_OF[tab];
            if (tab !== 'log' && TAB_OF[currentPage] === tab && !CHILD_OF_YOU[currentPage]) {
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
            back.addEventListener('click', function () { showPage('you'); });
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
        var tab = TAB_OF[page];
        var bar = document.getElementById('v2Tabbar');
        if (bar) {
            bar.querySelectorAll('[data-v2tab]').forEach(function (b) {
                b.classList.toggle('on', b.getAttribute('data-v2tab') === tab);
            });
        }
        var back = document.getElementById('v2Back');
        if (back) back.classList.toggle('on', !!CHILD_OF_YOU[page]);
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
            row('trophy', 'var(--sl-amber)', 'Challenges and board', 'Draws, leaderboard, how to earn points', "showPage('leaderboard')") +
            '<span id="v2IdentityRow"></span>' +
            row('heart-pulse', 'var(--sl-cyan)', 'Health notes', 'Private notes about how you feel after swims', 'openHealthLog()');

        var clubSafety =
            (clubAvailable() ? row('users', 'var(--sl-cyan)', 'Club', '', "showPage('club')") : '') +
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
            '<div class="v2-h2">Swimming</div><div class="v2-card">' + swimming + '</div>' +
            '<div class="v2-h2">Club and safety</div><div class="v2-card">' + clubSafety + '</div>' +
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

    function boot() { mount(); watchClubEntry(); onPage(currentPage); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
