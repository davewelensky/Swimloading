// SSR handler for all /spots/* routes.
// Routes /spots/[region-slug] → regional page, /spots/[spot-slug] → individual spot page.

import {
  dbGet, dbRpc,
  generateSlug,
  REGION_DOMAINS, REGION_NAMES, REGION_INTROS, REGION_COUNTRY_FILTER,
  COUNTRY_SLUGS,
  getLocationLabel, getRegionSlug,
  haversineKm, timeAgo, escapeHtml, formatDate,
} from './seo-utils.js';
import {
  getTemperatureFreshness, spotTitle, spotMetaDescription, waterTemperatureLabel, formatObservedAt,
  preferredFreshness,
} from './_lib/temperature-freshness.js';
import { getSpotSponsorHtml, getRegionSponsorHtml } from './sponsors.js';
import { VENUE_MAP } from './mywaterlive-config.js';
import { spotAnalyticsScript, SPOT_EVENTS } from './_lib/public-analytics.js';
import {
  exploreUrlForSpot, exploreCtaTextForSpot, nearbyEventsQueryForSpot,
} from './_lib/nearby.js';
import { getSpotConditions } from './_lib/observations/conditions.js';
import { renderConditionsCard } from './_lib/observations/render.js';
import { getStationHistory, renderHistoryChart } from './_lib/observations/history.js';

const REGION_SLUGS = new Set(Object.keys(REGION_DOMAINS));

// How close a measuring instrument must be before its reading may be
// described as this spot's temperature "today".
//
// Chosen against the real link set (2026-08-19): approved stations run
// 0.3–19.3 km out, averaging 5.9 km. 10 km keeps the genuinely local ones —
// La Jolla 1.1 km, Bethany Beach 1.3 km, Capistrano 2.1 km — and excludes
// the offshore ones like Dover's 15.2 km buoy, whose reading is still shown
// and still useful for planning, but is not the water at the beach.
export const NEARBY_MEASUREMENT_TODAY_KM = 10;

export default async function handler(req, res) {
  const path = (req.url || '').split('?')[0];
  const parts = path.split('/').filter(Boolean);

  // /countries/[slug] — render the matching regional page
  if (parts[0] === 'countries') {
    const countrySlug = parts[1] || '';
    const regionSlug = COUNTRY_SLUGS[countrySlug];
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    if (!regionSlug) return res.status(404).send(render404(countrySlug));
    try {
      const html = await renderRegionalPage(regionSlug);
      return res.status(200).send(html);
    } catch (err) {
      console.error('[spots-handler /countries]', err);
      return res.status(500).send(renderError());
    }
  }

  // /spots/[slug] — existing behaviour
  const slug = parts[1] || '';

  if (!slug) {
    res.writeHead(301, { Location: '/spots/atlantic' });
    return res.end();
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  try {
    // Greater London hub — must come before REGION_SLUGS check
  if (slug === 'greater-london') {
    const html = await renderGreaterLondonPage();
    return res.status(200).send(html);
  }
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
    'spots?active=eq.true&select=id,name,domain,area,water_type,latitude,longitude,brand,code,country_code&order=name.asc'
  );
  if (!allSpots) return null;

  const spot = allSpots.find(s => generateSlug(s.name) === slug);
  if (!spot) return null;

  const locationLabel = getLocationLabel(spot.domain, spot.area, spot.country_code);
  const regionSlug = getRegionSlug(spot.domain);
  const regionName = REGION_NAMES[regionSlug] || locationLabel;
  spot._locationLabel = locationLabel;

  // Latest SWIMMER reading — still needed for "logged by X", the recent-logs
  // table and the trend, all of which are about people, not instruments.
  const latestArr = await dbGet(
    `latest_spot_temps?spot_id=eq.${spot.id}&select=temp_c,updated_at&limit=1`
  );
  const latestData = latestArr?.[0] || null;

  // The BLENDED estimate — the same spot_temp_estimate view, and therefore
  // the same number, the app shows for this spot.
  //
  // These two surfaces used to disagree on 37 spots: the app showed
  // Muizenberg at 14.2°C from the model while this page said "no recent
  // logs", because the page only ever looked at swimmer logs. Two of our
  // own screens giving different answers for the same water is worse than
  // either answer alone.
  const estimateArr = await dbGet(
    `spot_temp_estimate?spot_id=eq.${spot.id}&select=best_c,best_source,confidence,swimmer_at,measured_at,measured_station,measured_distance_km,model_at&limit=1`
  ).catch(() => null);
  const estimate = estimateArr?.[0] || null;

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
      .slice(0, 6);
  }

  // Active hazards for this spot (resolved_at must be null; active_until in future or null)
  const hazardsRaw = await dbGet(
    `hazard_reports?spot_id=eq.${spot.id}&resolved_at=is.null&select=hazard_type,severity,title,description,created_at,active_until&order=created_at.desc&limit=5`
  ) || [];
  const now = new Date();
  const hazards = hazardsRaw.filter(h => !h.active_until || new Date(h.active_until) > now);

  // 7-day trend from recent logs
  const trend = computeTrend(recentLogs);

  // Measured water conditions from the spot's approved primary observation
  // station (global observation platform). Most spots have none — the card
  // renders only when a usable measurement exists, and the service is
  // contractually null-on-failure, so this can never cost the page a 200.
  // Sensor venues (my-water.live layout) keep their own live hero instead.
  const observedConditions = VENUE_MAP[slug]
    ? null
    : await getSpotConditions(spot.id).catch(() => null);

  // History for that same station. Only fetched when there is a live card to
  // put it under — a chart of a reading we are not willing to show would be
  // the stale-data problem in a bigger format. Failure-tolerant like the rest.
  const observedHistory = observedConditions && observedConditions.status !== 'STALE'
    && observedConditions.stationId
    ? await getStationHistory(observedConditions.stationId).catch(() => [])
    : [];

  // Upcoming swims a reader could actually enter. Failure-tolerant: a
  // slow or broken events lookup must not cost the visitor the spot page
  // they searched for.
  const eventsQ = nearbyEventsQueryForSpot(spot);
  const nearbyEvents = eventsQ
    ? ((await dbGet(eventsQ).catch(() => [])) || []).slice(0, 4)
    : [];

  const isPool = spot.water_type === 'POOL';

  // ── FRESHNESS, DECIDED ONCE ────────────────────────────────────────────
  // Every claim this page makes about how current its temperature is —
  // title, description, Open Graph, the hero badge, the FAQ and the
  // JSON-LD — is derived from this single verdict.
  //
  // It used to be derived from nothing at all: the title hardcoded the
  // word "Today" and the description hardcoded "Live"/"Current",
  // regardless of the reading. On 2026-08-14 that meant Simons Town
  // advertised "Water Temperature Today" and "Live ocean temperature" over
  // a reading six days old. The helper to prevent exactly this shipped in
  // increment 1 and was never actually called from here.
  //
  // Keyed on the MEASURED reading, not on the modelled estimate. The
  // marine model does produce a value for today, but a model is not an
  // observation of this water, and "Today's temperature" implies someone
  // was in it. Where only a model value exists the page still shows it —
  // labelled as modelled — but it does not earn the word "Today".
  const swimmerFreshness = getTemperatureFreshness(latestData?.updated_at ?? null);

  // A MEASURED reading can also earn the page its freshness — but only when
  // the instrument is close enough that its number describes this water.
  //
  // La Jolla's buoy is 1.1 km out and reads every hour: a page saying it has
  // today's temperature is telling the truth, and saying "Swimming
  // Conditions" (our no-reading wording) while displaying 19.2°C on the same
  // screen is not. Dover's nearest station is 15.2 km offshore — still worth
  // showing for planning, which is why the card renders regardless, but not
  // worth claiming as the temperature at the beach today.
  //
  // So distance, not just recency, decides. NEARBY_MEASUREMENT_TODAY_KM is
  // the whole judgement, in one number, in one place.
  const measuredObservedAt = observedConditions?.temperatureC != null
    ? observedConditions.observedAt : null;
  const measuredKm = observedConditions?.station?.distanceKm;
  const measuredIsLocal = measuredObservedAt != null
    && Number.isFinite(Number(measuredKm))
    && Number(measuredKm) <= NEARBY_MEASUREMENT_TODAY_KM;
  const measuredFreshness = measuredIsLocal
    ? getTemperatureFreshness(measuredObservedAt) : null;

  // Whichever source can honestly claim the most, claims it.
  //
  // Ordering matters and is easy to get subtly wrong: a swimmer log from
  // last week must NOT outrank a buoy 1 km away that read an hour ago.
  // Boscombe is exactly that case, and the first version of this line said
  // "Swimming Conditions" over a perfectly good live measurement. When both
  // can claim today, the swimmer wins — they were actually in the water.
  const freshness = preferredFreshness(swimmerFreshness, measuredFreshness);
  const title = spotTitle(spot.name, freshness, { isPool });
  const description = spotMetaDescription(freshness, {
    spotName: spot.name, locationLabel, waterType: spot.water_type, isPool,
  });

  // FAQPage JSON-LD — must come after `freshness`, which it consumes.
  const jsonLdFaq = buildFaqJsonLd(spot, latestData, hazards, freshness);

  // Country label — only append if it adds info (intl spots need country context)
  const SA_DOMAINS = new Set(['WEST_COAST','ATLANTIC','FALSE_BAY','KZN','EASTERN_CAPE','GARDEN_ROUTE','SOUTH_COAST','INLAND','NON_COASTAL','GAUTENG','FREE_STATE']);
  const countryLabel = SA_DOMAINS.has(spot.domain) ? 'South Africa' : null;
  const fullLocation = countryLabel ? `${locationLabel}, ${countryLabel}` : locationLabel;

  const jsonLdDataset = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: `${spot.name} Water Temperature Data`,
    // "Updated daily" was a claim about our own dataset that most spots do
    // not meet — many go weeks between logs. The Dataset describes what it
    // is, and temporalCoverage below already states its span.
    description: `Community-logged water temperatures at ${spot.name}, ${fullLocation}, recorded by open water swimmers on SwimLoading.`,
    url: `https://www.swimloading.com/spots/${slug}`,
    creator: { '@type': 'Organization', name: 'SwimLoading', url: 'https://www.swimloading.com' },
    spatialCoverage: { '@type': 'Place', name: `${spot.name}, ${fullLocation}` },
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

  // Sensor venues get a completely different hero-page layout
  const venue = VENUE_MAP[slug];
  const body = venue
    ? renderSensorVenueBody(slug, spot, venue, regionSlug, regionName, recentLogs, nearbySpots, hazards, nearbyEvents)
    : `
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <div class="container">
        <a href="/">SwimLoading</a> ›
        <a href="/spots/${regionSlug}">${escapeHtml(regionName)}</a> ›
        ${escapeHtml(spot.name)}
      </div>
    </nav>

    ${renderSpotHero(spot, latestData, recentLogs, trend, false, freshness, estimate)}

    <main class="container page-body">
      ${renderHazards(hazards)}

      ${renderConditionsCard(observedConditions)}
      ${renderHistoryChart(observedHistory)}

      <section>
        <h2>Recent Logs <small>(last 7 days)</small></h2>
        ${renderFreshnessBar(recentLogs, latestData)}
        ${renderTrendSummary(spot, recentLogs, trend)}
        ${renderRecentLogsTable(recentLogs)}
      </section>

      ${renderStatCards(stats)}
      ${renderMapEmbed(spot)}

      <section class="seo-copy">
        ${renderSeoCopy(spot, fullLocation, stats)}
        ${getSpotSponsorHtml(spot)}
      </section>

      ${renderNearbySpots(nearbySpots, regionSlug, regionName)}
      ${renderNearbyEvents(nearbyEvents, spot)}
      ${renderExploreCta(spot)}
      ${renderFaq(spot, locationLabel, latestData, hazards, freshness)}
      ${renderAppTeaser(spot)}
    </main>
  `;

  const analytics = spotAnalyticsScript({
    id: spot.id, slug, name: spot.name, country_code: spot.country_code,
    region: regionSlug, water_type: spot.water_type, freshness_state: freshness.state,
  });

  return pageShell({
    title, description, canonical: `https://www.swimloading.com/spots/${slug}`,
    jsonLd: [jsonLdDataset, jsonLdBreadcrumb, jsonLdFaq], body, ogImage: venue?.ogImage,
    extraScripts: analytics,
  });
}

