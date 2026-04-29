// SSR handler for all /spots/* routes.
// Routes /spots/[region-slug] → regional page, /spots/[spot-slug] → individual spot page.

import {
  dbGet, dbRpc,
  generateSlug,
  REGION_DOMAINS, REGION_NAMES, REGION_INTROS,
  getLocationLabel, getRegionSlug,
  haversineKm, timeAgo, escapeHtml, formatDate,
} from './seo-utils.js';
import { getSpotSponsorHtml, getRegionSponsorHtml } from './sponsors.js';

const REGION_SLUGS = new Set(Object.keys(REGION_DOMAINS));

export default async function handler(req, res) {
  const path = (req.url || '').split('?')[0];
  const parts = path.split('/').filter(Boolean);
  const slug = parts[1] || '';

  if (!slug) {
    res.writeHead(301, { Location: '/spots/cape-town' });
    return res.end();
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  try {
    if (REGION_SLUGS.has(slug)) {
      const html = await renderRegionalPage(slug);
      return res.status(200).send(html);
    }
    const html = await renderSpotPage(slug);
    if (!html) return res.status(404).send(render404(slug));
    return res.status(200).send(html);
  } catch (err) {
    console.error('[spots-handler]', err);
    return res.status(500).send(renderError());
  }
}

// ─── SPOT PAGE ────────────────────────────────────────────────────────────────

async function renderSpotPage(slug) {
  const allSpots = await dbGet(
    'spots?active=eq.true&select=id,name,domain,area,water_type,latitude,longitude,brand,code&order=name.asc'
  );
  if (!allSpots) return null;

  const spot = allSpots.find(s => generateSlug(s.name) === slug);
  if (!spot) return null;

  const locationLabel = getLocationLabel(spot.domain, spot.area);
  const regionSlug = getRegionSlug(spot.domain);
  const regionName = REGION_NAMES[regionSlug] || locationLabel;
  spot._locationLabel = locationLabel;

  // Latest temp from the view
  const latestArr = await dbGet(
    `latest_spot_temps?spot_id=eq.${spot.id}&select=temp_c,updated_at&limit=1`
  );
  const latestData = latestArr?.[0] || null;

  // Recent logs — last 7 days
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentLogs = await dbGet(
    `temp_logs?spot_id=eq.${spot.id}&created_at=gte.${encodeURIComponent(since7)}&select=temp_c,conditions,notes,created_at,user_id&order=created_at.desc&limit=10`
  ) || [];

  // Batch-fetch display names for those logs
  const userIds = [...new Set(recentLogs.map(l => l.user_id).filter(Boolean))];
  const profileMap = {};
  if (userIds.length > 0) {
    const profiles = await dbGet(
      `profiles?id=in.(${userIds.join(',')})&select=id,display_name`
    );
    (profiles || []).forEach(p => { profileMap[p.id] = p.display_name; });
  }
  recentLogs.forEach(l => { l._displayName = profileMap[l.user_id] || null; });

  // Seasonal stats via RPC
  const seasonal = await dbRpc('seo_spot_seasonal_avg', { p_spot_id: spot.id });
  const stats = seasonal?.[0] || null;

  // Nearby spots within 50 km
  let nearbySpots = [];
  if (spot.latitude && spot.longitude) {
    nearbySpots = allSpots
      .filter(s => s.id !== spot.id && s.latitude && s.longitude)
      .map(s => ({ ...s, dist: haversineKm(spot.latitude, spot.longitude, s.latitude, s.longitude) }))
      .filter(s => s.dist <= 50)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3);
  }

  const isPool = spot.water_type === 'POOL';
  const titleType = isPool ? 'Pool Temperature' : 'Water Temperature';
  const title = `${spot.name} ${titleType} Today | SwimLoading`;

  const descMap = {
    OCEAN:  `Live ocean temperature at ${spot.name}, ${locationLabel}. Community-logged by open water swimmers on SwimLoading. Check conditions before you dive in.`,
    LAGOON: `Current water temperature at ${spot.name}, ${locationLabel}. Community-logged by swimmers on SwimLoading.`,
    POOL:   `Current pool temperature at ${spot.name}, ${locationLabel}. Logged by the SwimLoading swimming community. Check before your session.`,
    DAM:    `Current water temperature at ${spot.name}, ${locationLabel}. Community-logged by swimmers on SwimLoading.`,
  };
  const description = descMap[spot.water_type] || descMap.OCEAN;

  const jsonLdDataset = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: `${spot.name} Water Temperature Data`,
    description: `Community-logged water temperatures at ${spot.name}, ${locationLabel}, South Africa. Updated daily by open water swimmers on SwimLoading.`,
    url: `https://www.swimloading.com/spots/${slug}`,
    creator: { '@type': 'Organization', name: 'SwimLoading', url: 'https://www.swimloading.com' },
    spatialCoverage: { '@type': 'Place', name: `${spot.name}, ${locationLabel}, South Africa` },
    measurementTechnique: 'Community logging by open water swimmers',
    variableMeasured: 'Water temperature in degrees Celsius',
    temporalCoverage: '2024/..',
  };

  const jsonLdBreadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'SwimLoading', item: 'https://www.swimloading.com' },
      { '@type': 'ListItem', position: 2, name: regionName, item: `https://www.swimloading.com/spots/${regionSlug}` },
      { '@type': 'ListItem', position: 3, name: spot.name, item: `https://www.swimloading.com/spots/${slug}` },
    ],
  };

  const body = `
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <div class="container">
        <a href="/">SwimLoading</a> ›
        <a href="/spots/${regionSlug}">${escapeHtml(regionName)}</a> ›
        ${escapeHtml(spot.name)}
      </div>
    </nav>

    <main class="container page-body">
      <h1>${escapeHtml(spot.name)} ${titleType}</h1>

      ${renderCurrentConditions(latestData, recentLogs)}

      <section>
        <h2>Recent Logs <small>(last 7 days)</small></h2>
        ${renderRecentLogsTable(recentLogs)}
      </section>

      ${renderSeasonalAvg(stats)}

      <section class="cta-box">
        <p>Swimming at <strong>${escapeHtml(spot.name)}</strong> today? Log the temperature and help the community.</p>
        <a href="/app" class="btn-cta">Open SwimLoading App →</a>
      </section>

      <section class="seo-copy">
        ${renderSeoCopy(spot, locationLabel, stats)}
        ${getSpotSponsorHtml(spot)}
      </section>

      ${renderNearbySpots(nearbySpots)}
    </main>
  `;

  return pageShell({ title, description, canonical: `https://www.swimloading.com/spots/${slug}`, jsonLd: [jsonLdDataset, jsonLdBreadcrumb], body });
}

