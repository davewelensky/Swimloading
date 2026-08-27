// Serves /sitemap.xml dynamically from the live database.
// New spots are automatically included — no manual updates required.

import { dbGet, generateSlug, REGION_DOMAINS } from './seo-utils.js';
import { isPublicPageIndexable } from './_lib/indexability.js';
import { countryByCode } from './_countries.js';

const BASE = 'https://www.swimloading.com';
const TODAY = () => new Date().toISOString().slice(0, 10);

const STATIC_PAGES = [
  { path: '/',                    priority: '1.0', changefreq: 'daily'   },
  { path: '/app',                 priority: '0.9', changefreq: 'weekly'  },
  // The catalogue's front door. It was absent from this list entirely
  // until 2026-08-06 while every event page it leads to was listed —
  // 218 children in the sitemap and no parent. Daily, because the
  // catalogue changes daily and this page is what states its size.
  { path: '/explore',             priority: '0.9', changefreq: 'daily'   },
  // The supply side of the catalogue. Organisers searching "list my open
  // water event" should land here, so it is indexed in its own right.
  { path: '/list-your-swim',      priority: '0.8', changefreq: 'monthly' },
  { path: '/robben',              priority: '0.8', changefreq: 'weekly'  },
  { path: '/campaign',            priority: '0.7', changefreq: 'weekly'  },
  { path: '/preekstool',          priority: '0.7', changefreq: 'weekly'  },
  { path: '/capepoint',           priority: '0.7', changefreq: 'weekly'  },
  { path: '/dassen',              priority: '0.7', changefreq: 'weekly'  },
  { path: '/westangle',           priority: '0.7', changefreq: 'weekly'  },
  { path: '/intel',               priority: '0.7', changefreq: 'weekly'  },
  { path: '/pricing',             priority: '0.6', changefreq: 'monthly' },
  { path: '/pro',                 priority: '0.6', changefreq: 'monthly' },
  { path: '/partners/maurten',    priority: '0.7', changefreq: 'monthly' },
  { path: '/partners/sis',        priority: '0.7', changefreq: 'monthly' },
  { path: '/partners/blu-smooth', priority: '0.7', changefreq: 'monthly' },
  { path: '/partners/magic5',     priority: '0.7', changefreq: 'monthly' },
  { path: '/blog/march-challenge',priority: '0.6', changefreq: 'monthly' },
];

// Whether a crossing row actually has a public page. The shared template
// (api/crossings-handler.js) serves any crossing with backfilled page
// content and 404s the rest — the table also holds app-side concepts
// (custom-marathon-swim, robben-island) that must not be advertised.
// english-channel keeps its hand-written page and content cluster, so it
// is routed but has no template content. This replaced a hand-mirrored
// slug list on 2026-08-14 when the template took over the routes.
const hasCrossingPage = (c) => Boolean(c.intro) || c.slug === 'english-channel';

