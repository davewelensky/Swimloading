// SwimLoading v2 — the Log sheet. Inert unless <html class="ui-v2"> (see app-v2.js).
//
// The v1 log form (#logTemp) IS the form: this module presents it as a bottom sheet over the page
// the swimmer came from and restyles it (v2.css). It does not reimplement anything, so
// submitTempLog() runs unchanged with all of its logic: profile check, location confirmation,
// backdating limits, one-hour duplicate check, outlier check, points, badges, challenge credit.
//
// What changes for the swimmer:
//   - opens as a sheet, closes with X / scrim / Escape / after a successful log
//   - hazards, notes and "log for earlier" move under "More detail"
//   - the temperature starts at the last reading at the chosen spot instead of a fixed 14.0
//   - if GPS finds no spot, the swimmer's last spot is preselected (the v1 location-confirm step
//     still runs on submit, exactly as for a GPS guess, so data quality is unchanged)
//   - the submit button says what it does
//
// DOM contract with app.js / app-nav.js (do not rename or remove): #tempValue, #tempSlider,
// #tempMinusBtn, #tempPlusBtn, #conditionsGrid .toggle-btn, #hazardsToggleGroup, #hazardsFormGroup,
// #logTemp textarea, #backdateToggleBtn, #backdateSection, #backdatePicker, #backdateTime,
// #logTempSpotSelect, #spotPickerTrigger, #spTriggerText, #gpsStatus, #submitTempBtn,
// #stravaLogEntry. The first ACTIVE .toggle-btn inside #logTemp must stay the conditions grid
// (submitTempLog reads it that way), so hazards always sit after conditions in the DOM.
(function () {
    'use strict';
    if (!(window.V2 && window.V2.enabled)) return;

    var COPY = window.V2.COPY;
    var st = { open: false, touched: false, spot: '', timer: null, defaultTried: false, openedAt: 0 };

    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function icons() { if (typeof initIcons === 'function') initIcons(); else if (window.lucide) window.lucide.createIcons(); }

    // ── One-time restructure of the v1 form ─────────────────────────────────
    function mount() {
        var page = $('logTemp'), app = $('mainApp');
        if (!page || !app || $('v2LogHead')) return;
        var card = page.querySelector('.card');
        if (!card) return;

        // The page must sit outside .container (its z-index:1 stacking context would trap the
        // sheet under the tab bar and scrim).
        app.appendChild(page);

        // Scrim
        var scrim = document.createElement('div');
        scrim.id = 'v2LogScrim';
        scrim.className = 'v2-scrim';
        scrim.addEventListener('click', closeLog);
        app.appendChild(scrim);

        // Header
        var head = document.createElement('div');
        head.id = 'v2LogHead';
        head.innerHTML =
            '<div class="v2-grab"></div>' +
            '<div class="v2-between"><div><div class="v2-sheet-title">' + esc(COPY.action) + '</div>' +
            '<div class="v2-cap">' + esc(COPY.hint) + '</div></div>' +
            '<button type="button" class="v2-icon-btn" id="v2LogClose" aria-label="Close">' +
            '<i data-lucide="x"></i></button></div>';
        card.insertBefore(head, card.firstChild);
        $('v2LogClose').addEventListener('click', closeLog);

        // Caption under the temperature: what the last reading here was
        var stepperGroup = $('tempValue') && $('tempValue').closest('.form-group');
        if (stepperGroup) {
            var cap = document.createElement('div');
            cap.id = 'v2LogLast';
            cap.className = 'v2-cap';
            stepperGroup.appendChild(cap);
        }

        // "More detail": earlier time, hazards, notes. Nodes are MOVED, never rebuilt, so ids,
        // inline handlers and v1 show/hide logic (pool mode hides hazards) keep working.
        var more = document.createElement('div');
        more.id = 'v2LogMore';
        more.className = 'v2-more';
        var backdateRow = $('backdateToggleBtn') && $('backdateToggleBtn').parentElement;
        var backdateSection = $('backdateSection');
        var hazards = $('hazardsFormGroup');
        var notes = card.querySelector('textarea') && card.querySelector('textarea').closest('.form-group');
        [backdateRow, backdateSection, hazards, notes].forEach(function (n) { if (n) more.appendChild(n); });

        var submit = $('submitTempBtn');
        var toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.id = 'v2LogMoreBtn';
        toggle.className = 'v2-link';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.innerHTML = '<i data-lucide="chevrons-up-down"></i>More detail <span class="v2-cap">hazards, notes, earlier time</span>';
        toggle.addEventListener('click', function () {
            var on = more.classList.toggle('on');
            toggle.setAttribute('aria-expanded', String(on));
        });
        if (submit && submit.parentNode) {
            submit.parentNode.insertBefore(toggle, submit);
            submit.parentNode.insertBefore(more, submit);
        }

        // Submit wording. submitTempLog() resets the label to 'Share Conditions' on every error path,
        // so keep it in step.
        if (submit) {
            var fix = function () { if (submit.textContent === 'Share Conditions') submit.textContent = COPY.action; };
            fix();
            new MutationObserver(fix).observe(submit, { childList: true, characterData: true, subtree: true });
        }

        // Track whether the swimmer has set the temperature themselves
        ['tempSlider', 'tempMinusBtn', 'tempPlusBtn'].forEach(function (id) {
            var el = $(id);
            if (el) ['input', 'click'].forEach(function (ev) { el.addEventListener(ev, function () { st.touched = true; }); });
        });

        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st.open) closeLog(); });
        icons();
    }

    // ── Open / close ────────────────────────────────────────────────────────
    function enterLog(prev) {
        mount();
        var page = $('logTemp');
        if (!page) return;
        // showPage('logTemp') hid the page we came from; put it back underneath the sheet
        var under = $(prev);
        if (under && under !== page) under.classList.add('active');
        page.classList.add('v2-sheet-open');
        document.documentElement.classList.add('v2-log-open');
        var scrim = $('v2LogScrim'); if (scrim) scrim.classList.add('on');
        page.scrollTop = 0;
        st.open = true; st.touched = false; st.spot = ''; st.defaultTried = false; st.openedAt = Date.now();
        var more = $('v2LogMore'); if (more) more.classList.remove('on');
        var mb = $('v2LogMoreBtn'); if (mb) mb.setAttribute('aria-expanded', 'false');
        if (st.timer) clearInterval(st.timer);
        st.timer = setInterval(tick, 500);
        tick();
        var c = $('v2LogClose'); if (c) setTimeout(function () { c.focus(); }, 50);
    }

    function exitLog() {
        if (!st.open && !document.documentElement.classList.contains('v2-log-open')) return;
        var page = $('logTemp');
        if (page) page.classList.remove('v2-sheet-open');
        document.documentElement.classList.remove('v2-log-open');
        var scrim = $('v2LogScrim'); if (scrim) scrim.classList.remove('on');
        if (st.timer) { clearInterval(st.timer); st.timer = null; }
        st.open = false;
    }

    // X / scrim / Escape: back to the page underneath (still active, so nothing reloads)
    function closeLog() {
        var page = $('logTemp');
        if (page) page.classList.remove('active');
        exitLog();
        var fab = document.querySelector('.v2-tab-log');
        if (fab) fab.focus();
    }

    // ── Smart defaults ──────────────────────────────────────────────────────
    function tick() {
        var sel = $('logTempSpotSelect');
        var id = sel && sel.value;
        if (id && id !== st.spot) { st.spot = id; spotDefaults(id); }
        // GPS gets 1.5s to find a spot; after that fall back to the swimmer's last spot
        if (!id && !st.defaultTried && Date.now() - st.openedAt > 1500) { st.defaultTried = true; lastSpotDefault(); }
    }

    async function lastSpotDefault() {
        try {
            if (!(typeof currentUser !== 'undefined' && currentUser)) return;
            var r = await supabaseClient.from('temp_logs').select('spot_id').eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(1);
            var id = r && r.data && r.data[0] && r.data[0].spot_id;
            var sel = $('logTempSpotSelect');
            if (!id || !sel || sel.value) return;             // GPS or the swimmer got there first
            var sp = (typeof spots !== 'undefined' && spots || []).find(function (s) { return s.id === id; });
            if (!sp) return;
            sel.value = id;
            var label = $('spTriggerText'), trig = $('spotPickerTrigger'), gps = $('gpsStatus');
            if (label) label.textContent = sp.name;
            if (trig) trig.classList.add('sp-has-value');
            if (gps) gps.textContent = 'Your last spot. Change it if you are somewhere else.';
            if (typeof applyPoolFormMode === 'function') applyPoolFormMode(id);
        } catch (e) { /* the swimmer can still pick a spot */ }
    }

    async function spotDefaults(spotId) {
        var cap = $('v2LogLast');
        try {
            var r = await supabaseClient.from('latest_spot_temps').select('temp_c, updated_at').eq('spot_id', spotId).maybeSingle();
            var row = r && r.data;
            if (spotId !== st.spot) return;                    // spot changed while we waited
            if (row && row.temp_c != null) {
                var t = Number(row.temp_c);
                var when = typeof getTimeAgo === 'function' ? getTimeAgo(new Date(row.updated_at)).replace(/^1 (\w+)s ago$/, '1 $1 ago') : '';
                if (!st.touched && typeof updateTempSlider === 'function') {
                    var slider = $('tempSlider'); if (slider) slider.value = t;
                    updateTempSlider(t);
                }
                if (cap) cap.textContent = 'Last reading here: ' + t.toFixed(1) + '°C' + (when ? ', ' + when : '') + '. Adjust to what you feel.';
            } else if (cap) {
                cap.textContent = 'No recent reading here yet. Set the temperature you measured.';
            }
        } catch (e) { if (cap) cap.textContent = ''; }
    }

    window.V2.enterLog = enterLog;
    window.V2.exitLog = exitLog;
    window.V2.closeLog = closeLog;
})();