// ─── SENSOR VENUE HERO PAGE ───────────────────────────────────────────────────
// Used instead of the standard spot page layout for my-water.live venues.

function renderSensorVenueBody(slug, spot, venue, regionSlug, regionName, recentLogs, nearbySpots, hazards, nearbyEvents = []) {
  const factsHtml = venue.facts.map(f =>
    `<div class="svh-fact"><span class="svh-fact-dot"></span><span>${escapeHtml(f)}</span></div>`
  ).join('');

  const steps = [
    'Pre-configured sensor delivered to the venue',
    'Probe submerged — weatherproof enclosure mounted poolside',
    'Sensor transmits readings automatically via its own SIM card — no Wi-Fi needed',
    'Local weather data integrated alongside the water reading',
    'Swimmers get a real-time view of conditions before they leave home',
  ];
  const stepsHtml = steps.map((s, i) =>
    `<div class="svh-step"><span class="svh-step-num">${i + 1}</span><span>${escapeHtml(s)}</span></div>`
  ).join('');

  const recentLogsHtml = recentLogs.length
    ? renderRecentLogsTable(recentLogs)
    : `<p class="svh-no-logs">No community logs yet — be the first to log a swim here and add your reading to the SwimLoading feed.</p>`;

  const nearbyHtml = nearbySpots.length
    ? `<section class="svh-section">${renderNearbySpots(nearbySpots, regionSlug, regionName)}</section>` : '';

  // Client-side temp fetch — key never appears here
  const script = `<script>
(function(){
  var slot = document.getElementById('svh-temp');
  var sub  = document.getElementById('svh-temp-sub');
  if (!slot) return;
  fetch('/api/mywaterlive?slug=${escapeHtml(slug)}')
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){
      if (!d || d.unavailable) {
        slot.textContent = '—';
        if (sub) sub.textContent = 'Sensor data unavailable';
        return;
      }
      slot.textContent = d.temperature != null ? parseFloat(d.temperature).toFixed(1) + '\\u00b0C' : '—';
      if (sub && d.timestamp) {
        try {
          var t = new Date(d.timestamp).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
          sub.textContent = 'Sensor updated ' + t + (d.stale ? ' (cached)' : '');
        } catch(e){}
      }
    })
    .catch(function(){ if (slot) slot.textContent = '—'; });
})();
<\/script>`;

  return `
<nav class="breadcrumb" aria-label="Breadcrumb">
  <div class="container">
    <a href="/">SwimLoading</a> ›
    <a href="/spots/${regionSlug}">${escapeHtml(regionName)}</a> ›
    ${escapeHtml(spot.name)}
  </div>
</nav>

<!-- VENUE HERO -->
<div class="svh-hero">
  <div class="container svh-hero-inner">
    <div class="svh-hero-left">
      <div class="svh-badge"><span class="svh-live-dot"></span>Live water temperature sensor</div>
      <h1 class="svh-venue-name">${escapeHtml(spot.name)}</h1>
      <p class="svh-tagline">Live water temperature for lakes &amp; lidos</p>
      <div class="svh-temp-block">
        <div class="svh-temp" id="svh-temp"><span class="svh-temp-loading">&#8203;</span></div>
        <div class="svh-temp-sub" id="svh-temp-sub">Fetching live reading…</div>
      </div>
      <p class="svh-built">Built for the grit of open water &nbsp;·&nbsp; Engineered and tested at Tooting Bec Lido &nbsp;·&nbsp; Swimmer owned</p>
      <div class="svh-ctas">
        <a href="${escapeHtml(venue.url)}" target="_blank" rel="noopener noreferrer" class="svh-btn-primary">Full conditions at my-water.live &#8594;</a>
        <a href="/app" class="svh-btn-secondary">Log your swim on SwimLoading</a>
      </div>
    </div>
    <div class="svh-hero-right">
      <div class="svh-type-strip">
        ${venue.type.split('·').map(t => `<span class="svh-tag">${escapeHtml(t.trim())}</span>`).join('')}
        <span class="svh-tag">Est. ${venue.built}</span>
      </div>
      <div class="svh-venue-headline">${escapeHtml(venue.headline)}</div>
      <p class="svh-venue-desc">${escapeHtml(venue.desc)}</p>
      <div class="svh-facts">${factsHtml}</div>
    </div>
  </div>
</div>

<main class="container svh-main">

  <!-- Peter's story -->
  <section class="svh-section svh-story-section">
    <div class="svh-story-grid">
      <div class="svh-story-text">
        <div class="svh-section-label">About my-water.live</div>
        <h2 class="svh-section-title">From water to cloud</h2>
        <blockquote class="svh-blockquote">"My Water Live wasn't born in a boardroom; it was engineered at the water's edge."</blockquote>
        <p>It started with a simple question here at Tooting Bec Lido: <em>"Do you log your readings anywhere?"</em> Until then, the data lived only in Strava descriptions. That question sparked a vision: a real-time sensor network for lakes and lidos that lets you check conditions before you've even left the house.</p>
        <p>Manual readings with fish-tank thermometers are clunky — two people rarely see the same number. The sensor replaced that clutter with one accurate, continuous, automatic reading. No Wi-Fi required, no human error, no gaps.</p>
        <blockquote class="svh-quote-pull">"When the mind screams 'don't get in', do it — it's good for the soul."</blockquote>
        <a href="${escapeHtml(venue.url)}" target="_blank" rel="noopener noreferrer" class="svh-credit-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <strong>Powered by my-water.live</strong> — live sensor network for outdoor swimming venues
        </a>
      </div>
      <div class="svh-how-works">
        <div class="svh-section-label">How it works</div>
        <h3 class="svh-how-title">Sensor to swimmer</h3>
        <div class="svh-steps">${stepsHtml}</div>
      </div>
    </div>
  </section>

  ${hazards.length ? `<section class="svh-section">${renderHazards(hazards)}</section>` : ''}

  <!-- Community logs -->
  <section class="svh-section">
    <h2>Community Swim Logs <small>(last 7 days)</small></h2>
    <p class="svh-logs-note">Water temperature is measured continuously by the live sensor above. These are additional community readings logged by swimmers on SwimLoading.</p>
    ${recentLogsHtml}
  </section>

  ${renderMapEmbed(spot)}

  ${nearbyHtml}

  ${renderNearbyEvents(nearbyEvents, spot)}

  ${renderExploreCta(spot)}

  ${renderAppTeaser(spot)}

</main>
${script}`;
}

// ─── my-water.live LIVE SENSOR WIDGET (legacy — used by non-hero path) ────────
// Returns empty string for spots not in VENUE_MAP — no impact on other pages.

function renderMywaterliveWidget(slug) {
  const venue = VENUE_MAP[slug];
  if (!venue) return '';

  // Facts list — rendered server-side, always visible
  const factsHtml = venue.facts.map(f =>
    `<li class="mwl-fact"><span class="mwl-fact-dot"></span>${escapeHtml(f)}</li>`
  ).join('');

  // Client-side temp slot — filled by fetch, never contains the API key
  const script = `
<script>
(function(){
  var slot = document.getElementById('mwl-temp-slot');
  var upd  = document.getElementById('mwl-updated');
  if (!slot) return;
  fetch('/api/mywaterlive?slug=${escapeHtml(slug)}')
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){
      if (!d || d.unavailable) {
        slot.innerHTML = '<span class="mwl-temp-na">Sensor offline</span>';
        return;
      }
      var temp = d.temperature != null
        ? parseFloat(d.temperature).toFixed(1) + '\\u00b0C'
        : '\\u2014';
      slot.innerHTML = temp;
      if (upd && d.timestamp) {
        try {
          var t = new Date(d.timestamp).toLocaleString('en-GB',{
            day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'
          });
          upd.textContent = 'Sensor reading ' + t + (d.stale ? ' (cached)' : '');
        } catch(e){}
      }
    })
    .catch(function(){
      if (slot) slot.innerHTML = '<span class="mwl-temp-na">Unavailable</span>';
    });
})();
<\/script>`.trim();

  return `
<section class="mwl-hero-section">

  <div class="mwl-hero-grid">

    <!-- Left: venue info + facts -->
    <div class="mwl-hero-info">
      <div class="mwl-sensor-badge"><span class="mwl-live-dot"></span>Live sensor · my-water.live</div>
      <h2 class="mwl-venue-headline">${escapeHtml(venue.headline)}</h2>
      <p class="mwl-venue-desc">${escapeHtml(venue.desc)}</p>
      <ul class="mwl-facts-list">${factsHtml}</ul>
    </div>

    <!-- Right: live temp + sensor credit -->
    <div class="mwl-hero-temp-panel">
      <div class="mwl-temp-label">Right now</div>
      <div class="mwl-live-temp" id="mwl-temp-slot">
        <span class="mwl-temp-loading">…</span>
      </div>
      <div class="mwl-temp-sub" id="mwl-updated">Live sensor data</div>
      <div class="mwl-type-tags">
        ${venue.type.split('·').map(t => `<span class="mwl-tag">${escapeHtml(t.trim())}</span>`).join('')}
        <span class="mwl-tag">Est. ${venue.built}</span>
      </div>
      <a href="${escapeHtml(venue.url)}" target="_blank" rel="noopener noreferrer" class="mwl-visit-btn">
        Full conditions at my-water.live &#8594;
      </a>
    </div>

  </div>

  <div class="mwl-hero-footer">
    <a href="${escapeHtml(venue.url)}" target="_blank" rel="noopener noreferrer" class="mwl-powered">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      <strong>Powered by my-water.live</strong> &mdash; permanent in-water sensor network for outdoor swimming venues
    </a>
  </div>

</section>
${script}`;
}

