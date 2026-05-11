// Serves /sitemap.xml dynamically from the live database.
// New spots are automatically included — no manual updates required.

import { dbGet, generateSlug, REGION_DOMAINS } from './seo-utils.js';

const BASE = 'https://www.swimloading.com';
const TODAY = () => new Date().toISOString().slice(0, 10);

const STATIC_PAGES = [
  { path: '/',                    priority: '1.0', changefreq: 'daily'   },
  { path: '/app',                 priority: '0.9', changefreq: 'weekly'  },
  { path: '/robben',              priority: '0.8', changefreq: 'weekly'  },
  { path: '/ri',                  priority: '0.8', changefreq: 'weekly'  },
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

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
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