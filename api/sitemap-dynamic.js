// Serves /sitemap.xml dynamically from the live database.
// New spots are automatically included — no manual updates required.

import { dbGet, generateSlug, REGION_DOMAINS } from './seo-utils.js';
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
  { path: '/robben',              priority: '0.8', changefreq: 'weekly'  },
  { path: '/ri',                  priority: '0.8', changefreq: 'weekly'  },
  { path: '/campaign',            priority: '0.7', changefreq: 'weekly'  },
  { path: '/preekstool',          priority: '0.7', changefreq: 'weekly'  },
  { path: '/capepoint',           priority: '0.7', changefreq: 'weekly'  },
  { path: '/dassen',              priority: '0.7', changefreq: 'weekly'  },
  { path: '/westangle',           priority: '0.7', changefreq: 'weekly'  },
  { path: '/intel',               priority: '0.7', changefreq: 'weekly'  },
  { path: '/crossings/english-channel', priority: '0.9', changefreq: 'daily' },
  { path: '/pricing',             priority: '0.6', changefreq: 'monthly' },
  { path: '/pro',                 priority: '0.6', changefreq: 'monthly' },
  { path: '/partners/maurten',    priority: '0.7', changefreq: 'monthly' },
  { path: '/partners/sis',        priority: '0.7', changefreq: 'monthly' },
  { path: '/partners/blu-smooth', priority: '0.7', changefreq: 'monthly' },
  { path: '/partners/magic5',     priority: '0.7', changefreq: 'monthly' },
  { path: '/blog/march-challenge',priority: '0.6', changefreq: 'monthly' },
];

export default async function handler(req, res) {
  try {
    const spots = await dbGet(
      'spots?active=eq.true&select=name,domain&order=name.asc'
    ) || [];

    const urls = [];

    // Static pages
    for (const page of STATIC_PAGES) {
      urls.push(url(`${BASE}${page.path}`, page.priority, page.changefreq, TODAY()));
    }

    // Individual spot pages — slug derived from spot name
    for (const spot of spots) {
      urls.push(url(`${BASE}/spots/${generateSlug(spot.name)}`, '0.9', 'daily', TODAY()));
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
    const events = await dbGet(
      'event_editions?is_indexable=eq.true&status=in.(announced,entries_open,entries_closed)' +
      `&start_date=gte.${TODAY()}&select=slug,start_date,last_verified_at&order=start_date.asc&limit=2000`
    ) || [];
    for (const ev of events) {
      if (!ev.slug) continue;
      // Soon = worth re-crawling often, because entry status and dates move.
      const soon = ev.start_date && ev.start_date <= addDays(90);
      urls.push(url(
        `${BASE}/events/${ev.slug}`,
        soon ? '0.8' : '0.6',
        soon ? 'daily' : 'weekly',
        (ev.last_verified_at || '').slice(0, 10) || TODAY()
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