/**
 * SwimLoading Promo Engine
 * ========================
 * Depends on: promos-config.js (must be loaded first)
 *
 * Exposes globally:
 *   isPromoActive(id)  → boolean
 *
 * On DOMContentLoaded, auto-hides any element with [data-promo="id"]
 * whose promo is inactive. display:none is used so flex/grid parents
 * leave no gap.
 *
 * Timezone: Africa/Johannesburg (SAST, UTC+2, no DST).
 * Change PROMO_TIMEZONE to shift all date comparisons in one place.
 */

(function () {
  const PROMO_TIMEZONE = 'Africa/Johannesburg';

  /**
   * Returns today's date as 'YYYY-MM-DD' in PROMO_TIMEZONE.
   * Uses en-CA locale because it formats dates as ISO YYYY-MM-DD natively.
   */
  function todayInZone() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: PROMO_TIMEZONE }).format(new Date());
  }

  /**
   * isPromoActive(id) → boolean
   *
   * Returns true if the promo should currently be shown:
   *   status 'on'   → always true
   *   status 'off'  → always false
   *   status 'auto' → true only if today (in SAST) is within [startDate, endDate]
   *
   * endDate is the LAST visible day (show through end of that day in SAST).
   * A promo with a future startDate stays hidden until that day arrives.
   */
  function isPromoActive(id) {
    const cfg = (window.PROMOS_CONFIG || {})[id];
    if (!cfg) return false;
    if (cfg.status === 'on')  return true;
    if (cfg.status === 'off') return false;
    // status === 'auto'
    const today = todayInZone();
    return today >= cfg.startDate && today <= cfg.endDate;
  }

  /**
   * Walks the DOM and hides any [data-promo] element whose promo is inactive.
   * Uses display:none — leaves absolutely no space in layout.
   */
  function applyPromos() {
    document.querySelectorAll('[data-promo]').forEach(function (el) {
      const id = el.dataset.promo;
      if (!isPromoActive(id)) {
        el.style.display  = 'none';
        el.style.margin   = '0';
        el.style.padding  = '0';
      }
      // Active promos: leave display untouched so the element's natural CSS applies.
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────
  window.isPromoActive = isPromoActive;

  // ── Auto-apply on DOM ready ───────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyPromos);
  } else {
    applyPromos(); // already ready (e.g. script is deferred)
  }

}());

/*
 * ── USAGE GUIDE ──────────────────────────────────────────────────────────────
 *
 * 1. HIDE A BLOCK AUTOMATICALLY
 *    Wrap any promo block with data-promo="your-id" and load this script.
 *    The element is hidden when the promo is inactive; nothing needed in JS.
 *
 *      <div data-promo="magic5-memorial-day">
 *        <!-- sale banner HTML here -->
 *      </div>
 *
 * 2. CONDITIONALLY SHOW A NAV LINK / CTA
 *    Call isPromoActive() after DOMContentLoaded:
 *
 *      document.addEventListener('DOMContentLoaded', function () {
 *        var link = document.getElementById('magic5-sale-nav-link');
 *        if (link) link.style.display = isPromoActive('magic5-memorial-day') ? '' : 'none';
 *      });
 *
 *    Or inline in a script block at the bottom of the page:
 *
 *      <a id="magic5-sale-link" href="/partners/magic5#sale"
 *         style="display:none">Shop the sale</a>
 *      <script>
 *        if (isPromoActive('magic5-memorial-day'))
 *          document.getElementById('magic5-sale-link').style.display = '';
 *      </script>
 *
 * 3. ADD A NEW PROMO
 *    Edit promos-config.js only — add one entry:
 *
 *      'july-blusmooth': {
 *        status:    'auto',
 *        startDate: '2026-07-01',
 *        endDate:   '2026-07-31',
 *        label:     'Blu Smooth July Challenge',
 *      },
 *
 *    Then wrap the promo HTML with data-promo="july-blusmooth".
 *    No other files need changing.
 *
 * 4. FORCE A PROMO ON OR OFF
 *    Change status in promos-config.js:
 *      status: 'on'   → always visible (use for QA / early preview)
 *      status: 'off'  → always hidden  (use to pull a promo immediately)
 * ──────────────────────────────────────────────────────────────────────────── */
