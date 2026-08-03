import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawlDelayFor, isPathAllowed, parseRobots, RobotsCache } from '../src/fetch/robots.js';

const SAMPLE = `
# comment line
User-agent: *
Disallow: /admin/
Disallow: /search
Allow: /search/events
Crawl-delay: 10

User-agent: BadBot
Disallow: /

User-agent: SwimLoadingDiscoveryBot
Disallow: /private/
Crawl-delay: 2

Sitemap: https://example.com/sitemap.xml
`;

test('parseRobots builds groups with rules and crawl-delay', () => {
  const rules = parseRobots(SAMPLE);
  assert.equal(rules.groups.length, 3);
  assert.deepEqual(rules.groups[0]!.userAgents, ['*']);
  assert.equal(rules.groups[0]!.rules.length, 3);
  assert.equal(rules.groups[0]!.crawlDelaySeconds, 10);
  assert.equal(rules.groups[2]!.crawlDelaySeconds, 2);
});

test('specific user-agent group outranks the * group', () => {
  const rules = parseRobots(SAMPLE);
  // Our bot's own group allows /admin/ (no rule about it there).
  assert.equal(isPathAllowed(rules, 'SwimLoadingDiscoveryBot', '/admin/anything').allowed, true);
  assert.equal(isPathAllowed(rules, 'SwimLoadingDiscoveryBot', '/private/x').allowed, false);
  // An unrelated bot falls back to *.
  assert.equal(isPathAllowed(rules, 'SomeOtherBot', '/admin/anything').allowed, false);
  assert.equal(crawlDelayFor(rules, 'SwimLoadingDiscoveryBot'), 2);
  assert.equal(crawlDelayFor(rules, 'SomeOtherBot'), 10);
});

test('longest matching rule wins; allow wins an exact tie', () => {
  const rules = parseRobots(SAMPLE);
  assert.equal(isPathAllowed(rules, 'SomeOtherBot', '/search').allowed, false);
  assert.equal(isPathAllowed(rules, 'SomeOtherBot', '/search/events/2027').allowed, true);

  const tie = parseRobots('User-agent: *\nDisallow: /page\nAllow: /page');
  assert.equal(isPathAllowed(tie, 'AnyBot', '/page').allowed, true);
});

test('wildcard * and end anchor $ patterns', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /cal*ndar/');
  assert.equal(isPathAllowed(rules, 'Bot', '/files/race.pdf').allowed, false);
  assert.equal(isPathAllowed(rules, 'Bot', '/files/race.pdfx').allowed, true);
  assert.equal(isPathAllowed(rules, 'Bot', '/calendar/2027').allowed, false);
});

test('empty Disallow allows everything', () => {
  const rules = parseRobots('User-agent: *\nDisallow:');
  assert.equal(isPathAllowed(rules, 'Bot', '/anything').allowed, true);
});

test('Disallow: / blocks the whole site', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /');
  assert.equal(isPathAllowed(rules, 'Bot', '/').allowed, false);
  assert.equal(isPathAllowed(rules, 'Bot', '/events').allowed, false);
});

test('RobotsCache: 404 means no policy (allowed), and is cached per origin', async () => {
  let calls = 0;
  const cache = new RobotsCache(async () => {
    calls++;
    return { status: 404, text: '' };
  }, 'SwimLoadingDiscoveryBot');

  const first = await cache.check('https://example.com/events/1');
  const second = await cache.check('https://example.com/events/2');
  assert.equal(first.allowed, true);
  assert.equal(first.availability, 'no_robots');
  assert.equal(second.allowed, true);
  assert.equal(calls, 1);
});

test('RobotsCache: 5xx and network errors mean the host is skipped (conservative)', async () => {
  const failing = new RobotsCache(async () => ({ status: 503, text: '' }), 'Bot');
  const decision = await failing.check('https://down.example.com/page');
  assert.equal(decision.allowed, false);
  assert.equal(decision.availability, 'unreachable');

  const network = new RobotsCache(async () => ({ networkError: 'ECONNRESET' }), 'Bot');
  const netDecision = await network.check('https://gone.example.com/page');
  assert.equal(netDecision.allowed, false);
  assert.equal(netDecision.availability, 'unreachable');
});

test('RobotsCache applies parsed rules to the path', async () => {
  const cache = new RobotsCache(
    async () => ({ status: 200, text: 'User-agent: *\nDisallow: /private/\nCrawl-delay: 7' }),
    'SwimLoadingDiscoveryBot'
  );
  const blocked = await cache.check('https://example.com/private/page');
  assert.equal(blocked.allowed, false);
  assert.match(blocked.matchedRule ?? '', /Disallow: \/private\//);
  const open = await cache.check('https://example.com/events');
  assert.equal(open.allowed, true);
  assert.equal(open.crawlDelaySeconds, 7);
});
