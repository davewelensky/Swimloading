import * as cheerio from 'cheerio';
import { isAssetUrl, registrableDomain } from './links.js';

// Sitemap-based page discovery.
//
// Why this matters more than link-following: an organiser whose calendar
// is rendered by JavaScript (so link extraction sees nothing) almost
// always still enumerates every race URL in sitemap.xml, because that is
// what search engines read. Sitemaps are also the only realistic way to
// find the long tail of a large site without crawling it page by page.
//
// Two shapes exist, both handled here: <sitemapindex> (a list of other
// sitemaps) and <urlset> (a list of pages). Indexes are followed one
// level, which covers essentially every real site; deeper nesting is
// rare and is deliberately not chased.

export interface SitemapEntry {
  url: string;
  lastModified: string | null;
}

export interface SitemapParseResult {
  kind: 'index' | 'urlset' | 'unknown';
  entries: SitemapEntry[];
}

export function parseSitemap(xml: string): SitemapParseResult {
  const $ = cheerio.load(xml, { xmlMode: true });

  const sitemapNodes = $('sitemapindex > sitemap');
  if (sitemapNodes.length > 0) {
    const entries: SitemapEntry[] = [];
    sitemapNodes.each((_i, el) => {
      const loc = $(el).find('loc').first().text().trim();
      if (loc) entries.push({ url: loc, lastModified: $(el).find('lastmod').first().text().trim() || null });
    });
    return { kind: 'index', entries };
  }

  const urlNodes = $('urlset > url');
  if (urlNodes.length > 0) {
    const entries: SitemapEntry[] = [];
    urlNodes.each((_i, el) => {
      const loc = $(el).find('loc').first().text().trim();
      if (loc) entries.push({ url: loc, lastModified: $(el).find('lastmod').first().text().trim() || null });
    });
    return { kind: 'urlset', entries };
  }

  return { kind: 'unknown', entries: [] };
}

// Path tokens that suggest a page is about an event, across the languages
// our sources actually publish in. This is a RANKING signal, never a
// filter that discards — an unrecognised language must never silently
// lose its events, so unmatched URLs are kept and simply ranked lower.
// Diacritics are folded before matching, so "travesía" matches "travesia".
const EVENT_PATH_TOKENS = new Set([
  // English
  'event', 'events', 'race', 'races', 'swim', 'swims', 'calendar', 'schedule', 'entry', 'entries',
  // Spanish / Portuguese
  'evento', 'eventos', 'carrera', 'carreras', 'travesia', 'travesias', 'travessia', 'travessias',
  'natacion', 'natacao', 'calendario', 'prueba', 'pruebas', 'corrida', 'inscricao', 'inscripcion',
  // French
  'evenement', 'evenements', 'course', 'courses', 'traversee', 'traversees', 'nage', 'natation', 'calendrier', 'epreuve', 'epreuves',
  // German
  'veranstaltung', 'veranstaltungen', 'wettkampf', 'wettkaempfe', 'termine', 'schwimmen', 'schwimmveranstaltung', 'kalender',
  // Italian
  'eventi', 'gara', 'gare', 'traversata', 'traversate', 'nuoto', 'manifestazione', 'manifestazioni',
  // Dutch
  'evenement', 'evenementen', 'wedstrijd', 'wedstrijden', 'zwemmen', 'zwemwedstrijd', 'agenda',
  // Nordic (da / no / sv / fi)
  'arrangement', 'arrangementer', 'stevne', 'stevner', 'lopp', 'simning', 'svomning', 'svommning',
  'kalender', 'tavling', 'tavlingar', 'kilpailu', 'kilpailut', 'uinti', 'tapahtuma', 'tapahtumat',
  // Polish / Czech
  'zawody', 'wydarzenia', 'wydarzenie', 'plywanie', 'kalendarz', 'zavody', 'plavani',
  // Turkish
  'yarisma', 'yarismalar', 'etkinlik', 'etkinlikler', 'yuzme', 'takvim',
  // Greek (romanised paths) / Croatian / Slovenian
  'agones', 'kolymvisi', 'utrka', 'utrke', 'plivanje', 'tekmovanje',
  // Indonesian / Malay / Filipino
  'acara', 'lomba', 'renang', 'kalendar', 'paligsahan',
]);

// Tokens marking a page as a PAST-results archive rather than an upcoming
// event. Federation sites carry years of these and they outnumber live
// listings; the classifier would reject them downstream anyway, so it is
// cheaper to rank them below real candidates than to spend fetches on
// them. Multilingual for the same reason as EVENT_PATH_TOKENS.
const RESULT_PATH_TOKENS = new Set([
  'results', 'result', 'resultados', 'resultado', 'resultats', 'resultat', 'resultater', 'resultat',
  'ergebnisse', 'risultati', 'uitslagen', 'wyniki', 'sonuclar', 'arkiv', 'archive', 'archives',
  'classifica', 'classement', 'rangliste',
  // News/blog archives are the other great time-sink on federation sites:
  // swimsa.org's sitemap is mostly a decade of articles, many of which
  // mention events in their slug and would otherwise rank as candidates.
  'news', 'noticias', 'noticia', 'nouvelles', 'actualites', 'nachrichten', 'notizie', 'nieuws',
  'nyheder', 'nyheter', 'uutiset', 'aktualnosci', 'haberler', 'blog', 'blogs', 'press', 'media',
]);

function foldForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Higher is more likely to be an event page. Used to ORDER the crawl
// worklist within a page budget, so the most promising URLs are fetched
// first — never to exclude anything outright.
export function scoreEventUrl(url: string): number {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return -1;
  }
  // The URL constructor percent-encodes non-ASCII path characters, so a
  // Spanish "/travesías/" arrives here as "/traves%C3%ADas/". Without
  // decoding first, every accented or non-Latin path scores as if it
  // contained no recognisable words — systematically ranking exactly the
  // non-English events we most want to find BELOW generic English pages.
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    pathname = parsed.pathname; // malformed escape sequence — match raw
  }
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return 0; // the homepage itself

  // Documents are never extractable event pages, whatever their path says.
  if (isAssetUrl(url)) return -1;

  let score = 0;
  for (const segment of segments) {
    const folded = foldForMatch(segment);
    for (const word of folded.split(' ')) {
      if (EVENT_PATH_TOKENS.has(word)) score += 3;
      else if (RESULT_PATH_TOKENS.has(word)) score -= 4;
    }
  }
  // A four-digit year in the path is a strong event-page signal in every
  // language ("/carreras/2027/", "/veranstaltungen/2026-open-water").
  if (/(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/.test(pathname)) score += 2;
  // Deep paths are more likely to be a specific event than a section index.
  if (segments.length >= 2) score += 1;
  return score;
}

export interface SitemapDiscoveryOptions {
  // Fetches an XML document; returns null when it could not be retrieved.
  fetchXml: (url: string) => Promise<string | null>;
  maxSitemapsToFollow: number;
  maxUrls: number;
  log?: (message: string) => void;
}

// Resolves a source's sitemap(s) into a ranked list of candidate page
// URLs on the same registrable domain. Returns [] rather than throwing
// when a site has no usable sitemap — that is a normal outcome, not an
// error, and the caller falls back to link discovery.
export async function discoverUrlsFromSitemaps(
  baseUrl: string,
  declaredSitemaps: string[],
  options: SitemapDiscoveryOptions
): Promise<string[]> {
  const log = options.log ?? (() => {});
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const baseDomain = registrableDomain(base.host);

  // robots.txt declarations first; the conventional path as a fallback so
  // a site that simply never declared one is still discoverable.
  const roots = declaredSitemaps.length > 0 ? [...declaredSitemaps] : [`${base.origin}/sitemap.xml`];

  const seen = new Set<string>();
  const pages: string[] = [];
  const queue = [...roots];
  let sitemapsFetched = 0;

  while (queue.length > 0 && sitemapsFetched < options.maxSitemapsToFollow && pages.length < options.maxUrls) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl || seen.has(sitemapUrl)) continue;
    seen.add(sitemapUrl);

    // Never follow a sitemap off the source's own domain.
    try {
      if (registrableDomain(new URL(sitemapUrl).host) !== baseDomain) continue;
    } catch {
      continue;
    }

    const xml = await options.fetchXml(sitemapUrl);
    sitemapsFetched++;
    if (!xml) continue;

    const parsed = parseSitemap(xml);
    if (parsed.kind === 'index') {
      // Follow child sitemaps, most event-looking first, so a site with
      // 50 sitemaps spends its budget on the ones likely to hold races.
      const ranked = parsed.entries
        .map((e) => e.url)
        .sort((a, b) => scoreEventUrl(b) - scoreEventUrl(a));
      queue.push(...ranked);
      log(`  sitemap index ${sitemapUrl}: ${parsed.entries.length} child sitemap(s)`);
      continue;
    }

    if (parsed.kind === 'urlset') {
      let kept = 0;
      for (const entry of parsed.entries) {
        if (pages.length >= options.maxUrls) break;
        try {
          if (registrableDomain(new URL(entry.url).host) !== baseDomain) continue;
        } catch {
          continue;
        }
        if (seen.has(entry.url)) continue;
        seen.add(entry.url);
        // Assets score -1 and are dropped here rather than ranked, so a
        // document-heavy sitemap does not crowd out real event pages.
        if (isAssetUrl(entry.url)) continue;
        pages.push(entry.url);
        kept++;
      }
      log(`  sitemap ${sitemapUrl}: ${parsed.entries.length} URL(s), ${kept} kept`);
    }
  }

  // Rank so the page budget is spent on the most event-like URLs first.
  return pages.sort((a, b) => scoreEventUrl(b) - scoreEventUrl(a)).slice(0, options.maxUrls);
}
