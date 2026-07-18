/**
 * SwimLoading — SITE SYNC (runtime for site-config.js)
 * ====================================================
 * Reads window.SITE_CONFIG and keeps every page consistent:
 *   1. Stamps [data-sync="<key>"] elements with the shared value.
 *   2. Auto-selects the current SAST month's challenge (rolls over at 00:00
 *      SAST on the 1st with no code change).
 *   3. Renders / recaps / hides [data-challenge="<sponsor>"] boxes.
 *
 * Load AFTER site-config.js:
 *   <script src="/site-config.js"></script>
 *   <script src="/site-sync.js"></script>
 *
 * Public API (window.siteSync):
 *   countryCount()      → number (international list + 1 for South Africa)
 *   sastMonth()         → 'YYYY-MM' in Africa/Johannesburg
 *   currentChallenge()  → the current month's challenge object (or null)
 *   refresh()           → re-run stamping (call after injecting DOM)
 */
(function () {
  'use strict';

  var C  = window.SITE_CONFIG || {};
  var TZ = 'Africa/Johannesburg';

  /* ── date helpers (SAST) ─────────────────────────────────────────────── */
  function sastMonth() {
    try {
      // en-CA formats as YYYY-MM-DD; slice to YYYY-MM
      return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' })
        .format(new Date()).slice(0, 7);
    } catch (e) {
      return new Date().toISOString().slice(0, 7);
    }
  }
  function sastToday() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date());
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  /* ── derived values ──────────────────────────────────────────────────── */
  function countryCount() {
    return (Array.isArray(C.countries) ? C.countries.length : 0) + 1; // +1 = South Africa
  }
  function currentChallenge() {
    var m = sastMonth();
    var ch = C.challenges && C.challenges[m];
    return ch ? assign({ month: m }, ch) : null;
  }

  function fmt(n) {
    return (typeof n === 'number') ? n.toLocaleString('en-US') : n;
  }

  var WORDS = ['zero','one','two','three','four','five','six','seven','eight','nine','ten',
               'eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty'];
  function numberWord(n, cap) {
    var w = WORDS[n] || String(n);
    return cap ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  }

  // key → function returning the value to stamp
  var VALUES = {
    'countries':          countryCount,
    'countries.word':     function () { return numberWord(countryCount(), true); },  // "Twelve"
    'countries.word.lc':  function () { return numberWord(countryCount(), false); }, // "twelve"
    'spots':              function () { return fmt(C.spots); },
    'swimmers':           function () { return fmt(C.swimmers); },
    'tempsLogged':        function () { return fmt(C.tempsLogged); },
    'challenge.title':    function () { var c = currentChallenge(); return c ? c.title   : ''; },
    'challenge.sponsor':  function () { var c = currentChallenge(); return c ? c.sponsor : ''; },
    'challenge.prize':    function () { var c = currentChallenge(); return c ? c.prize   : ''; },
  };

  /* ── stamp [data-sync] ───────────────────────────────────────────────── */
  function stampValues() {
    var nodes = document.querySelectorAll('[data-sync]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var fn = VALUES[el.getAttribute('data-sync')];
      if (!fn) continue;
      var v = fn();
      if (v !== null && v !== undefined && v !== '') el.textContent = v;
    }
  }

  /* ── sponsor challenge boxes [data-challenge] ────────────────────────── */
  // A box may contain any of these state sections:
  //   <div data-state="active">…</div>   shown while the sponsor's month is current
  //   <div data-state="recap">…</div>    shown once ended AND a winner is set
  //   <div data-state="pending">…</div>  shown once ended but winner not yet set
  // Slots inside a box: <span data-slot="title|prize|sponsor|winner|month"></span>
  function renderSponsorChallenges() {
    var boxes = document.querySelectorAll('[data-challenge]');
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var key = box.getAttribute('data-challenge');
      var sc  = (C.sponsorChallenges || {})[key];
      var ch  = sc && C.challenges ? C.challenges[sc.challengeMonth] : null;

      if (!ch) { box.style.display = 'none'; continue; }

      var today  = sastToday();
      var active = today >= ch.startDate && today <= ch.endDate;
      var ended  = today > ch.endDate;

      var state;
      if (active)        state = 'active';
      else if (ended)    state = ch.winner ? 'recap' : 'pending';
      else               state = 'active'; // upcoming — treat like active teaser

      // fill slots
      setSlot(box, 'title',   ch.title);
      setSlot(box, 'prize',   ch.prize);
      setSlot(box, 'sponsor', ch.sponsor);
      setSlot(box, 'winner',  ch.winner || '');
      setSlot(box, 'month',   monthName(sc.challengeMonth));

      // show the chosen state section, hide the others; if the chosen section
      // is absent, hide the whole box rather than showing a half-empty one.
      var sections = box.querySelectorAll('[data-state]');
      var shown = false;
      for (var j = 0; j < sections.length; j++) {
        var match = sections[j].getAttribute('data-state') === state;
        sections[j].style.display = match ? '' : 'none';
        if (match) shown = true;
      }
      // Restore the box's intended display when shown. Boxes styled inline
      // (no CSS class to fall back to) declare it via data-display="flex".
      box.style.display = shown ? (box.getAttribute('data-display') || '') : 'none';
      box.setAttribute('data-challenge-state', state);
    }
  }

  function setSlot(box, name, value) {
    var slots = box.querySelectorAll('[data-slot="' + name + '"]');
    for (var i = 0; i < slots.length; i++) {
      if (value !== null && value !== undefined) slots[i].textContent = value;
    }
  }

  function monthName(ym) {
    if (!ym) return '';
    var months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
    var parts = ym.split('-');
    var mi = parseInt(parts[1], 10) - 1;
    return (months[mi] || '') + (parts[0] ? ' ' + parts[0] : '');
  }

  /* ── tiny helpers ────────────────────────────────────────────────────── */
  function assign(t, s) { for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; return t; }

  function refresh() {
    stampValues();
    renderSponsorChallenges();
  }

  window.siteSync = {
    countryCount: countryCount,
    sastMonth: sastMonth,
    currentChallenge: currentChallenge,
    refresh: refresh,
  };

  if (document.readyState !== 'loading') refresh();
  else document.addEventListener('DOMContentLoaded', refresh);
})();
