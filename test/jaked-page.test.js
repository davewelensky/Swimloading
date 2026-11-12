import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(root, 'partners/jaked.html'), 'utf8');

test('every image on the JAKED page exists in the repo and has alt text', () => {
  for (const m of page.matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0];
    const src = (tag.match(/src="([^"]+)"/) || [])[1];
    assert.ok(src, 'img without src: ' + tag);
    if (/^https?:/.test(src)) continue;
    const file = src.startsWith('/') ? path.join(root, src) : path.join(root, 'partners', src);
    assert.ok(fs.existsSync(file), src + ' must exist');
    assert.match(tag, /\balt="/, src + ' needs an alt attribute');
  }
});

test('Carina photo section is present and the preview image points at a real file', () => {
  assert.match(page, /id="carina"/);
  const og = (page.match(/property="og:image" content="https:\/\/www\.swimloading\.com\/([^"]+)"/) || [])[1];
  assert.ok(og && fs.existsSync(path.join(root, og)), 'og:image must point at a committed file');
});

test('the interest button goes to a real WhatsApp number (not a placeholder, not the City line) and is tracked', () => {
  const href = (page.match(/id="interestBtn"[^>]*|<a [^>]*id="interestBtn"/) || [''])[0];
  const link = (page.match(/href="(https:\/\/wa\.me\/[^"]+)"[^>]*id="interestBtn"/) || [])[1];
  assert.ok(link, 'interest button must be a wa.me link: ' + href);
  assert.match(link, /^https:\/\/wa\.me\/27\d{9}\?text=/);
  assert.doesNotMatch(link, /27600181505/, 'that is the City of Cape Town coastal line');
  assert.match(page, /partner_jaked_interest_click/);
});

test('the interest block promises nothing that is not agreed: no price, discount or delivery time', () => {
  const block = (page.match(/<div class="interest-card"[\s\S]*?<\/div>\s*<\/section>/) || [''])[0].replace(/<[^>]+>/g, ' ');
  assert.ok(block.length > 0);
  assert.doesNotMatch(block, /\bR\s?\d|€|% off|discount|deliver(y|ed) (in|within)|days/i);
});

test('brand rules: no emojis', () => {
  assert.doesNotMatch(page, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});
