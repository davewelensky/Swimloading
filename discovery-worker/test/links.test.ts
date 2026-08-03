import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSameSiteLinks, registrableDomain } from '../src/fetch/links.js';

test('registrableDomain handles plain and multi-part TLDs', () => {
  assert.equal(registrableDomain('www.chillswim.com'), 'chillswim.com');
  assert.equal(registrableDomain('oceanmanswim.com'), 'oceanmanswim.com');
  assert.equal(registrableDomain('www.castleraceseries.com'), 'castleraceseries.com');
  assert.equal(registrableDomain('shop.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('rottnestchannelswim.com.au'), 'rottnestchannelswim.com.au');
  assert.equal(registrableDomain('www.rottnestchannelswim.com.au'), 'rottnestchannelswim.com.au');
  assert.equal(registrableDomain('bogazici.olimpiyat.org.tr'), 'olimpiyat.org.tr');
});

const LISTING = `
<html><body>
  <a href="/races/coniston">Coniston</a>
  <a href="https://www.example.com/races/ullswater/">Ullswater</a>
  <a href="races/derwent#waves">Derwent</a>
  <a href="/races/coniston">Coniston again</a>
  <a href="/races/coniston/">Coniston trailing slash</a>
  <a href="https://other-site.com/races/foreign">External</a>
  <a href="/brochure.pdf">PDF</a>
  <a href="/images/hero.jpg">Image</a>
  <a href="mailto:info@example.com">Mail</a>
  <a href="tel:+441234">Phone</a>
  <a href="javascript:void(0)">JS</a>
  <a href="/login">Login</a>
  <a href="/cart/">Cart</a>
  <a href="/privacy-policy">Privacy</a>
  <a href="/it/gare/lago-di-garda">Italian race page</a>
  <a href="#section">Anchor</a>
  <a href="/races">The listing itself</a>
</body></html>`;

test('extractSameSiteLinks keeps same-domain page links only', () => {
  const { links } = extractSameSiteLinks(LISTING, 'https://www.example.com/races');
  assert.deepEqual(links, [
    'https://www.example.com/races/coniston',
    'https://www.example.com/races/ullswater/',
    'https://www.example.com/races/derwent',
    'https://www.example.com/it/gare/lago-di-garda',
  ]);
});

test('www and bare host count as the same site', () => {
  const html = '<a href="https://example.com/races/one">One</a>';
  const { links } = extractSameSiteLinks(html, 'https://www.example.com/races');
  assert.deepEqual(links, ['https://example.com/races/one']);
});

test('non-Latin link paths survive untouched', () => {
  const html = '<a href="/yar%C4%B1%C5%9Flar/bo%C4%9Fazi%C3%A7i">Boğaziçi</a>';
  const { links } = extractSameSiteLinks(html, 'https://example.org.tr/');
  assert.equal(links.length, 1);
  assert.match(links[0]!, /yar%C4%B1%C5%9Flar/);
});

test('a listing with no links warns instead of failing', () => {
  const { links, warnings } = extractSameSiteLinks('<html><body>Nothing here</body></html>', 'https://example.com/');
  assert.equal(links.length, 0);
  assert.equal(warnings.length, 1);
});
