import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildSportsEvent, ldJsonScript, isoDate } from '../api/_lib/sports-event-schema.js';
import { schemaOrg, supportingSchema } from '../api/events-handler.js';
import { buildSchemaOrg } from '../api/channel-swim-handler.js';

const full = {
  name: 'Langebaan Express', url: 'https://www.swimloading.com/events/langebaan-express-2026',
  description: 'A tidal-assisted swim.', images: ['https://www.swimloading.com/x.jpg'],
  startDate: '2026-11-07', endDate: '2026-11-07',
  venue: { name: 'Preekstoel', city: 'Langebaan', region: 'Western Cape', country: 'ZA', lat: -33.138, lng: 18.09 },
  organizer: { name: 'Big Bay Events', url: 'https://bigbayevents.co.za/' },
  offers: [{ url: 'https://example.org/enter', price: 450, currency: 'ZAR', availability: 'https://schema.org/InStock' }],
};
const hasEmpty = (o) => JSON.stringify(o, (k, v) => (v === '' || v === null ? '__EMPTY__' : v)).includes('__EMPTY__');
const parse = (s) => JSON.parse(s.replace(/^<script[^>]*>|<\/script>$/g, ''));

test('complete event produces valid SportsEvent JSON-LD', () => {
  const d = buildSportsEvent(full);
  assert.equal(d['@type'], 'SportsEvent');
  assert.equal(d.offers.price, '450');
  assert.equal(d.organizer.url, 'https://bigbayevents.co.za/');
  assert.deepEqual(d.image, ['https://www.swimloading.com/x.jpg']);
  assert.doesNotThrow(() => parse(ldJsonScript(d)));
});

test('missing optional data creates no empty properties', () => {
  const d = buildSportsEvent({ name: 'X', startDate: '2026-11-07', venue: { name: 'V', city: '', region: null } });
  assert.ok(!hasEmpty(d));
  for (const k of ['description', 'image', 'endDate', 'organizer', 'offers', 'performer']) assert.ok(!(k in d), k);
  assert.equal(d.location.address, undefined);
});

test('performer is never produced, even if supplied', () => {
  assert.ok(!('performer' in buildSportsEvent({ ...full, performer: { name: 'Someone' } })));
});

test('organizer without a verified URL gets no url', () => {
  const d = buildSportsEvent({ ...full, organizer: { name: 'Oceanman', url: null } });
  assert.deepEqual(d.organizer, { '@type': 'Organization', name: 'Oceanman' });
});

test('javascript: and non-https image/organiser URLs are dropped', () => {
  const d = buildSportsEvent({ ...full, images: ['http://a.com/i.jpg', 'javascript:alert(1)'],
    organizer: { name: 'O', url: 'javascript:alert(1)' } });
  assert.ok(!('image' in d));
  assert.ok(!('url' in d.organizer));
});

test('offer is omitted without a registration URL; multiple offers kept', () => {
  assert.ok(!('offers' in buildSportsEvent({ ...full, offers: [{ price: 5, currency: 'ZAR' }] })));
  const d = buildSportsEvent({ ...full, offers: [
    { name: '6km', url: 'https://e.org/6', price: 300, currency: 'ZAR' },
    { name: '12km', url: 'https://e.org/12', price: 500, currency: 'ZAR' }] });
  assert.equal(d.offers.length, 2);
  assert.equal(d.offers[1].price, '500');
});

test('price without a valid currency is not emitted', () => {
  const d = buildSportsEvent({ ...full, offers: [{ url: 'https://e.org', price: 10, currency: 'rand' }] });
  assert.ok(!('price' in d.offers));
});

test('dates: ISO only, offset-less datetimes rejected, endDate never before start', () => {
  assert.equal(isoDate('2026-11-07'), '2026-11-07');
  assert.equal(isoDate('2026-11-07T07:00:00+02:00'), '2026-11-07T07:00:00+02:00');
  assert.equal(isoDate('2026-11-07T07:00:00'), undefined);
  assert.equal(isoDate('7 Nov 2026'), undefined);
  assert.ok(!('endDate' in buildSportsEvent({ ...full, endDate: '2026-11-01' })));
  assert.equal(buildSportsEvent({ ...full, endDate: '2026-11-08' }).endDate, '2026-11-08');
});