function renderCurrentConditions(latestData, recentLogs) {
  const latest = recentLogs[0] || null;
  if (!latestData?.temp_c) {
    return `
      <section class="card" style="margin-bottom:24px">
        <p class="no-logs">No recent logs — be the first to log this spot today.</p>
        <a href="/app" class="btn-cta" style="margin-top:12px;display:inline-block">Log Temperature →</a>
      </section>`;
  }
  const cond = latest?.conditions
    ? `<div class="conditions-label">${escapeHtml(capitalise(latest.conditions))}</div>` : '';
  const who = latest?._displayName || 'SwimLoading member';
  const when = latest?.created_at ? ` · ${timeAgo(latest.created_at)}` : '';
  const notes = latest?.notes
    ? `<div class="notes">"${escapeHtml(latest.notes)}"</div>` : '';
  return `
    <section class="card" style="margin-bottom:24px">
      <div class="temp-big">${latestData.temp_c}°C</div>
      ${cond}
      <div class="logged-by">Logged by ${escapeHtml(who)}${escapeHtml(when)}</div>
      ${notes}
    </section>`;
}

function renderRecentLogsTable(logs) {
  if (!logs.length) return `<p class="no-logs">No logs in the last 7 days.</p>`;
  const rows = logs.map(l => `
    <tr>
      <td>${l.created_at ? formatDate(l.created_at) : '—'}</td>
      <td><strong>${l.temp_c != null ? l.temp_c + '°C' : '—'}</strong></td>
      <td>${l.conditions ? escapeHtml(capitalise(l.conditions)) : '—'}</td>
      <td>${l._displayName ? escapeHtml(l._displayName) : 'Member'}</td>
    </tr>`).join('');
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Temp</th><th>Conditions</th><th>Logged by</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderSeasonalAvg(stats) {
  if (!stats || stats.total_logs < 5) return '';
  return `
    <section>
      <h2>Historical Data</h2>
      <p>Community average: <strong>${stats.avg_temp}°C</strong> across ${stats.total_logs} logs since SwimLoading launched.
         Range: ${stats.min_temp}°C – ${stats.max_temp}°C.</p>
    </section>`;
}

function renderSeoCopy(spot, locationLabel, stats) {
  const hasRange = stats && stats.total_logs >= 5;
  const range = hasRange
    ? `Temperatures typically range between ${stats.min_temp}°C and ${stats.max_temp}°C based on community data.`
    : 'Water temperatures vary seasonally.';
  const loc = escapeHtml(locationLabel);
  const name = escapeHtml(spot.name);

  if (spot.water_type === 'POOL') {
    return `
      <p>${name} is a swimming pool in ${loc}, South Africa. Pool temperatures are logged by SwimLoading members so you always know the water temperature before you arrive.</p>
      <p>During South Africa's winter months, many open water swimmers transition to heated pools for training. SwimLoading tracks pool temperatures across South Africa alongside ocean and lagoon spots so swimmers can plan year-round.</p>`;
  }
  if (spot.water_type === 'LAGOON') {
    return `
      <p>${name} is a popular swimming lagoon in ${loc}, South Africa. Lagoon water temperatures are typically warmer than the nearby ocean and are logged by the SwimLoading community. ${range}</p>
      <p>SwimLoading is a free peer-to-peer ocean intelligence platform built by open water swimmers. Swimmers log water temperatures, conditions, and hazards so the whole community swims smarter.</p>`;
  }
  if (spot.water_type === 'DAM') {
    return `
      <p>${name} is a dam swimming spot in ${loc}, South Africa. Water temperatures are logged by the SwimLoading community so swimmers can track conditions throughout the year. ${range}</p>
      <p>SwimLoading is a free peer-to-peer platform built by open water swimmers. Log water temperatures, conditions, and hazards so the whole community swims smarter.</p>`;
  }
  // OCEAN (default)
  return `
    <p>${name} is an open water swimming spot on ${loc}, South Africa. Water temperatures are logged daily by the SwimLoading community of open water swimmers. ${range}</p>
    <p>SwimLoading is a free peer-to-peer ocean intelligence platform built by open water swimmers. Swimmers log water temperatures, conditions, and hazards so the whole community swims smarter. Check current conditions at ${name} before every swim.</p>`;
}

function renderNearbySpots(nearby) {
  if (nearby.length < 2) return '';
  const links = nearby.map(s => `<a href="/spots/${generateSlug(s.name)}">${escapeHtml(s.name)}</a>`).join(' · ');
  return `<section class="nearby"><p>Nearby spots: ${links}</p></section>`;
}

// ─── REGIONAL PAGE ────────────────────────────────────────────────────────────

async function renderRegionalPage(regionSlug) {
  const regionName = REGION_NAMES[regionSlug];
  const domains = REGION_DOMAINS[regionSlug];

  const spots = await dbRpc('seo_regional_spots', { p_domains: domains }) || [];
  const poolSpots = spots.filter(s => s.water_type === 'POOL');
  const showWinter = ['cape-town', 'eastern-cape', 'garden-route'].includes(regionSlug) && poolSpots.length > 0;
  const allPools = spots.length > 0 && spots.every(s => s.water_type === 'POOL');

  const title = allPools
    ? `Swimming Pool Temperatures in ${regionName} | SwimLoading`
    : `Open Water Swimming Spots in ${regionName} | SwimLoading`;
  const description = `Water temperatures and swimming conditions across ${regionName}, South Africa. Community-logged daily by open water swimmers on SwimLoading. Free to use.`;

  const jsonLdItemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Open Water Swimming Spots in ${regionName}`,
    description: `Community-logged water temperature spots in ${regionName}, South Africa`,
    url: `https://www.swimloading.com/spots/${regionSlug}`,
    itemListElement: spots.map((s, i) => ({
      '@type': 'ListItem', position: i + 1,
      url: `https://www.swimloading.com/spots/${generateSlug(s.name)}`,
      name: s.name,
    })),
  };

  const intro = REGION_INTROS[regionSlug] || '';
  const sponsorHtml = getRegionSponsorHtml(regionSlug);

  const body = `
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <div class="container">
        <a href="/">SwimLoading</a> › ${escapeHtml(regionName)}
      </div>
    </nav>

    <main class="container page-body">
      <h1>Swimming in ${escapeHtml(regionName)}</h1>
      ${intro ? `<p class="intro-text">${escapeHtml(intro)}</p>` : ''}

      <section>
        <h2>Swimming Spots in ${escapeHtml(regionName)}</h2>
        ${renderRegionalSpotsTable(spots)}
      </section>

      ${showWinter ? renderWinterSection(poolSpots, regionName) : ''}

      <section class="cta-box">
        <p>Logging temperatures in ${escapeHtml(regionName)}? Add your reading and help the community.</p>
        <a href="/app" class="btn-cta">Log a Temperature in ${escapeHtml(regionName)} →</a>
      </section>

      ${sponsorHtml ? `<section class="sponsor-section">${sponsorHtml}</section>` : ''}
    </main>
  `;

  return pageShell({ title, description, canonical: `https://www.swimloading.com/spots/${regionSlug}`, jsonLd: [jsonLdItemList], body });
}

