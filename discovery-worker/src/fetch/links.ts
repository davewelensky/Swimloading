import * as cheerio from 'cheerio';

// Candidate-link discovery from a listing/calendar page.
//
// Deliberately LANGUAGE-NEUTRAL: links are filtered by structure (same
// registrable domain, not an asset, not a utility page), never by
// English keywords like "race" or "event" in the link text — that filter
// would silently discard every non-English organiser site, and sources
// span every language. Noise from structural-only filtering is handled
// downstream by the per-run page cap and the minimum-extraction gate.

export interface LinkExtractionResult {
  links: string[];
  warnings: string[];
}

// Multi-label public suffixes we actually encounter. A full Public Suffix
// List dependency isn't warranted yet; extend this set when a source on a
// new ccTLD scheme is added.
const MULTI_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au',
  'co.nz', 'org.nz',
  'co.za', 'org.za', 'web.za',
  'com.tr', 'org.tr', 'gen.tr',
  'com.br', 'com.mx', 'com.ar',
  'co.jp', 'or.jp', 'co.in', 'co.kr',
]);

export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  const take = MULTI_PART_TLDS.has(lastTwo) ? 3 : 2;
  return labels.slice(-take).join('.');
}

const ASSET_EXTENSIONS = /\.(?:jpe?g|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|rss|atom|pdf|docx?|xlsx?|pptx?|zip|gz|rar|7z|mp3|mp4|mov|avi|webm|woff2?|ttf|eot|gpx|kml)$/i;

// Utility paths that are never an event page, matched as path segments.
// Kept structural/universal (login, cart, legal) — NOT content words.
const UTILITY_SEGMENTS = new Set([
  'login', 'logout', 'signin', 'signup', 'register-account', 'account', 'admin', 'wp-admin', 'wp-login.php',
  'cart', 'basket', 'checkout', 'privacy', 'privacy-policy', 'terms', 'terms-and-conditions', 'cookies',
  'cookie-policy', 'sitemap', 'feed', 'tag', 'author', 'search', 'shop', 'store', 'product', 'products',
]);

function isUtilityPath(pathname: string): boolean {
  return pathname
    .toLowerCase()
    .split('/')
    .filter(Boolean)
    .some((segment) => UTILITY_SEGMENTS.has(segment));
}

// Extracts same-site page links from a listing page, resolved absolute,
// stripped of fragments, deduplicated, in document order. The base page
// itself is excluded.
export function extractSameSiteLinks(html: string, baseUrl: string): LinkExtractionResult {
  const warnings: string[] = [];
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return { links: [], warnings: [`Base URL not parseable: ${baseUrl}`] };
  }
  const baseDomain = registrableDomain(base.host);
  const basePageKey = normalizeForCompare(base);

  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const links: string[] = [];

  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    if (/^(mailto:|tel:|javascript:|data:|sms:|whatsapp:)/i.test(trimmed)) return;

    let resolved: URL;
    try {
      resolved = new URL(trimmed, base);
    } catch {
      return;
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
    if (registrableDomain(resolved.host) !== baseDomain) return;
    if (ASSET_EXTENSIONS.test(resolved.pathname)) return;
    if (isUtilityPath(resolved.pathname)) return;

    resolved.hash = '';
    const key = normalizeForCompare(resolved);
    if (key === basePageKey) return;
    if (seen.has(key)) return;
    seen.add(key);
    links.push(resolved.toString());
  });

  if (links.length === 0) warnings.push('Listing page yielded no same-site links');
  return { links, warnings };
}

function normalizeForCompare(url: URL): string {
  return `${url.host}${url.pathname.replace(/\/+$/, '')}${url.search}`;
}
