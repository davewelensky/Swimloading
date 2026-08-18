// The crawlable country links on the homepage.
//
// The rule these tests exist to hold: the links in welcome.html are
// GENERATED from site-config.js and must never drift from it. A hand-edited
// list on this page silently fell five countries behind once already.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  loadCountries, buildCountryLinks, renderBlock, applyBlock,
} from '../scripts/sync-country-links.mjs';
import { COUNTRY_SLUGS, REGION_DOMAINS } from '../api/seo-utils.js';

const HTML = readFileSync('welcome.html', 'utf8');
const countries = loadCountries();
const links = buildCountryLinks(countries);

test('links: welcome.html is in sync with site-config.js', () => {
  // Exactly what `node scripts/sync-country-links.mjs --check` does, as a
  // test so a config change without a regen fails the suite.
  assert.equal(applyBlock(HTML, renderBlock(links)), HTML,
    'welcome.html country links are stale — run: node scripts/sync-country-links.mjs');
});

test('links: every country in the config is present, plus South Africa', () => {
  assert.equal(links.length, countries.length + 1);
  assert.equal(links[0].label, 'South Africa');
  for (const c of countries) {
    assert.ok(links.some((l) => l.label === (c.label || c.name)), `${c.name} missing`);
  }
});

test('links: the actual anchors exist in the static HTML (no JS required)', () => {
  for (const l of links) {
    assert.ok(HTML.includes(`href="${l.href}"`), `${l.href} not in welcome.html`);
  }
});

test('links: no duplicate country URLs', () => {
  const hrefs = links.map((l) => l.href);
  const dupes = hrefs.filter((h, i) => hrefs.indexOf(h) !== i);
  assert.deepEqual(dupes, [], `duplicate country URLs: ${dupes.join(', ')}`);
});

test('links: every href resolves to a real region page in seo-utils', () => {
  // The failure this catches for real: site-config had USA slug
  // 'united-states', which has no REGION_DOMAINS entry and 404s. The link
  // was invisible in the HTML because JS rendered it, so nothing caught it.
  const regionSlugs = new Set(Object.keys(REGION_DOMAINS));
  for (const l of links) {
    const slug = l.href.replace('/spots/', '');
    assert.ok(regionSlugs.has(slug), `${l.href} is not a region slug — it would 404`);
  }
});

test('links: a country without its own page falls back to a page that exists', () => {
  const noSlug = countries.filter((c) => !c.slug);
  for (const c of noSlug) {
    const link = links.find((l) => l.label === (c.label || c.name));
    assert.equal(link.href, '/spots/europe');
    assert.ok(Object.keys(REGION_DOMAINS).includes('europe'));
  }
});

test('links: country pages are reachable by both link and /countries/ route', () => {
  // /countries/<slug> is the alternate route; it must map to a real region.
  const regionSlugs = new Set(Object.keys(REGION_DOMAINS));
  for (const [countrySlug, regionSlug] of Object.entries(COUNTRY_SLUGS)) {
    assert.ok(regionSlugs.has(regionSlug),
      `/countries/${countrySlug} maps to '${regionSlug}', which is not a region`);
  }
});
