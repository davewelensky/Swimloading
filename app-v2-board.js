// SwimLoading v2 — Challenges (the v1 Board page, #leaderboard). Inert unless <html class="ui-v2">.
//
// The challenge engines (app-june.js, app-eo.js, app-uk-challenge.js, loadDUCChallenge) carry
// prize copy, draw rules and scoring, and are month-specific. They are NOT touched. v2 changes the
// page around them:
//   - a proper title, and a "Where you stand" card FIRST (v1 puts your own status below the prize,
//     the draw list and the rules), using the same wording as Today (V2.challengeStatus)
//   - the redundant "N challenges live" hub pill is hidden (the page is the list)
//   - tiny text is lifted to 12px and the expanders get 44px targets and keyboard access (v2.css)
// v1's loadLeaderboard() still runs unchanged; we only add to it.
(function () {
    'use strict';
    if (!(window.V2 && window.V2.enabled)) return;

    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function icons() { if (typeof initIcons === 'function') initIcons(); else if (window.lucide) window.lucide.createIcons(); }

    function mount() {
        var page = $('leaderboard');
        if (!page || $('v2BoardHead')) return;
        var head = document.createElement('div');
        head.id = 'v2BoardHead';
        head.innerHTML = '<div class="v2-swims-title">Challenges</div><div id="v2BoardStatus" aria-live="polite"></div>';
        page.insertBefore(head, page.firstChild);

        // Expanders in the challenge cards are <div onclick>: give them a role and keyboard access
        var decorate = function () {
            page.querySelectorAll('[onclick*="nextElementSibling"]').forEach(function (el) {
                if (el.getAttribute('role')) return;
                el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
            });
        };
        if (window.MutationObserver) new MutationObserver(decorate).observe(page, { childList: true, subtree: true });
        page.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            var t = e.target.closest('[role="button"]');
            if (t && t === e.target) { e.preventDefault(); t.click(); }
        });
        decorate();
    }

    async function fillStatus() {
        var box = $('v2BoardStatus');
        if (!box) return;
        try {
            if (typeof jcInit !== 'function') { box.innerHTML = ''; checkEmpty(); return; }
            await jcInit();
            if (typeof jcIsActive !== 'function' || !jcIsActive() || !window.V2.challengeStatus) { box.innerHTML = ''; checkEmpty(); return; }
            var range = jcDateRange();
            var daysLeft = Math.max(0, Math.ceil((range.end - new Date()) / 86400000));
            var score = await jcGetMyScore();
            var month = range.end.toLocaleDateString('en-ZA', { month: 'long' });
            var st = window.V2.challengeStatus(score);
            box.innerHTML =
                '<div class="v2-card v2-status-card">' +
                    '<div class="v2-eyebrow">' + esc(month) + ' · ' + daysLeft + (daysLeft === 1 ? ' day' : ' days') + ' left</div>' +
                    '<div class="v2-card-title" style="margin:6px 0 2px">' + esc(st.headline) + '</div>' +
                    '<div class="v2-sub">' + esc(st.sub) + '</div>' +
                    (st.bar ? '<div class="v2-prog"><div style="width:' + st.bar + '%"></div></div>' : '') +
                '</div>';
        } catch (e) { console.warn('Board status:', e); box.innerHTML = ''; }
        checkEmpty();
    }

    // Between challenges every section is empty; say so instead of showing a title over blank space.
    function checkEmpty() {
        setTimeout(function () {
            var page = $('leaderboard'), head = $('v2BoardHead');
            if (!page || !head) return;
            var empty = ['v2BoardStatus', 'monthlyChallenge', 'eoBoardSection', 'ducChallenge', 'pastWinners', 'dashUkChallenge']
                .every(function (id) { var el = $(id); return !el || !el.textContent.trim() || el.style.display === 'none'; });
            var note = $('v2BoardEmpty');
            if (empty && !note) {
                note = document.createElement('div');
                note.id = 'v2BoardEmpty';
                note.className = 'v2-empty';
                note.innerHTML = '<i data-lucide="trophy"></i><div><b>No challenge running right now</b><br><span class="v2-sub">The next one appears here the day it starts.</span></div>';
                head.appendChild(note);
                icons();
            } else if (!empty && note) { note.remove(); }
        }, 1800);
    }

    // v1 calls loadLeaderboard() from showPage('leaderboard'); add our status alongside it
    var _orig = window.loadLeaderboard;
    if (typeof _orig === 'function') {
        window.loadLeaderboard = function () {
            mount();
            fillStatus();
            return _orig.apply(this, arguments);
        };
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
