// JAKED Business — Price list calculations (pure; rendered by app.js, tested in test/jaked-business.test.js).
// Supplier prices come from the private catalogue at runtime; none live in this file.
//
// Definitions (shown on the page too):
//   cost €         JAKED wholesale (supplier cost) from the 2026-27 price lists
//   JAKED RRP €    JAKED's suggested retail price (European reference, not a South African price)
//   JAKED margin   (RRP − cost) / RRP  — the margin JAKED's own RRP implies
//   cost R         cost € × ZAR-per-EUR from the active scenario (no freight, duty or import VAT)
//   our price R    the selling price Dave and Carina set, INCLUDING sales VAT
//   our margin     (our price excl. VAT − cost R) / our price excl. VAT — BEFORE freight, duty and import VAT;
//                  the Orders screen gives the full landed margin per shipment.

const num = (x) => typeof x === 'number' && Number.isFinite(x);

export function priceRow(product, ourPrice, scenario = {}) {
  const cost = num(product.wholesale) ? product.wholesale : null;
  const rrp = num(product.retail) ? product.retail : null;
  const fx = num(scenario.fx) && scenario.fx > 0 ? scenario.fx : null;
  const vat = num(scenario.salesVat) && scenario.salesVat >= 0 && scenario.salesVat < 1 ? scenario.salesVat : null;
  const sell = num(ourPrice) && ourPrice > 0 ? ourPrice : null;
  const jakedMargin = cost !== null && rrp ? (rrp - cost) / rrp : null;
  const costZar = cost !== null && fx ? cost * fx : null;
  const rrpZar = rrp !== null && fx ? rrp * fx : null;
  const sellExVat = sell !== null && vat !== null ? sell / (1 + vat) : null;
  const ourMargin = sellExVat && costZar !== null ? (sellExVat - costZar) / sellExVat : null;
  return { sku: product.sku, cost, rrp, jakedMargin, costZar, rrpZar, sell, sellExVat, ourMargin };
}

export const SORTS = {
  model: (a, b) => String(a.p.collection).localeCompare(String(b.p.collection)) || String(a.p.sku).localeCompare(String(b.p.sku)),
  cost_desc: (a, b) => (b.r.cost ?? -1) - (a.r.cost ?? -1),
  cost_asc: (a, b) => (a.r.cost ?? Infinity) - (b.r.cost ?? Infinity),
  jaked_margin_desc: (a, b) => (b.r.jakedMargin ?? -1) - (a.r.jakedMargin ?? -1),
  our_margin_desc: (a, b) => (b.r.ourMargin ?? -Infinity) - (a.r.ourMargin ?? -Infinity),
};

/** Filter + sort the catalogue into price-list rows. */
export function priceList(products, prices = {}, scenario = {}, { search = '', section = '', sort = 'model' } = {}) {
  const q = String(search).trim().toLowerCase();
  return products
    .filter((p) => (!section || p.section === section) && (!q || [p.sku, p.collection, p.gender, p.description, p.section].join(' ').toLowerCase().includes(q)))
    .map((p) => ({ p, r: priceRow(p, prices[p.sku] && prices[p.sku].sell, scenario) }))
    .sort(SORTS[sort] || SORTS.model);
}

/** A data: image URL is accepted only as base64 JPEG/PNG/WebP (catalogue photos from the private table). */
export function safeImage(u) {
  const s = String(u || '');
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) return s;
  try { const x = new URL(s); return x.protocol === 'https:' && !x.username && !x.password ? x.href : null; } catch { return null; }
}

// ── Live rate + defaults (Dave, 18 Nov 2026: "surely we pick up the exchange rate EUR vs ZAR") ───────────
export const SA_VAT_DEFAULT = 0.15;   // South African VAT; a typed rate in Landed cost / Price list always wins

/** The rate and VAT the Price list actually uses, and where each came from (shown on the page). */
export function effectiveRates(scenario = {}, live = null) {
  const own = num(scenario.fx) && scenario.fx > 0;
  const liveOk = live && num(live.rate) && live.rate > 0;
  const vatOwn = num(scenario.salesVat) && scenario.salesVat >= 0 && scenario.salesVat < 1;
  return {
    fx: own ? scenario.fx : liveOk ? live.rate : null,
    fxSource: own ? 'yours' : liveOk ? 'live' : 'none',
    fxDate: !own && liveOk ? live.date || null : null,
    salesVat: vatOwn ? scenario.salesVat : SA_VAT_DEFAULT,
    vatSource: vatOwn ? 'yours' : 'default',
  };
}

/** Parse an ECB-rate response from Frankfurter ({ base:'EUR', date, rates:{ ZAR } }); null if it is not a usable EUR→ZAR rate. */
export function parseLiveRate(json) {
  const r = json && json.rates && json.rates.ZAR;
  if (!(typeof r === 'number' && Number.isFinite(r) && r > 5 && r < 100)) return null;   // sanity band for ZAR per EUR
  if (json.base && json.base !== 'EUR') return null;
  return { rate: r, date: typeof json.date === 'string' ? json.date.slice(0, 10) : null, source: 'European Central Bank via Frankfurter' };
}
