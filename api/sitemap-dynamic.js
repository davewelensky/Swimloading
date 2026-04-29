// Serves /sitemap.xml dynamically from the live database.
// New spots are automatically included — no manual updates required.

import { dbGet, generateSlug } from './seo-utils.js';

const BASE = 'https://www.swimloading.com';
const REGION_SLUGS = ['cape-town', 'kwazulu-natal', 'eastern-cape', 'garden-route', 'south-coast', 'inland', 'namibia'];
const TODAY = () => new Date().toISOString().slice(0, 10);

export default async function handler(req, res) {
  try {
    const spots = await dbGet(
      'spots?active=eq.true&select=name,domain&order=name.asc'
    ) || [];

    const urls = [];

    // Homepage
    urls.push(url(BASE + '/', '1.0', 'daily', TODAY()));

    // Individual spot pages
    for (const spot of spots) {
      urls.push(url(`${BASE}/spots/${generateSlug(spot.name)}`, '0.9', 'daily', TODAY()));
    }

    // Regional pages
    for (const region of REGION_SLUGS) {
      urls.push(url(`${BASE}/spots/${region}`, '0.8', 'weekly', TODAY()));
    }

    // Blog
    urls.push(url(`${BASE}/blog/march-challenge`, '0.7', 'weekly'));

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