export default async function handler(req, res) {
  try {
    // Enough of each spot to APPLY THE QUALITY GATE, not just to build a
    // URL. Selecting only name+domain (as this did) makes every active row
    // look equally worth indexing, which is how a sitemap fills up with
    // pages that cannot answer the query they would rank for.
    const spots = await dbGet(
      'spots?active=eq.true&select=id,name,domain,area,meet_note,water_type,country_code,latitude,longitude&order=name.asc'
    ) || [];
    // spot_temp_estimate, NOT latest_spot_temps. The gate asks "has this
    // page something to say about its water", and the estimate view is the
    // honest answer to that: it blends the swimmer reading with the
    // modelled one and is what the app itself shows. Gating on swimmer
    // readings alone held back 67 of 194 spots — Boulders Beach, Ballito,
    // Blouberg — real named beaches with coordinates whose only failing was
    // that nobody had logged a temperature there lately. Counting the
    // modelled estimate takes that to 6, and all six are genuinely missing
    // a country_code.
    const estimates = await dbGet('spot_temp_estimate?select=spot_id,swimmer_c,swimmer_at,best_c') || [];
    const estBySpot = new Map(estimates.map(e => [e.spot_id, e]));
    // Whether a spot has EVER had a reading. An inland pool gets no marine
    // model and may go months between logs, but a page with past readings
    // still answers "how cold is it usually" — so history qualifies a page
    // that a recent-reading-only test would wrongly discard.
    const everLogged = await dbGet('latest_spot_temps?select=spot_id') || [];
    const hasReadings = new Set(everLogged.map(r => r.spot_id));

    const urls = [];

    // Static pages
    for (const page of STATIC_PAGES) {
      urls.push(url(`${BASE}${page.path}`, page.priority, page.changefreq, TODAY()));
    }

    // Individual spot pages — slug derived from spot name, and only when
    // the page has enough to be worth indexing. A page that fails the gate
    // still renders and still works; it is simply not advertised here.
    let spotsSkipped = 0;
    for (const spot of spots) {
      const e = estBySpot.get(spot.id);
      const verdict = isPublicPageIndexable(
        { ...spot, temp_c: e?.swimmer_c ?? null, temp_observed_at: e?.swimmer_at ?? null,
          estimate_c: e?.best_c ?? null, has_readings: hasReadings.has(spot.id) },
        'spot'
      );
      if (!verdict.indexable) { spotsSkipped++; continue; }
      urls.push(url(`${BASE}/spots/${generateSlug(spot.name)}`, '0.9', 'daily', TODAY()));
    }

    // Crossing pages, READ FROM THE TABLE rather than hand-listed.
    // Only /crossings/english-channel was ever in STATIC_PAGES, so the
    // other ten were absent — including /crossings/strait-of-gibraltar,
    // which is the single highest-earning page on the site (194 of 447
    // organic clicks in the 28 days to 2026-08-13). A hand-maintained list
    // is wrong the moment a crossing is added, which is the same lesson
    // CLAUDE.md records about hand-typed country lists.
    const crossings = await dbGet(
      'crossings?is_active=eq.true&select=slug,name,distance_km,is_active,intro&order=slug.asc'
    ) || [];
    for (const c of crossings) {
      if (!isPublicPageIndexable(c, 'crossing').indexable) continue;
      // Only crossings the template (or english-channel's own page) will
      // actually serve. Rows without page content 404 and must not be listed.
      if (!hasCrossingPage(c)) continue;
      urls.push(url(`${BASE}/crossings/${c.slug}`, '0.9', 'weekly', TODAY()));
    }

    // Visible in the function log, so a sudden jump in held-back spots is
    // noticed rather than silently shrinking the sitemap.
    if (spotsSkipped > 0) {
      console.log(`sitemap: ${spotsSkipped} of ${spots.length} spots held back as too thin to index`);
    }

    // Region pages — pulled directly from REGION_DOMAINS so seo-utils is the single source of truth
    for (const regionSlug of Object.keys(REGION_DOMAINS)) {
      urls.push(url(`${BASE}/spots/${regionSlug}`, '0.8', 'daily', TODAY()));
    }

    // English Channel content cluster (cost, training, qualifying, pilots, records, relay, jellyfish, tide-windows, famous-swims)
    const CHANNEL_CLUSTER = [
      'cost', 'training-plan', 'qualifying-swim', 'pilots', 'records',
      'relay', 'jellyfish', 'tide-windows', 'famous-swims', 'data-sources',
    ];
    for (const slug of CHANNEL_CLUSTER) {
      urls.push(url(`${BASE}/english-channel/${slug}`, '0.8', 'weekly', TODAY()));
    }

    // English Channel solo swims (3,443 individual pages from the database).
    // PostgREST defaults to 1000 rows — paginate to get them all.
    const channelSwims = await fetchAllSwims();
    for (const swim of channelSwims) {
      // Recent (last 5y) crawl more often; historical stable
      const recent = swim.year >= new Date().getFullYear() - 5;
      urls.push(url(
        `${BASE}/english-channel/swim/${swim.slug}`,
        recent ? '0.6' : '0.4',
        recent ? 'weekly' : 'yearly',
        TODAY()
      ));
    }

    // ── Event pages ──────────────────────────────────────────────────────
    // 194 /events/{slug} pages were built and marked index,follow, and NONE
    // of them was in this file — so Google had no way to reach a single one.
    // Indexable pages that nothing links to and no sitemap lists are
    // invisible pages.
    //
    // The original note here said /explore was noindex,nofollow. It has been
    // index,follow since 2026-08-05 — but it was itself missing from
    // STATIC_PAGES until 2026-08-06 and is still linked from nowhere on the
    // marketing site, so the parent was as invisible as the children were.
    // Both halves are fixed now; the lesson is that "indexable" and
    // "reachable" are different properties and this file only grants one.
    //
    // Gated on is_indexable, which is granted by rule and excludes AI-read
    // candidates and past events — see
    // sql/applied/2026-08-05_explore-phase1-foundation.sql. Listing an event
    // we have not verified well enough would put a wrong listing somewhere a
    // correction cannot follow it.
    // The DB flag narrows the set; isPublicPageIndexable is the authority
    // on whether each survivor is actually fit to be indexed. Selecting the
    // venue and the precision/verification columns is what makes that
    // judgement possible — the old query fetched only a slug and a date,
    // which is exactly enough to advertise a listing nobody has checked.
    const events = await dbGet(
      'event_editions?is_indexable=eq.true&status=in.(announced,entries_open,entries_closed)' +
      `&start_date=gte.${TODAY()}&select=slug,title,start_date,end_date,date_precision,status,discipline,` +
      'verification_tier,is_indexable,venue_id,last_verified_at,event_venues(country_code,latitude,longitude)' +
      '&order=start_date.asc&limit=2000'
    ) || [];
    let eventsSkipped = 0;
    for (const ev of events) {
      if (!ev.slug) continue;
      if (!isPublicPageIndexable({ ...ev, venue: ev.event_venues }, 'event').indexable) { eventsSkipped++; continue; }
      // Soon = worth re-crawling often, because entry status and dates move.
      const soon = ev.start_date && ev.start_date <= addDays(90);
      urls.push(url(
        `${BASE}/events/${ev.slug}`,
        soon ? '0.8' : '0.6',
        soon ? 'daily' : 'weekly',
        (ev.last_verified_at || '').slice(0, 10) || TODAY()
      ));
    }

    if (eventsSkipped > 0) {
      console.log(`sitemap: ${eventsSkipped} of ${events.length} events held back by the quality gate`);
    }

    // ── Regular group swims ──────────────────────────────────────────────
    // /group-swims/{slug}. No quality gate: unlike a crawled race, every row
    // here was entered by hand from a named source and carries
    // last_verified_at. is_public is the gate, and it is the same one the
    // browser reads on /explore, so the index and the page cannot disagree.
    //
    // Weekly rather than daily: a standing swim's details change far less
    // often than a race's entry status, and asking Google to re-crawl three
    // pages every day earns nothing.
    const groupSwims = await dbGet(
      'recurring_swims?is_public=eq.true&select=slug,last_verified_at&order=name.asc&limit=500'
    ) || [];
    for (const g of groupSwims) {
      if (!g.slug) continue;
      urls.push(url(
        `${BASE}/group-swims/${g.slug}`,
        '0.7',
        'weekly',
        (g.last_verified_at || '').slice(0, 10) || TODAY()
      ));
    }

    // ── Country hub pages ────────────────────────────────────────────────
    // /swims/south-africa is a page Google can rank for "open water swims
    // South Africa". /explore?country=ZA is a query string it treats as one
    // page with parameters, which is why the hubs exist at all.
    // Only listed where there is actually something to see — an empty hub
    // in the index is a thin page that costs more than it earns.
    //
    // The slug list used to be typed here AND again in events-handler.js,
    // so a country could be missing from either and nothing would fail.
    // Both now read api/_countries.js. Driving the loop off what is in the
    // data — rather than off a list of countries someone remembered —
    // means a new country reaches the index on its next crawl.
    const hubCountries = await dbGet(
      'event_venues?select=country_code&country_code=not.is.null&limit=2000'
    ) || [];
    const present = [...new Set(hubCountries.map((v) => v.country_code))];
    for (const code of present) {
      const country = countryByCode(code);
      if (country) urls.push(url(`${BASE}/swims/${country.slug}`, '0.85', 'daily', TODAY()));
    }

    // ── Bookable route pages ─────────────────────────────────────────────
    // These have no date and change rarely, but they are the pages a
    // traveller searches for ("swim Robben Island"), so they earn a high
    // priority and a slow changefreq.
    const routes = await dbGet(
      'swim_routes?is_public=eq.true&select=slug,updated_at&order=slug.asc'
    ) || [];
    for (const r of routes) {
      if (!r.slug) continue;
      urls.push(url(`${BASE}/swims/${r.slug}`, '0.8', 'monthly',
        (r.updated_at || '').slice(0, 10) || TODAY()));
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');
    res.status(200).send(xml);

  } catch (err) {
    console.error('[sitemap-dynamic]', err);
    res.status(500).send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>');
  }
}

// Days from today as YYYY-MM-DD. Used to decide how often a listing is
// worth re-crawling: an event three months out still moves.
function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function url(loc, priority, changefreq, lastmod) {
  return [
    '  <url>',
    `    <loc>${loc}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : '',
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ].filter(Boolean).join('\n');
}

// Paginated fetch — PostgREST caps at 1000 rows per request. We chunk via Range headers.
async function fetchAllSwims() {
  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
  const ANON_KEY = process.env.SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';

  const all = [];
  const pageSize = 1000;
  for (let start = 0; start < 10000; start += pageSize) {
    const end = start + pageSize - 1;
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/channel_solo_swims?slug=not.is.null&select=slug,year&order=year.desc`,
        {
          headers: {
            apikey: ANON_KEY,
            Authorization: `Bearer ${ANON_KEY}`,
            Accept: 'application/json',
            Range: `${start}-${end}`,
            'Range-Unit': 'items',
          },
        }
      );
      if (!res.ok) break;
      const chunk = await res.json();
      if (!chunk?.length) break;
      all.push(...chunk);
      if (chunk.length < pageSize) break;
    } catch {
      break;
    }
  }
  return all;
}