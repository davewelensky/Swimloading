import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptLanguageFor,
  charsetFromContentType,
  decodeBody,
  detectPageLanguage,
  sniffMetaCharset,
} from '../src/fetch/decode.js';

test('charsetFromContentType parses header variants', () => {
  assert.equal(charsetFromContentType('text/html; charset=ISO-8859-9'), 'iso-8859-9');
  assert.equal(charsetFromContentType('text/html;charset="utf-8"'), 'utf-8');
  assert.equal(charsetFromContentType('text/html'), null);
  assert.equal(charsetFromContentType(null), null);
});

test('sniffMetaCharset finds both meta forms', () => {
  assert.equal(sniffMetaCharset(Buffer.from('<html><head><meta charset="windows-1251"></head>')), 'windows-1251');
  assert.equal(
    sniffMetaCharset(
      Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-2">')
    ),
    'iso-8859-2'
  );
  assert.equal(sniffMetaCharset(Buffer.from('<html><head></head>')), null);
});

test('decodeBody honours the header charset for non-UTF-8 bytes', () => {
  // "Gijón" in ISO-8859-1: ó = 0xF3. Decoded as UTF-8 this byte is invalid.
  const bytes = new Uint8Array([0x47, 0x69, 0x6a, 0xf3, 0x6e]);
  const decoded = decodeBody(bytes, 'text/html; charset=ISO-8859-1');
  assert.equal(decoded.text, 'Gijón');
  assert.equal(decoded.charset, 'windows-1252'); // ISO-8859-1 canonicalises to windows-1252 per WHATWG
});

test('decodeBody falls back to the meta tag, then UTF-8', () => {
  const metaPage = Buffer.from('<meta charset="iso-8859-1"><p>caf\xe9</p>', 'latin1');
  assert.equal(decodeBody(metaPage, 'text/html').text.includes('café'), true);

  const utf8Page = Buffer.from('<p>Bogaziçi Kıtalararası</p>', 'utf8');
  assert.equal(decodeBody(utf8Page, null).text.includes('Kıtalararası'), true);
});

test('decodeBody: BOM wins, unknown charset warns and decodes as UTF-8', () => {
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from('swim')]);
  assert.equal(decodeBody(withBom, 'text/html; charset=iso-8859-9').charset, 'utf-8');

  const unknown = decodeBody(Buffer.from('hello'), 'text/html; charset=x-not-a-charset');
  assert.equal(unknown.text, 'hello');
  assert.equal(unknown.warnings.length, 1);
});

test('detectPageLanguage reads html lang, og:locale, content-language — in that order', () => {
  assert.equal(detectPageLanguage('<html lang="it-IT"><body></body></html>'), 'it');
  assert.equal(detectPageLanguage('<html lang="TR"><body></body></html>'), 'tr');
  assert.equal(detectPageLanguage('<html><head><meta property="og:locale" content="es_ES"></head></html>'), 'es');
  assert.equal(
    detectPageLanguage('<html><head><meta http-equiv="content-language" content="fr"></head></html>'),
    'fr'
  );
  assert.equal(detectPageLanguage('<html><body>no declaration</body></html>'), null);
});

test('acceptLanguageFor puts source languages first with English fallback', () => {
  assert.equal(acceptLanguageFor(['it']), 'it, en;q=0.9');
  assert.equal(acceptLanguageFor(['tr', 'en']), 'tr, en;q=0.9');
  assert.equal(acceptLanguageFor(['en']), 'en');
  assert.equal(acceptLanguageFor([]), 'en');
  assert.equal(acceptLanguageFor(null), 'en');
});
