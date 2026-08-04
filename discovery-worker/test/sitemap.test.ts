import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverUrlsFromSitemaps, parseSitemap, scoreEventUrl } from '../src/fetch/sitemap.js';
import { parseRobots } from '../src/fetch/robots.js';

const URLSET = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/about</loc></url>
  <url><loc>https://example.com/races/2027/lake-crossing</loc><lastmod>2026-07-01</lastmod></url>
  <url><loc>https://example.com/races/2027/river-swim</loc></url>
  <url><loc>https://other-domain.com/races/foreign</loc></url>
</urlset>`;

const INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-events.xml</loc></sitemap>
</sitemapindex>`;

test('parseSitemap distinguishes urlset from sitemapindex', () => {
  const urlset = parseSitemap(URLSET);
  assert.equal(urlset.kind, 'urlset');
  assert.equal(urlset.entries.length, 5);
  assert.equal(urlset.entries[2]!.lastModified, '2026-07-01');

  const index = parseSitemap(INDEX);
  assert.equal(index.kind, 'index');
  assert.equal(index.entries.length, 2);

  assert.equal(parseSitemap('<html><body>not a sitemap</body></html>').kind, 'unknown');
});

test('robots.txt Sitemap directives are captured', () => {
  const rules = parseRobots(
    'User-agent: *\nDisallow: /admin\nSitemap: https://example.com/sitemap.xml\nSitemap: https://example.com/sitemap-events.xml'
  );
  assert.deepEqual(rules.sitemaps, ['https://example.com/sitemap.xml', 'https://example.com/sitemap-events.xml']);
  // Rules still parse correctly alongside them.
  assert.equal(rules.groups[0]!.rules.length, 1);
});

test('scoreEventUrl ranks event-looking paths above generic pages, in any language', () => {
  const generic = scoreEventUrl('https://example.com/about-us');
  assert.equal(scoreEventUrl('https://example.com/races/2027/lake-crossing') > generic, true);
  // Non-English paths must rank just as highly — this is the whole point.
  assert.equal(scoreEventUrl('https://ejemplo.es/travesias/2027/cruce-del-lago') > generic, true);
  assert.equal(scoreEventUrl('https://beispiel.de/veranstaltungen/2027/seequerung') > generic, true);
  assert.equal(scoreEventUrl('https://eksempel.dk/arrangementer/2027/aabent-vand') > generic, true);
  assert.equal(scoreEventUrl('https://ornek.com.tr/yarismalar/2027/bogaz') > generic, true);
  // Accented paths fold to the same score as their unaccented spelling.
  assert.equal(
    scoreEventUrl('https://exemple.fr/traversée/2027/lac'),
    scoreEventUrl('https://exemple.fr/traversee/2027/lac')
  );
  // An unrecognised language is never scored below zero — it must still
  // be crawlable, just ranked lower.
  assert.equal(scoreEventUrl('https://example.jp/2027/oyogi') >= 0, true);
});

test('documents are excluded, and past-results paths rank below upcoming events', async () => {
  // Real case: swimsa.org's sitemap is dominated by results PDFs, entry
  // spreadsheets and meet-file ZIPs, which outranked actual event pages.
  assert.equal(scoreEventUrl('https://swimsa.org/events-results/all-events/champs/entries.pdf'), -1);
  assert.equal(scoreEventUrl('https://swimsa.org/events/champs/meet-files.zip'), -1);
  assert.equal(scoreEventUrl('https://swimsa.org/events/programme.xlsx'), -1);

  const upcoming = scoreEventUrl('https://example.com/events/2027/lake-swim');
  const archived = scoreEventUrl('https://example.com/events/results/2019/lake-swim');
  assert.equal(archived < upcoming, true);
  // Multilingual result markers behave the same way.
  assert.equal(
    scoreEventUrl('https://ejemplo.es/eventos/resultados/2019/travesia') <
      scoreEventUrl('https://ejemplo.es/eventos/2027/travesia'),
    true
  );
});

test('discoverUrlsFromSitemaps follows an index, filters off-domain, ranks by event-likeness', async () => {
  const fetched: string[] = [];
  const urls = await discoverUrlsFromSitemaps('https://example.com/races', ['https://example.com/sitemap.xml'], {
    fetchXml: async (url) => {
      fetched.push(url);
      if (url.endsWith('/sitemap.xml')) return INDEX;
      return URLSET;
    },
    maxSitemapsToFollow: 5,
    maxUrls: 100,
  });

  // Off-domain URL dropped, on-domain kept, event pages ranked first.
  assert.equal(urls.includes('https://other-domain.com/races/foreign'), false);
  assert.equal(urls[0]!.includes('/races/2027/'), true);
  assert.equal(urls.includes('https://example.com/about'), true);
  assert.equal(fetched[0], 'https://example.com/sitemap.xml');
});

test('falls back to /sitemap.xml when robots declares none', async () => {
  const fetched: string[] = [];
  await discoverUrlsFromSitemaps('https://example.com/races', [], {
    fetchXml: async (url) => {
      fetched.push(url);
      return URLSET;
    },
    maxSitemapsToFollow: 3,
    maxUrls: 50,
  });
  assert.deepEqual(fetched, ['https://example.com/sitemap.xml']);
});

test('a missing sitemap yields no URLs rather than throwing', async () => {
  const urls = await discoverUrlsFromSitemaps('https://example.com/races', [], {
    fetchXml: async () => null,
    maxSitemapsToFollow: 3,
    maxUrls: 50,
  });
  assert.deepEqual(urls, []);
});

test('budgets are enforced on both sitemaps followed and URLs returned', async () => {
  let sitemapFetches = 0;
  const bigIndex = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from(
    { length: 20 },
    (_, i) => `<sitemap><loc>https://example.com/sitemap-${i}.xml</loc></sitemap>`
  ).join('')}</sitemapindex>`;
  const bigUrlset = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from(
    { length: 50 },
    (_, i) => `<url><loc>https://example.com/races/2027/race-${i}</loc></url>`
  ).join('')}</urlset>`;

  const urls = await discoverUrlsFromSitemaps('https://example.com/races', ['https://example.com/sitemap.xml'], {
    fetchXml: async (url) => {
      sitemapFetches++;
      return url.endsWith('/sitemap.xml') ? bigIndex : bigUrlset;
    },
    maxSitemapsToFollow: 3,
    maxUrls: 10,
  });

  assert.equal(sitemapFetches <= 3, true);
  assert.equal(urls.length, 10);
});