function renderSpotHero(spot, latestData, recentLogs, trend, hasSensor = false, freshness = null, estimate = null) {
  const latest = recentLogs[0] || null;
  const hasTemp = latestData?.temp_c != null;
  // The visible page must not out-claim its own metadata. A badge reading
  // "Live conditions" over a six-day-old number is the same falsehood the
  // title used to tell, just in a bigger font.
  const fresh = freshness || getTemperatureFreshness(latestData?.updated_at ?? null);
  const tempHeading = waterTemperatureLabel({
    observedAt: latestData?.updated_at ?? null,
  }).label;
  const observedStr = formatObservedAt(fresh.observedAt, null);
  const cond = latest?.conditions ? escapeHtml(capitalise(latest.conditions)) : '';
  const who = latest?._displayName || 'SwimLoading member';
  const when = latest?.created_at ? timeAgo(latest.created_at) : '';
  const notes = latest?.notes ? `<div class="hero-notes">"${escapeHtml(latest.notes)}"</div>` : '';
  const isIntl = !SA_DOMAINS_SET.has(spot.domain);

  const TREND_LABEL = { warming: '↑ Warming', cooling: '↓ Cooling', stable: '→ Stable' };
  const TREND_COLOR = { warming: '#f59e0b', cooling: '#38bdf8', stable: '#94a3b8' };
  const trendBadge = trend ? `<span style="font-size:12px;font-weight:700;color:${TREND_COLOR[trend]};background:${TREND_COLOR[trend]}18;border:1px solid ${TREND_COLOR[trend]}44;border-radius:20px;padding:3px 10px;margin-left:10px;">${TREND_LABEL[trend]}</span>` : '';

  const noDataMsg = hasSensor
    ? `<div class="hero-no-data">Live sensor reading below ↓ &nbsp;·&nbsp; <a href="/app" style="color:var(--ocean-lt);">Log your swim</a> to add community data.</div>`
    : `<div class="hero-no-data">No recent logs — be the first to log this spot today.</div>`;

  // THE NUMBER THE APP SHOWS.
  //
  // The hero used to show only the latest swimmer log, so 37 spots had a
  // temperature in the app and "no recent logs" on their public page —
  // Muizenberg said nothing here while the app showed the model's 14.2°C.
  // Now both read the same blended estimate, and the caption says which
  // rung of the ladder it came from so the number is never over-claimed.
  const estSource = estimate?.best_source || null;
  const estTemp = estimate?.best_c != null ? Number(estimate.best_c).toFixed(1) : null;
  const showEstimate = !hasTemp && estTemp != null;

  const estCaption = estSource === 'measured'
    ? `Measured at ${escapeHtml(estimate.measured_station || 'a nearby station')}${
        estimate.measured_distance_km != null ? `, ${Number(estimate.measured_distance_km).toFixed(1)} km away` : ''}`
    : estSource === 'model'
      ? 'Modelled sea-surface estimate (Open-Meteo) — no swimmer reading yet'
      : '';

  const tempBlock = hasTemp ? `
    <div class="hero-temp-label" style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:2px;">${escapeHtml(tempHeading)}</div>
    <div class="hero-temp">${latestData.temp_c}°C${trendBadge}</div>
    ${cond ? `<div class="hero-cond">${cond}</div>` : ''}
    <div class="hero-meta">${fresh.canSayToday ? 'Logged' : 'Recorded'} by ${escapeHtml(who)}${when ? ` · ${escapeHtml(when)}` : ''}${observedStr ? ` · ${escapeHtml(observedStr)}` : ''}</div>
    ${notes}
  ` : showEstimate ? `
    <div class="hero-temp-label" style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:2px;">${escapeHtml(estSource === 'measured' ? 'Measured nearby' : 'Typical water temperature')}</div>
    <div class="hero-temp">${estTemp}°C</div>
    <div class="hero-meta">${estCaption}</div>
    <div class="hero-no-data" style="margin-top:10px;">No swimmer has logged this spot recently — <a href="/app" style="color:var(--ocean-lt);">be the first</a>.</div>
  ` : noDataMsg;

  const badgeStyle = isIntl
    ? 'background:rgba(217,119,6,0.1);border-color:rgba(217,119,6,0.35);color:#d97706;'
    : '';
  const dotStyle = isIntl ? 'background:#d97706;' : '';
  // The badge earns the word "Live" from the reading, not from the layout.
  const stateLabel = fresh.state === 'live' ? 'Live conditions'
    : fresh.state === 'recent' ? 'Recent conditions'
    : fresh.state === 'stale' ? 'Last recorded conditions'
    : 'Swimming conditions';
  const badgeLabel = isIntl
    ? `International \xB7 ${fresh.state === 'live' ? 'Live' : fresh.state === 'recent' ? 'Recent' : 'Conditions'}`
    : stateLabel;

  return `
  <div class="spot-hero">
    <div class="container spot-hero-inner">
      <div class="spot-hero-text">
        <div class="live-badge" style="${badgeStyle}">
          <span class="live-dot" style="${dotStyle}"></span> ${badgeLabel}
        </div>
        <h1>${escapeHtml(spot.name)} Water Temperature</h1>
        ${tempBlock}
        <a href="/app" class="btn-hero" data-sl-event="${SPOT_EVENTS.signupClick}" data-sl-cta="hero">Open SwimLoading Free →</a>
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
        <li>Real-time temperatures at 180+ spots</li>
        <li>Group swim coordination</li>
        <li>Community leaderboards</li>
        <li>Safety & hazard alerts</li>
      </ul>
      <a href="/app" class="btn-cta" style="margin-top:20px" data-sl-event="${SPOT_EVENTS.signupClick}" data-sl-cta="app_teaser">Start Swimming Free →</a>
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
      <p>${name} is a swimming pool in ${loc}. Pool temperatures are logged by SwimLoading members so you always know the water temperature before you arrive.</p>
      <p>SwimLoading tracks pool temperatures globally — from heated gym pools in Johannesburg to lidos in London — alongside ocean and lake spots, so swimmers everywhere can plan year-round.</p>`;
  }
  if (spot.water_type === 'LAKE') {
    return `
      <p>${name} is an open water lake swimming spot in ${loc}. Water temperatures are logged by the SwimLoading community so swimmers can track conditions throughout the year. ${range}</p>
      <p>SwimLoading is a free peer-to-peer platform built by open water swimmers. Swimmers log water temperatures, conditions, and hazards so the whole community swims smarter.</p>`;
  }
  if (spot.water_type === 'LAGOON') {
    return `
      <p>${name} is a popular swimming lagoon in ${loc}. Lagoon water temperatures are typically warmer than the nearby ocean and are logged by the SwimLoading community. ${range}</p>
      <p>SwimLoading is a free peer-to-peer ocean intelligence platform built by open water swimmers. Swimmers log water temperatures, conditions, and hazards so the whole community swims smarter.</p>`;
  }
  if (spot.water_type === 'DAM') {
    return `
      <p>${name} is a dam swimming spot in ${loc}. Water temperatures are logged by the SwimLoading community so swimmers can track conditions throughout the year. ${range}</p>
      <p>SwimLoading is a free peer-to-peer platform built by open water swimmers. Log water temperatures, conditions, and hazards so the whole community swims smarter.</p>`;
  }
  // OCEAN (default)
  return `
    <p>${name} is an open water swimming spot in ${loc}. Water temperatures are logged by the SwimLoading community of open water swimmers. ${range}</p>
    <p>SwimLoading is a free peer-to-peer ocean intelligence platform built by open water swimmers. Swimmers log water temperatures, conditions, and hazards so the whole community swims smarter. Check current conditions at ${name} before every swim.</p>`;
}

function renderNearbySpots(nearby, regionSlug, regionName) {
  if (!nearby.length) return '';
  const links = nearby.map(s => {
    const d = s.dist ? ` <span style="font-size:11px;color:var(--subtle);">${s.dist.toFixed(1)} km</span>` : '';
    return `<a href="/spots/${generateSlug(s.name)}" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:1px solid var(--border);border-radius:8px;text-decoration:none;color:var(--text);font-size:14px;font-weight:600;transition:border-color .2s;" onmouseover="this.style.borderColor='rgba(56,189,248,0.4)'" onmouseout="this.style.borderColor='rgba(56,189,248,0.15)'">${escapeHtml(s.name)}${d}</a>`;
  }).join('');
  const regionLink = regionSlug ? `<p style="margin-top:14px;font-size:13px;color:var(--subtle);">All spots in <a href="/spots/${regionSlug}">${escapeHtml(regionName || regionSlug)}</a></p>` : '';
  return `
  <section>
    <h2>Nearby Spots</h2>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">${links}</div>
    ${regionLink}
  </section>`;
}

/**
 * Upcoming swims near this spot.
 *
 * A swimmer checking the temperature at Muizenberg is, by definition,
 * someone who swims there — which makes an entered-this-season race
 * nearby genuinely useful rather than filler. Renders nothing at all when
 * there is nothing on: an empty "Upcoming swims" heading is worse than no
 * heading, because it teaches the reader the section is never worth
 * looking at.
 */
function renderNearbyEvents(events, spot) {
  if (!events?.length) return '';
  const items = events.map((e) => {
    const when = e.start_date
      ? new Date(`${e.start_date}T00:00:00Z`).toLocaleDateString('en-GB', {
          day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
        })
      : '';
    const place = e.event_venues?.city || e.event_venues?.region || '';
    return `
      <a href="/events/${escapeHtml(e.slug)}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;border:1px solid var(--border);border-radius:8px;text-decoration:none;color:var(--text);font-size:14px;font-weight:600;">
        <span>${escapeHtml(e.title)}${place ? `<span style="display:block;font-size:11px;font-weight:400;color:var(--subtle);">${escapeHtml(place)}</span>` : ''}</span>
        ${when ? `<span style="font-size:12px;color:var(--subtle);font-weight:400;flex-shrink:0;">${escapeHtml(when)}</span>` : ''}
      </a>`;
  }).join('');
  return `
  <section>
    <h2>Upcoming swims near ${escapeHtml(spot.name)}</h2>
    <div style="display:grid;gap:8px;">${items}</div>
  </section>`;
}

/**
 * The way out of a spot page that is not the back button.
 *
 * Uses Explore's existing query contract, so the link reproduces a real
 * search rather than dumping the visitor on an unfiltered map.
 */
function renderExploreCta(spot) {
  const url = exploreUrlForSpot(spot);
  return `
  <section style="text-align:center;padding:6px 0 2px;">
    <a href="${escapeHtml(url)}" class="btn-explore"
       data-sl-event="${SPOT_EVENTS.exploreClick}" data-sl-cta="spot_footer"
       style="display:inline-block;padding:12px 26px;border-radius:50px;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.3);color:var(--ocean-lt);font-size:14px;font-weight:700;text-decoration:none;">
      ${escapeHtml(exploreCtaTextForSpot(spot))} &rarr;
    </a>
  </section>`;
}

