// SSR handler for /events/[slug] — the public page for one event edition.
//
// Server-rendered, following api/spots-handler.js: the content must be in
// the HTML for a crawler and for a swimmer on a bad connection, not
// assembled by JavaScript after three round trips. Reads with the anon key
// through seo-utils' dbGet/dbRpc, so RLS decides what is public — same
// boundary as /api/explore/events.
//
// The page never requires a login. Save is progressive: the button is
// rendered server-side and wired by the small script at the bottom, so a
// visitor with no session still sees a complete, useful page.

import { dbGet, dbRpc, escapeHtml } from './seo-utils.js';

const SITE = 'https://www.swimloading.com';

// ── Small helpers ─────────────────────────────────────────────────────────

const MONTHS_LONG = ['January','February','March','April','May','June','July',
                     'August','September','October','November','December'];
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function fmtLongDate(iso, precision, confirmed) {
  if (!iso) return { text: 'Date to be confirmed', provisional: true };
  const d = new Date(`${iso}T00:00:00Z`);
  const month = MONTHS_LONG[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  // A month-precision or unconfirmed date must never be printed as though
  // it were a day someone can book flights around.
  if (precision === 'month' || !confirmed) {
    return { text: `${month} ${year}`, provisional: true };
  }
  return { text: `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${month} ${year}`, provisional: false };
}

// ISO 8601 week, matching what scripts/copernicus-climatology.py stores.
function isoWeek(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((target - firstThursday) / (7 * 24 * 3600 * 1000));
}

const fmtDistance = (m) =>
  m == null ? null : m >= 1000 ? `${+(m / 1000).toFixed(2)} km` : `${m} m`;

// URLs came off third-party pages via a crawler. Anything that is not plain
// http(s) is dropped rather than rendered — a javascript: or data: URL in an
// href is stored XSS, and the crawler is not a trusted author.
function safeUrl(u) {
  if (!u) return null;
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.toString() : null;
  } catch { return null; }
}

// ── Trust vocabulary ──────────────────────────────────────────────────────
// One place, so the label on the card, the label here and the label in the
// structured data cannot drift apart. The raw confidence_score is
// deliberately never shown — the brief forbids the internal number as the
// public label, and verification_tier is its public form.
function trustLabel(ev) {
  if (ev.officially_claimed) {
    return { label: 'Confirmed by the organiser', tone: 'green', icon: 'badge-check',
      detail: 'The organiser has claimed this listing and confirmed its details.' };
  }
  switch (ev.verification_tier) {
    case 'confirmed': return { label: 'Verified from the official event page', tone: 'green', icon: 'shield-check',
      detail: "Read from the organiser's own page, with an exact date and an entry link." };
    case 'listed': return { label: 'Listed from a reliable source', tone: 'cyan', icon: 'circle-check',
      detail: 'The date and source look solid, but some details are missing. Confirm before you travel.' };
    default: return { label: 'Details not recently verified', tone: 'amber', icon: 'alert-triangle',
      detail: 'We found this swim but could not verify much about it. Check with the organiser before making plans.' };
  }
}

// How stale is too stale. One constant, not a number scattered through the
// file — the brief asks for a configurable expiry window.
const VERIFICATION_EXPIRY_DAYS = 90;
function isStale(lastVerifiedAt) {
  if (!lastVerifiedAt) return true;
  return (Date.now() - new Date(lastVerifiedAt).getTime()) / 86400000 > VERIFICATION_EXPIRY_DAYS;
}

// ── Data ──────────────────────────────────────────────────────────────────

