import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const page = read('partners/getstoked.html');
const text = page.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');

test('no discount code is published until Get Stoked confirm it works (PARTNERS.md rule 1)', () => {
  // Sam suggested SWIMLOADING10 as a default but nothing is set up yet. When the code is confirmed in writing, change
  // MEMBER_CODE on the page AND update this test on purpose.
  assert.match(page, /var MEMBER_CODE = null;/);
  assert.doesNotMatch(page, /SWIMLOADING10/i);
  assert.ok(page.includes('id="codeBlock" hidden'), 'the code block ships hidden');
  // .soon-block { display:flex } beats the hidden attribute unless this rule exists (found by rendering the page: an empty "member code" box was visible)
  assert.match(page, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test('the page makes no product or benefit claims; those must come from Therabody-approved material', () => {
  const banned = /\b(faster recovery|recover faster|reduce[sd]? (soreness|pain|inflammation)|relie(f|ve|ves)|heal(s|ing)?|treat(s|ment)?|cure[sd]?|clinically|proven|prevent(s)? injur|boost(s)? performance|muscle (pain|soreness|tension))\b/i;
  assert.doesNotMatch(text, banned);
});

test('no Therabody logo or imagery, and members are not sent to the dealer-only site', () => {
  assert.doesNotMatch(page, /<img[^>]+therabody/i);
  assert.doesNotMatch(page, /href="https?:\/\/[^"]*getstoked\.store/i, 'getstoked.store is the dealer/B2B site');
  assert.ok(fs.existsSync(path.join(root, 'icons/getstoked-logo.jpg')));
});

test('does not mention things that are not agreed: Langebaan, Carina, competitions, exclusivity', () => {
  assert.doesNotMatch(text, /langebaan|carina|bruwer|giveaway|competition|exclusivity|exclusive (partner|supplier|recovery|rights)/i);
});

test('routed with no-cache, tracked under its own key, and counted in the stats dashboard', () => {
  const routes = JSON.parse(read('vercel.json')).routes;
  const r = routes.find((x) => x.src && !x.continue && new RegExp(x.src).test('/partners/getstoked'));
  assert.equal(r.dest, '/partners/getstoked.html');
  assert.match(r.headers['Cache-Control'], /no-store/);
  assert.match(page, /partner_getstoked_page_view/);
  assert.doesNotMatch(page, /partner_jaked_/);
  assert.match(read('partner-stats.html'), /\['getstoked','Get Stoked'\]/);
});

test('brand rules: spotlight, cyan nav brand, no emojis, canonical', () => {
  assert.match(page, /--mouse-x/);
  assert.match(page, /rel="canonical" href="https:\/\/www\.swimloading\.com\/partners\/getstoked"/);
  assert.doesNotMatch(page, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});
