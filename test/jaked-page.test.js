import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONSENT_TEXT, CATEGORIES } from '../api/_lib/partner-enquiries/core.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(root, 'partners/jaked.html'), 'utf8');
const fileFor = (src) => (src.startsWith('/') ? path.join(root, src) : path.join(root, 'partners', src));
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('every image on the JAKED page exists in the repo and has alt text', () => {
  for (const m of page.matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0];
    if (/id="lbImg"/.test(tag)) continue; // the lightbox image gets its src at runtime
    const src = (tag.match(/src="([^"]+)"/) || [])[1];
    assert.ok(src, 'img without src: ' + tag);
    assert.match(tag, /\balt="/, src + ' needs an alt attribute');
    if (/^https?:/.test(src)) continue;
    assert.ok(fs.existsSync(fileFor(src)), src + ' must exist');
  }
  for (const m of page.matchAll(/data-full="([^"]+)"/g)) assert.ok(fs.existsSync(fileFor(m[1])), m[1] + ' (full-size photo) must exist');
});

test('Carina sections are present and the preview image points at a real file', () => {
  assert.match(page, /id="wetsuit"/);
  assert.match(page, /id="costumes"/);
  const og = (page.match(/property="og:image" content="https:\/\/www\.swimloading\.com\/([^"]+)"/) || [])[1];
  assert.ok(og && fs.existsSync(path.join(root, og)), 'og:image must point at a committed file');
});

test('WhatsApp links go to the real SwimLoading number (not a placeholder, not the City line) and clicks are tracked', () => {
  const links = [...page.matchAll(/href="(https:\/\/wa\.me\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(links.length >= 1, 'WhatsApp stays as the secondary route');
  for (const l of links) {
    assert.match(l, /^https:\/\/wa\.me\/27824482501\?text=/);
    assert.doesNotMatch(l, /27600181505/, 'that is the City of Cape Town coastal line');
  }
  assert.match(page, /partner_jaked_interest_click/);
});

test('the enquiry section is titled as agreed and has the Register Your Interest call to action', () => {
  const sec = (page.match(/<section id="interest">[\s\S]*?<\/section>/) || [''])[0];
  assert.ok(sec, '#interest section must exist');
  assert.match(text(sec), /Interested in JAKED swimwear\?/);
  assert.match(text(sec), /Register Your Interest/);
  assert.match(text(sec), /SwimLoading is coordinating South African product enquiries and upcoming orders\./);
  // every "register" button opens this form
  assert.ok((page.match(/data-register=/g) || []).length >= 4);
});

test('the enquiry section promises nothing that is not agreed: no price, stock, delivery time, discount or distributor claim', () => {
  const sec = text((page.match(/<section id="interest">[\s\S]*?<\/section>/) || [''])[0]);
  assert.doesNotMatch(sec, /\bR\s?\d|€|\$\s?\d|% off|discount|in stock|available now|ships? (in|within)|deliver(y|ed) (in|within)|\bdays\b|working days|exclusive|authori[sz]ed (dealer|distributor)|official distributor/i);
});

test('the form posts to the enquiry endpoint, asks for consent with the exact stored wording, and never opts anyone into marketing', () => {
  const form = (page.match(/<form id="enqForm"[\s\S]*?<\/form>/) || [''])[0];
  assert.ok(form);
  assert.match(page, /fetch\('\/api\/partner-enquiry'/);
  assert.match(form, /name="consent" required/);
  assert.ok(text(form).includes(CONSENT_TEXT), 'consent wording on the page must match CONSENT_TEXT stored with each enquiry');
  assert.match(form, /href="\/privacy"/);
  assert.match(form, /name="website" tabindex="-1"/, 'honeypot field');
  assert.doesNotMatch(form, /newsletter[^.]*(checked|subscribe me)|name="(marketing|newsletter|subscribe)"/i);
  const cats = [...form.matchAll(/name="product_category" value="([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(cats, Object.keys(CATEGORIES).sort());
  for (const f of ['customer_name', 'email', 'phone', 'preferred_model', 'fit', 'size', 'size_help', 'colour', 'quantity', 'comments']) {
    assert.match(form, new RegExp(`name="${f}"`), f + ' field');
  }
});

test('the confirmation copy matches the agreed wording and shows the reference', () => {
  const done = text((page.match(/<div class="enq-done"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/) || [''])[0]);
  assert.match(done, /Thank you for your interest in JAKED\. We've received your enquiry and will contact you regarding availability, pricing, sizing and delivery options\./);
  assert.match(page, /id="enqRef"/);
});

test('brand rules: no emojis', () => {
  assert.doesNotMatch(page, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});