// ─── REGIONAL PAGE ────────────────────────────────────────────────────────────

async function renderRegionalPage(regionSlug) {
  const regionName = REGION_NAMES[regionSlug];
  const domains = REGION_DOMAINS[regionSlug];

  const countryFilter = REGION_COUNTRY_FILTER[regionSlug] || null;
  const spots = await dbRpc('seo_regional_spots', { p_domains: domains, p_country_code: countryFilter }) || [];

  // Live temperature for the cards, from the same blended view the app and
  // the spot pages use.
  //
  // The RPC returns avg_temp — an ALL-TIME community average — so a region
  // where nobody has ever logged showed "No data yet" on every card even
  // when instruments were reading it. Ireland was the clearest case: Forty
  // Foot had a buoy on 15.6°C and its region page said there was nothing.
  // A visitor should not have to open a spot page to discover the region
  // has data at all.
  const estimates = await dbGet(
    'spot_temp_estimate?select=spot_id,best_c,best_source,confidence,measured_at,model_at,swimmer_at'
  ).catch(() => []) || [];
  const estBySpot = new Map(estimates.map((e) => [e.spot_id, e]));
  for (const s of spots) {
    const e = estBySpot.get(s.id);
    if (e?.best_c != null) {
      s._liveTemp = Number(e.best_c);
      s._liveSource = e.best_source;
      // When the shown reading was actually taken — so the caption can
      // describe THAT reading instead of falling back to "Never logged",
      // which is true of swimmers but reads as a contradiction printed
      // directly under a live 16°C from a buoy.
      s._liveAt = e.best_source === 'measured' ? e.measured_at
        : e.best_source === 'model' ? e.model_at
        : e.swimmer_at;
    }
  }
  const poolSpots = spots.filter(s => s.water_type === 'POOL');
  const showWinter = ['west-coast', 'atlantic', 'false-bay', 'eastern-cape', 'garden-route'].includes(regionSlug) && poolSpots.length > 0;
  const allPools = spots.length > 0 && spots.every(s => s.water_type === 'POOL');

  const title = allPools
    ? `Swimming Pool Temperatures in ${regionName} | SwimLoading`
    : `Open Water Swimming Spots in ${regionName} | SwimLoading`;
  const SA_REGIONS = new Set(['west-coast','atlantic','false-bay','kwazulu-natal','eastern-cape','garden-route','south-coast','inland','gauteng','free-state']);
  const regionCountry = SA_REGIONS.has(regionSlug) ? ', South Africa' : '';
  const description = `Water temperatures and swimming conditions across ${regionName}${regionCountry}. Community-logged daily by open water swimmers on SwimLoading. Free to use.`;

  const jsonLdItemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Open Water Swimming Spots in ${regionName}`,
    description: `Community-logged water temperature spots in ${regionName}${regionCountry}`,
    url: `https://www.swimloading.com/spots/${regionSlug}`,
    itemListElement: spots.map((s, i) => ({
      '@type': 'ListItem', position: i + 1,
      url: `https://www.swimloading.com/spots/${generateSlug(s.name)}`,
      name: s.name,
    })),
  };

  const intro = REGION_INTROS[regionSlug] || '';
  const introHtml = intro
    ? intro.split('\n\n').map(p => `<p class="intro-text">${escapeHtml(p.trim())}</p>`).join('')
    : '';
  const sponsorHtml = getRegionSponsorHtml(regionSlug);
  const jsonLdRegionFaq = buildRegionFaqJsonLd(regionName, spots);

  const body = `
    <div class="region-hero">
      <div class="container region-hero-inner">
        <div class="region-hero-text">
          <nav class="breadcrumb breadcrumb-inline" aria-label="Breadcrumb">
            <a href="/">SwimLoading</a> › ${escapeHtml(regionName)}
          </nav>
          <h1>Swimming in ${escapeHtml(regionName)}</h1>
          ${introHtml}
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

      ${renderRegionDiscovery(spots)}

      ${showWinter ? renderWinterSection(poolSpots, regionName) : ''}

      ${allPools ? renderIntlPoolsSection() : ''}

      <section class="cta-box">
        <p>Logging temperatures in ${escapeHtml(regionName)}? Add your reading and help the community.</p>
        <a href="/app" class="btn-cta">Log a Temperature →</a>
      </section>

      ${renderRegionFaq(regionName, regionSlug, spots)}

      ${sponsorHtml ? `<section class="sponsor-section">${sponsorHtml}</section>` : ''}
    </main>
  `;

  return pageShell({ title, description, canonical: `https://www.swimloading.com/spots/${regionSlug}`, jsonLd: [jsonLdItemList, jsonLdRegionFaq], body });
}

const SA_DOMAINS_SET = new Set(['WEST_COAST','ATLANTIC','FALSE_BAY','KZN','EASTERN_CAPE','GARDEN_ROUTE','SOUTH_COAST','INLAND','NON_COASTAL','GAUTENG','FREE_STATE']);

function renderSpotCards(spots) {
  if (!spots.length) return `<p class="no-logs">No spots found for this region yet.</p>`;
  const TYPE_LABEL = { OCEAN: 'Ocean', LAGOON: 'Lagoon', POOL: 'Pool', DAM: 'Dam', LAKE: 'Lake' };
  const TYPE_COLOR = { OCEAN: '#38bdf8', LAGOON: '#34d399', POOL: '#a78bfa', DAM: '#fb923c', LAKE: '#34d399' };
  const cards = spots.map(s => {
    const slug = generateSlug(s.name);
    const typeLabel = TYPE_LABEL[s.water_type] || s.water_type;
    const typeColor = TYPE_COLOR[s.water_type] || '#94a3b8';
    const lastLogged = s.last_logged ? timeAgo(s.last_logged) : null;
    const isIntl = !SA_DOMAINS_SET.has(s.domain);
    const intlStyle = isIntl
      ? 'border-color:rgba(217,119,6,0.5);background:rgba(217,119,6,0.04);'
      : '';
    const intlBadge = isIntl
      ? `<div class="spot-card-intl"><span style="width:6px;height:6px;border-radius:50%;background:#d97706;display:inline-block;flex-shrink:0;"></span>International</div>`
      : '';
    return `
      <a href="/spots/${slug}" class="spot-card" style="${intlStyle}">
        <div class="spot-card-top">
          <span class="spot-card-name">${escapeHtml(s.name)}</span>
          <span class="spot-card-type" style="color:${typeColor}">${typeLabel}</span>
        </div>
        ${s._liveTemp != null
          ? `<div class="spot-card-temp">${s._liveTemp.toFixed(1)}°C <span>${s._liveSource === 'swimmer' ? 'logged' : s._liveSource === 'measured' ? 'buoy' : 'model'}</span></div>`
          // NO all-time average here. It used to fall back to avg_temp, so an
          // indoor pool nobody had logged since May advertised "26.4°C avg" —
          // a number in the temperature slot, at a glance indistinguishable
          // from a current one, describing water three months ago. Better to
          // show no temperature and let the caption say when it was last
          // logged. The history is still on the spot page itself.
          : lastLogged
            ? `<div class="spot-card-temp spot-card-temp-none">No recent reading</div>`
            : `<div class="spot-card-temp spot-card-temp-none">No data yet</div>`}
        ${spotCardMeta(s, lastLogged)}
        ${intlBadge}
        <div class="spot-card-cta">View spot ›</div>
      </a>`;
  }).join('');
  return `<p class="spot-cards-hint">Tap any spot for map, conditions &amp; directions</p><div class="spot-cards">${cards}</div>`;
}

/**
 * The line under a spot card's temperature.
 *
 * It has to describe the reading that is ACTUALLY shown. Ireland's cards
 * displayed a live 16.0°C from a buoy with "Never logged" printed directly
 * underneath — both true (no swimmer has ever logged there) and, side by
 * side, indistinguishable from a bug.
 *
 * A swimmer log is still the headline when there is one; otherwise the
 * caption belongs to whichever instrument produced the number.
 */
function spotCardMeta(s, lastLogged) {
  // The caption follows the SHOWN reading, whatever it is. Preferring the
  // swimmer log whenever one exists produced the same confusion in reverse:
  // Clifton 4th displayed 13.6°C from the model over "Last logged 2 days
  // ago", so the number and the sentence beneath it described different
  // readings taken from different sources on different days.
  if (s._liveTemp != null && s._liveAt) {
    const when = timeAgo(s._liveAt);
    const what = s._liveSource === 'measured' ? 'Buoy reading'
      : s._liveSource === 'model' ? 'Model updated'
      : 'Last logged';
    return `<div class="spot-card-meta">${what} ${escapeHtml(when)}</div>`;
  }
  if (lastLogged) return `<div class="spot-card-meta">Last logged ${escapeHtml(lastLogged)}</div>`;
  // Genuinely nothing — and now it is the only case that says so.
  return `<div class="spot-card-meta">No readings yet</div>`;
}

