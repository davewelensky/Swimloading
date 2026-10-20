import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const page = read('partners/zerobs.html');
const text = page.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');

test('no discount, price or challenge month is published: none is confirmed (PARTNERS.md rule 1)', () => {
  assert.doesNotMatch(text, /\bR\s?\d|discount code|% off|challenge month|promo code/i);
  assert.match(text, /Not at this stage/);
});

test('the page makes no product or health claims; those stay on the Zero BS site', () => {
  const banned = /\b(faster recovery|recover faster|reduce[sd]? (soreness|pain|inflammation)|relie(f|ve|ves)|heal(s|ing)?|treat(s|ment)?|cure[sd]?|clinically|proven|prevent(s)? injur|boost(s)? performance|muscle (pain|soreness|tension))\b/i;
  assert.doesNotMatch(text, banned);
});

test('no logo file is invented: the wordmark is text until Zero BS supply one', () => {
  assert.doesNotMatch(page, /<img[^>]+zerobs/i);
});

test('does not mention things that are not agreed: athlete names, paid content, sample counts', () => {
  assert.doesNotMatch(text, /carina|bruwer|stramrood|ryan|content fee|\b350\b/i);
});

test('routed with no-cache, tracked under its own key, and counted in the stats dashboard', () => {
  const routes = JSON.parse(read('vercel.json')).routes;
  const r = routes.find((x) => x.src && !x.continue && new RegExp(x.src).test('/partners/zerobs'));
  assert.equal(r.dest, '/partners/zerobs.html');
  assert.match(r.headers['Cache-Control'], /no-store/);
  assert.match(page, /partner_zerobs_page_view/);
  assert.doesNotMatch(page, /partner_jaked_/);
  assert.match(read('partner-stats.html'), /\['zerobs','Zero BS'\]/);
});

test('brand rules: spotlight, cyan nav brand, no emojis, canonical', () => {
  assert.match(page, /--mouse-x/);
  assert.match(page, /rel="canonical" href="https:\/\/www\.swimloading\.com\/partners\/zerobs"/);
  assert.doesNotMatch(page, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});