function renderRegionalSpotsTable(spots) {
  if (!spots.length) return `<p class="no-logs">No spots found for this region yet.</p>`;
  const TYPE_LABEL = { OCEAN: 'Ocean', LAGOON: 'Lagoon', POOL: 'Pool', DAM: 'Dam' };
  const rows = spots.map(s => {
    const slug = generateSlug(s.name);
    return `
      <tr>
        <td><a href="/spots/${slug}">${escapeHtml(s.name)}</a></td>
        <td>${TYPE_LABEL[s.water_type] || s.water_type}</td>
        <td>${s.avg_temp != null ? s.avg_temp + '°C' : '—'}</td>
        <td>${s.last_logged ? formatDate(s.last_logged) : 'Never'}</td>
      </tr>`;
  }).join('');
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Spot</th><th>Type</th><th>Avg Temp</th><th>Last Logged</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderWinterSection(poolSpots, regionName) {
  const links = poolSpots.map(s => `<a href="/spots/${generateSlug(s.name)}">${escapeHtml(s.name)}</a>`).join(', ');
  return `
    <section>
      <h2>Heated pools near ${escapeHtml(regionName)} this winter</h2>
      <p>As ocean temperatures drop through May to August, many ${escapeHtml(regionName)} swimmers move to heated pools.
         SwimLoading tracks pool temperatures alongside ocean spots so you can plan year-round.</p>
      <p style="margin-top:12px">${links}</p>
    </section>`;
}

// ─── SHARED HTML SHELL ────────────────────────────────────────────────────────

function pageShell({ title, description, canonical, jsonLd, body }) {
  const ldTags = jsonLd.map(d => `<script type="application/ld+json">${JSON.stringify(d)}</script>`).join('\n  ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
  ${ldTags}
  <style>${INLINE_CSS}</style>
</head>
<body>
  <header>
    <div class="container header-inner">
      <a href="/" class="logo">Swim<span>Loading</span></a>
      <a href="/app" class="btn-app">Get the App</a>
    </div>
  </header>
  ${body}
  <footer class="seo-footer">
    <div class="container">
      ${FOOTER_HTML}
    </div>
  </footer>
</body>
</html>`;
}

const INLINE_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --ocean:#0284c7;--ocean-lt:#38bdf8;--ocean-dk:#0c4a6e;
  --bg:#0a1628;--card:#1e293b;--card2:rgba(30,41,59,0.7);
  --text:#f1f5f9;--muted:#94a3b8;--subtle:#475569;
  --border:rgba(56,189,248,0.15);--border2:rgba(56,189,248,0.25);
  --r:14px
}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.5;font-size:16px;-webkit-font-smoothing:antialiased}
a{color:var(--ocean-lt);text-decoration:none}a:hover{text-decoration:underline}
.container{max-width:760px;margin:0 auto;padding:0 20px}
header{background:rgba(10,22,40,0.95);border-bottom:1px solid var(--border);padding:13px 0;position:sticky;top:0;z-index:100;backdrop-filter:blur(12px)}
.header-inner{display:flex;align-items:center;justify-content:space-between}
.logo{font-weight:800;font-size:18px;color:var(--text)}.logo span{color:var(--ocean-lt)}
.btn-app{background:var(--ocean);color:#fff!important;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none!important}
.btn-app:hover{background:#0369a1}
nav.breadcrumb{font-size:13px;color:var(--subtle);padding:10px 0}
nav.breadcrumb a{color:var(--subtle)}nav.breadcrumb a:hover{color:var(--muted)}
.page-body{padding-top:24px;padding-bottom:60px}
h1{font-size:28px;font-weight:800;margin-bottom:20px;line-height:1.2;color:var(--text)}
h2{font-size:18px;font-weight:700;margin:0 0 14px;color:var(--text)}
h2 small{font-size:13px;font-weight:400;color:var(--muted);margin-left:6px}
p{margin-bottom:12px;color:var(--muted)}
.intro-text{font-size:15px;line-height:1.7;color:var(--muted);margin-bottom:24px}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:22px 24px}
.temp-big{font-size:64px;font-weight:900;color:var(--ocean-lt);line-height:1;text-shadow:0 0 40px rgba(56,189,248,0.35)}
.conditions-label{font-size:14px;color:var(--muted);margin-top:6px;text-transform:capitalize}
.logged-by{font-size:13px;color:var(--subtle);margin-top:10px}
.notes{font-style:italic;font-size:14px;color:var(--subtle);margin-top:8px}
.no-logs{color:var(--muted);font-size:15px;padding:8px 0}
section{margin:28px 0}
.table-wrap{border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;padding:10px 14px;background:rgba(2,132,199,0.12);color:var(--ocean-lt);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}
td{padding:11px 14px;border-bottom:1px solid var(--border);color:var(--text)}
tr:last-child td{border-bottom:none}tr:hover td{background:rgba(56,189,248,0.04)}
.cta-box{background:rgba(2,132,199,0.1);border:1px solid rgba(2,132,199,0.3);border-radius:var(--r);padding:22px 24px}
.cta-box p{color:var(--text);margin-bottom:0}
.cta-box strong{color:var(--text)}
.btn-cta{display:inline-block;margin-top:14px;background:var(--ocean);color:#fff!important;padding:11px 22px;border-radius:8px;font-weight:600;font-size:15px;text-decoration:none!important}
.btn-cta:hover{background:#0369a1}
.seo-copy{font-size:15px;line-height:1.7}.seo-copy p{color:var(--muted);margin-bottom:12px}
.seo-copy strong{color:var(--text)}
.sponsor-note{font-size:13px;color:var(--subtle);line-height:1.6;margin-top:10px}
.sponsor-section{border-top:1px solid var(--border);padding-top:20px;margin-top:8px}
.nearby{margin-top:20px;font-size:14px;color:var(--subtle)}.nearby a{color:var(--muted);margin-right:10px}
.nearby a:hover{color:var(--ocean-lt)}
.seo-footer{background:rgba(10,22,40,0.8);border-top:1px solid var(--border);margin-top:60px;padding:32px 0}
.f-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--subtle);margin-bottom:10px}
.f-links{margin-bottom:22px}.f-links a{font-size:14px;color:var(--subtle);margin-right:14px;display:inline-block;margin-bottom:5px}
.f-links a:hover{color:var(--ocean-lt)}.f-copy{font-size:12px;color:var(--subtle)}
.f-copy a{color:var(--subtle)}.f-copy a:hover{color:var(--ocean-lt)}
@media(max-width:600px){h1{font-size:22px}.temp-big{font-size:48px}td,th{padding:9px 12px}.card{padding:18px 16px}}
`.trim();

const FOOTER_HTML = `
<div class="f-label">Explore by region</div>
<div class="f-links">
  <a href="/spots/cape-town">Cape Town</a>
  <a href="/spots/kwazulu-natal">KwaZulu-Natal</a>
  <a href="/spots/garden-route">Garden Route</a>
  <a href="/spots/eastern-cape">Eastern Cape</a>
  <a href="/spots/south-coast">South Coast</a>
  <a href="/spots/inland">Inland &amp; Pools</a>
  <a href="/spots/namibia">Namibia</a>
</div>
<div class="f-label">Popular spots</div>
<div class="f-links">
  <a href="/spots/big-bay">Big Bay</a>
  <a href="/spots/clifton-4th-beach">Clifton 4th Beach</a>
  <a href="/spots/robben-island">Robben Island</a>
  <a href="/spots/simons-town">Simons Town</a>
  <a href="/spots/duc">DUC</a>
  <a href="/spots/gordons-bay">Gordons Bay</a>
  <a href="/spots/simons-town-long-beach">Simon's Town Long Beach</a>
  <a href="/spots/glencairn">Glencairn</a>
</div>
<div class="f-copy">
  <a href="/">SwimLoading</a> — Community water temperature tracking across South Africa.
  <a href="/app">Open the app</a>
</div>
`.trim();

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function capitalise(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function render404(slug) {
  return pageShell({
    title: 'Spot Not Found | SwimLoading',
    description: 'This swimming spot could not be found on SwimLoading.',
    canonical: `https://www.swimloading.com/spots/${slug}`,
    jsonLd: [],
    body: `
      <main class="container page-body" style="text-align:center">
        <h1 style="margin-top:40px">Spot not found</h1>
        <p style="color:var(--muted)">We couldn't find a swimming spot matching this URL.</p>
        <a href="/spots/cape-town" class="btn-cta" style="margin-top:16px">Browse Cape Town spots</a>
      </main>`,
  });
}

function renderError() {
  return `<!DOCTYPE html><html><head><title>Error | SwimLoading</title></head><body style="font-family:sans-serif;padding:40px;text-align:center"><p>Something went wrong. <a href="/">Return home</a></p></body></html>`;
}