function renderIntlPoolsSection() {
  return `
    <section style="background:rgba(217,119,6,0.06);border:1px solid rgba(217,119,6,0.2);border-radius:14px;padding:20px 24px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="width:7px;height:7px;border-radius:50%;background:#d97706;display:inline-block;"></span>
        <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#d97706;">International</span>
      </div>
      <h2 style="margin-bottom:8px;">Swimming outside South Africa?</h2>
      <p style="margin-bottom:14px;">SwimLoading tracks pools and lidos internationally. UK lidos, Swiss lakes, and more — all community-logged and free to use.</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        <a href="/spots/united-kingdom" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid rgba(217,119,6,0.3);background:rgba(217,119,6,0.07);color:#d97706;font-size:13px;font-weight:600;text-decoration:none;">UK Lidos &amp; Open Water</a>
        <a href="/spots/switzerland" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid rgba(217,119,6,0.3);background:rgba(217,119,6,0.07);color:#d97706;font-size:13px;font-weight:600;text-decoration:none;">Swiss Lakes</a>
        <a href="/spots/portugal" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid rgba(217,119,6,0.3);background:rgba(217,119,6,0.07);color:#d97706;font-size:13px;font-weight:600;text-decoration:none;">Portugal</a>
        <a href="/spots/australia" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid rgba(217,119,6,0.3);background:rgba(217,119,6,0.07);color:#d97706;font-size:13px;font-weight:600;text-decoration:none;">Australia</a>
      </div>
    </section>`;
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

function pageShell({ title, description, canonical, jsonLd, body, ogImage, extraScripts = '' }) {
  const ldTags = jsonLd.map(d => `<script type="application/ld+json">${JSON.stringify(d)}</script>`).join('\n  ');
  const image = ogImage || 'https://www.swimloading.com/screenshots/temps.jpg';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${image}">
  <meta property="og:site_name" content="SwimLoading">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${image}">
  ${ldTags}
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-89R519Y9T4"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-89R519Y9T4');
  </script>
  <style>${INLINE_CSS}</style>
</head>
<body>
  <header>
    <div class="container header-inner">
      <a href="/" class="logo">
        <img src="/icons/logo-wave.png" alt="" class="logo-icon">
        <span class="logo-text">SwimLoading</span>
      </a>
      <div style="display:flex;align-items:center;gap:10px;">
        <a href="javascript:history.back()" class="btn-back">&#8592; Back</a>
        <a href="/app" class="btn-app" data-sl-event="${SPOT_EVENTS.loginClick}" data-sl-cta="nav">Get the App</a>
      </div>
    </div>
  </header>
  ${body}
  <footer class="seo-footer">
    <div class="container">
      ${FOOTER_HTML}
    </div>
  </footer>
<script>document.addEventListener('mousemove',e=>{document.body.style.setProperty('--mouse-x',e.clientX+'px');document.body.style.setProperty('--mouse-y',e.clientY+'px')});</script>
${extraScripts}
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
.logo{display:flex;align-items:center;gap:7px;text-decoration:none}
.logo-icon{height:22px;width:auto;flex-shrink:0}
.logo-text{font-size:18px;font-weight:800;background:linear-gradient(135deg,#38bdf8 0%,#0ea5e9 50%,#0284c7 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:-0.5px}
.btn-back{display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:500;color:var(--subtle);background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:5px 12px;text-decoration:none;transition:all .2s}
.btn-back:hover{color:var(--ocean-lt);border-color:rgba(56,189,248,0.25);text-decoration:none}
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
.spot-card-intl{display:inline-flex;align-items:center;gap:5px;margin-top:8px;font-size:11px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:.05em}
.spot-card-cta{margin-top:12px;font-size:12px;font-weight:600;color:var(--ocean-lt);text-align:right;opacity:.7;transition:opacity .2s}
.spot-card:hover .spot-card-cta{opacity:1}
.spot-cards-hint{font-size:12px;color:var(--subtle);margin-bottom:10px;text-align:right;letter-spacing:.01em}
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
  .f-grid{grid-template-columns:1fr!important}
  .btn-back{display:none}
}
@media(max-width:440px){
  .spot-cards{grid-template-columns:1fr}
  .stat-cards{grid-template-columns:repeat(2,1fr)}
  td,th{padding:9px 10px}
}
/* ── Sensor venue hero page ── */
.svh-hero{background:linear-gradient(135deg,#061628 0%,#0a1e38 40%,rgba(2,132,199,0.15) 100%);border-bottom:1px solid rgba(56,189,248,0.2);padding:52px 0 48px;overflow:hidden}
.svh-hero-inner{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:start}
.svh-hero-left{display:flex;flex-direction:column;gap:16px}
.svh-badge{display:inline-flex;align-items:center;gap:8px;font-size:11px;font-weight:700;color:#22c55e;text-transform:uppercase;letter-spacing:.1em;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:20px;padding:5px 14px;width:fit-content}
.svh-live-dot{width:7px;height:7px;background:#22c55e;border-radius:50%;animation:pulse-dot 2s ease-in-out infinite;flex-shrink:0}
.svh-venue-name{font-size:42px;font-weight:900;color:var(--text);line-height:1.05;margin:0}
.svh-tagline{font-size:16px;color:var(--ocean-lt);font-weight:500;margin:0}
.svh-temp-block{margin:8px 0 4px}
.svh-temp{font-size:96px;font-weight:900;color:var(--ocean-lt);line-height:1;text-shadow:0 0 60px rgba(56,189,248,0.5);min-height:96px}
.svh-temp-loading{display:inline-block;width:120px;height:80px;background:rgba(56,189,248,0.08);border-radius:8px;animation:pulse-dot 1.5s ease-in-out infinite}
.svh-temp-sub{font-size:13px;color:var(--subtle);margin-top:6px}
.svh-built{font-size:12px;color:var(--subtle);margin:0}
.svh-ctas{display:flex;gap:12px;flex-wrap:wrap;margin-top:4px}
.svh-btn-primary{display:inline-flex;align-items:center;background:var(--ocean);color:#fff!important;font-size:14px;font-weight:700;padding:12px 22px;border-radius:10px;text-decoration:none!important;transition:background .15s}
.svh-btn-primary:hover{background:#0369a1;text-decoration:none!important}
.svh-btn-secondary{display:inline-flex;align-items:center;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:var(--text)!important;font-size:14px;font-weight:600;padding:12px 22px;border-radius:10px;text-decoration:none!important;transition:all .15s}
.svh-btn-secondary:hover{background:rgba(255,255,255,0.1);text-decoration:none!important}
.svh-hero-right{padding-top:8px}
.svh-type-strip{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.svh-tag{font-size:11px;font-weight:600;color:var(--ocean-lt);background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.2);border-radius:20px;padding:3px 10px}
.svh-venue-headline{font-size:18px;font-weight:800;color:var(--text);margin-bottom:10px;line-height:1.3}
.svh-venue-desc{font-size:13px;color:var(--muted);line-height:1.7;margin-bottom:16px}
.svh-facts{display:flex;flex-direction:column;gap:8px}
.svh-fact{display:flex;align-items:flex-start;gap:9px;font-size:13px;color:var(--muted)}
.svh-fact-dot{width:5px;height:5px;border-radius:50%;background:var(--ocean-lt);flex-shrink:0;margin-top:5px}
/* Main content */
.svh-main{padding-top:40px;padding-bottom:60px}
.svh-section{margin:0 0 48px}
.svh-section-label{font-size:11px;font-weight:700;color:var(--ocean-lt);text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px}
.svh-section-title{font-size:22px;font-weight:800;color:var(--text);margin-bottom:16px}
.svh-story-grid{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:start}
.svh-story-text p{font-size:14px;color:var(--muted);line-height:1.75;margin-bottom:14px}
.svh-blockquote{font-size:17px;font-style:italic;color:var(--ocean-lt);border-left:3px solid var(--ocean-lt);padding-left:16px;margin:0 0 16px;line-height:1.6}
.svh-quote-pull{font-size:15px;font-style:italic;color:var(--muted);border-left:2px solid rgba(255,255,255,0.1);padding-left:14px;margin:16px 0;line-height:1.6}
.svh-credit-link{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--muted);text-decoration:none;transition:color .15s;margin-top:4px}
.svh-credit-link:hover{color:var(--ocean-lt);text-decoration:none}
.svh-credit-link strong{color:var(--ocean-lt)}
.svh-how-works{}
.svh-how-title{font-size:16px;font-weight:700;color:var(--text);margin-bottom:16px}
.svh-steps{display:flex;flex-direction:column;gap:12px}
.svh-step{display:flex;align-items:flex-start;gap:12px;font-size:13px;color:var(--muted);line-height:1.5}
.svh-step-num{flex-shrink:0;width:24px;height:24px;border-radius:50%;background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.25);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--ocean-lt);margin-top:1px}
.svh-logs-note{font-size:13px;color:var(--subtle);background:rgba(56,189,248,0.05);border:1px solid rgba(56,189,248,0.12);border-radius:8px;padding:10px 14px;margin-bottom:14px}
.svh-no-logs{font-size:14px;color:var(--subtle);padding:16px 0}
@media(max-width:700px){
  .svh-hero{padding:36px 0 32px}
  .svh-hero-inner{grid-template-columns:1fr;gap:28px}
  .svh-temp{font-size:72px}
  .svh-venue-name{font-size:30px}
  .svh-story-grid{grid-template-columns:1fr;gap:28px}
  .svh-ctas{flex-direction:column}
  .svh-btn-primary,.svh-btn-secondary{width:100%;justify-content:center}
}
/* ── my-water.live venue hero ── */
.mwl-hero-section{background:linear-gradient(135deg,#0d1f38 0%,#0a1628 50%,rgba(2,132,199,0.1) 100%);border:1px solid rgba(56,189,248,0.3);border-radius:var(--r);overflow:hidden;margin:0 0 32px}
.mwl-hero-grid{display:grid;grid-template-columns:1fr 280px;gap:0}
.mwl-hero-info{padding:28px 28px 24px;border-right:1px solid rgba(56,189,248,0.12)}
.mwl-sensor-badge{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:700;color:var(--ocean-lt);text-transform:uppercase;letter-spacing:.1em;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.2);border-radius:20px;padding:4px 12px;margin-bottom:14px}
.mwl-live-dot{width:7px;height:7px;background:#22c55e;border-radius:50%;animation:pulse-dot 2s ease-in-out infinite;flex-shrink:0}
.mwl-venue-headline{font-size:20px;font-weight:800;color:var(--text);margin-bottom:10px;line-height:1.25}
.mwl-venue-desc{font-size:13px;color:var(--muted);line-height:1.7;margin-bottom:16px}
.mwl-facts-list{list-style:none;display:flex;flex-direction:column;gap:7px}
.mwl-fact{display:flex;align-items:flex-start;gap:9px;font-size:13px;color:var(--muted)}
.mwl-fact-dot{width:5px;height:5px;border-radius:50%;background:var(--ocean-lt);flex-shrink:0;margin-top:5px}
/* Right panel */
.mwl-hero-temp-panel{padding:28px 22px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;background:rgba(2,132,199,0.06)}
.mwl-temp-label{font-size:11px;font-weight:700;color:var(--subtle);text-transform:uppercase;letter-spacing:.1em}
.mwl-live-temp{font-size:72px;font-weight:900;color:var(--ocean-lt);line-height:1;text-shadow:0 0 50px rgba(56,189,248,0.4);min-height:72px}
.mwl-temp-loading{font-size:36px;color:var(--subtle);animation:pulse-dot 1.5s ease-in-out infinite}
.mwl-temp-na{font-size:18px;color:var(--subtle)}
.mwl-temp-sub{font-size:11px;color:var(--subtle);margin-bottom:4px}
.mwl-type-tags{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 16px}
.mwl-tag{font-size:11px;font-weight:600;color:var(--ocean-lt);background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.2);border-radius:20px;padding:3px 9px;white-space:nowrap}
.mwl-visit-btn{display:inline-flex;align-items:center;background:var(--ocean);color:#fff!important;font-size:13px;font-weight:600;padding:9px 16px;border-radius:8px;text-decoration:none!important;transition:background .15s;white-space:nowrap;margin-top:auto}
.mwl-visit-btn:hover{background:#0369a1;text-decoration:none!important}
/* Footer */
.mwl-hero-footer{border-top:1px solid rgba(56,189,248,0.12);padding:10px 22px}
.mwl-powered{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--subtle);text-decoration:none;transition:color .15s}
.mwl-powered:hover{color:var(--ocean-lt);text-decoration:none}
.mwl-powered strong{color:var(--ocean-lt)}
/* Logs note */
.mwl-logs-note{font-size:13px;color:var(--subtle);background:rgba(56,189,248,0.05);border:1px solid rgba(56,189,248,0.12);border-radius:8px;padding:10px 14px;margin-bottom:12px}
@media(max-width:700px){
  .mwl-hero-grid{grid-template-columns:1fr}
  .mwl-hero-info{border-right:none;border-bottom:1px solid rgba(56,189,248,0.12);padding:20px}
  .mwl-hero-temp-panel{padding:20px;flex-direction:row;flex-wrap:wrap;align-items:center;gap:16px}
  .mwl-live-temp{font-size:56px}
  .mwl-type-tags{margin:0}
  .mwl-visit-btn{margin-top:0;width:100%}
}
`.trim();

// International column built from COUNTRY_SLUGS (seo-utils.js) — the same
// map that already correctly resolves /spots/[country-slug] for every live
// country. This used to be a hand-typed 5-country HTML string that never
// grew past Namibia/UK/Australia/Switzerland/Portugal — Seychelles, Italy,
// France, Croatia, Spain and Thailand were all live but missing here. Never
// hardcode this list again; add the country to COUNTRY_SLUGS and it appears
// here automatically. Italy has no dedicated country page (see site-config.js
// countries[].slug===null) so it's added separately, matching welcome.html's
// own fallback of routing it to /spots/europe.
function prettifyCountryKey(key) {
  return key.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
const INTL_FOOTER_LINKS = Object.keys(COUNTRY_SLUGS)
  .filter(key => key !== 'south-africa')
  .map(key => `<a href="/spots/${COUNTRY_SLUGS[key]}">${prettifyCountryKey(key)}</a>`)
  .concat('<a href="/spots/europe">Italy</a>')
  .join('\n      ');

const FOOTER_HTML = `
<div class="f-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:32px 24px;margin-bottom:28px;">
  <div>
    <div class="f-label">South Africa</div>
    <div class="f-links">
      <a href="/spots/atlantic">Atlantic Seaboard</a>
      <a href="/spots/false-bay">False Bay</a>
      <a href="/spots/west-coast">West Coast</a>
      <a href="/spots/kwazulu-natal">KwaZulu-Natal</a>
      <a href="/spots/garden-route">Garden Route</a>
      <a href="/spots/eastern-cape">Eastern Cape</a>
      <a href="/spots/south-coast">South Coast</a>
      <a href="/spots/inland">Inland &amp; Pools</a>
      <a href="/spots/gauteng">Gauteng</a>
      <a href="/spots/free-state">Free State</a>
    </div>
  </div>
  <div>
    <div class="f-label">International</div>
    <div class="f-links">
      ${INTL_FOOTER_LINKS}
    </div>
  </div>
</div>
<div class="f-label">Popular spots</div>
<div class="f-links">
  <a href="/spots/big-bay">Big Bay</a>
  <a href="/spots/clifton-4th-beach">Clifton 4th Beach</a>
  <a href="/spots/robben-island">Robben Island</a>
  <a href="/spots/glencairn">Glencairn</a>
  <a href="/spots/gordons-bay">Gordons Bay</a>
  <a href="/spots/tooting-bec-lido">Tooting Bec Lido</a>
  <a href="/spots/cottesloe-beach">Cottesloe Beach</a>
  <a href="/spots/cascais">Cascais</a>
</div>
<div class="f-copy" style="border-top:1px solid rgba(255,255,255,0.06);padding-top:20px;margin-top:4px;">
  <a href="/">SwimLoading</a> — Community water temperature tracking across South Africa, UK, Australia, Portugal and beyond.
  &nbsp;·&nbsp; <a href="/app">Open the app</a>
  &nbsp;·&nbsp; <a href="mailto:support@swimloading.com">support@swimloading.com</a>
</div>
`.trim();

// ─── SPOT PAGE HELPERS ────────────────────────────────────────────────────────

function computeTrend(logs) {
  const temps = logs.map(l => l.temp_c).filter(t => t != null);
  if (temps.length < 3) return null;
  // logs are newest-first; split into recent half vs older half
  const half = Math.ceil(temps.length / 2);
  const avgRecent = temps.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const avgOlder  = temps.slice(half).reduce((a, b) => a + b, 0) / (temps.length - half);
  const diff = avgRecent - avgOlder;
  if (diff > 0.5) return 'warming';
  if (diff < -0.5) return 'cooling';
  return 'stable';
}

function renderHazards(hazards) {
  if (!hazards.length) {
    return `
  <section>
    <h2>Hazards</h2>
    <p class="no-logs">No active hazards reported by the SwimLoading community.</p>
  </section>`;
  }

  const SEV_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#64748b', info: '#38bdf8' };
  const SEV_LABEL = { high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
  const rows = hazards.map(h => {
    const c = SEV_COLOR[h.severity] || '#64748b';
    const l = SEV_LABEL[h.severity] || h.severity;
    return `
    <div style="border:1px solid ${c}33;border-left:3px solid ${c};border-radius:10px;padding:14px 16px;margin-bottom:10px;background:${c}08;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap;">
        <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:${c};background:${c}22;padding:2px 8px;border-radius:20px;">${escapeHtml(l)}</span>
        <span style="font-size:12px;color:var(--subtle);">${escapeHtml(capitalise(h.hazard_type))}</span>
        <span style="font-size:12px;color:var(--subtle);margin-left:auto;">${h.created_at ? formatDate(h.created_at) : ''}</span>
      </div>
      <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px;">${escapeHtml(h.title)}</div>
      ${h.description ? `<div style="font-size:13px;color:var(--muted);">${escapeHtml(h.description)}</div>` : ''}
    </div>`;
  }).join('');
  return `
  <section>
    <h2>Active Hazards</h2>
    ${rows}
  </section>`;
}

function renderFaq(spot, locationLabel, latestData, hazards, freshness = null) {
  const name = escapeHtml(spot.name);
  const isPool = spot.water_type === 'POOL';
  const typeLabel = isPool ? 'pool' : 'open water';
  const fresh = freshness || getTemperatureFreshness(latestData?.updated_at ?? null);
  const observed = formatObservedAt(fresh.observedAt, null);

  // The question is "what is it TODAY", so a stale answer has to say so in
  // the same breath as the number, not leave the reader to notice.
  const tempAnswer = latestData?.temp_c != null
    ? (fresh.canSayToday
        ? `The water temperature at ${name} is <strong>${latestData.temp_c}°C</strong>${observed ? `, logged ${escapeHtml(observed)}` : ''}.`
        : `The most recent reading at ${name} is <strong>${latestData.temp_c}°C</strong>${observed ? `, recorded ${escapeHtml(observed)}` : ''} — not a reading from today. Water temperatures move, so treat it as a guide and check for newer logs before you swim.`)
    : `There is no community log for ${name} yet. SwimLoading relies on swimmers to log temperatures — be the first to log it and help the whole community.`;

  const goodAnswer = isPool
    ? `${name} is a swimming pool in ${escapeHtml(locationLabel)}. It is suitable for lap swimming and training. Check the latest pool temperature above before your session.`
    : `${name} is an open water ${typeLabel} spot in ${escapeHtml(locationLabel)}. Conditions vary by weather, swell, and current water temperature. Always check the latest logs before swimming and assess conditions on the day. SwimLoading community data is logged by swimmers, not certified safety officers.`;

  const hazardAnswer = hazards.length
    ? `There ${hazards.length === 1 ? 'is 1 active hazard' : `are ${hazards.length} active hazards`} currently reported at ${name} by the SwimLoading community. See the hazards section above for details.`
    : `No active hazards have been reported at ${name}. This does not guarantee conditions are safe — always assess on the day.`;

  const updateAnswer = `SwimLoading is a community platform. Temperatures at ${name} are updated whenever a SwimLoading member logs a reading. Active spots are typically updated multiple times per week during peak swimming seasons.`;

  const logAnswer = `Yes. SwimLoading is free. Sign up at swimloading.com or download the app, and log a temperature for ${name}. Your reading helps the whole community plan their swims.`;

  const faqs = [
    [`What is the water temperature at ${name} today?`, tempAnswer],
    [`Is ${name} good for ${typeLabel} swimming?`, goodAnswer],
    [`Are there any hazards at ${name}?`, hazardAnswer],
    [`How often is ${name} updated on SwimLoading?`, updateAnswer],
    [`Can I log a temperature for ${name}?`, logAnswer],
  ];

  const items = faqs.map(([q, a]) => `
  <details style="border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:8px;">
    <summary style="padding:14px 16px;font-size:15px;font-weight:600;color:var(--text);cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:8px;">
      ${escapeHtml(q)}<span style="font-size:20px;color:var(--ocean-lt);flex-shrink:0;font-weight:400;">+</span>
    </summary>
    <div style="padding:0 16px 14px;font-size:14px;line-height:1.7;color:var(--muted);">${a}</div>
  </details>`).join('');

  return `
  <section>
    <h2>Frequently Asked Questions</h2>
    ${items}
  </section>`;
}

function buildFaqJsonLd(spot, latestData, hazards, freshness = null) {
  const name = spot.name;
  // Structured data is read by machines that cannot see the caveat beside
  // it, so the answer carries its own observation date rather than
  // implying the number is current.
  const fresh = freshness || getTemperatureFreshness(latestData?.updated_at ?? null);
  const observed = formatObservedAt(fresh.observedAt, null);
  const tempText = latestData?.temp_c != null
    ? (fresh.canSayToday
        ? `The water temperature at ${name} was ${latestData.temp_c}°C, logged by a SwimLoading swimmer${observed ? ` on ${observed}` : ' today'}.`
        : `The last recorded water temperature at ${name} was ${latestData.temp_c}°C${observed ? `, logged on ${observed}` : ''}. It is not a current reading — check the SwimLoading page for newer logs.`)
    : `There is no community log for ${name} yet. Sign up free at swimloading.com and be the first to log it.`;
  const hazardText = hazards.length
    ? `There ${hazards.length === 1 ? 'is 1 active hazard' : `are ${hazards.length} active hazards`} currently reported at ${name}. See the SwimLoading spot page for details.`
    : `No active hazards have been reported at ${name} by the SwimLoading community. Always assess conditions on the day.`;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      { '@type': 'Question', name: `What is the water temperature at ${name} today?`,
        acceptedAnswer: { '@type': 'Answer', text: tempText } },
      { '@type': 'Question', name: `Are there any hazards at ${name}?`,
        acceptedAnswer: { '@type': 'Answer', text: hazardText } },
      { '@type': 'Question', name: `How often is ${name} updated on SwimLoading?`,
        acceptedAnswer: { '@type': 'Answer', text: `SwimLoading is a community platform — temperatures at ${name} are updated by members. Active spots are typically logged multiple times per week during peak seasons.` } },
      { '@type': 'Question', name: `Can I log a temperature for ${name}?`,
        acceptedAnswer: { '@type': 'Answer', text: `Yes. SwimLoading is free to use. Visit swimloading.com or download the app, sign up free, and log a temperature for ${name}.` } },
    ],
  };
}

function renderFreshnessBar(recentLogs, latestData) {
  const count = recentLogs.length;
  if (!count && !latestData?.updated_at) return '';
  const lastTime = latestData?.updated_at || recentLogs[0]?.created_at;
  const lastStr = lastTime ? timeAgo(lastTime) : null;
  const parts = [];
  if (count > 0) parts.push(`${count} log${count !== 1 ? 's' : ''} this week`);
  if (lastStr) parts.push(`Updated ${lastStr}`);
  return `<p style="font-size:13px;color:var(--subtle);margin-bottom:10px;">${parts.join(' · ')}</p>`;
}

function renderTrendSummary(spot, recentLogs, trend) {
  if (!trend || recentLogs.length < 3) return '';
  const temps = recentLogs.map(l => l.temp_c).filter(t => t != null);
  if (temps.length < 3) return '';
  const half = Math.ceil(temps.length / 2);
  const avgRecent = temps.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const avgOlder  = temps.slice(half).reduce((a, b) => a + b, 0) / (temps.length - half);
  const delta = Math.abs(avgRecent - avgOlder).toFixed(1);
  const name = escapeHtml(spot.name);
  const sentences = {
    warming: `Water temperatures at ${name} have risen ${delta}°C over the last 7 days.`,
    cooling: `Water temperatures at ${name} have dropped ${delta}°C over the last 7 days.`,
    stable:  `Water temperatures at ${name} have been stable over the last 7 days.`,
  };
  return `<p style="font-size:14px;color:var(--muted);margin-bottom:12px;">${sentences[trend]}</p>`;
}

function renderRegionDiscovery(spots) {
  const withLogged = spots.filter(s => s.last_logged != null);
  const withTemp   = spots.filter(s => s.avg_temp != null);
  if (!withLogged.length && !withTemp.length) return '';

  const cardLink = (name, slug, right) =>
    `<a href="/spots/${slug}" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:1px solid var(--border);border-radius:8px;text-decoration:none;color:var(--text);font-size:14px;font-weight:600;transition:border-color .2s;" onmouseover="this.style.borderColor='rgba(56,189,248,0.4)'" onmouseout="this.style.borderColor='rgba(56,189,248,0.15)'">${escapeHtml(name)}${right}</a>`;

  let html = '';

  if (withLogged.length >= 2) {
    const recent = [...withLogged].sort((a, b) => new Date(b.last_logged) - new Date(a.last_logged)).slice(0, 4);
    const items = recent.map(s => cardLink(s.name, generateSlug(s.name),
      `<span style="font-size:12px;color:var(--subtle);font-weight:400;">${escapeHtml(timeAgo(s.last_logged))}</span>`
    )).join('');
    html += `<section><h2>Recently Logged</h2><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">${items}</div></section>`;
  }

  if (withTemp.length >= 2) {
    const warmest = [...withTemp].sort((a, b) => b.avg_temp - a.avg_temp).slice(0, 4);
    const items = warmest.map(s => cardLink(s.name, generateSlug(s.name),
      `<span style="font-size:14px;font-weight:800;color:var(--ocean-lt);">${s.avg_temp}°C</span>`
    )).join('');
    html += `<section><h2>Warmest Spots</h2><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">${items}</div></section>`;
  }

  return html;
}

function renderRegionFaq(regionName, regionSlug, spots) {
  const withTemp = spots.filter(s => s.avg_temp != null);
  const temps = withTemp.map(s => s.avg_temp);
  const minT = temps.length ? Math.min(...temps).toFixed(1) : null;
  const maxT = temps.length ? Math.max(...temps).toFixed(1) : null;
  const topSpots = spots.slice(0, 3).map(s => s.name).join(', ');
  const rn = escapeHtml(regionName);

  const faqs = [
    [
      `What water temperature can I expect swimming in ${rn}?`,
      temps.length >= 2
        ? `Community-logged temperatures across ${rn} range from <strong>${minT}°C</strong> to <strong>${maxT}°C</strong> depending on the spot and season. Check individual spot pages for the latest logged reading.`
        : `Temperatures in ${rn} vary by spot and season. Check individual spot pages for the latest reading.`,
    ],
    [
      `What are the best swimming spots in ${rn}?`,
      topSpots
        ? `SwimLoading tracks ${spots.length} swimming spot${spots.length !== 1 ? 's' : ''} in ${rn}, including ${escapeHtml(topSpots)}. Browse all spots on this page — tap any card for the latest conditions.`
        : `SwimLoading is building its coverage of ${rn} swimming spots. Check back soon or sign up free to log a spot in this region.`,
    ],
    [
      `Is open water swimming in ${rn} safe?`,
      `Open water conditions vary with weather, swell, and temperature. SwimLoading data is community-logged — it gives you real water temperatures and conditions from other swimmers, but is not a substitute for your own on-the-day assessment. Always swim within your ability and be aware of local hazards.`,
    ],
    [
      `How does SwimLoading track temperatures in ${rn}?`,
      `SwimLoading is a peer-to-peer platform. Temperatures across ${rn} are logged by the open water swimming community after their sessions, so data reflects actual conditions from real swims. Sign up free to contribute your own logs.`,
    ],
  ];

  const items = faqs.map(([q, a]) => `
  <details style="border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:8px;">
    <summary style="padding:14px 16px;font-size:15px;font-weight:600;color:var(--text);cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:8px;">
      ${q}<span style="font-size:20px;color:var(--ocean-lt);flex-shrink:0;font-weight:400;">+</span>
    </summary>
    <div style="padding:0 16px 14px;font-size:14px;line-height:1.7;color:var(--muted);">${a}</div>
  </details>`).join('');

  return `
  <section>
    <h2>Frequently Asked Questions</h2>
    ${items}
  </section>`;
}

function buildRegionFaqJsonLd(regionName, spots) {
  const withTemp = spots.filter(s => s.avg_temp != null);
  const temps = withTemp.map(s => s.avg_temp);
  const minT = temps.length ? Math.min(...temps).toFixed(1) : null;
  const maxT = temps.length ? Math.max(...temps).toFixed(1) : null;
  const topSpots = spots.slice(0, 3).map(s => s.name).join(', ');

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      { '@type': 'Question',
        name: `What water temperature can I expect swimming in ${regionName}?`,
        acceptedAnswer: { '@type': 'Answer', text: temps.length >= 2
          ? `Community-logged temperatures across ${regionName} range from ${minT}°C to ${maxT}°C depending on the spot and season.`
          : `Temperatures in ${regionName} vary by spot and season. Check individual spot pages on SwimLoading for the latest reading.` } },
      { '@type': 'Question',
        name: `What are the best swimming spots in ${regionName}?`,
        acceptedAnswer: { '@type': 'Answer', text: topSpots
          ? `SwimLoading tracks ${spots.length} swimming spot${spots.length !== 1 ? 's' : ''} in ${regionName}, including ${topSpots}.`
          : `SwimLoading is building its coverage of ${regionName} swimming spots.` } },
      { '@type': 'Question',
        name: `Is open water swimming in ${regionName} safe?`,
        acceptedAnswer: { '@type': 'Answer', text: `Open water conditions vary with weather, swell, and temperature. SwimLoading data is community-logged and not a substitute for your own on-the-day assessment. Always swim within your ability.` } },
      { '@type': 'Question',
        name: `How does SwimLoading track temperatures in ${regionName}?`,
        acceptedAnswer: { '@type': 'Answer', text: `SwimLoading is a peer-to-peer platform. Temperatures across ${regionName} are logged by the open water swimming community after their sessions. Sign up free at swimloading.com to contribute.` } },
    ],
  };
}
// ─── GREATER LONDON HUB PAGE ──────────────────────────────────────────────────
// Drop this function into spots-handler.js, before render404().
// Call it from the main handler with: if (slug === 'greater-london') { ... }

async function renderGreaterLondonPage() {
  const title       = 'Open Water Swimming Spots in Greater London | SwimLoading';
  const description = 'Explore open water swimming spots, lidos, ponds, reservoirs and swimming locations across Greater London. Check water temperatures, conditions and recent swim activity with SwimLoading.';
  const canonical   = 'https://www.swimloading.com/spots/greater-london';

  // Pull all UK spots from Supabase — these are the 12 London spots we inserted
  const LONDON_CODES = [
    'TOOTING_LIDO', 'BROCKWELL_LIDO', 'LONDON_FIELDS_LIDO',
    'PARLIAMENT_HILL_LIDO', 'HAMPSTEAD_MIXED_POND', 'HAMPSTEAD_LADIES_POND',
    'HAMPSTEAD_MENS_POND', 'SERPENTINE_LIDO', 'WEST_RESERVOIR',
    'CHARLTON_LIDO', 'HAMPTON_POOL', 'OASIS_SPORTS_CENTRE',
  ];

  const allUKSpots = await dbGet(
    `spots?active=eq.true&domain=eq.UK&country_code=eq.GB&select=id,name,code,area,water_type,latitude,longitude`
  ) || [];

  // Filter to our 12 London spots, preserve order
  const londonSpots = LONDON_CODES
    .map(code => allUKSpots.find(s => s.code === code))
    .filter(Boolean);

  // Fetch latest temp for each spot
  const tempsMap = {};
  await Promise.all(londonSpots.map(async (spot) => {
    try {
      const logs = await dbGet(
        `temp_logs?spot_id=eq.${spot.id}&select=temp_c,created_at&order=created_at.desc&limit=1`
      );
      tempsMap[spot.id] = logs?.[0] || null;
    } catch (_) {}
  }));

  // JSON-LD
  const jsonLdBreadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'SwimLoading',    item: 'https://www.swimloading.com' },
      { '@type': 'ListItem', position: 2, name: 'United Kingdom', item: 'https://www.swimloading.com/spots/united-kingdom' },
      { '@type': 'ListItem', position: 3, name: 'Greater London', item: canonical },
    ],
  };

  const jsonLdItemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Open Water Swimming Spots in Greater London',
    url: canonical,
    itemListElement: londonSpots.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `https://www.swimloading.com/spots/${generateSlug(s.name)}`,
      name: s.name,
    })),
  };

  const jsonLdFaq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'What are the best open water swimming spots in Greater London?',
        acceptedAnswer: { '@type': 'Answer', text: 'Greater London has 12 tracked swimming venues on SwimLoading, including Tooting Bec Lido, the Hampstead Heath ponds, Brockwell Lido, Serpentine Lido, and West Reservoir. Each has different water temperatures, facilities, and access requirements.' },
      },
      {
        '@type': 'Question',
        name: 'What is the water temperature at London lidos and ponds?',
        acceptedAnswer: { '@type': 'Answer', text: 'Water temperatures at London swimming venues vary significantly by location and season. Unheated venues like the Hampstead ponds can be below 10°C in winter and reach 20°C+ in summer. Heated lidos like London Fields and Oasis maintain warmer temperatures year-round. Check individual spot pages on SwimLoading for the latest community-logged readings.' },
      },
      {
        '@type': 'Question',
        name: 'What is the difference between a lido and a pond in London?',
        acceptedAnswer: { '@type': 'Answer', text: 'A lido is an outdoor swimming pool — either heated or unheated, with a defined pool structure. London ponds, specifically the Hampstead Heath ponds, are natural freshwater bodies fed by springs and managed by the City of London. Ponds offer a more wild swimming experience; lidos are more structured venues with lifeguards and set hours.' },
      },
      {
        '@type': 'Question',
        name: 'Can I swim in London year-round?',
        acceptedAnswer: { '@type': 'Answer', text: 'Yes. Several London venues are open year-round, including Tooting Bec Lido, the Hampstead Heath ponds, and Parliament Hill Lido. Heated lidos like Hampton Pool and London Fields Lido are also open in winter. Water temperatures in winter can drop below 5°C at unheated venues.' },
      },
      {
        '@type': 'Question',
        name: 'How can I log my swim at a London venue on SwimLoading?',
        acceptedAnswer: { '@type': 'Answer', text: 'SwimLoading is free. Sign up at swimloading.com or download the app and log your swim, water temperature, and conditions at any London venue. Your data helps other swimmers plan their sessions.' },
      },
    ],
  };

  // ── Spot cards ──────────────────────────────────────────────────────────────

  const TYPE_LABEL = { POOL: 'Lido', LAKE: 'Pond', RESERVOIR: 'Reservoir', OCEAN: 'Open Water' };
  const TYPE_COLOR = { POOL: '#a78bfa', LAKE: '#34d399', RESERVOIR: '#38bdf8', OCEAN: '#38bdf8' };

  // Area groupings for display
  const AREA_GROUP = {
    'TOOTING_LIDO':           'South London',
    'BROCKWELL_LIDO':         'South London',
    'CHARLTON_LIDO':          'South East London',
    'HAMPTON_POOL':           'South West London',
    'LONDON_FIELDS_LIDO':     'East London',
    'WEST_RESERVOIR':         'North London',
    'PARLIAMENT_HILL_LIDO':   'North London',
    'HAMPSTEAD_MIXED_POND':   'North London',
    'HAMPSTEAD_LADIES_POND':  'North London',
    'HAMPSTEAD_MENS_POND':    'North London',
    'SERPENTINE_LIDO':        'Central London',
    'OASIS_SPORTS_CENTRE':    'Central London',
  };

  const spotCardsHtml = londonSpots.map(spot => {
    const slug      = generateSlug(spot.name);
    const typeLabel = TYPE_LABEL[spot.water_type] || spot.water_type;
    const typeColor = TYPE_COLOR[spot.water_type] || '#94a3b8';
    const tempData  = tempsMap[spot.id];
    const tempHtml  = tempData?.temp_c != null
      ? `<div class="spot-card-temp">${parseFloat(tempData.temp_c).toFixed(1)}°C <span>latest</span></div>
         <div class="spot-card-meta">Updated ${timeAgo(tempData.created_at)}</div>`
      : `<div class="spot-card-temp spot-card-temp-none">No logs yet</div>
         <div class="spot-card-meta">Be the first to log this spot</div>`;
    const areaGroup = AREA_GROUP[spot.code] || (spot.area || 'London');

    return `
      <a href="/spots/${escapeHtml(slug)}" class="spot-card"
         onclick="gtag('event','spot_card_click',{region:'greater-london',spot:'${escapeHtml(slug)}'})">
        <div class="spot-card-top">
          <span class="spot-card-name">${escapeHtml(spot.name)}</span>
          <span class="spot-card-type" style="color:${typeColor}">${typeLabel}</span>
        </div>
        <div style="font-size:11px;color:var(--subtle);margin-bottom:8px;">${escapeHtml(areaGroup)}</div>
        ${tempHtml}
        <div class="spot-card-cta">View conditions ›</div>
      </a>`;
  }).join('');

  // ── SEO editorial copy ──────────────────────────────────────────────────────

  const seoCopy = `
    <h2>Swimming Outdoors in London</h2>

    <p>London has one of the most active outdoor swimming communities in the world. Across the city, swimmers brave unheated lidos, natural ponds, and managed reservoirs year-round — from the coloured cubicles of <a href="/spots/tooting-bec-lido">Tooting Bec Lido</a> to the spring-fed ponds of Hampstead Heath. The city's outdoor swimming culture runs deep, shaped by decades of cold water tradition and a community that keeps going long after summer ends.</p>

    <p>SwimLoading tracks water temperatures and conditions at London's key swimming venues so you can check before you get in. Community members log their swims, report conditions, and help build a real-time picture of what the water is actually like — not just on a warm July afternoon, but in February too.</p>

    <h3 style="font-size:16px;font-weight:700;color:var(--text);margin:20px 0 10px;">Lidos, Ponds and Reservoirs — what's the difference?</h3>

    <p><strong style="color:var(--text)">Lidos</strong> are outdoor swimming pools, either heated or unheated. London's lidos range from the 91-metre unheated expanse of <a href="/spots/tooting-bec-lido">Tooting Bec Lido</a> to the rooftop heated pool at <a href="/spots/oasis-sports-centre">Oasis Sports Centre</a> in Covent Garden. Most are managed venues with lifeguards, changing facilities, and set opening hours.</p>

    <p><strong style="color:var(--text)">Ponds</strong> — specifically the Hampstead Heath ponds — are natural freshwater bodies fed by springs. The <a href="/spots/hampstead-mixed-pond">Mixed Pond</a>, <a href="/spots/hampstead-ladies-pond">Ladies' Pond</a>, and <a href="/spots/hampstead-mens-pond">Men's Pond</a> are all managed by the City of London and open year-round. They offer some of the most authentic wild swimming available anywhere in a major city. Water temperatures follow natural seasonal patterns with no heating.</p>

    <p><strong style="color:var(--text)">Reservoirs</strong> like <a href="/spots/west-reservoir">West Reservoir</a> in Stoke Newington are Victorian-era infrastructure repurposed for outdoor swimming. Managed sessions with trained safety staff make these accessible to swimmers who want open water without the unpredictability of river or sea swimming.</p>

    <h3 style="font-size:16px;font-weight:700;color:var(--text);margin:20px 0 10px;">Why water temperature matters</h3>

    <p>Water temperature is the single most important variable for outdoor swimming safety and enjoyment. A 15°C pond and a 19°C lido feel completely different — and both feel different again at 8°C in January. Cold water shock, swim performance, and how long you can safely stay in are all directly linked to water temperature, not air temperature.</p>

    <p>Air temperature and water temperature can diverge significantly, especially in spring when the air warms faster than the water. A sunny 20°C day in April can still mean 10°C water at the Hampstead ponds. Always check the water temperature before you swim — not the forecast.</p>

    <h3 style="font-size:16px;font-weight:700;color:var(--text);margin:20px 0 10px;">How SwimLoading helps London swimmers</h3>

    <p>SwimLoading is a community platform where swimmers log water temperatures, conditions, and swim sessions at outdoor swimming venues. Every time a swimmer records their swim at <a href="/spots/brockwell-lido">Brockwell Lido</a> or the <a href="/spots/serpentine-lido">Serpentine</a>, it adds to a growing dataset that helps the next swimmer decide whether to go.</p>

    <p>Across London, conditions vary dramatically between venues even on the same day — a heated lido might be at 28°C while a natural pond nearby sits at 12°C. SwimLoading lets you compare across locations, track seasonal trends, and find the conditions that suit your swim style. <a href="/join">Join SwimLoading free</a> to start logging your London swims.</p>`;

  // ── FAQ accordion ───────────────────────────────────────────────────────────

  const faqItems = jsonLdFaq.mainEntity.map(item => `
    <details style="border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:8px;">
      <summary style="padding:14px 16px;font-size:15px;font-weight:600;color:var(--text);cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:8px;">
        ${escapeHtml(item.name)}<span style="font-size:20px;color:var(--ocean-lt);flex-shrink:0;font-weight:400;">+</span>
      </summary>
      <div style="padding:0 16px 14px;font-size:14px;line-height:1.7;color:var(--muted);">${escapeHtml(item.acceptedAnswer.text)}</div>
    </details>`).join('');

  // ── Assemble body ───────────────────────────────────────────────────────────

  const body = `
    <div class="region-hero">
      <div class="container region-hero-inner">
        <div class="region-hero-text">
          <nav class="breadcrumb breadcrumb-inline" aria-label="Breadcrumb">
            <a href="/">SwimLoading</a> ›
            <a href="/spots/united-kingdom">United Kingdom</a> ›
            Greater London
          </nav>
          <h1>Open Water Swimming Spots in Greater London</h1>
          <p class="intro-text">Find London lidos, ponds, reservoirs and open water swimming venues with current conditions and water temperature tracking.</p>
          <a href="/join"
             class="btn-hero"
             onclick="gtag('event','regional_hub_join_click',{region:'greater-london'})">
            Join SwimLoading — it's free →
          </a>
        </div>
        <div class="region-hero-phones">
          <div class="phone-frame"><img src="/screenshots/temps.jpg" alt="Water temperatures" loading="lazy"></div>
          <div class="phone-frame phone-frame-back"><img src="/screenshots/dashboard.jpg" alt="SwimLoading dashboard" loading="lazy"></div>
        </div>
      </div>
    </div>

    <main class="container page-body">

      <section>
        <h2>Swimming Locations · Greater London</h2>
        <p class="spot-cards-hint">Tap any spot for current conditions and recent logs</p>
        <div class="spot-cards">${spotCardsHtml}</div>
      </section>

      <nav aria-label="Related regions" style="display:flex;flex-wrap:wrap;gap:8px;margin:32px 0;">
        <a href="/spots/tooting-bec-lido" style="padding:7px 14px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-weight:600;color:var(--muted);text-decoration:none;">Tooting Bec Lido</a>
        <a href="/spots/brockwell-lido"   style="padding:7px 14px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-weight:600;color:var(--muted);text-decoration:none;">Brockwell Lido</a>
        <a href="/spots/united-kingdom"   style="padding:7px 14px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-weight:600;color:var(--muted);text-decoration:none;">All UK Spots</a>
        <a href="/app"                    style="padding:7px 14px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-weight:600;color:var(--muted);text-decoration:none;">Open the App</a>
      </nav>

      <section class="seo-copy">
        ${seoCopy}
      </section>

      <section>
        <h2>Frequently Asked Questions</h2>
        ${faqItems}
      </section>

      <section class="cta-box">
        <p>Help build the UK swimming conditions map. Every swim you log at a London venue adds to the dataset.</p>
        <a href="/join"
           class="btn-cta"
           onclick="gtag('event','regional_hub_join_click',{region:'greater-london',source:'bottom_cta'})">
          Join SwimLoading — it's free →
        </a>
      </section>

    </main>`;

  return pageShell({
    title,
    description,
    canonical,
    jsonLd: [jsonLdBreadcrumb, jsonLdItemList, jsonLdFaq],
    body,
  });
}
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
