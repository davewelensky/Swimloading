// SSR handler for /english-channel/swim/:key
// Accepts either the slug ("matthew-webb-1875") or the unique_id ("187500001").
// Renders a full HTML page with schema.org SportsEvent + Person markup, OG tags,
// related swims (same pilot, same swimmer), and deep links back to the hub.

import { dbRpc, escapeHtml } from './seo-utils.js';

export default async function handler(req, res) {
  const path = (req.url || '').split('?')[0];
  const parts = path.split('/').filter(Boolean);
  // /english-channel/swim/<key>
  const key = parts[2] || '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  if (!key) return res.status(404).send(renderNotFound());

  try {
    const swims = await dbRpc('get_channel_swim', { p_key: key });
    const swim = swims?.[0];
    if (!swim) return res.status(404).send(renderNotFound(key));

    // Canonical URL — always the slug form
    const canonicalPath = `/english-channel/swim/${swim.slug || swim.unique_id}`;
    if (parts[2] !== swim.slug && swim.slug) {
      // Redirect numeric ID lookups to the slug
      res.writeHead(301, { Location: canonicalPath });
      return res.end();
    }

    const [pilotSwims, sameSwimmer] = await Promise.all([
      swim.pilot ? dbRpc('get_pilot_swims', { p_pilot: swim.pilot, p_exclude_id: swim.unique_id, p_limit: 6 }) : Promise.resolve([]),
      dbRpc('get_swimmer_crossings', { p_full_name: swim.full_name, p_exclude_id: swim.unique_id }),
    ]);

    const html = renderSwimPage(swim, pilotSwims || [], sameSwimmer || []);
    return res.status(200).send(html);
  } catch (err) {
    console.error('[channel-swim-handler]', err);
    return res.status(500).send(renderError());
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function fmtTime(secs) {
  if (secs === null || secs === undefined) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return s > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${h}h ${String(m).padStart(2,'0')}m`;
}

function dirLabel(d) {
  if (!d) return null;
  return d
    .replace('E-F', 'England → France')
    .replace('F-E', 'France → England')
    .replace(/ → ([EF])-([EF])/, ' → $1 → $2');
}

function nWaysLabel(n) {
  if (!n || n === 1) return 'Solo';
  return ['', 'Solo', 'Two-way', 'Three-way', 'Four-way'][n] || `${n}-way`;
}

// ─── PAGE RENDER ──────────────────────────────────────────────────────────────

function renderSwimPage(s, pilotSwims, sameSwimmer) {
  const timeStr = fmtTime(s.time_seconds);
  const dirStr = dirLabel(s.direction);
  const wayStr = nWaysLabel(s.n_ways);
  const dateStr = s.depart_date || s.year;

  const titleBits = [
    s.full_name,
    timeStr ? `— ${timeStr}` : null,
    `(${s.year})`,
  ].filter(Boolean);
  const pageTitle = `${titleBits.join(' ')} | English Channel Swim`;

  const recordTag = pickRecordTag(s);
  const metaDesc = buildMetaDescription(s, timeStr, dirStr, wayStr, recordTag);

  const canonicalUrl = `https://www.swimloading.com/english-channel/swim/${s.slug || s.unique_id}`;

  const jsonLd = buildSchemaOrg(s, timeStr, canonicalUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(pageTitle)}</title>
<meta name="description" content="${escapeHtml(metaDesc)}">
<link rel="canonical" href="${canonicalUrl}">
<meta property="og:title" content="${escapeHtml(pageTitle)}">
<meta property="og:description" content="${escapeHtml(metaDesc)}">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:type" content="article">
<meta name="theme-color" content="#0a1628">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap" rel="stylesheet">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
:root {
  --bg:#0a1628; --bg-card:#111c30; --ocean:#0ea5e9; --ocean-light:#38bdf8;
  --text:#f0f9ff; --text-sec:#94a3b8; --warm:#f59e0b; --green:#22c55e;
  --border:rgba(255,255,255,0.06);
}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',-apple-system,sans-serif;line-height:1.55;min-height:100vh;padding-bottom:60px;}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:9999;background:radial-gradient(500px circle at var(--mouse-x,-999px) var(--mouse-y,-999px),rgba(56,189,248,0.06),transparent 70%);}
.header{padding:14px 16px;border-bottom:1px solid var(--border);position:sticky;top:0;background:rgba(10,22,40,0.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:50;}
.header-inner{display:flex;align-items:center;gap:12px;max-width:680px;margin:0 auto;}
.brand{display:flex;align-items:center;gap:7px;text-decoration:none;font-size:17px;font-weight:800;letter-spacing:-0.5px;background:linear-gradient(135deg,#38bdf8 0%,#0ea5e9 50%,#0284c7 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
.brand img{height:22px;}
.crumb{margin-left:auto;font-size:12px;color:var(--text-sec);}
.crumb a{color:var(--ocean-light);text-decoration:none;}
.container{max-width:680px;margin:0 auto;padding:18px 16px;}
.hero{background:linear-gradient(135deg,rgba(14,165,233,0.12),rgba(14,165,233,0.02));border:1px solid rgba(14,165,233,0.3);border-radius:18px;padding:24px 22px;margin-bottom:18px;}
.hero-rec{display:inline-block;font-size:10px;font-weight:800;letter-spacing:0.15em;color:#fbbf24;background:rgba(251,191,36,0.10);border:1px solid rgba(251,191,36,0.30);padding:4px 10px;border-radius:6px;margin-bottom:14px;}
.hero-name{font-family:'Bebas Neue',sans-serif;font-size:46px;letter-spacing:1px;line-height:1;color:var(--text);}
.hero-meta{font-size:14px;color:var(--text-sec);margin-top:8px;}
.hero-time{font-family:'Bebas Neue',sans-serif;font-size:64px;letter-spacing:2px;color:var(--ocean-light);line-height:1;margin-top:20px;}
.hero-time-label{font-size:11px;color:var(--text-sec);letter-spacing:0.12em;text-transform:uppercase;margin-top:6px;}
.card{background:var(--bg-card);border-radius:14px;padding:18px;margin-bottom:14px;border:1px solid var(--border);}
.card-label{font-size:10px;font-weight:700;letter-spacing:0.16em;color:var(--text-sec);text-transform:uppercase;margin-bottom:14px;}
.fact{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px;}
.fact:last-child{border-bottom:none;}
.fact-key{color:var(--text-sec);width:130px;flex-shrink:0;}
.fact-val{color:var(--text);font-weight:600;flex:1;}
.fact-val a{color:var(--ocean-light);text-decoration:none;}
.fact-val a:hover{text-decoration:underline;}
.swim-row{display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid var(--border);text-decoration:none;color:inherit;}
.swim-row:last-child{border-bottom:none;}
.swim-row:hover{background:rgba(56,189,248,0.04);}
.swim-name{font-size:13px;font-weight:600;color:var(--text);}
.swim-name a{color:var(--ocean-light);text-decoration:none;}
.swim-meta{font-size:11px;color:var(--text-sec);margin-top:2px;}
.swim-time{font-size:14px;font-weight:700;color:var(--ocean-light);margin-left:auto;flex-shrink:0;}
.cta-row{display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;}
.cta-btn{display:inline-block;padding:10px 20px;border-radius:50px;background:var(--ocean-light);color:#080f1a;font-size:13px;font-weight:700;text-decoration:none;}
.cta-btn.ghost{background:rgba(14,165,233,0.10);border:1px solid rgba(14,165,233,0.4);color:var(--ocean-light);}
.tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:2px 7px;border-radius:5px;margin-right:4px;}
.tag-honour{background:rgba(245,158,11,0.12);color:var(--warm);border:1px solid rgba(245,158,11,0.30);}
.tag-multi{background:rgba(56,189,248,0.12);color:var(--ocean-light);border:1px solid rgba(56,189,248,0.30);}
.tag-dir{background:rgba(34,197,94,0.10);color:var(--green);border:1px solid rgba(34,197,94,0.25);}
.note{font-size:11px;color:var(--text-sec);margin-top:12px;line-height:1.5;}
.foot{text-align:center;padding:14px;font-size:11px;color:var(--text-sec);}
.foot a{color:var(--ocean-light);text-decoration:none;}
</style>
</head>
<body>
<header class="header">
  <div class="header-inner">
    <a class="brand" href="https://swimloading.com"><img src="/icons/logo-wave.png" alt="">SwimLoading</a>
    <div class="crumb"><a href="/crossings/english-channel">&larr; English Channel</a></div>
  </div>
</header>

<div class="container">

  <div class="hero">
    ${recordTag ? `<div class="hero-rec">${recordTag}</div>` : ''}
    <div class="hero-name">${escapeHtml(s.full_name)}</div>
    <div class="hero-meta">${escapeHtml(s.year + ' · ' + (s.nationality_when_swam || '—') + (s.age ? ' · age ' + Math.round(s.age) : ''))}</div>
    ${timeStr ? `<div class="hero-time">${timeStr}</div><div class="hero-time-label">Crossing time</div>` : ''}
    <div style="margin-top:16px;">
      ${(s.honours || '').includes('IMSHOF') ? `<span class="tag tag-honour">${escapeHtml(s.honours)}</span>` : (s.honours ? `<span class="tag tag-honour">${escapeHtml(s.honours)}</span>` : '')}
      ${s.n_ways > 1 ? `<span class="tag tag-multi">${escapeHtml(wayStr.toUpperCase())}</span>` : ''}
      ${s.direction ? `<span class="tag tag-dir">${escapeHtml(s.direction)}</span>` : ''}
    </div>
  </div>

  <div class="card">
    <div class="card-label">Swim details</div>
    <div class="fact"><div class="fact-key">Date</div><div class="fact-val">${escapeHtml(dateStr || s.year.toString())}</div></div>
    ${dirStr ? `<div class="fact"><div class="fact-key">Direction</div><div class="fact-val">${escapeHtml(dirStr)}</div></div>` : ''}
    <div class="fact"><div class="fact-key">Type</div><div class="fact-val">${escapeHtml(wayStr)} crossing${s.crossing_for_individual > 1 ? ' · crossing #' + s.crossing_for_individual + ' for ' + s.full_name : ''}</div></div>
    ${timeStr ? `<div class="fact"><div class="fact-key">Time</div><div class="fact-val">${timeStr}</div></div>` : ''}
    ${s.pilot ? `<div class="fact"><div class="fact-key">Pilot</div><div class="fact-val">${escapeHtml(s.pilot)}${s.boat ? ' on <em>' + escapeHtml(s.boat) + '</em>' : ''}</div></div>` : ''}
    ${s.observer ? `<div class="fact"><div class="fact-key">Observer</div><div class="fact-val">${escapeHtml(s.observer)}</div></div>` : ''}
    ${s.trainer ? `<div class="fact"><div class="fact-key">Trainer</div><div class="fact-val">${escapeHtml(s.trainer)}</div></div>` : ''}
    ${s.stroke ? `<div class="fact"><div class="fact-key">Stroke</div><div class="fact-val">${escapeHtml(s.stroke)}</div></div>` : ''}
    ${s.age ? `<div class="fact"><div class="fact-key">Age</div><div class="fact-val">${Math.round(s.age)}</div></div>` : ''}
    ${s.nationality_when_swam ? `<div class="fact"><div class="fact-key">Nationality</div><div class="fact-val">${escapeHtml(s.nationality_when_swam)}${s.county_state ? ' · ' + escapeHtml(s.county_state) : ''}</div></div>` : ''}
    ${s.ratifier ? `<div class="fact"><div class="fact-key">Ratified by</div><div class="fact-val">${escapeHtml(s.ratifier)}</div></div>` : ''}
    ${s.landed_at_cap_gris_nez && s.landed_at_cap_gris_nez !== 'n/a' ? `<div class="fact"><div class="fact-key">Landed at Cap Gris-Nez</div><div class="fact-val">${escapeHtml(s.landed_at_cap_gris_nez)}${s.landing_landmark ? ' · ' + escapeHtml(s.landing_landmark) : ''}</div></div>` : ''}
  </div>

  ${s.comments ? `<div class="card"><div class="card-label">Notes</div><div style="font-size:14px;color:var(--text);line-height:1.6;">${escapeHtml(s.comments)}</div>${s.website ? `<div style="margin-top:12px;font-size:12px;"><a href="${escapeHtml(s.website)}" target="_blank" rel="noopener" style="color:var(--ocean-light);">Read more &rarr;</a></div>` : ''}</div>` : ''}

  ${sameSwimmer && sameSwimmer.length ? `<div class="card">
    <div class="card-label">Other crossings by ${escapeHtml(s.full_name)}</div>
    ${sameSwimmer.map(o => `<a class="swim-row" href="/english-channel/swim/${o.slug || o.unique_id}">
      <div><div class="swim-name">${escapeHtml(o.year + (o.n_ways > 1 ? ' · ' + nWaysLabel(o.n_ways) : '') + (o.direction ? ' · ' + o.direction : '') + (o.pilot ? ' · pilot ' + o.pilot : ''))}</div></div>
      <div class="swim-time">${fmtTime(o.time_seconds) || '—'}</div>
    </a>`).join('')}
    <div class="note">${escapeHtml(s.full_name)} has ${sameSwimmer.length + 1} ratified crossing${sameSwimmer.length === 0 ? '' : 's'} in the database.</div>
  </div>` : ''}

  ${pilotSwims && pilotSwims.length ? `<div class="card">
    <div class="card-label">Pilot ${escapeHtml(s.pilot)} — other fast crossings</div>
    ${pilotSwims.map(o => `<a class="swim-row" href="/english-channel/swim/${o.slug || o.unique_id}">
      <div><div class="swim-name">${escapeHtml(o.full_name)}</div><div class="swim-meta">${o.year}${o.n_ways > 1 ? ' · ' + nWaysLabel(o.n_ways) : ''}${o.direction ? ' · ' + o.direction : ''}</div></div>
      <div class="swim-time">${fmtTime(o.time_seconds) || '—'}</div>
    </a>`).join('')}
    <div class="note"><a href="/crossings/english-channel#pilots" style="color:var(--ocean-light);">See full pilot leaderboard &rarr;</a></div>
  </div>` : ''}

  <div class="card" style="text-align:center;">
    <div class="card-label">More from SwimLoading</div>
    <div style="font-size:13px;color:var(--text-sec);line-height:1.6;margin-bottom:16px;">Browse 3,443 ratified English Channel solo swims, real-time conditions, and the pilot leaderboard.</div>
    <div class="cta-row" style="justify-content:center;">
      <a href="/crossings/english-channel" class="cta-btn">Open Channel intelligence</a>
      <a href="/app" class="cta-btn ghost">SwimLoading app</a>
    </div>
  </div>

  <div class="foot">
    Source: public Channel solo swim database (CSA + CS&PF + historical) · <a href="https://db.marathonswimmers.org" target="_blank" rel="noopener">LongSwims</a> · <a href="/english-channel/data-sources">Data sources &amp; attribution</a>
    <div style="margin-top:8px;font-size:11px;">
      <a href="mailto:hello@swimloading.com?subject=Channel%20swim%20-%20${encodeURIComponent(s.full_name + ' (' + s.year + ')')}&amp;body=Reference%3A%20${encodeURIComponent('https://www.swimloading.com/english-channel/swim/' + (s.slug || s.unique_id))}%0A%0AI%20would%20like%20to%3A%20%5Breport%20an%20inaccuracy%20%2F%20request%20removal%20%2F%20add%20information%5D%0A%0ADetails%3A">
        Report an inaccuracy or request removal &rarr;
      </a>
    </div>
    <div style="margin-top:6px;"><a href="/crossings/english-channel">&larr; English Channel hub</a></div>
  </div>

</div>

<script>
document.addEventListener('mousemove', e => {
  document.body.style.setProperty('--mouse-x', e.clientX + 'px');
  document.body.style.setProperty('--mouse-y', e.clientY + 'px');
});
</script>
</body>
</html>`;
}

// ─── METADATA HELPERS ─────────────────────────────────────────────────────────

function pickRecordTag(s) {
  if (s.rec_all_individual)   return 'World record · solo crossing';
  if (s.rec_male_individual)  return "Men's world record · solo crossing";
  if (s.rec_female_individual) return "Women's world record · solo crossing";
  if (s.rec_all_ef)           return 'World record · England → France';
  if (s.rec_male_ef)          return "Men's record · England → France";
  if (s.rec_female_ef)        return "Women's record · England → France";
  if (s.rec_all_fe)           return 'World record · France → England';
  if (s.rec_male_fe)          return "Men's record · France → England";
  if (s.rec_female_fe)        return "Women's record · France → England";
  if (s.rec_all_2way)         return 'World record · two-way';
  if (s.rec_male_2way)        return "Men's record · two-way";
  if (s.rec_female_2way)      return "Women's record · two-way";
  if (s.rec_all_3way)         return 'World record · three-way';
  if (s.rec_male_3way)        return "Men's record · three-way";
  if (s.rec_female_3way)      return "Women's record · three-way";
  if (s.rec_all_4way)         return 'World record · four-way';
  if (s.rec_longest)          return 'Longest ratified crossing';
  return null;
}

function buildMetaDescription(s, timeStr, dirStr, wayStr, recordTag) {
  const parts = [
    `${s.full_name} swam the English Channel in ${s.year}`,
    timeStr ? `crossing in ${timeStr}` : null,
    dirStr ? `(${dirStr})` : null,
    s.pilot ? `piloted by ${s.pilot}${s.boat ? ' on ' + s.boat : ''}` : null,
    recordTag ? recordTag : null,
  ].filter(Boolean);
  return parts.join(', ') + '.';
}

function buildSchemaOrg(s, timeStr, canonicalUrl) {
  const event = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: `${s.full_name} — English Channel swim (${s.year})`,
    description: timeStr ? `Ratified solo crossing of the English Channel in ${timeStr}.` : 'Ratified solo crossing of the English Channel.',
    sport: 'Open water swimming',
    startDate: s.depart_date && /^\d{4}/.test(s.depart_date) ? s.depart_date.slice(0,10) : `${s.year}-01-01`,
    location: {
      '@type': 'Place',
      name: s.direction === 'F-E' ? 'Cap Gris-Nez, France → Dover, England' : 'Shakespeare Beach, Dover, England → Cap Gris-Nez, France',
      geo: { '@type': 'GeoCoordinates', latitude: 51.1172, longitude: 1.3271 },
    },
    competitor: {
      '@type': 'Person',
      name: s.full_name,
      nationality: s.nationality_when_swam || undefined,
    },
    url: canonicalUrl,
  };
  if (s.ratifier) {
    event.organizer = { '@type': 'Organization', name: s.ratifier };
  }
  return event;
}

// ─── ERROR / 404 ──────────────────────────────────────────────────────────────

function renderNotFound(key) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Swim not found | SwimLoading</title>
<meta name="robots" content="noindex">
<style>body{background:#0a1628;color:#f0f9ff;font-family:-apple-system,sans-serif;text-align:center;padding:60px 20px;}h1{font-size:24px;margin-bottom:12px;}p{color:#94a3b8;}a{color:#38bdf8;}</style>
</head><body>
<h1>Swim not found</h1>
<p>${key ? '"' + escapeHtml(key) + '" is not a ratified English Channel solo crossing we have on file.' : 'No swim was specified.'}</p>
<p style="margin-top:20px;"><a href="/crossings/english-channel">&larr; Back to the English Channel hub</a></p>
</body></html>`;
}

function renderError() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error</title></head><body style="background:#0a1628;color:#f0f9ff;font-family:sans-serif;padding:40px;text-align:center;"><h1>Something went wrong</h1><p><a href="/crossings/english-channel" style="color:#38bdf8;">Back to the Channel hub</a></p></body></html>`;
}
