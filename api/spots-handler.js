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
    res.writeHead(301, { Location: '/spots/atlantic' });
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

    ${renderSpotHero(spot, latestData, recentLogs)}

    <main class="container page-body">
      <section>
        <h2>Recent Logs <small>(last 7 days)</small></h2>
        ${renderRecentLogsTable(recentLogs)}
      </section>

      ${renderStatCards(stats)}
      ${renderMapEmbed(spot)}

      <section class="seo-copy">
        ${renderSeoCopy(spot, locationLabel, stats)}
        ${getSpotSponsorHtml(spot)}
      </section>

      ${renderNearbySpots(nearbySpots)}
      ${renderAppTeaser(spot)}
    </main>
  `;

  return pageShell({ title, description, canonical: `https://www.swimloading.com/spots/${slug}`, jsonLd: [jsonLdDataset, jsonLdBreadcrumb], body });
}

function renderSpotHero(spot, latestData, recentLogs) {
  const latest = recentLogs[0] || null;
  const hasTemp = latestData?.temp_c != null;
  const cond = latest?.conditions ? escapeHtml(capitalise(latest.conditions)) : '';
  const who = latest?._displayName || 'SwimLoading member';
  const when = latest?.created_at ? timeAgo(latest.created_at) : '';
  const notes = latest?.notes ? `<div class="hero-notes">"${escapeHtml(latest.notes)}"</div>` : '';

  const tempBlock = hasTemp ? `
    <div class="hero-temp">${latestData.temp_c}°C</div>
    ${cond ? `<div class="hero-cond">${cond}</div>` : ''}
    <div class="hero-meta">Logged by ${escapeHtml(who)}${when ? ` · ${escapeHtml(when)}` : ''}</div>
    ${notes}
  ` : `
    <div class="hero-no-data">No recent logs — be the first to log this spot today.</div>
  `;

  return `
  <div class="spot-hero">
    <div class="container spot-hero-inner">
      <div class="spot-hero-text">
        <div class="live-badge">
          <span class="live-dot"></span> Live conditions
        </div>
        <h1>${escapeHtml(spot.name)} Water Temperature</h1>
        ${tempBlock}
        <a href="/app" class="btn-hero">Open SwimLoading Free →</a>
      </div>
      <div class="spot-hero-phone">
        <div class="phone-frame">
          <img src="/screenshots/temps.jpg" alt="SwimLoading water temperature tracking app" loading="lazy">
        </div>
      </div>
    </div>
  </div>`;
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

function renderStatCards(stats) {
  if (!stats || stats.total_logs < 5) return '';
  return `
    <section>
      <h2>All-time community data</h2>
      <div class="stat-cards">
        <div class="stat-card">
          <div class="stat-val">${stats.min_temp}°C</div>
          <div class="stat-label">Coldest recorded</div>
        </div>
        <div class="stat-card stat-card-avg">
          <div class="stat-val">${stats.avg_temp}°C</div>
          <div class="stat-label">Community average</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${stats.max_temp}°C</div>
          <div class="stat-label">Warmest recorded</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${stats.total_logs}</div>
          <div class="stat-label">Total logs</div>
        </div>
      </div>
    </section>`;
}

function renderMapEmbed(spot) {
  if (!spot.latitude || !spot.longitude) return '';
  const lat = spot.latitude, lon = spot.longitude;
  const pad = 0.018;
  const bbox = `${lon - pad},${lat - pad},${lon + pad},${lat + pad}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
  return `
    <section>
      <h2>Location</h2>
      <div class="map-wrap">
        <iframe src="${src}" title="${escapeHtml(spot.name)} location map" loading="lazy" referrerpolicy="no-referrer"></iframe>
      </div>
      <p style="font-size:13px;margin-top:8px">
        <a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=14/${lat}/${lon}" rel="noopener noreferrer" target="_blank">Open larger map</a>
      </p>
    </section>`;
}

function renderAppTeaser(spot) {
  return `
  <div class="app-teaser">
    <div class="app-teaser-phones">
      <div class="phone-frame"><img src="/screenshots/dashboard.jpg" alt="SwimLoading dashboard" loading="lazy"></div>
      <div class="phone-frame phone-frame-back"><img src="/screenshots/swims.jpg" alt="SwimLoading upcoming swims" loading="lazy"></div>
    </div>
    <div class="app-teaser-text">
      <h2>Track ${escapeHtml(spot.name)} before every swim</h2>
      <p>SwimLoading is free. Open water swimmers log water temperatures, conditions, and hazards so the whole community swims smarter.</p>
      <ul class="teaser-list">
        <li>Real-time temperatures at 90+ spots</li>
        <li>Group swim coordination</li>
        <li>Community leaderboards</li>
        <li>Safety & hazard alerts</li>
      </ul>
      <a href="/app" class="btn-cta" style="margin-top:20px">Start Swimming Free →</a>
    </div>
  </div>`;
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
  const showWinter = ['west-coast', 'atlantic', 'false-bay', 'eastern-cape', 'garden-route'].includes(regionSlug) && poolSpots.length > 0;
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
    <div class="region-hero">
      <div class="container region-hero-inner">
        <div class="region-hero-text">
          <nav class="breadcrumb breadcrumb-inline" aria-label="Breadcrumb">
            <a href="/">SwimLoading</a> › ${escapeHtml(regionName)}
          </nav>
          <h1>Swimming in ${escapeHtml(regionName)}</h1>
          ${intro ? `<p class="intro-text">${escapeHtml(intro)}</p>` : ''}
          <a href="/app" class="btn-hero">Track conditions free →</a>
        </div>
        <div class="region-hero-phones">
          <div class="phone-frame"><img src="/screenshots/temps.jpg" alt="Water temperatures" loading="lazy"></div>
          <div class="phone-frame phone-frame-back"><img src="/screenshots/dashboard.jpg" alt="SwimLoading dashboard" loading="lazy"></div>
        </div>
      </div>
    </div>

    <main class="container page-body">
      <section>
        <h2>Swimming Spots in ${escapeHtml(regionName)}</h2>
        ${renderSpotCards(spots)}
      </section>

      ${showWinter ? renderWinterSection(poolSpots, regionName) : ''}

      <section class="cta-box">
        <p>Logging temperatures in ${escapeHtml(regionName)}? Add your reading and help the community.</p>
        <a href="/app" class="btn-cta">Log a Temperature →</a>
      </section>

      ${sponsorHtml ? `<section class="sponsor-section">${sponsorHtml}</section>` : ''}
    </main>
  `;

  return pageShell({ title, description, canonical: `https://www.swimloading.com/spots/${regionSlug}`, jsonLd: [jsonLdItemList], body });
}

function renderSpotCards(spots) {
  if (!spots.length) return `<p class="no-logs">No spots found for this region yet.</p>`;
  const TYPE_LABEL = { OCEAN: 'Ocean', LAGOON: 'Lagoon', POOL: 'Pool', DAM: 'Dam' };
  const TYPE_COLOR = { OCEAN: '#38bdf8', LAGOON: '#34d399', POOL: '#a78bfa', DAM: '#fb923c' };
  const cards = spots.map(s => {
    const slug = generateSlug(s.name);
    const typeLabel = TYPE_LABEL[s.water_type] || s.water_type;
    const typeColor = TYPE_COLOR[s.water_type] || '#94a3b8';
    const lastLogged = s.last_logged ? timeAgo(s.last_logged) : null;
    return `
      <a href="/spots/${slug}" class="spot-card">
        <div class="spot-card-top">
          <span class="spot-card-name">${escapeHtml(s.name)}</span>
          <span class="spot-card-type" style="color:${typeColor}">${typeLabel}</span>
        </div>
        ${s.avg_temp != null ? `<div class="spot-card-temp">${s.avg_temp}°C <span>avg</span></div>` : `<div class="spot-card-temp spot-card-temp-none">No data yet</div>`}
        ${lastLogged ? `<div class="spot-card-meta">Last logged ${escapeHtml(lastLogged)}</div>` : `<div class="spot-card-meta">Never logged</div>`}
      </a>`;
  }).join('');
  return `<div class="spot-cards">${cards}</div>`;
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
      <a href="/" class="logo">
        <div class="logo-icon"><img src="/icons/logo-wave.png" alt="SwimLoading"></div>
        <span class="logo-text">SwimLoading</span>
      </a>
      <a href="/app" class="btn-app">Get the App</a>
    </div>
  </header>
  ${body}
  <footer class="seo-footer">
    <div class="container">
      ${FOOTER_HTML}
    </div>
  </footer>
<script>document.addEventListener('mousemove',e=>{document.body.style.setProperty('--mouse-x',e.clientX+'px');document.body.style.setProperty('--mouse-y',e.clientY+'px')});</script>
</body>
</html>`;
}

const INLINE_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --ocean:#0284c7;--ocean-lt:#38bdf8;--ocean-dk:#0c4a6e;
  --bg:#0a1628;--card:#1e293b;
  --text:#f1f5f9;--muted:#94a3b8;--subtle:#475569;
  --border:rgba(56,189,248,0.15);
  --r:14px
}
@keyframes pulse-dot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.4)}}
@keyframes fade-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.5;font-size:16px;-webkit-font-smoothing:antialiased}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:9999;background:radial-gradient(18px circle at var(--mouse-x,-999px) var(--mouse-y,-999px),rgba(56,189,248,0.55),transparent 100%),radial-gradient(500px circle at var(--mouse-x,-999px) var(--mouse-y,-999px),rgba(56,189,248,0.07),transparent 70%)}
a{color:var(--ocean-lt);text-decoration:none}a:hover{text-decoration:underline}
.container{max-width:820px;margin:0 auto;padding:0 20px}
/* ── Header ── */
header{background:rgba(10,22,40,0.95);border-bottom:1px solid var(--border);padding:13px 0;position:sticky;top:0;z-index:100;backdrop-filter:blur(12px)}
.header-inner{display:flex;align-items:center;justify-content:space-between}
.logo{display:flex;align-items:center;gap:10px;text-decoration:none}
.logo-icon{width:42px;height:42px;border-radius:12px;overflow:hidden;flex-shrink:0}
.logo-icon img{width:100%;height:100%;object-fit:contain}
.logo-text{font-size:20px;font-weight:800;background:linear-gradient(135deg,var(--ocean-lt),var(--ocean-lt));-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-0.5px}
.btn-app{background:var(--ocean);color:#fff!important;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none!important}
.btn-app:hover{background:#0369a1}
/* ── Breadcrumb ── */
nav.breadcrumb{font-size:13px;color:var(--subtle);padding:10px 0}
nav.breadcrumb a{color:var(--subtle)}nav.breadcrumb a:hover{color:var(--muted)}
.breadcrumb-inline{padding:0;font-size:13px;color:var(--subtle);margin-bottom:14px;display:block}
.breadcrumb-inline a{color:var(--subtle)}
/* ── Spot hero ── */
.spot-hero{background:linear-gradient(135deg,#0d1f38 0%,#0a1628 60%,rgba(2,132,199,0.08) 100%);border-bottom:1px solid var(--border);padding:48px 0 40px;overflow:hidden}
.spot-hero-inner{display:flex;align-items:center;gap:40px}
.spot-hero-text{flex:1;min-width:0;animation:fade-up .6s ease-out}
.live-badge{display:inline-flex;align-items:center;gap:8px;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.25);border-radius:100px;padding:6px 16px;font-size:12px;font-weight:600;color:var(--ocean-lt);margin-bottom:16px}
.live-dot{width:7px;height:7px;background:var(--ocean-lt);border-radius:50%;animation:pulse-dot 2s ease-in-out infinite;flex-shrink:0}
.spot-hero-text h1{font-size:32px;font-weight:800;line-height:1.15;margin-bottom:20px;color:var(--text)}
.hero-temp{font-size:72px;font-weight:900;color:var(--ocean-lt);line-height:1;text-shadow:0 0 50px rgba(56,189,248,0.4);margin-bottom:8px}
.hero-cond{font-size:15px;color:var(--muted);text-transform:capitalize;margin-bottom:6px}
.hero-meta{font-size:13px;color:var(--subtle);margin-bottom:10px}
.hero-notes{font-style:italic;font-size:14px;color:var(--subtle);margin-bottom:16px}
.hero-no-data{font-size:15px;color:var(--subtle);margin-bottom:20px;padding:14px 0}
.btn-hero{display:inline-block;background:var(--ocean-lt);color:#0a1628!important;padding:12px 24px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none!important;margin-top:16px;transition:opacity .2s}
.btn-hero:hover{opacity:.88;text-decoration:none!important}
.spot-hero-phone{flex-shrink:0;width:200px;animation:fade-up .8s ease-out .1s both}
/* ── Region hero ── */
.region-hero{background:linear-gradient(135deg,#0d1f38 0%,#0a1628 60%,rgba(2,132,199,0.08) 100%);border-bottom:1px solid var(--border);padding:48px 0 40px;overflow:hidden}
.region-hero-inner{display:flex;align-items:center;gap:40px}
.region-hero-text{flex:1;min-width:0}
.region-hero-text h1{font-size:32px;font-weight:800;line-height:1.15;margin-bottom:14px;color:var(--text)}
.region-hero-phones{flex-shrink:0;display:flex;gap:14px;align-items:flex-end}
/* ── Phone frame ── */
.phone-frame{width:160px;border-radius:24px;overflow:hidden;border:2px solid rgba(56,189,248,0.2);box-shadow:0 20px 60px rgba(0,0,0,0.5),0 0 0 1px rgba(56,189,248,0.08);flex-shrink:0}
.phone-frame img{width:100%;display:block}
.phone-frame-back{opacity:.65;transform:scale(.9) translateY(12px);transform-origin:bottom center}
/* ── Page body ── */
.page-body{padding-top:32px;padding-bottom:60px}
h2{font-size:18px;font-weight:700;margin:0 0 14px;color:var(--text)}
h2 small{font-size:13px;font-weight:400;color:var(--muted);margin-left:6px}
p{margin-bottom:12px;color:var(--muted)}
.intro-text{font-size:15px;line-height:1.7;color:var(--muted);margin-bottom:24px}
section{margin:32px 0}
.no-logs{color:var(--muted);font-size:15px;padding:8px 0}
/* ── Tables ── */
.table-wrap{border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;padding:10px 14px;background:rgba(2,132,199,0.12);color:var(--ocean-lt);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}
td{padding:11px 14px;border-bottom:1px solid var(--border);color:var(--text)}
tr:last-child td{border-bottom:none}tr:hover td{background:rgba(56,189,248,0.04)}
/* ── Stat cards ── */
.stat-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:18px 16px;text-align:center}
.stat-card-avg{border-color:rgba(56,189,248,0.35);background:rgba(2,132,199,0.08)}
.stat-val{font-size:28px;font-weight:800;color:var(--ocean-lt);line-height:1;margin-bottom:6px}
.stat-label{font-size:12px;color:var(--subtle);font-weight:500}
/* ── Map ── */
.map-wrap{border-radius:var(--r);overflow:hidden;border:1px solid var(--border)}
.map-wrap iframe{width:100%;height:280px;display:block;border:none;filter:hue-rotate(185deg) invert(1) brightness(.85) contrast(.9)}
/* ── Spot cards grid ── */
.spot-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.spot-card{background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:18px 16px;text-decoration:none!important;transition:border-color .2s,transform .15s;display:block}
.spot-card:hover{border-color:rgba(56,189,248,0.4);transform:translateY(-2px)}
.spot-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:10px}
.spot-card-name{font-size:15px;font-weight:700;color:var(--text);line-height:1.3}
.spot-card-type{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;flex-shrink:0}
.spot-card-temp{font-size:26px;font-weight:800;color:var(--ocean-lt);line-height:1;margin-bottom:6px}
.spot-card-temp span{font-size:13px;font-weight:400;color:var(--subtle)}
.spot-card-temp-none{font-size:14px;color:var(--subtle)}
.spot-card-meta{font-size:12px;color:var(--subtle)}
/* ── CTA box ── */
.cta-box{background:rgba(2,132,199,0.1);border:1px solid rgba(2,132,199,0.3);border-radius:var(--r);padding:22px 24px}
.cta-box p{color:var(--text);margin-bottom:0}
.btn-cta{display:inline-block;margin-top:14px;background:var(--ocean);color:#fff!important;padding:11px 22px;border-radius:8px;font-weight:600;font-size:15px;text-decoration:none!important}
.btn-cta:hover{background:#0369a1}
/* ── SEO copy ── */
.seo-copy{font-size:15px;line-height:1.7}.seo-copy p{color:var(--muted);margin-bottom:12px}
.seo-copy strong{color:var(--text)}
.sponsor-note{font-size:13px;color:var(--subtle);line-height:1.6;margin-top:10px}
.sponsor-section{border-top:1px solid var(--border);padding-top:20px;margin-top:8px}
/* ── Nearby ── */
.nearby{margin-top:20px;font-size:14px;color:var(--subtle)}.nearby a{color:var(--muted);margin-right:10px}
.nearby a:hover{color:var(--ocean-lt)}
/* ── App teaser ── */
.app-teaser{display:flex;align-items:center;gap:40px;background:linear-gradient(135deg,rgba(2,132,199,0.1),rgba(10,22,40,0));border:1px solid var(--border);border-radius:20px;padding:36px 32px;margin:40px 0}
.app-teaser-phones{display:flex;gap:12px;align-items:flex-end;flex-shrink:0}
.app-teaser-text h2{font-size:22px;margin-bottom:12px}
.app-teaser-text p{font-size:15px;line-height:1.7;margin-bottom:4px}
.teaser-list{list-style:none;margin:16px 0 0;padding:0}
.teaser-list li{font-size:14px;color:var(--muted);padding:4px 0;padding-left:20px;position:relative}
.teaser-list li::before{content:"✓";position:absolute;left:0;color:var(--ocean-lt);font-weight:700}
/* ── Footer ── */
.seo-footer{background:rgba(10,22,40,0.8);border-top:1px solid var(--border);margin-top:60px;padding:32px 0}
.f-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--subtle);margin-bottom:10px}
.f-links{margin-bottom:22px}.f-links a{font-size:14px;color:var(--subtle);margin-right:14px;display:inline-block;margin-bottom:5px}
.f-links a:hover{color:var(--ocean-lt)}.f-copy{font-size:12px;color:var(--subtle)}
.f-copy a{color:var(--subtle)}.f-copy a:hover{color:var(--ocean-lt)}
/* ── Responsive ── */
@media(max-width:700px){
  .spot-hero-inner,.region-hero-inner{flex-direction:column;gap:28px}
  .spot-hero-phone{width:160px;margin:0 auto}
  .region-hero-phones{display:none}
  .spot-hero-text h1,.region-hero-text h1{font-size:24px}
  .hero-temp{font-size:56px}
  .stat-cards{grid-template-columns:repeat(2,1fr)}
  .spot-cards{grid-template-columns:repeat(2,1fr)}
  .app-teaser{flex-direction:column;padding:24px 20px}
  .app-teaser-phones{display:none}
}
@media(max-width:440px){
  .spot-cards{grid-template-columns:1fr}
  .stat-cards{grid-template-columns:repeat(2,1fr)}
  td,th{padding:9px 10px}
}
`.trim();

const FOOTER_HTML = `
<div class="f-label">Explore by region</div>
<div class="f-links">
  <a href="/spots/west-coast">West Coast</a>
  <a href="/spots/atlantic">Atlantic Seaboard</a>
  <a href="/spots/false-bay">False Bay</a>
  <a href="/spots/kwazulu-natal">KwaZulu-Natal</a>
  <a href="/spots/garden-route">Garden Route</a>
  <a href="/spots/eastern-cape">Eastern Cape</a>
  <a href="/spots/south-coast">South Coast</a>
  <a href="/spots/inland">Inland &amp; Pools</a>
  <a href="/spots/gauteng">Gauteng</a>
  <a href="/spots/free-state">Free State</a>
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
        <a href="/spots/atlantic" class="btn-cta" style="margin-top:16px">Browse Atlantic Seaboard spots</a>
      </main>`,
  });
}

function renderError() {
  return `<!DOCTYPE html><html><head><title>Error | SwimLoading</title></head><body style="font-family:sans-serif;padding:40px;text-align:center"><p>Something went wrong. <a href="/">Return home</a></p></body></html>`;
}
