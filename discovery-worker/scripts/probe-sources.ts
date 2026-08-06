#!/usr/bin/env node
/**
 * Batch-probe candidate sources and report what each would ACTUALLY yield.
 *
 * WHY THIS EXISTS
 * ---------------
 * The catalogue is 250 swims across 29 countries, and the map is empty
 * across Africa, most of Asia, South America and Eastern Europe. Growing it
 * means finding one good regional calendar per region — Ray's Notebook
 * alone is 338 swims — and the only way to do that at scale is to probe
 * many candidates cheaply and enable the few that work.
 *
 * WHAT MAKES THIS DIFFERENT FROM `npm run probe`
 * ----------------------------------------------
 * `crawl.ts --probe` measures REACHABILITY: links, sitemap URLs, whether
 * JSON-LD is present, and grades on page count. That is necessary and not
 * sufficient, and on 2026-08-05 it would have been actively misleading.
 *
 * Big Bay Events returns HTTP 200, has no robots restriction, and offers
 * dozens of crawlable pages — it would score as a strong candidate. It
 * publishes ZERO dates, so it can never produce a publishable event: the
 * schema forbids storing an unconfirmed date. An afternoon went into
 * discovering that by hand.
 *
 * So this script answers the question that actually decides a source:
 * **how many DATED events would we get?** It runs the real extractors —
 * extractTableEvents and buildFromRow, the same functions crawl-source.ts
 * uses — so the number it reports is the number a real crawl would produce,
 * not a proxy for it.
 *
 * READ-ONLY. Fetches politely through PoliteHttpClient (robots.txt honoured,
 * per-host delays) and writes nothing to the database. The seed SQL it emits
 * is text for a human to review, not something it applies.
 *
 * USAGE
 * -----
 *   npm run probe:batch -- candidates.tsv
 *   npm run probe:batch -- --url https://example.com/calendar
 *   npm run probe:batch -- candidates.tsv --json report.json
 *
 * candidates.tsv — one per line, tab-separated, '#' comments ignored:
 *   ZA<TAB>Cape Long Distance Swimming Association<TAB>https://cldsa.co.za/events/
 * A bare URL per line also works; country and name are then left blank.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { loadConfig } from '../src/config.js';
import { findDateLikeStrings, parseFreeTextDate } from '../src/normalize/date.js';
import { PoliteHttpClient } from '../src/fetch/http-client.js';
import { extractSameSiteLinks } from '../src/fetch/links.js';
import { extractTableEvents } from '../src/extract/table.js';
import { buildFromRow } from '../src/jobs/process-table-page.js';
import { processPage } from '../src/jobs/process-page.js';

const PROBE_SOURCE_ID = '00000000-0000-4000-8000-0000000000ff'; // never persisted

interface Candidate {
  country: string;
  name: string;
  url: string;
}

interface Probe {
  country: string;
  name: string;
  url: string;
  status: number | null;
  error: string | null;
  robotsBlocked: boolean;
  visibleChars: number;
  // Dates the PAGE states, found by scanning its own text — as distinct
  // from dates our extractors managed to pull out. The gap between the two
  // is the difference between "no dates here" and "we missed them".
  datesStatedInText: number;
  futureDatesStatedInText: number;
  sampleStatedDates: string[];
  sameSiteLinks: number;
  hasJsonLd: boolean;
  tableRows: number;
  pageYear: number | null;
  /** Rows that survive buildFromRow — i.e. real named events, waves rejected. */
  usableEvents: number;
  /** Of those, how many carry a date we would actually store. THE number. */
  datedEvents: number;
  /** Dated AND in the future — what would reach the public catalogue. */
  futureDatedEvents: number;
  sampleNames: string[];
  verdict: string;
  recommendation: 'seed' | 'seed-with-ai' | 'needs-render' | 'no-dates' | 'blocked' | 'dead';
}