async function loadEvent(slug) {
  const rows = await dbGet(
    `event_editions?slug=eq.${encodeURIComponent(slug)}&limit=1&select=` +
    'id,slug,title,short_description,description,start_date,end_date,date_precision,' +
    'date_confirmed,status,registration_status,registration_url,official_url,timezone,' +
    'last_verified_at,edition_year,participant_estimate,verification_tier,discipline,' +
    'officially_claimed,is_indexable,entry_opens_on,entry_closes_on,' +
    'event_series(id,display_name,prominence,event_type,description,official_url,organiser_id),' +
    'event_venues(id,display_name,location_text,city,region,country_code,latitude,longitude,water_body_type,spot_id),' +
    'event_distances(id,original_label,distance_metres,category,start_time,wetsuit_policy,qualification_required,registration_url)'
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function loadContext(ev) {
  const venue = ev.event_venues;
  const series = ev.event_series;

  const [organiser, climatology, current, nearby, history] = await Promise.all([
    series?.organiser_id
      // public_organisers, never event_organisers — the latter carries
      // email and phone and has no public policy at all.
      ? dbGet(`public_organisers?id=eq.${series.organiser_id}&select=display_name,official_url&limit=1`)
      : Promise.resolve(null),
    venue?.id && ev.start_date
      ? dbGet(`venue_water_climatology?venue_id=eq.${venue.id}&week_of_year=eq.${isoWeek(ev.start_date)}&limit=1` +
              '&select=mean_c,min_c,max_c,p10_c,p90_c,years_observed,baseline_start_year,baseline_end_year')
      : Promise.resolve(null),
    venue?.id
      ? dbGet(`venue_temp_estimate?venue_id=eq.${venue.id}&limit=1&select=best_c,best_source,confidence`)
      : Promise.resolve(null),
    venue?.latitude != null
      ? dbRpc('search_events_v2', {
          p_lat: venue.latitude, p_lng: venue.longitude, p_radius_km: 250,
          p_sort: 'date', p_page: 1, p_page_size: 7 })
      : Promise.resolve(null),
    dbGet(`event_change_history?edition_id=eq.${ev.id}&order=changed_at.desc&limit=5`),
  ]);

  return {
    organiser: Array.isArray(organiser) && organiser.length ? organiser[0] : null,
    climatology: Array.isArray(climatology) && climatology.length ? climatology[0] : null,
    current: Array.isArray(current) && current.length ? current[0] : null,
    nearby: (Array.isArray(nearby) ? nearby : []).filter((n) => n.edition_id !== ev.id).slice(0, 5),
    history: Array.isArray(history) ? history : [],
  };
}

// ── Structured data ───────────────────────────────────────────────────────
// Emitted ONLY when the facts justify it. The brief is explicit: do not
// publish misleading structured data for provisional or incomplete events.
// A rich result promising a date we are not sure of is worse than no rich
// result, because Google will show it long after we have corrected it.
function schemaOrg(ev, ctx) {
  if (!ev.date_confirmed || !ev.start_date || ev.date_precision === 'month') return '';
  const venue = ev.event_venues;
  if (!venue || !venue.display_name) return '';

  const statusMap = {
    cancelled: 'https://schema.org/EventCancelled',
    postponed: 'https://schema.org/EventPostponed',
    announced: 'https://schema.org/EventScheduled',
    completed: 'https://schema.org/EventScheduled',
  };

  const data = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: ev.title,
    startDate: ev.start_date,
    eventStatus: statusMap[ev.status] || 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    url: `${SITE}/events/${ev.slug}`,
    location: {
      '@type': 'Place',
      name: venue.display_name,
      address: {
        '@type': 'PostalAddress',
        addressLocality: venue.city || undefined,
        addressRegion: venue.region || undefined,
        addressCountry: venue.country_code || undefined,
      },
      ...(venue.latitude != null && venue.longitude != null
        ? { geo: { '@type': 'GeoCoordinates', latitude: venue.latitude, longitude: venue.longitude } }
        : {}),
    },
  };

  if (ev.end_date && ev.end_date !== ev.start_date) data.endDate = ev.end_date;
  if (ev.description || ev.short_description) data.description = ev.short_description || ev.description;
  if (ctx.organiser?.display_name) {
    data.organizer = { '@type': 'Organization', name: ctx.organiser.display_name,
                       ...(safeUrl(ctx.organiser.official_url) ? { url: safeUrl(ctx.organiser.official_url) } : {}) };
  }
  // offers only where there is a real registration URL AND entries are
  // actually open — an offer element on a closed event is a lie Google
  // will happily repeat.
  const reg = safeUrl(ev.registration_url);
  if (reg && ev.registration_status === 'open') {
    data.offers = { '@type': 'Offer', url: reg, availability: 'https://schema.org/InStock' };
  }

  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

// ── Render ────────────────────────────────────────────────────────────────

function head(ev, ctx) {
  const venue = ev.event_venues;
  const place = [venue?.city, venue?.region, venue?.country_code].filter(Boolean).join(', ');
  const d = fmtLongDate(ev.start_date, ev.date_precision, ev.date_confirmed);
  const title = `${ev.title}${place ? ` — ${place}` : ''} | SwimLoading`;
  const desc = ev.short_description
    || `${ev.title}${place ? ` in ${place}` : ''}, ${d.text}.` +
       `${ev.event_distances?.length ? ` Distances: ${ev.event_distances.map(x=>x.original_label).filter(Boolean).slice(0,4).join(', ')}.` : ''}` +
       ' Open water swim details, conditions and entry information.';

  // is_indexable is granted by rule and excludes AI-read candidates — see
  // sql/applied/2026-08-05_explore-phase1-foundation.sql. An event we have
  // not verified well enough must not be handed to a search engine, where a
  // wrong listing outlives its correction.
  //
  // The date check is NOT redundant. is_indexable is a stored snapshot taken
  // when the row was assessed; nothing clears it as time passes, so every
  // indexable event silently becomes a past event that still claims
  // index,follow. Without this, within weeks Google is indexing swims that
  // already happened. Evaluated here because this is where the current date
  // is known — the column says "good enough to index", the handler adds
  // "and it has not happened yet".
  const past = ev.end_date
    ? ev.end_date < new Date().toISOString().slice(0, 10)
    : ev.start_date && ev.start_date < new Date().toISOString().slice(0, 10);
  const dead = ev.status === 'cancelled' || ev.status === 'postponed';
  const robots = ev.is_indexable && !past && !dead ? 'index,follow' : 'noindex,nofollow';

  return `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc.slice(0, 300))}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${SITE}/events/${escapeHtml(ev.slug)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(ev.title)}">
<meta property="og:description" content="${escapeHtml(desc.slice(0, 300))}">
<meta property="og:url" content="${SITE}/events/${escapeHtml(ev.slug)}">
<meta property="og:site_name" content="SwimLoading">
<meta property="og:image" content="${SITE}/icons/logo.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap" rel="stylesheet">
${schemaOrg(ev, ctx)}`;
}

const STYLES = `
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#080f1a;--card:#0d1728;--cyan:#38bdf8;--text:#f1f5f9;--sec:#64748b;
      --border:rgba(255,255,255,.07);--amber:#f59e0b;--green:#10b981;--danger:#ef4444}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;
     -webkit-font-smoothing:antialiased;line-height:1.6;overflow-x:hidden}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:9999;
  background:radial-gradient(18px circle at var(--mouse-x,-999px) var(--mouse-y,-999px),rgba(56,189,248,.55),transparent 100%),
             radial-gradient(500px circle at var(--mouse-x,-999px) var(--mouse-y,-999px),rgba(56,189,248,.07),transparent 70%)}
a{color:var(--cyan)}
:focus-visible{outline:2px solid var(--cyan);outline-offset:2px;border-radius:4px}
nav{position:sticky;top:0;z-index:60;display:flex;align-items:center;justify-content:space-between;
    padding:14px 22px;background:rgba(8,15,26,.82);backdrop-filter:blur(14px);border-bottom:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:7px;text-decoration:none;font-size:20px;font-weight:800;
       letter-spacing:-.5px;background:linear-gradient(135deg,#38bdf8 0%,#0ea5e9 50%,#0284c7 100%);
       -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.brand img{height:22px}
nav .cta{text-decoration:none;background:var(--cyan);color:#080f1a;padding:9px 20px;border-radius:50px;font-weight:700;font-size:13px}
.wrap{max-width:900px;margin:0 auto;padding:0 22px 90px}
.crumb{padding:22px 0 0;font-size:13px;color:var(--sec)}
.crumb a{text-decoration:none}
header.ev{padding:26px 0 8px}
h1{font-family:'Bebas Neue',sans-serif;font-size:clamp(34px,6vw,62px);line-height:1.02;letter-spacing:.5px;margin-bottom:12px}
.sub{color:#94a3b8;font-size:16px;margin-bottom:16px}
.badges{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px;align-items:center}
.badge{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;
       padding:4px 11px;border-radius:50px;font-weight:700}
.b-green{background:rgba(16,185,129,.15);color:var(--green)}
.b-cyan{background:rgba(56,189,248,.15);color:var(--cyan)}
.b-amber{background:rgba(245,158,11,.15);color:var(--amber)}
.b-red{background:rgba(239,68,68,.18);color:var(--danger)}
.b-grey{background:rgba(100,116,139,.22);color:#cbd5e1}
.keyline{display:flex;gap:26px;flex-wrap:wrap;margin:22px 0 6px;padding:18px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.keyline div{display:flex;flex-direction:column}
.keyline b{font-family:'Bebas Neue',sans-serif;font-size:26px;line-height:1.1;letter-spacing:.5px}
.keyline b.prov{color:var(--amber)}
.keyline span{font-size:10.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--sec);margin-top:3px}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border-radius:50px;padding:12px 24px;
     font-size:14px;font-weight:700;cursor:pointer;text-decoration:none;border:1px solid var(--border);
     background:transparent;color:#cbd5e1;font-family:inherit}
.btn:hover{border-color:rgba(56,189,248,.5);color:#fff}
.btn-primary{background:var(--cyan);color:#080f1a;border-color:var(--cyan)}
.btn-saved{background:rgba(16,185,129,.15);border-color:rgba(16,185,129,.5);color:var(--green)}
section{margin:34px 0}
h2{font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1.1px;color:var(--cyan);margin-bottom:14px;
   display:flex;align-items:center;gap:12px}
h2::after{content:'';flex:1;height:1px;background:var(--border)}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px 20px}
.card + .card{margin-top:10px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--border)}
th{font-size:10.5px;letter-spacing:1.2px;text-transform:uppercase;color:var(--sec);font-weight:600}
tr:last-child td{border-bottom:none}
.tablewrap{overflow-x:auto}
dl{display:grid;grid-template-columns:auto 1fr;gap:9px 20px;font-size:14.5px}
dt{color:var(--sec)}
.prov-note{font-size:12.5px;color:var(--sec);margin-top:12px;display:flex;gap:8px;align-items:flex-start}
.warn{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.28);border-radius:12px;padding:14px 16px;
      font-size:13.5px;color:#fbbf24;margin-bottom:14px}
.danger{background:rgba(239,68,68,.09);border:1px solid rgba(239,68,68,.32);border-radius:12px;padding:14px 16px;
        font-size:14px;color:#fca5a5;margin-bottom:16px;font-weight:600}
.srcnote{font-size:12px;color:var(--sec);margin-top:10px}
ul.plain{list-style:none}
ul.plain li{padding:9px 0;border-bottom:1px solid var(--border);font-size:14.5px}
ul.plain li:last-child{border-bottom:none}
ul.plain a{text-decoration:none;font-weight:600}
.muted{color:var(--sec);font-size:13px}
footer{border-top:1px solid var(--border);padding:26px 0;margin-top:44px;font-size:13px;color:var(--sec)}
@media (max-width:640px){.keyline{gap:18px}dl{grid-template-columns:1fr;gap:2px 0}dt{margin-top:8px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

function renderEventPage(ev, ctx) {
  const venue = ev.event_venues;
  const series = ev.event_series;
  const d = fmtLongDate(ev.start_date, ev.date_precision, ev.date_confirmed);
  const trust = trustLabel(ev);
  const stale = isStale(ev.last_verified_at);
  const place = [venue?.city, venue?.region, venue?.country_code].filter(Boolean).join(', ');
  const officialUrl = safeUrl(ev.official_url) || safeUrl(series?.official_url);
  const regUrl = safeUrl(ev.registration_url);
  const distances = (ev.event_distances || [])
    .slice().sort((a, b) => (a.distance_metres ?? 1e9) - (b.distance_metres ?? 1e9));

  // Cancellation and postponement override every promotional element on the
  // page. This block is rendered first and the entry button is suppressed
  // below — a swimmer must not be able to skim this page and enter a race
  // that is not happening.
  const dead = ev.status === 'cancelled' || ev.status === 'postponed';

  return `<!DOCTYPE html>
<html lang="en">
<head>${head(ev, ctx)}<style>${STYLES}</style></head>
<body>
<nav>
  <a class="brand" href="/"><img src="/icons/logo-wave.png" alt=""><span>SwimLoading</span></a>
  <a class="cta" href="/app">Open the app</a>
</nav>
<div class="wrap">
  <nav class="crumb" aria-label="Breadcrumb">
    <a href="/explore">Where to swim</a> ›
    ${venue?.country_code ? `<a href="/explore?country=${escapeHtml(venue.country_code)}">${escapeHtml(venue.country_code)}</a> › ` : ''}
    <span>${escapeHtml(ev.title)}</span>
  </nav>

  <header class="ev">
    ${dead ? `<div class="danger">This swim is ${escapeHtml(ev.status)}. Do not make travel or entry plans from this page — check with the organiser.</div>` : ''}
    <div class="badges">
      ${ev.status === 'cancelled' ? '<span class="badge b-red">Cancelled</span>' : ''}
      ${ev.status === 'postponed' ? '<span class="badge b-amber">Postponed</span>' : ''}
      ${ev.registration_status === 'sold_out' ? '<span class="badge b-grey">Sold out</span>' : ''}
      ${ev.registration_status === 'open' && !dead ? '<span class="badge b-green">Entries open</span>' : ''}
      ${ev.registration_status === 'closed' ? '<span class="badge b-grey">Entries closed</span>' : ''}
      ${series?.prominence && series.prominence !== 'unknown' ? `<span class="badge b-cyan">${escapeHtml(series.prominence)}</span>` : ''}
      <span class="badge b-${trust.tone}">${escapeHtml(trust.label)}</span>
      ${ev.discipline === 'multisport_swim_leg' ? '<span class="badge b-grey">Triathlon swim leg</span>' : ''}
    </div>
    <h1>${escapeHtml(ev.title)}</h1>
    <p class="sub">${escapeHtml(place || venue?.location_text || 'Location to be confirmed')}${
      ctx.organiser?.display_name ? ` · organised by ${escapeHtml(ctx.organiser.display_name)}` : ''}</p>

    <div class="keyline">
      <div><b class="${d.provisional ? 'prov' : ''}">${escapeHtml(d.text)}</b>
        <span>${d.provisional ? 'Provisional date' : 'Date'}</span></div>
      ${distances.length ? `<div><b>${escapeHtml(distances.map(x => fmtDistance(x.distance_metres)).filter(Boolean).join(' · ') || '—')}</b><span>Distances</span></div>` : ''}
      ${venue?.water_body_type ? `<div><b>${escapeHtml(venue.water_body_type)}</b><span>Water</span></div>` : ''}
      ${ev.participant_estimate ? `<div><b>~${Number(ev.participant_estimate).toLocaleString()}</b><span>Swimmers</span></div>` : ''}
    </div>

    <div class="actions">
      <button type="button" class="btn" id="saveBtn" data-id="${escapeHtml(ev.id)}" aria-pressed="false">Save this swim</button>
      ${regUrl && !dead ? `<a class="btn btn-primary" href="${escapeHtml(regUrl)}" target="_blank" rel="noopener noreferrer nofollow" id="regBtn">Enter this swim</a>` : ''}
      ${officialUrl ? `<a class="btn" href="${escapeHtml(officialUrl)}" target="_blank" rel="noopener noreferrer nofollow" id="offBtn">Official event page</a>` : ''}
    </div>
  </header>

  ${ev.description || ev.short_description || series?.description ? `<section>
    <h2>About this swim</h2>
    <div class="card"><p>${escapeHtml(ev.description || ev.short_description || series.description)}</p></div>
  </section>` : ''}

  <section>
    <h2>How we know this</h2>
    ${stale ? `<div class="warn">We last checked this listing ${ev.last_verified_at
        ? `on ${escapeHtml(String(ev.last_verified_at).slice(0,10))}` : 'a while ago'} — more than
        ${VERIFICATION_EXPIRY_DAYS} days. Details may have changed since.</div>` : ''}
    <div class="card">
      <dl>
        <dt>Verification</dt><dd>${escapeHtml(trust.label)} — ${escapeHtml(trust.detail)}</dd>
        <dt>Last checked</dt><dd>${ev.last_verified_at ? escapeHtml(String(ev.last_verified_at).slice(0,10)) : 'Not recorded'}</dd>
        ${officialUrl ? `<dt>Official source</dt><dd><a href="${escapeHtml(officialUrl)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(new URL(officialUrl).hostname)}</a></dd>` : ''}
        ${ctx.organiser?.display_name ? `<dt>Organiser</dt><dd>${escapeHtml(ctx.organiser.display_name)}</dd>` : ''}
      </dl>
      <p class="prov-note">SwimLoading gathers event listings automatically from public sources.
         A listing here is not a booking and not a guarantee — <b>always confirm the date, the entry
         status and the conditions with the organiser before you travel.</b></p>
    </div>
    ${ctx.history.length ? `<div class="card">
      <p class="muted" style="margin-bottom:8px">What has changed since we first listed it</p>
      <ul class="plain">${ctx.history.map(h => `<li>${escapeHtml(String(h.changed_at).slice(0,10))} —
        ${escapeHtml(String(h.change_type).replace(/_/g,' '))}${h.old_value && h.new_value
          ? `: ${escapeHtml(h.old_value)} → ${escapeHtml(h.new_value)}` : ''}</li>`).join('')}</ul>
    </div>` : ''}
  </section>

  ${distances.length ? `<section>
    <h2>Distances</h2>
    <div class="card tablewrap">
      <table>
        <thead><tr><th>Distance</th><th>Name</th><th>Start</th><th>Wetsuit</th><th>Qualifier</th></tr></thead>
        <tbody>${distances.map(x => `<tr>
          <td><b>${escapeHtml(fmtDistance(x.distance_metres) || '—')}</b></td>
          <td>${escapeHtml(x.original_label || '—')}</td>
          <td>${x.start_time ? escapeHtml(String(x.start_time).slice(0,5)) : '—'}</td>
          <td>${x.wetsuit_policy && x.wetsuit_policy !== 'unknown' ? escapeHtml(x.wetsuit_policy) : '—'}</td>
          <td>${x.qualification_required === true ? 'Required' : x.qualification_required === false ? 'No' : '—'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </section>` : ''}

  <section>
    <h2>Water and conditions</h2>
    ${renderConditions(ev, ctx, venue)}
  </section>

  ${ctx.nearby.length ? `<section>
    <h2>Other swims nearby</h2>
    <div class="card"><ul class="plain">${ctx.nearby.map(n => `<li>
      <a href="/events/${escapeHtml(n.slug)}">${escapeHtml(n.title || n.series_name)}</a>
      <span class="muted"> — ${escapeHtml(String(n.start_date || 'date TBC'))}${
        n.distance_km != null ? `, ${Math.round(n.distance_km)} km away` : ''}</span></li>`).join('')}</ul>
    </div>
  </section>` : ''}

  <section>
    <h2>Is this your event?</h2>
    <div class="card">
      <p>If you organise this swim, you can claim the listing — correct the details, confirm the date,
         and it will show as confirmed by the organiser.</p>
      <div class="actions" style="margin-bottom:0">
        <a class="btn" href="/app?intent=claim_event&event=${escapeHtml(ev.slug)}" id="claimBtn">Claim this event</a>
      </div>
    </div>
  </section>

  <footer>
    <p>Listed by <a href="/explore">SwimLoading</a> — open water swims worldwide.
       Details gathered from public sources and not guaranteed. Confirm with the organiser before travelling.</p>
  </footer>
</div>
<script>
document.addEventListener('mousemove',e=>{
  document.body.style.setProperty('--mouse-x',e.clientX+'px');
  document.body.style.setProperty('--mouse-y',e.clientY+'px');
});
(function(){
  var SB_URL='https://szgkzuswelntnevobnoh.supabase.co';
  var KEY='${'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA'}';
  var ID='${ev.id}';
  function track(name, props){
    try{ fetch(SB_URL+'/rest/v1/analytics_events',{method:'POST',keepalive:true,
      headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json','Prefer':'return=minimal'},
      body:JSON.stringify({event_name:name,user_id:null,properties:props||null})}).catch(function(){}); }catch(e){}
  }
  track('event_detail_view',{event_id:ID});
  var reg=document.getElementById('regBtn');
  if(reg) reg.addEventListener('click',function(){ track('event_registration_click',{event_id:ID}); });
  var off=document.getElementById('offBtn');
  if(off) off.addEventListener('click',function(){ track('event_official_link_click',{event_id:ID}); });
  var claim=document.getElementById('claimBtn');
  if(claim) claim.addEventListener('click',function(){ track('organiser_claim_started',{event_id:ID}); });
  var save=document.getElementById('saveBtn');
  if(save) save.addEventListener('click',function(){
    // Saving needs a session, which this static page does not have. Hold the
    // intent and hand off to the app, which resumes it — the same mechanism
    // /explore uses, so a swimmer never returns from signing in wondering
    // which swim they were saving.
    try{ sessionStorage.setItem('swimloading_pending_save',
      JSON.stringify({id:ID,name:document.title,back:location.href})); }catch(e){}
    track('event_save_click',{event_id:ID});
    location.href='/app?intent=save_event&event='+encodeURIComponent('${ev.slug}');
  });
})();
</script>
</body>
</html>`;
}

// Conditions, with the three provenances kept visibly separate. Mixing a
// 20-year Copernicus climatology, today's model reading and a swimmer's
// thermometer into one number would be the single most misleading thing
// this page could do.
function renderConditions(ev, ctx, venue) {
  const parts = [];

  if (ctx.climatology) {
    const c = ctx.climatology;
    parts.push(`<div class="card">
      <dl>
        <dt>Typical for this week</dt>
        <dd><b>${escapeHtml(String(Math.round(c.mean_c * 10) / 10))}°C</b>
            ${c.p10_c != null && c.p90_c != null
              ? ` (usually ${escapeHtml(String(Math.round(c.p10_c*10)/10))}–${escapeHtml(String(Math.round(c.p90_c*10)/10))}°C)` : ''}</dd>
      </dl>
      <p class="srcnote">SwimLoading estimate, not the organiser's figure. Copernicus Marine satellite
        reanalysis for this venue's week of the year, averaged over ${escapeHtml(String(c.years_observed))} years
        (${escapeHtml(String(c.baseline_start_year))}–${escapeHtml(String(c.baseline_end_year))}).
        It describes what the water usually does, not what it will do on the day.</p>
    </div>`);
  }

  const soon = ev.start_date && (new Date(`${ev.start_date}T00:00:00Z`) - Date.now()) / 86400000 <= 14;
  if (ctx.current?.best_c != null && soon) {
    parts.push(`<div class="card">
      <dl><dt>In the water now</dt>
        <dd><b>${escapeHtml(String(Math.round(ctx.current.best_c * 10) / 10))}°C</b></dd></dl>
      <p class="srcnote">${ctx.current.best_source === 'swimmer'
        ? 'Reported by a swimmer' : 'Modelled sea-surface temperature'} — today's water, shown because this
        swim is within a fortnight. Confidence: ${escapeHtml(ctx.current.confidence || 'unknown')}.</p>
    </div>`);
  }

  if (!parts.length) {
    parts.push(`<div class="card"><p class="muted">
      We have no reliable water temperature for this venue.
      ${venue?.water_body_type && venue.water_body_type !== 'sea'
        ? 'The marine model covers oceans and seas only, so lakes, dams and rivers have nothing unless a swimmer reports one.'
        : 'Nothing has been reported or modelled here yet.'}
      We would rather say so than show you a number we do not trust.</p></div>`);
  }

  return parts.join('');
}

function renderShell(title, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>${STYLES}</style></head><body>
<nav><a class="brand" href="/"><img src="/icons/logo-wave.png" alt=""><span>SwimLoading</span></a>
<a class="cta" href="/explore">Find a swim</a></nav>
<div class="wrap"><section style="padding-top:60px">${body}</section></div></body></html>`;
}

export default async function handler(req, res) {
  const path = (req.url || '').split('?')[0];
  const parts = path.split('/').filter(Boolean);
  const slug = parts[1] || '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!slug) {
    res.writeHead(301, { Location: '/explore' });
    return res.end();
  }

  try {
    const ev = await loadEvent(slug);
    if (!ev) {
      // 404 must not be cached for long: a slug goes live the moment a
      // candidate is approved, and a day-long cached 404 would hide it.
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      return res.status(404).send(renderShell('Swim not found — SwimLoading',
        `<h1>We do not have that swim</h1>
         <p class="sub">It may have been removed, merged with another listing, or never existed.</p>
         <div class="actions"><a class="btn btn-primary" href="/explore">Find a swim</a></div>`));
    }

    const ctx = await loadContext(ev);
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
    return res.status(200).send(renderEventPage(ev, ctx));
  } catch (err) {
    console.error('[events-handler]', err);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).send(renderShell('Something went wrong — SwimLoading',
      `<h1>Something went wrong</h1>
       <p class="sub">We could not load that swim. Please try again.</p>
       <div class="actions"><a class="btn btn-primary" href="/explore">Find a swim</a></div>`));
  }
}
