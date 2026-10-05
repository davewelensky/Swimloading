import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../sponsors-core.js';
const C = globalThis.SponsorsCore;

const e = (kind, amount, currency, status = 'agreed') => ({ kind, amount, currency, status });

test('balance keeps cash, product, other, inventory and athlete cost as SEPARATE lines', () => {
  const b = C.ledgerBalance([e('cash', 1000, 'ZAR', 'delivered'), e('cash', 500, 'ZAR'), e('product', 2000, 'ZAR'),
    e('other_contribution', 300, 'ZAR'), e('inventory', 800, 'ZAR'), e('athlete_cost', 400, 'ZAR')]).ZAR;
  assert.deepEqual(b.cash, { received: 1000, agreed: 500 });
  assert.equal(b.product, 2000); assert.equal(b.other, 300);
  assert.equal(b.inventory, 800); assert.equal(b.athlete, 400);
  assert.equal(b.indicative, 1000 + 500 + 2000 + 300 - 800 - 400);
});

test('product value is never presented as cash received', () => {
  const b = C.ledgerBalance([e('product', 5000, 'ZAR', 'delivered')]).ZAR;
  assert.equal(b.cash.received, 0); assert.equal(b.cash.agreed, 0); assert.equal(b.product, 5000);
});

test('agreed-but-unreceived cash is not "received"', () => {
  const b = C.ledgerBalance([e('cash', 700, 'GBP', 'agreed')]).GBP;
  assert.equal(b.cash.received, 0); assert.equal(b.cash.agreed, 700);
});

test('currencies are never merged or converted', () => {
  const b = C.ledgerBalance([e('cash', 100, 'ZAR', 'delivered'), e('cash', 100, 'GBP', 'delivered'), e('cash', 100, 'USD', 'delivered')]);
  assert.deepEqual(Object.keys(b).sort(), ['GBP', 'USD', 'ZAR']);
  for (const k of Object.keys(b)) assert.equal(b[k].cash.received, 100);
});

test('any 3-letter currency works, not a fixed four', () => {
  assert.equal(C.currencyCode('aud'), 'AUD'); assert.equal(C.currencyCode('CHF'), 'CHF');
  assert.equal(C.currencyCode('rand'), null); assert.equal(C.currencyCode(''), null);
  assert.ok(C.ledgerBalance([e('cash', 5, 'AUD', 'delivered')]).AUD);
});

test('cancelled entries are excluded; proposed are counted but not valued', () => {
  const b = C.ledgerBalance([e('cash', 900, 'ZAR', 'cancelled'), e('inventory', 900, 'ZAR', 'proposed')]).ZAR;
  assert.equal(b.cash.agreed + b.cash.received, 0); assert.equal(b.inventory, 0); assert.equal(b.proposed, 1);
});

test('unknown kinds are ignored, not silently added to a total', () => {
  assert.deepEqual(C.ledgerBalance([e('mystery', 100, 'ZAR')]), {});
});

test('deal totals: per currency, unpriced lines counted not guessed, declined ignored', () => {
  const d = C.dealTotals([
    { quantity: 2, unit_price: 100, currency: 'ZAR', status: 'draft' },
    { quantity: 1, unit_price: 50, currency: 'GBP', status: 'proposed' },
    { quantity: 3, unit_price: null, currency: null, status: 'draft' },
    { quantity: 1, unit_price: 999, currency: 'ZAR', status: 'declined' }]);
  assert.deepEqual(d.totals, { ZAR: 200, GBP: 50 }); assert.equal(d.unpriced, 1);
});

test('history is one chronological list, newest first, across both legacy sources', () => {
  const h = C.sortHistory([
    { id: 1, occurred_at: '2026-06-25T09:16:57.798Z', source: 'conversations' },
    { id: 2, occurred_at: '2026-09-23T00:00:00+00:00', source: 'conversation_log' },
    { id: 3, occurred_at: '2026-07-03T08:37:18.526Z', source: 'conversations' }]);
  assert.deepEqual(h.map((x) => x.id), [2, 3, 1]);
});

test('money is always labelled with its currency', () => {
  assert.match(C.fmtMoney(1200, 'ZAR'), /^ZAR 1[\s ]?200[.,]00$/);
});
