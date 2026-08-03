// Charset-correct decoding of fetched bodies, and page-language
// detection. Sources span every language and not every organiser serves
// UTF-8 (Turkish ISO-8859-9, legacy Latin-1, Windows-1251 all exist in
// the wild); decoding everything as UTF-8 silently mangles exactly the
// names and place text this pipeline exists to extract faithfully.

export interface DecodedBody {
  text: string;
  charset: string;
  warnings: string[];
}

// Charset from a Content-Type header value, e.g. "text/html; charset=ISO-8859-9".
export function charsetFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const m = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType);
  return m?.[1]?.trim().toLowerCase() ?? null;
}

// Sniffs a <meta charset> / http-equiv declaration from the first bytes of
// the document. The prefix is decoded as latin1, which is safe for this
// purpose: every charset a meta tag can name is ASCII-compatible in the
// range the tag itself occupies.
export function sniffMetaCharset(bytes: Uint8Array): string | null {
  const prefix = Buffer.from(bytes.subarray(0, 2048)).toString('latin1');
  const metaCharset = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(prefix);
  if (metaCharset?.[1]) return metaCharset[1].toLowerCase();
  const httpEquiv = /<meta[^>]+http-equiv\s*=\s*["']?content-type["']?[^>]*content\s*=\s*["'][^"']*charset=([\w.:-]+)/i.exec(
    prefix
  );
  return httpEquiv?.[1]?.toLowerCase() ?? null;
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

// Decode priority (matching how browsers resolve it): BOM, then the
// Content-Type header, then an in-document <meta> declaration, then UTF-8.
// An unrecognised label falls back to UTF-8 with a warning rather than
// failing the fetch — a mangled page still carries JSON-LD worth reading.
export function decodeBody(bytes: Uint8Array, contentTypeHeader: string | null): DecodedBody {
  const warnings: string[] = [];
  let charset = hasUtf8Bom(bytes)
    ? 'utf-8'
    : charsetFromContentType(contentTypeHeader) ?? sniffMetaCharset(bytes) ?? 'utf-8';

  let decoder: InstanceType<typeof TextDecoder>;
  try {
    decoder = new TextDecoder(charset);
  } catch {
    warnings.push(`Unrecognised charset "${charset}" — decoded as UTF-8 instead`);
    charset = 'utf-8';
    decoder = new TextDecoder('utf-8');
  }
  return { text: decoder.decode(bytes), charset: decoder.encoding, warnings };
}

// Primary language subtag of the page ("it", "tr", "zh"…), from the
// <html lang> attribute, an og:locale meta tag, or a Content-Language
// declaration — in that order. Null when the page doesn't say; the
// language is never guessed from the text itself (that would be
// inference, which this pipeline avoids everywhere).
export function detectPageLanguage(html: string): string | null {
  const htmlLang = /<html[^>]*\slang\s*=\s*["']?([A-Za-z]{2,3})(?:[-_][\w]+)?["'\s>]/i.exec(html);
  if (htmlLang?.[1]) return htmlLang[1].toLowerCase();
  const ogLocale = /<meta[^>]+property\s*=\s*["']og:locale["'][^>]*content\s*=\s*["']([A-Za-z]{2,3})(?:[-_][\w]+)?["']/i.exec(
    html
  );
  if (ogLocale?.[1]) return ogLocale[1].toLowerCase();
  const contentLang = /<meta[^>]+http-equiv\s*=\s*["']?content-language["']?[^>]*content\s*=\s*["']([A-Za-z]{2,3})(?:[-_][\w]+)?["']/i.exec(
    html
  );
  return contentLang?.[1]?.toLowerCase() ?? null;
}

// Accept-Language header for a source, from its language_codes column —
// its own languages first, then English as a fallback so multilingual
// sites that have an English variant can offer it.
export function acceptLanguageFor(languageCodes: string[] | null | undefined): string {
  const codes = (languageCodes ?? []).map((c) => c.trim().toLowerCase()).filter((c) => /^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(c));
  const unique = [...new Set(codes.includes('en') ? codes : [...codes, 'en'])];
  if (unique.length === 0) return 'en';
  return unique.map((code, i) => (i === 0 ? code : `${code};q=${Math.max(1 - i * 0.1, 0.1).toFixed(1)}`)).join(', ');
}
