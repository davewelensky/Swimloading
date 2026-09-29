// SwimLoading v2 — Swims (the v1 Events page, #events). Inert unless <html class="ui-v2">.
//
// v1 renders event cards and swim posts as large inline-styled templates (loadEvents,
// _renderSwimPostCard) with no classes or ids. Rather than copy or edit those shared templates, v2
// DECORATES the rendered cards (MutationObserver on #eventsList / #swimPostsFeed) and restyles with
// v2.css. Buttons are matched by their label and handler, and every new button reuses the ORIGINAL
// onclick attribute, so joinEvent / leaveEvent / viewEventDetails / toggleSwimInterest keep all
// their v1 behaviour (safety-info gate, approval flow, notifications). If a card does not match
// what we expect it is left exactly as v1 rendered it.
//
// What changes for the swimmer:
//   - one "New" action (I'm swimming now / Plan a group swim) instead of two stacked buttons
//   - one primary action per card (the whole card already opens the swim in v1)
//   - "Running late" and "Cancel RSVP" move behind "Manage my RSVP", so the destructive action is
//     no longer beside a routine one and "You're going" is a status, not a disabled button
//   - going count plus up to three chips per card (safety gear first), the rest under "+N"
//   - 44px targets on every control; swim-post edit/delete get a proper hit area
(function () {
    'use strict';
    if (!(window.V2 && window.V2.enabled)) return;

    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function icons() { if (typeof initIcons === 'function') initIcons(); else if (window.lucide) window.lucide.createIcons(); }

    // ── Header + the single "New" action ────────────────────────────────────
    function mountHeader() {
        var page = $('events');
        var card = page && page.querySelector(':scope > .card');
        if (!card || $('v2SwimsHead')) return;
        var head = document.createElement('div');
        head.id = 'v2SwimsHead';
        head.className = 'v2-between v2-swims-head';
        head.innerHTML = '<div class="v2-swims-title">Swims</div>' +
            '<button type="button" class="v2-btn v2-btn-primary v2-btn-sm" id="v2SwimsNew"><i data-lucide="plus"></i>New</button>';
        card.insertBefore(head, card.firstChild);
        $('v2SwimsNew').addEventListener('click', openNew);

        // The two v1 CTAs are replaced by "New"
        card.querySelectorAll(':scope > button').forEach(function (b) {
            var oc = b.getAttribute('onclick') || '';
            if (/^showImSwimming|^showCreateEvent/.test(oc)) b.classList.add('v2-gone');
        });

        var scrim = document.createElement('div');
        scrim.id = 'v2NewScrim'; scrim.className = 'v2-scrim v2-scrim-top';
        scrim.addEventListener('click', closeNew);
        var sheet = document.createElement('div');
        sheet.id = 'v2NewSheet'; sheet.className = 'v2-done';
        sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'New swim');
        sheet.innerHTML =
            '<div class="v2-grab"></div>' +
            '<div class="v2-between" style="margin-bottom:12px"><div class="v2-sheet-title">New</div>' +
            '<button type="button" class="v2-icon-btn" id="v2NewClose" aria-label="Close"><i data-lucide="x"></i></button></div>' +
            '<div class="v2-card v2-list">' +
                '<button type="button" class="v2-row" data-new="now"><i data-lucide="waves" style="color:var(--sl-cyan)"></i><span class="v2-row-text"><span class="v2-row-title">I\'m swimming now</span><br><span class="v2-cap">Tell people where and when you will be in the water</span></span><i data-lucide="chevron-right" class="v2-chev"></i></button>' +
                '<button type="button" class="v2-row" data-new="plan"><i data-lucide="calendar-plus" style="color:var(--sl-cyan)"></i><span class="v2-row-text"><span class="v2-row-title">Plan a group swim</span><br><span class="v2-cap">Pick a date, place and pace for others to join</span></span><i data-lucide="chevron-right" class="v2-chev"></i></button>' +
            '</div>';
        var app = $('mainApp');
        app.appendChild(scrim); app.appendChild(sheet);
        $('v2NewClose').addEventListener('click', closeNew);
        sheet.querySelectorAll('[data-new]').forEach(function (b) {
            b.addEventListener('click', function () {
                var which = b.getAttribute('data-new');
                closeNew();
                if (which === 'now' && typeof showImSwimming === 'function') showImSwimming();
                if (which === 'plan' && typeof showCreateEvent === 'function') showCreateEvent();
            });
        });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeNew(); });
        icons();
    }
    function openNew() { $('v2NewScrim').classList.add('on'); $('v2NewSheet').classList.add('on'); var c = $('v2NewClose'); if (c) setTimeout(function () { c.focus(); }, 60); }
    function closeNew() { var s = $('v2NewSheet'), sc = $('v2NewScrim'); if (s) s.classList.remove('on'); if (sc) sc.classList.remove('on'); }

    // ── Event cards ─────────────────────────────────────────────────────────
    var CHIP_ORDER = [/^OFFICIAL/i, /Tow Float/i, /Bright Cap/i, /^(Every|Weekly|Monthly|Daily)/i, /^(Race Pace|Fast|Steady|Social|Developing)$/i, /\d\s*km$/i];
    function chipRank(txt) {
        for (var i = 0; i < CHIP_ORDER.length; i++) if (CHIP_ORDER[i].test(txt)) return i;
        return CHIP_ORDER.length;
    }
    function tidyChips(card) {
        var box = [].slice.call(card.querySelectorAll('div')).filter(function (d) {
            var st = d.getAttribute('style') || '';
            return /flex-wrap:\s*wrap/.test(st) && /gap:\s*6px/.test(st) && d.children.length > 0;
        })[0];
        if (!box) return;
        var chips = [].slice.call(box.children);
        var goingChip = chips.filter(function (c) { return /going/i.test(c.textContent); })[0];
        var others = chips.filter(function (c) { return c !== goingChip; })
            .map(function (c, i) { return { el: c, r: chipRank(c.textContent.trim()), i: i }; })
            .sort(function (a, b) { return a.r - b.r || a.i - b.i; });
        var keep = others.slice(0, 3), hide = others.slice(keep.length);     // going count + three, gear chips first
        box.classList.add('ev-chips');
        if (goingChip) box.appendChild(goingChip);
        keep.forEach(function (o) { box.appendChild(o.el); });
        hide.forEach(function (o) { o.el.classList.add('v2-gone'); box.appendChild(o.el); });
        if (hide.length) {
            var more = document.createElement('div');
            more.className = 'v2-more-chip';
            more.textContent = '+' + hide.length;
            more.title = 'More details inside';
            box.appendChild(more);
        }
    }

    function actionButton(cls, label, onclick) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'v2-btn v2-btn-sm ' + cls;
        b.textContent = label;
        if (onclick) b.setAttribute('onclick', onclick);
        return b;
    }

    function decorateCard(card) {
        if (card.getAttribute('data-v2')) return;
        card.setAttribute('data-v2', '1');
        var btns = [].slice.call(card.querySelectorAll('button.btn'));
        if (!btns.length) return;                       // club event card or unknown shape: leave as v1
        var txt = function (b) { return b.textContent.replace(/\s+/g, ' ').trim(); };
        var find = function (re) { return btns.filter(function (b) { return re.test(txt(b)); })[0]; };
        var oc = function (b) { return b ? b.getAttribute('onclick') : null; };

        var join = find(/^I'm Going/i), maybe = find(/^Maybe/i);
        var youGoing = find(/You're Going/i), late = find(/Running Late/i), cancelRsvp = find(/^Cancel RSVP/i);
        var reqSent = find(/Request Sent/i), cancelReq = find(/^Cancel$/i);
        var still = find(/Still In/i), drop = find(/Drop Out/i), cancelled = find(/^Cancelled/i);
        var details = btns.filter(function (b) { return /^Details$/i.test(txt(b)); })[0];
        var idMatch = (btns.map(function (b) { return b.getAttribute('onclick') || ''; }).join(' ').match(/'([^']+)'/) || [])[1];
        if (!idMatch) return;                           // cannot find the event id: leave as v1

        card.classList.add('ev-card');
        card.setAttribute('data-event-id', idMatch);
        tidyChips(card);

        // v1 already opens the swim on a card tap (onclick on the card root, buttons stopPropagation);
        // v2 only adds keyboard access and a role.
        card.setAttribute('role', 'button'); card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', 'Open swim details');
        card.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); viewEventDetails(idMatch); } });

        var actions = document.createElement('div');
        actions.className = 'v2-ev-actions';
        var handled = true;

        if (still && drop) {
            handled = false;                            // "swim changed, still in?" keeps its v1 block; CSS gives it 44px buttons
            card.classList.add('ev-reconfirm');
        } else if (cancelled) {
            /* the CANCELLED tag in the title says it all */
        } else if (youGoing) {
            actions.innerHTML = '<div class="v2-ev-status"><i data-lucide="check"></i>You\'re going</div>';
            var manage = document.createElement('div');
            manage.className = 'v2-ev-manage';
            manage.hidden = true;
            if (late) manage.appendChild(actionButton('v2-btn-ghost v2-btn-warn', 'Running late', oc(late)));
            if (cancelRsvp) manage.appendChild(actionButton('v2-btn-ghost v2-btn-danger', 'Cancel my RSVP', oc(cancelRsvp)));
            var tog = document.createElement('button');
            tog.type = 'button'; tog.className = 'v2-link'; tog.setAttribute('aria-expanded', 'false'); tog.textContent = 'Manage my RSVP';
            tog.addEventListener('click', function (e) { e.stopPropagation(); manage.hidden = !manage.hidden; tog.setAttribute('aria-expanded', String(!manage.hidden)); });
            actions.appendChild(tog); actions.appendChild(manage);
        } else if (reqSent) {
            actions.innerHTML = '<div class="v2-ev-status v2-ev-status-wait"><i data-lucide="clock"></i>Request sent</div>';
            if (cancelReq) actions.appendChild(actionButton('v2-btn-ghost v2-btn-danger', 'Cancel request', oc(cancelReq)));
        } else if (join) {
            var row = document.createElement('div');
            row.className = 'v2-ev-row';
            row.appendChild(actionButton('v2-btn-primary', "I'm going", oc(join)));
            if (maybe) row.appendChild(actionButton('v2-btn-ghost', 'Maybe', oc(maybe)));
            actions.appendChild(row);
        } else {
            handled = false;
        }

        if (handled) {
            // Hide v1's button rows (their handlers now live on the new buttons above)
            var rows = [];
            btns.forEach(function (b) { if (rows.indexOf(b.parentElement) < 0) rows.push(b.parentElement); });
            rows.forEach(function (r) { r.classList.add('v2-gone'); });
            card.appendChild(actions);
            card.classList.add('v2-ev-managed');
        }
    }

    // v1 lists the club's events (its galas) in Swims for every club member. Galas are for the kids' squads and no
    // OW Masters swimmer attends them (Dave, 29 Sep 2026), so hide club-event cards for a masters-squad swimmer.
    // Club-event cards are the ones with a "View on club page" link. Unknown squad => leave them visible.
    var _squadInflight = null;
    // Resolves true (masters) / false (not masters) / null (club not loaded yet: do NOT remember this answer)
    function squadIsMasters() {
        var api = window.V2 && window.V2.club;
        if (!api) return Promise.resolve(null);
        if (api.state && api.state.schedule) return Promise.resolve(api.state.schedule.squadType === 'masters');
        if (!_squadInflight) {
            _squadInflight = api.prepare()
                .then(function (st) { _squadInflight = null; return st && st.schedule ? st.schedule.squadType === 'masters' : null; })
                .catch(function () { _squadInflight = null; return null; });
        }
        return _squadInflight;
    }
    function hideGalasForMasters(list, tries) {
        squadIsMasters().then(function (masters) {
            if (masters === null) {                                       // memberships still loading: look again shortly
                if ((tries || 0) < 10) setTimeout(function () { hideGalasForMasters(list, (tries || 0) + 1); }, 1000);
                return;
            }
            if (!masters) return;
            [].slice.call(list.children).forEach(function (card) {
                if (card.querySelector('a[href^="/clubs/"]')) card.classList.add('v2-gone');
            });
        });
    }

    function decorateAll() {
        var list = $('eventsList');
        if (!list) return;
        [].slice.call(list.children).forEach(function (card) {
            try { decorateCard(card); } catch (e) { console.warn('Swims card left as v1:', e); }
        });
        hideGalasForMasters(list);
        icons();
    }

    // ── Swim posts ("Who's swimming soon") need only CSS; keep keyboard access sane ──
    function boot() {
        mountHeader();
        var list = $('eventsList');
        if (list && window.MutationObserver) new MutationObserver(function () { decorateAll(); }).observe(list, { childList: true });
        decorateAll();
        icons();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
