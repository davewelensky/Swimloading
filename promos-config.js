/**
 * SwimLoading Promo Config
 * ========================
 * Keyed by promo id. All dates in SAST (Africa/Johannesburg, UTC+2).
 *
 * status:
 *   "auto"  → show only while today is within [startDate, endDate] (inclusive both ends)
 *   "on"    → always visible regardless of dates (force-on for testing or early launch)
 *   "off"   → never visible (finished, paused, or not yet ready to announce)
 *
 * To ADD a promo:  add an entry below, set status:"auto", fill in dates.
 * To END a promo:  set status:"off" (or just let endDate pass — auto hides it).
 * To FORCE on:     set status:"on".
 * To FORCE off:    set status:"off".
 *
 * Pages use:  <div data-promo="promo-id">…</div>
 * JS uses:    isPromoActive('promo-id')   → boolean
 */

window.PROMOS_CONFIG = {

  // ── Finished promos ──────────────────────────────────────────────────────

  'magic5-memorial-day': {
    status:    'off',                    // ended 27 May 2026
    startDate: '2026-05-15',
    endDate:   '2026-05-27',
    label:     'THEMAGIC5 Memorial Day Sale (45–50% off)',
  },

  // ── Active / upcoming promos ─────────────────────────────────────────────

  'june-challenge': {
    status:    'auto',
    startDate: '2026-06-01',
    endDate:   '2026-06-30',
    label:     'June Community Challenge — win custom Magic5 goggles',
  },

  // Template — copy this block to add a new promo:
  // 'my-promo-id': {
  //   status:    'auto',          // "auto" | "on" | "off"
  //   startDate: 'YYYY-MM-DD',
  //   endDate:   'YYYY-MM-DD',
  //   label:     'Human-readable name for logs/debugging',
  // },

};
