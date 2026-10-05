// Shared sponsor rules — loaded by /Sponsors (sponsor-pipeline.html) and
// /growth-hub. One canonical status list, one category treatment, one country
// rule, one stats function, so the two pages cannot drift apart again.
// (Oct 2026: they had different status lists and a fixed-vs-free-text category
// mismatch, so a plain open-and-save in the Hub silently corrupted sponsors.)
//
// Plain global script (no ES modules, like the rest of the app). Also loadable
// in Node/vm for tests: it attaches to globalThis.
(function (root) {
  // The ONLY status list. Order is pipeline order.
  const STATUSES = ['Idea', 'Researching', 'Contacted', 'In Discussion', 'Confirmed', 'Passed'];

  // Legacy Growth Hub vocabulary, mapped on read. Never written back.
  const STATUS_ALIASES = { 'interested': 'In Discussion', 'not now': 'In Discussion' };   // same mapping the 5 Oct 2026 DB migration applied

  /** Canonical status for any stored/legacy value, or null if unrecognised. */
  function canonicalStatus(s) {
    if (s == null) return null;
    const key = String(s).trim().toLowerCase();
    if (!key) return null;
    const exact = STATUSES.find((x) => x.toLowerCase() === key);
    return exact || STATUS_ALIASES[key] || null;
  }

  /**
   * Category is FREE TEXT (the pipeline has 17 distinct labels and grows), not
   * a fixed list. Canonical treatment: trim, collapse whitespace, and reuse the
   * existing spelling when the same label is already in use, so "recovery" and
   * "Recovery " cannot become two categories.
   */
  function canonicalCategory(input, existing) {
    const clean = String(input == null ? '' : input).replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    const hit = (existing || []).find((c) => c && String(c).replace(/\s+/g, ' ').trim().toLowerCase() === clean.toLowerCase());
    return hit ? String(hit).replace(/\s+/g, ' ').trim() : clean;
  }

  /** Distinct existing categories, sorted, for pickers/datalists. */
  function categoryChoices(rows) {
    return [...new Set((rows || []).map((r) => r && r.category).filter(Boolean).map((c) => String(c).trim()))]
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * A country to PERSIST. "ALL" is a view filter, never a value; anything
   * blank/unknown returns null so callers must ask rather than default to UK.
   */
  function countryForWrite(value) {
    const c = String(value == null ? '' : value).trim().toUpperCase();
    if (!c || c === 'ALL') return null;
    return /^[A-Z]{2,3}$/.test(c) ? c : null;
  }

  /** Counts used by every dashboard tile/list, from the single status list. */
  function sponsorStats(rows, today) {
    const list = rows || [];
    const st = (r) => canonicalStatus(r.status) || 'Idea';
    return {
      total: list.length,
      confirmed: list.filter((r) => st(r) === 'Confirmed').length,
      inDiscussion: list.filter((r) => st(r) === 'In Discussion').length,
      overdue: list.filter((r) => r.follow_up_date && r.follow_up_date < today
        && st(r) !== 'Confirmed' && st(r) !== 'Passed'),
    };
  }

  const TEXT_FIELDS = ['sponsor_name', 'website', 'contact_name', 'contact_email', 'instagram',
    'linkedin', 'proposed_offer', 'owner', 'next_action', 'follow_up_date', 'notes'];
  const norm = (v) => { const s = v == null ? '' : String(v).trim(); return s === '' ? null : s; };

  /**
   * Build the UPDATE for an edit: only fields that actually changed.
   *  - `country` is never part of an update (an edit must not relocate a sponsor).
   *  - `status` / `category` are skipped when the form could not represent the
   *    stored value (`unrepresentable`) and the user did not pick a new one,
   *    so a no-op save can never blank them.
   * @param {object} original  the stored row
   * @param {object} form      values read from the editor
   * @param {{status?:boolean,category?:boolean}} unrepresentable
   */
  function buildSponsorPatch(original, form, unrepresentable) {
    const un = unrepresentable || {};
    const patch = {};
    for (const f of TEXT_FIELDS) {
      if (!(f in form)) continue;
      if (norm(form[f]) !== norm(original[f])) patch[f] = norm(form[f]);
    }
    if ('category' in form) {
      const next = norm(form.category);
      if (!(un.category && next === null) && next !== norm(original.category)) {
        patch.category = canonicalCategory(next, [original.category]);
      }
    }
    if ('status' in form) {
      const next = canonicalStatus(form.status);
      const cur = canonicalStatus(original.status) || norm(original.status);
      if (!(un.status && !next) && next && next !== cur) patch.status = next;
    }
    if ('conversations' in form && JSON.stringify(form.conversations || []) !== JSON.stringify(original.conversations || [])) {
      patch.conversations = form.conversations;
    }
    return patch;
  }


  // ── Commercial maths (no FX: everything is grouped per currency) ──────────
  const SPONSOR_SIDE = ['cash', 'product', 'other_contribution'];
  const SWIMLOADING_SIDE = ['inventory', 'athlete_cost'];
  const LEDGER_KINDS = SPONSOR_SIDE.concat(SWIMLOADING_SIDE);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  /**
   * Balance per currency, kept as SEPARATE lines — never collapsed into one
   * number, and product value is never counted as cash.
   *   cash.received   = cash entries marked delivered
   *   cash.agreed     = cash entries agreed but not yet received
   *   product / other = sponsor-side value (agreed + delivered)
   *   inventory       = SwimLoading commercial inventory committed
   *   athlete         = athlete/talent cost
   *   indicative      = (cash agreed+received + product + other) - (inventory + athlete)
   * Cancelled and proposed entries are excluded (proposed is counted separately).
   */
  function ledgerBalance(entries) {
    const out = {};
    for (const e of entries || []) {
      if (!e || !LEDGER_KINDS.includes(e.kind)) continue;
      const cur = e.currency || '???';
      const b = out[cur] || (out[cur] = { cash: { received: 0, agreed: 0 }, product: 0, other: 0,
        inventory: 0, athlete: 0, proposed: 0, indicative: 0 });
      const amt = num(e.amount);
      if (e.status === 'cancelled') continue;
      if (e.status === 'proposed') { b.proposed += 1; continue; }
      if (e.kind === 'cash') b.cash[e.status === 'delivered' ? 'received' : 'agreed'] += amt;
      else if (e.kind === 'product') b.product += amt;
      else if (e.kind === 'other_contribution') b.other += amt;
      else if (e.kind === 'inventory') b.inventory += amt;
      else if (e.kind === 'athlete_cost') b.athlete += amt;
    }
    for (const b of Object.values(out)) {
      b.indicative = b.cash.received + b.cash.agreed + b.product + b.other - b.inventory - b.athlete;
    }
    return out;
  }

  /** Deal totals per currency; lines without a price are counted, never guessed. */
  function dealTotals(lines) {
    const totals = {}; let unpriced = 0;
    for (const l of lines || []) {
      if (!l || l.status === 'declined') continue;
      if (l.unit_price == null || !l.currency) { unpriced += 1; continue; }
      totals[l.currency] = (totals[l.currency] || 0) + num(l.quantity || 1) * num(l.unit_price);
    }
    return { totals, unpriced };
  }

  /** One chronological history (newest first) from interaction rows. */
  function sortHistory(rows) {
    return (rows || []).slice().sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
  }

  /** "ZAR 1,200.00" — the currency code is always shown; amounts are never merged across currencies. */
  function fmtMoney(amount, currency) {
    const n = num(amount);
    return (currency ? currency + ' ' : '') + n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** Normalise a currency code typed by a person; null if it is not a 3-letter code. */
  function currencyCode(v) {
    const c = String(v == null ? '' : v).trim().toUpperCase();
    return /^[A-Z]{3}$/.test(c) ? c : null;
  }

  root.SponsorsCore = { STATUSES, STATUS_ALIASES, canonicalStatus, canonicalCategory,
    categoryChoices, countryForWrite, sponsorStats, buildSponsorPatch,
    LEDGER_KINDS, SPONSOR_SIDE, SWIMLOADING_SIDE, ledgerBalance, dealTotals, sortHistory, fmtMoney, currencyCode };
})(typeof globalThis !== 'undefined' ? globalThis : window);