function parseCandidates(text: string): Candidate[] {
  const out: Candidate[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t').map((p) => p.trim());
    const url = parts.find((p) => /^https?:\/\//i.test(p));
    if (!url) continue;
    const rest = parts.filter((p) => p !== url);
    out.push({
      country: rest[0] && rest[0].length <= 3 ? rest[0].toUpperCase() : '',
      name: rest.find((p) => p.length > 3) ?? '',
      url,
    });
  }
  return out;
}

const visibleText = (html: string) =>
  html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const visibleTextLength = (html: string) => visibleText(html).length;

async function probeOne(c: Candidate, http: PoliteHttpClient): Promise<Probe> {
  const base: Probe = {
    country: c.country, name: c.name, url: c.url,
    status: null, error: null, robotsBlocked: false,
    visibleChars: 0, datesStatedInText: 0, futureDatesStatedInText: 0, sampleStatedDates: [],
    sameSiteLinks: 0, hasJsonLd: false,
    tableRows: 0, pageYear: null,
    usableEvents: 0, datedEvents: 0, futureDatedEvents: 0,
    sampleNames: [], verdict: '', recommendation: 'dead',
  };

  const res = await http.fetchPage(c.url, 'en');
  base.status = res.status ?? null;

  if (!res.ok || res.html === null) {
    base.error = `${res.errorCode ?? 'error'}: ${res.errorMessage ?? 'no body'}`;
    // A 403 to an identified, robots-respecting crawler is a bot-blocker,
    // not a policy refusal — worth recording separately because the fix is
    // to ask the site owner, not to try harder. CLDSA is exactly this.
    base.robotsBlocked = res.status === 403 || /robots/i.test(base.error);
    base.recommendation = base.robotsBlocked ? 'blocked' : 'dead';
    base.verdict = base.robotsBlocked
      ? `HTTP ${res.status} — blocks automated fetches. Ask the organiser rather than retrying.`
      : `Unreachable (${base.error}).`;
    return base;
  }

  const html = res.html;
  const finalUrl = res.finalUrl ?? c.url;
  const today = new Date().toISOString().slice(0, 10);
  base.visibleChars = visibleTextLength(html);

  // What the PAGE says, independent of what we managed to extract. This is
  // the check that stops a "NO DATES" verdict being a lie.
  const statedDates = findDateLikeStrings(visibleText(html))
    .map((raw) => ({ raw, parsed: parseFreeTextDate(raw, {}) }))
    .filter((d) => d.parsed.dateConfirmed && d.parsed.startDate);
  base.datesStatedInText = statedDates.length;
  base.futureDatesStatedInText = statedDates.filter((d) => d.parsed.startDate! >= today).length;
  base.sampleStatedDates = statedDates.slice(0, 4).map((d) => d.raw);
  base.hasJsonLd = /application\/ld\+json/i.test(html);
  base.sameSiteLinks = extractSameSiteLinks(html, finalUrl).links.length;

  // The high-yield path: a whole season in one table.
  const table = extractTableEvents(html);
  base.tableRows = table.rows.length;
  base.pageYear = table.pageYear;

  for (const row of table.rows) {
    // The real builder — rejects waves, age brackets and numbered
    // placeholders, and resolves dates by the real rules including the
    // page-stated year. If this returns null, a crawl would produce nothing
    // for that row either.
    const built = buildFromRow(PROBE_SOURCE_ID, finalUrl, row, table.pageYear, null, {});
    if (!built) continue;
    base.usableEvents += 1;
    const cand = built.candidate;
    if (cand.dateConfirmed && cand.startDate) {
      base.datedEvents += 1;
      if (cand.startDate >= today) base.futureDatedEvents += 1;
    }
    if (base.sampleNames.length < 3 && cand.canonicalName) {
      base.sampleNames.push(
        `${cand.canonicalName}${cand.startDate ? ` (${cand.startDate})` : ' (no date)'}`
      );
    }
  }

  // No table? It may still be a single-event page with JSON-LD.
  if (base.tableRows === 0) {
    const single = processPage(PROBE_SOURCE_ID, finalUrl, html);
    if (single.candidate.canonicalName) {
      base.usableEvents = 1;
      if (single.candidate.dateConfirmed && single.candidate.startDate) {
        base.datedEvents = 1;
        if (single.candidate.startDate >= today) base.futureDatedEvents = 1;
        base.sampleNames.push(`${single.candidate.canonicalName} (${single.candidate.startDate})`);
      }
    }
  }

  // ── Verdict ────────────────────────────────────────────────────────────
  // Ordered so the MOST informative failure wins. "Dates" is the gate:
  // everything else is secondary, because an undated source cannot produce
  // a publishable event no matter how crawlable it is.
  if (base.futureDatedEvents >= 10) {
    base.recommendation = 'seed';
    base.verdict = `STRONG — ${base.futureDatedEvents} future dated events on one page. Seed it.`;
  } else if (base.futureDatedEvents >= 3) {
    base.recommendation = 'seed';
    base.verdict = `GOOD — ${base.futureDatedEvents} future dated events. Worth seeding.`;
  } else if (base.datedEvents >= 3) {
    base.recommendation = 'seed';
    base.verdict = `PAST SEASON — ${base.datedEvents} dated events but none upcoming. Seed and re-crawl when the new season posts.`;
  } else if (base.visibleChars < 1500 && base.sameSiteLinks < 5) {
    base.recommendation = 'needs-render';
    base.verdict = `JS SHELL — only ${base.visibleChars} chars of server-rendered text. Needs Playwright, or skip.`;
  } else if (base.datedEvents === 0 && base.futureDatesStatedInText >= 3) {
    // THE PAGE STATES DATES AND WE MISSED THEM. This branch exists because
    // the one below used to swallow this case and call the source useless.
    //
    // Events Horizons (Hong Kong) reads "24th MAY 2026" in its own HTML.
    // parseFreeTextDate handles that string perfectly; the date simply sits
    // in a Squarespace div no deterministic selector reaches, and this
    // script runs only the deterministic extractors — never the AI fallback
    // the real crawler has. Reported as NO DATES, it looked identical to
    // Big Bay Events, which genuinely publishes none.
    //
    // 'seed-with-ai' rather than 'seed' because the deterministic path
    // demonstrably cannot read this page, so a crawl WILL spend AI budget.
    // That is a cost to accept knowingly, not a surprise to discover.
    base.recommendation = 'seed-with-ai';
    base.verdict =
      `DATES PRESENT, EXTRACTORS MISSED THEM — the page states ${base.futureDatesStatedInText} ` +
      `future date(s) (${base.sampleStatedDates.join(', ')}) that the deterministic ` +
      `extractors could not reach, so this is NOT an undated source. Seed it, but expect the ` +
      `AI fallback to do the work and budget accordingly.`;
  } else if (base.datedEvents === 0) {
    // ZERO DATES IS THE GATE, and it is checked before any "lots of links,
    // maybe events are on sub-pages" optimism. That optimism is exactly how
    // this script would have recommended Big Bay Events: 20 same-site links,
    // reachable, well written — and not one date anywhere on the site, so it
    // can never produce a publishable event. An unconfirmed date is never
    // stored. Recommending AI extraction there spends real money to
    // rediscover that.
    //
    // Deliberately NOT called 'seed-with-ai' even when the link count is
    // high: we have no evidence the sub-pages carry dates, and a verdict
    // should not imply evidence it does not have.
    base.recommendation = 'no-dates';
    const linkNote =
      base.sameSiteLinks >= 20
        ? ` There are ${base.sameSiteLinks} same-site links, so events MIGHT be on individual pages — but that is a guess, not a finding. Probe two or three of those pages directly before spending AI budget on the whole site.`
        : '';
    base.verdict =
      `NO DATES — ${base.usableEvents} event name(s) found, but not one usable date` +
      `${base.pageYear === null ? ' and the page never states a year either' : ''}. ` +
      `An unconfirmed date is never stored, so this cannot publish as it stands. ` +
      // Three different situations used to read identically here. Say which.
      (base.datesStatedInText === 0
        ? `The page's own text was scanned too and states no dates at all, so this is a ` +
          `genuine absence rather than an extraction failure. The fix is usually to ask the ` +
          `organiser for a calendar, not to crawl harder.`
        : `The page DOES state ${base.datesStatedInText} date(s) (${base.sampleStatedDates.join(', ')}) ` +
          `but none of them is upcoming — this is a finished season, not an undated source. ` +
          `Worth seeding and re-probing when next season posts, rather than discarding.`) +
      linkNote;
  } else if (base.futureDatedEvents >= 1 && base.sameSiteLinks >= 15) {
    // ONE EVENT PER PAGE. The thresholds above assume a calendar listing a
    // whole season, and judged per-page they dismiss a perfectly good source
    // that happens to give each event its own page — which is how a great
    // many event sites are built.
    //
    // Caught on oceanswims.com: its listing page yielded nothing, but every
    // individual event page carries a confirmed future date, and there are
    // 24+ of them. Judged one page at a time that reads as "thin"; judged as
    // a site it is Australia's most comprehensive ocean swim calendar. The
    // crawler follows same-site links, so the yield is roughly one event per
    // event page, not one event full stop.
    base.recommendation = 'seed';
    base.verdict =
      `ONE EVENT PER PAGE — this page has a confirmed future date and ${base.sameSiteLinks} ` +
      `same-site links, so the site likely holds one event per page. Seed it: the crawler follows ` +
      `links, so expect roughly one event per event page rather than the single event seen here. ` +
      `Probe the LISTING page too — if that yields nothing, this is still the right shape.`;
  } else {
    base.recommendation = 'no-dates';
    base.verdict = `THIN — ${base.usableEvents} usable event(s), ${base.datedEvents} dated, ` +
      `${base.sameSiteLinks} links. Not enough to justify a crawl slot on its own.`;
  }

  return base;
}

function report(results: Probe[]): string {
  const order: Probe['recommendation'][] =
    ['seed', 'seed-with-ai', 'needs-render', 'no-dates', 'blocked', 'dead'];
  const sorted = [...results].sort(
    (a, b) =>
      order.indexOf(a.recommendation) - order.indexOf(b.recommendation) ||
      b.futureDatedEvents - a.futureDatedEvents
  );

  const lines: string[] = [];
  lines.push('# Source probe report', '');
  lines.push(`${results.length} candidate(s) probed. Read-only — nothing was written.`, '');
  lines.push('| Verdict | Country | URL | Future dated | Usable | Table rows | Links |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of sorted) {
    lines.push(
      `| ${r.recommendation} | ${r.country || '—'} | ${r.url} | ${r.futureDatedEvents} | ` +
        `${r.usableEvents} | ${r.tableRows} | ${r.sameSiteLinks} |`
    );
  }
  lines.push('');
  for (const r of sorted) {
    lines.push(`### ${r.name || r.url}`);
    lines.push(`- ${r.url}`);
    lines.push(`- **${r.verdict}**`);
    if (r.sampleNames.length) lines.push(`- Sample: ${r.sampleNames.join('; ')}`);
    if (r.pageYear !== null) lines.push(`- Page states year: ${r.pageYear}`);
    lines.push('');
  }

  const seeds = sorted.filter((r) => r.recommendation === 'seed' || r.recommendation === 'seed-with-ai');
  if (seeds.length) {
    lines.push('## Seed SQL for the candidates worth enabling', '');
    lines.push('Review before applying. Follow MIGRATIONS.md — this is a starting point, not a migration.', '');
    lines.push('```sql');
    for (const r of seeds) {
      lines.push(
        `INSERT INTO discovery_sources (name, base_url, source_type, authority_level, country_code,` +
          ` language_codes, parser_type, enabled, crawl_frequency, notes)`
      );
      lines.push(
        `VALUES (${sq(r.name || r.url)}, ${sq(r.url)}, 'aggregator', 3, ` +
          `${r.country ? sq(r.country) : 'NULL'}, ARRAY['en'], 'html', false, 'weekly',`
      );
      lines.push(`  ${sq(`Probed ${new Date().toISOString().slice(0, 10)}: ${r.verdict}`)});`);
      lines.push('');
    }
    lines.push('```');
    lines.push('');
    lines.push(
      '`enabled` is FALSE deliberately — seeding and enabling are separate decisions, ' +
        'and a source should be looked at once before it starts writing to the catalogue.'
    );
  }
  return lines.join('\n');
}

const sq = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const urls: string[] = [];
  let file: string | null = null;
  let jsonOut: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url') urls.push(argv[++i]);
    else if (argv[i] === '--json') jsonOut = argv[++i];
    else if (!argv[i].startsWith('--')) file = argv[i];
  }

  let candidates: Candidate[] = urls.map((u) => ({ country: '', name: '', url: u }));
  if (file) candidates = candidates.concat(parseCandidates(await readFile(file, 'utf8')));

  if (candidates.length === 0) {
    console.error('Nothing to probe. Pass a TSV file or one or more --url values.');
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  // Live fetching is gated everywhere else in this worker and is gated here
  // too — probing is still hitting other people's servers.
  if (!config.liveFetchEnabled) {
    console.error(
      'DISCOVERY_LIVE_FETCH_ENABLED is not true — probing makes real network requests and refuses without it.'
    );
    process.exitCode = 1;
    return;
  }

  const http = new PoliteHttpClient({
    userAgent: config.userAgent,
    timeoutMs: config.fetchTimeoutMs,
    maxRetries: config.fetchMaxRetries,
    minHostDelayMs: config.minHostDelayMs,
    maxCrawlDelayMs: config.maxCrawlDelayMs,
    maxResponseBytes: config.maxResponseBytes,
  });

  console.error(`Probing ${candidates.length} candidate(s)…\n`);
  const results: Probe[] = [];
  for (const [i, c] of candidates.entries()) {
    console.error(`  [${i + 1}/${candidates.length}] ${c.url}`);
    try {
      results.push(await probeOne(c, http));
    } catch (err) {
      results.push({
        country: c.country, name: c.name, url: c.url, status: null,
        error: err instanceof Error ? err.message : String(err),
        robotsBlocked: false, visibleChars: 0, datesStatedInText: 0, futureDatesStatedInText: 0,
        sampleStatedDates: [], sameSiteLinks: 0, hasJsonLd: false,
        tableRows: 0, pageYear: null, usableEvents: 0, datedEvents: 0, futureDatedEvents: 0,
        sampleNames: [], verdict: `Probe threw: ${err instanceof Error ? err.message : String(err)}`,
        recommendation: 'dead',
      });
    }
  }

  if (jsonOut) await writeFile(jsonOut, JSON.stringify(results, null, 2));
  // Report to stdout, progress to stderr, so `> report.md` captures only the report.
  console.log(report(results));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