test('minimum facts missing returns null, not a half-empty event', () => {
  assert.equal(buildSportsEvent({ ...full, startDate: 'soon' }), null);
  assert.equal(buildSportsEvent({ ...full, venue: {} }), null);
});

test('JSON-LD cannot be broken out of its script block', () => {
  const html = ldJsonScript(buildSportsEvent({ ...full, name: '</script><script>alert(1)</script> ' }));
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.ok(!html.includes(' '));
});

// ── events-handler integration ────────────────────────────────────────
const ev = {
  slug: 'langebaan-express-2026', title: 'Langebaan Express', start_date: '2026-11-07', end_date: null,
  date_confirmed: true, date_precision: 'exact', status: 'announced', registration_status: 'unknown',
  registration_url: null, short_description: null, description: null,
  event_venues: { display_name: 'Preekstoel', city: 'Langebaan', region: 'Western Cape', country_code: 'ZA', latitude: -33.1, longitude: 18.0 },
  event_distances: [{ original_label: '12km', price_amount: null, price_currency: null }],
};

test('event page: canonical URL, description from stored facts, no fake offer/performer', () => {
  const d = parse(schemaOrg(ev, { organiser: { display_name: 'Big Bay Events', official_url: 'https://bigbayevents.co.za/' } }));
  assert.equal(d.url, 'https://www.swimloading.com/events/langebaan-express-2026');
  assert.match(d.description, /Saturday 7 November 2026/);
  for (const k of ['offers', 'performer', 'image', 'endDate']) assert.ok(!(k in d), k);
});

test('event page: offers only when entries are open with a URL; per-distance prices honoured', () => {
  const open = { ...ev, registration_status: 'open', registration_url: 'https://e.org/enter',
    event_distances: [
      { original_label: '6km', price_amount: 300, price_currency: 'ZAR', registration_url: null },
      { original_label: '12km', price_amount: 500, price_currency: 'ZAR', registration_url: null }] };
  const d = parse(schemaOrg(open, {}));
  assert.equal(d.offers.length, 2);
  assert.equal(d.offers[0].url, 'https://e.org/enter');
  assert.ok(!('offers' in parse(schemaOrg({ ...open, registration_status: 'closed' }, {}))));
});

test('event page: provisional / month-precision dates emit no SportsEvent', () => {
  assert.equal(schemaOrg({ ...ev, date_confirmed: false }, {}), '');
  assert.equal(schemaOrg({ ...ev, date_precision: 'month' }, {}), '');
});

test('no duplicate SportsEvent: supporting graph carries no Event type', () => {
  const g = parse(supportingSchema(ev, { climatology: null }));
  assert.ok(g['@graph'].every((n) => !/Event/.test(n['@type'])));
  assert.equal([schemaOrg(ev, {}), supportingSchema(ev, {})].join('').match(/"SportsEvent"/g).length, 1);
});

test('English Channel swim page: no SportsEvent without a real departure date', () => {
  const s = { full_name: 'A B', year: 1999, direction: 'E-F', depart_date: null };
  assert.equal(buildSchemaOrg(s, '10:00', 'https://www.swimloading.com/x'), null);
  const real = buildSchemaOrg({ ...s, depart_date: '1999-08-01' }, '10:00', 'https://www.swimloading.com/x');
  assert.equal(real.startDate, '1999-08-01');
});

test('generic crossing/route pages never emit SportsEvent', () => {
  for (const f of ['robben.html', 'preekstool.html', 'capepoint.html', 'dassen.html', 'westangle.html', 'english-channel.html', 'big5.html']) {
    assert.ok(!/SportsEvent|"@type"\s*:\s*"Event"/.test(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')), f);
  }
});

test('SportsEvent is only hand-built in the one legacy per-swimmer handler', () => {
  const hits = readdirSync(new URL('../api/', import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .filter((f) => /'@type':\s*'SportsEvent'/.test(readFileSync(new URL(`../api/${f}`, import.meta.url), 'utf8')));
  assert.deepEqual(hits.sort(), ['channel-swim-handler.js']);
});
