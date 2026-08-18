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
import { countryBySlug, countryByCode } from './_countries.js';
import { isPublicPageIndexable, robotsFor } from './_lib/indexability.js';

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

/**
 * An edition that used to live at this slug, or null.
 *
 * previous_slugs is a text[] and every historical form is kept, because a
 * slug can be corrected more than once and each old URL must keep resolving.
 * PostgREST's `cs` operator is array-contains, so this is an index hit on
 * event_editions_previous_slugs_idx rather than a scan.
 *
 * Returns only the CURRENT slug — the caller 301s to it. Deliberately not
 * chained: if the target has itself been renamed the row's own slug is
 * already the latest, so one hop is always enough.
 */
async function findRenamedEdition(slug) {
  // The value is interpolated into a PostgREST array literal, so a slug
  // containing a comma or brace would change the meaning of the filter.
  // Real slugs are [a-z0-9-], so anything else cannot be a match anyway.
  if (!/^[a-z0-9-]+$/i.test(slug)) return null;
  const rows = await dbGet(
    `event_editions?previous_slugs=cs.{${encodeURIComponent(slug)}}&limit=1&select=slug`
  );
  return Array.isArray(rows) && rows.length ? rows[0].slug : null;
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

  // Catalogue size for the closing block. Real numbers, fetched rather than
  // hard-coded, because a stale "250 swims" on a few hundred cached pages is
  // exactly the drift the site-config rule exists to prevent. Counted via a
  // HEAD-style exact count so this costs one cheap query, not a row fetch.
  let catalogueSize = null;
  let countryCount = null;
  try {
    const all = await dbGet(
      `event_editions?is_searchable=eq.true&status=in.(announced,entries_open,entries_closed)` +
      `&start_date=gte.${new Date().toISOString().slice(0,10)}&select=venue_id&limit=2000`
    );
    if (Array.isArray(all)) catalogueSize = all.length;
  } catch { /* non-fatal */ }
  try {
    const v = await dbGet('event_venues?select=country_code&country_code=not.is.null&limit=2000');
    if (Array.isArray(v)) countryCount = new Set(v.map((x) => x.country_code)).size;
  } catch { /* non-fatal */ }

  return {
    catalogueSize,
    countryCount,
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

// Breadcrumb, organisation and FAQ — the same shapes the /spots pages carry.
// Unlike the SportsEvent block above these are safe on ANY event, because
// they describe the page and the answers are generated from what we actually
// hold: an FAQ that says "we do not have a confirmed date" is still a true
// answer, and truthful uncertainty is what this catalogue is for.
function supportingSchema(ev, ctx) {
  const venue = ev.event_venues;
  const place = [venue?.city, venue?.region, venue?.country_code].filter(Boolean).join(', ');
  const d = fmtLongDate(ev.start_date, ev.date_precision, ev.date_confirmed);
  const trust = trustLabel(ev);
  const distances = (ev.event_distances || [])
    .map((x) => fmtDistance(x.distance_metres)).filter(Boolean);

  const qa = [
    [`When is ${ev.title}?`,
     ev.date_confirmed && !d.provisional
       ? `${ev.title} takes place on ${d.text}${place ? ` in ${place}` : ''}.`
       : `The date for ${ev.title} is not yet confirmed${ev.start_date ? ` — it is expected around ${d.text}` : ''}. Check with the organiser before making plans.`],
    [`Where is ${ev.title} held?`,
     place || venue?.location_text
       ? `${ev.title} is held at ${venue?.display_name || place}${place && venue?.display_name ? `, ${place}` : ''}.`
       : `The venue for ${ev.title} has not been confirmed.`],
  ];
  if (distances.length) {
    qa.push([`What distances does ${ev.title} offer?`,
      `${ev.title} offers ${distances.join(', ')}.`]);
  }
  if (ctx.climatology) {
    const c = ctx.climatology;
    qa.push([`How cold is the water at ${ev.title}?`,
      `Water at this venue typically averages ${Math.round(c.mean_c * 10) / 10}°C in this week of the year` +
      `${c.p10_c != null ? `, usually between ${Math.round(c.p10_c*10)/10}°C and ${Math.round(c.p90_c*10)/10}°C` : ''}` +
      `, based on ${c.years_observed} years of Copernicus Marine satellite data. That is what the water usually does, not a forecast for the day.`]);
  }
  qa.push([`Is ${ev.title} information verified?`, trust.detail +
    ` Last checked ${ev.last_verified_at ? String(ev.last_verified_at).slice(0,10) : 'not recorded'}. Always confirm with the organiser before travelling.`]);

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'SwimLoading', url: SITE,
        logo: `${SITE}/icons/logo.png`,
        description: 'Open water swimming platform tracking water temperature, conditions and events worldwide.' },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'SwimLoading', item: SITE },
        { '@type': 'ListItem', position: 2, name: 'Where to swim', item: `${SITE}/explore` },
        { '@type': 'ListItem', position: 3, name: ev.title, item: `${SITE}/events/${ev.slug}` },
      ] },
      { '@type': 'FAQPage', mainEntity: qa.map(([q, a]) => ({
        '@type': 'Question', name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })) },
    ],
  };
  return `<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, '\\u003c')}</script>`;
}

// ── Render ────────────────────────────────────────────────────────────────

function head(ev, ctx) {
  const venue = ev.event_venues;
  const place = [venue?.city, venue?.region, venue?.country_code].filter(Boolean).join(', ');
  const d = fmtLongDate(ev.start_date, ev.date_precision, ev.date_confirmed);
  // Keyword-led, matching the spots pages ("Robben Island Water Temperature
  // Today | SwimLoading"). A swimmer searches "<race name> 2027 date" or
  // "<race name> water temperature", not the bare event name, and the title
  // is the strongest signal we control.
  const year = ev.edition_year || (ev.start_date ? ev.start_date.slice(0, 4) : '');
  const title =
    `${ev.title}${year ? ` ${year}` : ''} — Date, Distances & Water Temperature` +
    `${place ? ` | ${place}` : ''} | SwimLoading`;
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
  // The whole judgement now lives in the shared gate, which applies the
  // same "is this fit to put in front of a swimmer" test the sitemap uses
  // — so a page can no longer claim index,follow while the sitemap quietly
  // holds it back, or the reverse. The date check it performs is NOT
  // redundant with is_indexable: that column is a stored snapshot taken
  // when the row was assessed, and nothing clears it as time passes.
  //
  // noindex,FOLLOW rather than nofollow: an unverified listing should not
  // rank, but its links to the venue and the organiser are still worth
  // crawling. Withholding the page is the point; withholding the graph is
  // just collateral damage.
  const verdict = isPublicPageIndexable({ ...ev, venue: ev.venue || ev.event_venues }, 'event');
  const robots = robotsFor(verdict);

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
${schemaOrg(ev, ctx)}
${supportingSchema(ev, ctx)}`;
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
      <!-- An organiser reading a rival's listing is the most qualified
           visitor /list-your-swim will ever get: they run swims, they are
           looking at what a listing gets them, and their own is missing. -->
      <p style="margin-top:14px;font-size:14px;color:var(--sec)">
        Organise a different swim that is not here yet?
        <a href="/list-your-swim">Add it to the calendar</a> — free, no account.
      </p>
    </div>
  </section>

  <!-- The reason this page earns its place in a search result, and the only
       real call to action. A visitor arriving from Google on one event name
       has no idea what SwimLoading is; the spots pages solved this with a
       closing block and internal links, and event pages had neither. -->
  <section>
    <h2>Swimming ${escapeHtml(venue?.city || venue?.country_code || 'here')}?</h2>
    <div class="card">
      <p>SwimLoading tracks water temperature and conditions for open water swimmers worldwide —
         ${escapeHtml(String(ctx.catalogueSize || 'hundreds of'))} swims across
         ${escapeHtml(String(ctx.countryCount || 'dozens of'))} countries, each with the temperature
         of the water it is actually held in. Log your own swims, follow the events you are aiming
         at, and see what the water is doing before you travel.</p>
      <div class="actions" style="margin-bottom:0">
        <a class="btn btn-primary" href="/app">Open the app — it's free</a>
        <a class="btn" href="/explore">Find more swims</a>
        ${venue?.country_code ? `<a class="btn" href="/explore?country=${escapeHtml(venue.country_code)}">More in ${escapeHtml(venue.country_code)}</a>` : ''}
      </div>
    </div>
  </section>

  <footer>
    <p><a href="/explore">All open water swims</a> ·
       <a href="/spots">Swim spots and water temperatures</a> ·
       <a href="/crossings">Channel crossings</a> ·
       <a href="/app">Open the app</a></p>
    <p style="margin-top:10px">Listed by SwimLoading. Details gathered from public sources and not
       guaranteed — confirm with the organiser before travelling.</p>
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

// ── Country hubs: /swims/{country-slug} ───────────────────────────────────
// A rankable page per country. /explore?country=ZA is a query string Google
// treats as one page with parameters; /swims/south-africa is a page it can
// rank for "open water swims South Africa", which is what people search.
//
// Resolved BEFORE route slugs, the same way spots-handler.js checks
// REGION_SLUGS before spot slugs. The two namespaces share a path, so the
// finite, known set wins and a route can never shadow a country.
//
// That known set is now every ISO country (api/_countries.js, generated),
// not twenty typed by hand here and twenty more typed again in
// sitemap-dynamic.js. Those two lists had drifted to the point where 16
// countries with live events — the Philippines, Sweden, Hong Kong, the
// UAE — had no reachable hub, silently, because a stale hand-written list
// never fails, it just quietly omits. A country in the data now gets a
// hub with no code change.
//
// Widening 20 slugs to 249 cannot shadow a route: checked against every
// swim_routes slug on 6 Aug 2026 (cape-point, robben-island-*, …), no
// collisions. A future route named after a country would lose, so name
// routes for the swim, not the country.

async function loadCountryHub(code) {
  const today = new Date().toISOString().slice(0, 10);
  const [events, routes] = await Promise.all([
    dbRpc('search_events_v2', { p_country: code, p_sort: 'date', p_page: 1, p_page_size: 60 }),
    // Routes have no country column — they are bound to spots, so match on
    // the venue that shares the spot. Only ZA has routes today, but this is
    // written generally so a UK operator needs no code change.
    dbGet('swim_routes?is_public=eq.true&select=slug,name,distance_metres,summary,operator_role,' +
          'observed_temp_avg_c,logged_swims,start_spot_id'),
  ]);
  const venues = await dbGet(
    `event_venues?country_code=eq.${encodeURIComponent(code)}&spot_id=not.is.null&select=spot_id`
  );
  const spotIds = new Set((Array.isArray(venues) ? venues : []).map((v) => v.spot_id));

  // The footer's "other countries" links come from what is actually in the
  // catalogue. They used to be the first ten entries of the hand-written
  // map, which meant a country could only be linked if someone had thought
  // to type it — and, once the map became all 249, would have offered
  // Andorra and Anguilla ahead of anywhere you can swim.
  const allCountries = await dbGet(
    'event_venues?select=country_code&country_code=not.is.null&limit=2000'
  );
  const siblings = [...new Set((Array.isArray(allCountries) ? allCountries : [])
    .map((v) => v.country_code))]
    .map(countryByCode)
    .filter((c) => c && c.code !== code)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    events: Array.isArray(events) ? events.filter((e) => e.start_date >= today) : [],
    routes: (Array.isArray(routes) ? routes : []).filter((r) => r.start_spot_id && spotIds.has(r.start_spot_id)),
    siblings,
  };
}

function renderCountryHub(slug, country, data) {
  const { events, routes } = data;
  const n = events.length;
  const months = new Map();
  for (const e of events) {
    const k = (e.start_date || '').slice(0, 7);
    if (!months.has(k)) months.set(k, []);
    months.get(k).push(e);
  }
  const distances = [...new Set(events.flatMap((e) =>
    (Array.isArray(e.distances) ? e.distances : []).map((d) => d.metres)).filter(Boolean))].sort((a,b)=>a-b);
  const temps = events.map((e) => e.water_temp_c).filter((t) => t != null);

  // "1 Events" is the title Google prints. It never showed before because
  // every hand-listed country happened to have several; the moment hubs
  // came from the data, fourteen one-event countries appeared at once.
  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

  const title = `Open Water Swims in ${country.name} — ${plural(n, 'Event', 'Events')}, Dates & Water Temperature | SwimLoading`;
  const desc = `${plural(n, 'open water swimming event', 'open water swimming events')} in ${country.name}` +
    `${routes.length ? `, plus ${plural(routes.length, 'escorted swim', 'escorted swims')} you can book any time` : ''}. ` +
    `Dates, distances and water temperature for each venue.`;

  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'SwimLoading', url: SITE, logo: `${SITE}/icons/logo.png` },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'SwimLoading', item: SITE },
        { '@type': 'ListItem', position: 2, name: 'Where to swim', item: `${SITE}/explore` },
        { '@type': 'ListItem', position: 3, name: country.name, item: `${SITE}/swims/${slug}` },
      ] },
      { '@type': 'ItemList', numberOfItems: n, itemListElement: events.slice(0, 30).map((e, i) => ({
        '@type': 'ListItem', position: i + 1, name: e.title,
        url: e.slug ? `${SITE}/events/${e.slug}` : undefined,
      })) },
      { '@type': 'FAQPage', mainEntity: [
        { '@type': 'Question', name: `How many open water swims are there in ${country.name}?`,
          acceptedAnswer: { '@type': 'Answer', text: `SwimLoading lists ${plural(n, 'upcoming open water swimming event', 'upcoming open water swimming events')} in ${country.name}${routes.length ? `, plus ${plural(routes.length, 'escorted route', 'escorted routes')} that can be booked when conditions allow` : ''}.` } },
        { '@type': 'Question', name: `What distances can you swim in ${country.name}?`,
          acceptedAnswer: { '@type': 'Answer', text: distances.length
            ? `Events in ${country.name} range from ${distances[0] >= 1000 ? `${+(distances[0]/1000).toFixed(1)} km` : `${distances[0]} m`} to ${distances[distances.length-1] >= 1000 ? `${+(distances[distances.length-1]/1000).toFixed(1)} km` : `${distances[distances.length-1]} m`}.`
            : `Distance information is not yet recorded for events in ${country.name}.` } },
      ] },
    ],
  };

  const card = (e) => {
    const d = fmtLongDate(e.start_date, e.date_precision, e.date_confirmed);
    const dists = (Array.isArray(e.distances) ? e.distances : []).map((x) => x.label).filter(Boolean);
    return `<article class="result" style="display:block">
      <h3 style="font-size:17px;margin-bottom:4px">${e.slug
        ? `<a href="/events/${escapeHtml(e.slug)}" style="text-decoration:none">${escapeHtml(e.title)}</a>`
        : escapeHtml(e.title)}</h3>
      <div class="muted" style="font-size:13.5px">
        ${escapeHtml(d.text)} · ${escapeHtml([e.city, e.region].filter(Boolean).join(', ') || e.venue_name || '')}
        ${dists.length ? ` · ${escapeHtml(dists.slice(0,4).join(', '))}` : ''}
        ${e.water_temp_c != null ? ` · <span style="color:var(--cyan)">${escapeHtml(String(e.water_temp_c))}°C now</span>` : ''}
      </div>
    </article>`;
  };

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc.slice(0,300))}">
<meta name="robots" content="${n > 0 ? 'index,follow' : 'noindex,follow'}">
<link rel="canonical" href="${SITE}/swims/${escapeHtml(slug)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(`Open Water Swims in ${country.name}`)}">
<meta property="og:description" content="${escapeHtml(desc.slice(0,300))}">
<meta property="og:url" content="${SITE}/swims/${escapeHtml(slug)}">
<meta property="og:site_name" content="SwimLoading">
<meta property="og:image" content="${SITE}/screenshots/temps.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap" rel="stylesheet">
<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>
<style>${STYLES}</style></head>
<body>
<nav><a class="brand" href="/"><img src="/icons/logo-wave.png" alt=""><span>SwimLoading</span></a>
<a class="cta" href="/app">Open the app</a></nav>
<div class="wrap">
  <nav class="crumb" aria-label="Breadcrumb">
    <a href="/explore">Where to swim</a> › <span>${escapeHtml(country.name)}</span>
  </nav>
  <header class="ev">
    <h1>Open water swims in ${escapeHtml(country.name)}</h1>
    <p class="sub">${n} upcoming event${n === 1 ? '' : 's'}${routes.length
      ? `, and ${routes.length} escorted swim${routes.length === 1 ? '' : 's'} you can book any time` : ''}.
      Every venue carries the water temperature where we have one.</p>
    <div class="keyline">
      <div><b>${n}</b><span>Upcoming swims</span></div>
      ${routes.length ? `<div><b>${routes.length}</b><span>Bookable routes</span></div>` : ''}
      ${distances.length ? `<div><b>${distances[distances.length-1] >= 1000 ? `${+(distances[distances.length-1]/1000).toFixed(0)} km` : `${distances[distances.length-1]} m`}</b><span>Longest</span></div>` : ''}
      ${temps.length ? `<div><b>${Math.round(temps.reduce((a,b)=>a+Number(b),0)/temps.length)}°C</b><span>Water now, average</span></div>` : ''}
    </div>
  </header>

  ${n ? [...months.entries()].map(([k, rows]) => `<section>
      <h2>${k === '' ? 'Date to be confirmed'
        : `${MONTHS_LONG[Number(k.slice(5,7))-1]} ${k.slice(0,4)}`}</h2>
      ${rows.map(card).join('')}
    </section>`).join('') : `<section><div class="card"><p class="muted">
      We have no upcoming swims listed in ${escapeHtml(country.name)} yet. We are adding sources country
      by country — this is a gap in what we have found, not proof there is nothing there.
      </p><div class="actions" style="margin-bottom:0"><a class="btn btn-primary" href="/explore">Find swims elsewhere</a></div></div></section>`}

  ${routes.length ? `<section>
    <h2>Swims you can book any time in ${escapeHtml(country.name)}</h2>
    ${routes.map((r) => `<article class="result" style="display:block">
      <h3 style="font-size:17px;margin-bottom:4px"><a href="/swims/${escapeHtml(r.slug)}" style="text-decoration:none">${escapeHtml(r.name)}</a></h3>
      <div class="muted" style="font-size:13.5px">
        ${r.distance_metres ? `${+(r.distance_metres/1000).toFixed(1)} km` : ''}
        ${r.observed_temp_avg_c != null ? ` · <span style="color:var(--cyan)">${escapeHtml(String(r.observed_temp_avg_c))}°C average</span>` : ''}
        ${r.logged_swims ? ` · ${r.logged_swims} logged swims` : ''}
      </div>
    </article>`).join('')}
  </section>` : ''}

  <section>
    <h2>Planning to swim in ${escapeHtml(country.name)}?</h2>
    <div class="card">
      <p>SwimLoading tracks water temperature and conditions for open water swimmers worldwide.
         See what the water is doing before you travel, follow the events you are aiming at,
         and log the swims you do.</p>
      <div class="actions" style="margin-bottom:0">
        <a class="btn btn-primary" href="/app">Open the app — it's free</a>
        <a class="btn" href="/explore">All open water swims</a>
        <a class="btn" href="/spots">Swim spots and temperatures</a>
      </div>
    </div>
  </section>

  <footer>
    <p>${(data.siblings || []).slice(0, 24)
        .map((c) => `<a href="/swims/${c.slug}">${escapeHtml(c.name)}</a>`).join(' · ')}</p>
    <p style="margin-top:10px">Details gathered from public sources and not guaranteed —
       confirm with the organiser before travelling.</p>
  </footer>
</div>
<script>
document.addEventListener('mousemove',e=>{
  document.body.style.setProperty('--mouse-x',e.clientX+'px');
  document.body.style.setProperty('--mouse-y',e.clientY+'px');
});
</script>
</body></html>`;
}

// ── Bookable routes: /swims/{slug} ────────────────────────────────────────
// Shares this handler because it shares the shell, the styles and the brand.
// A route is NOT an event — no date, booked when conditions allow — so it
// gets its own loader and renderer rather than being forced through the
// event path.

async function loadRoute(slug) {
  const rows = await dbGet(
    `swim_routes?slug=eq.${encodeURIComponent(slug)}&is_public=eq.true&limit=1&select=*`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function loadRouteContext(route) {
  const [operator, startSpot, climatology] = await Promise.all([
    route.operator_id
      ? dbGet(`public_organisers?id=eq.${route.operator_id}&select=display_name,official_url&limit=1`)
      : Promise.resolve(null),
    route.start_spot_id
      ? dbGet(`spots?id=eq.${route.start_spot_id}&select=id,name,latitude,longitude&limit=1`)
      : Promise.resolve(null),
    // Climatology is keyed on VENUE, and routes link to spots — so find a
    // venue sharing the spot. This is why the Big Bay venues were bound to
    // spots rather than given typed coordinates.
    route.start_spot_id
      ? dbGet(`event_venues?spot_id=eq.${route.start_spot_id}&select=id&limit=1`)
      : Promise.resolve(null),
  ]);

  let weeks = [];
  const venueId = Array.isArray(climatology) && climatology.length ? climatology[0].id : null;
  if (venueId) {
    const rows = await dbGet(
      `venue_water_climatology?venue_id=eq.${venueId}&select=week_of_year,mean_c,p10_c,p90_c,years_observed&order=week_of_year.asc`
    );
    weeks = Array.isArray(rows) ? rows : [];
  }

  return {
    operator: Array.isArray(operator) && operator.length ? operator[0] : null,
    spot: Array.isArray(startSpot) && startSpot.length ? startSpot[0] : null,
    weeks,
  };
}

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtMins = (m) => {
  if (m == null) return null;
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h}h${r ? String(r).padStart(2, '0') : ''}` : `${r}m`;
};

function renderRoutePage(route, ctx) {
  const operates = route.operator_role === 'operates';
  const dist = route.distance_metres
    ? (route.distance_metres >= 1000 ? `${+(route.distance_metres / 1000).toFixed(1)} km` : `${route.distance_metres} m`)
    : null;
  const season = (route.season_start_month && route.season_end_month)
    ? `${MONTH_SHORT[route.season_start_month - 1]}–${MONTH_SHORT[route.season_end_month - 1]}`
    : null;
  const bookUrl = operates ? safeUrl(route.booking_url) : null;
  const title = `Swim ${route.name} — Distance, Water Temperature & How to Book | SwimLoading`;
  const desc = `${route.summary || route.name}${dist ? ` ${dist}.` : ''}` +
    `${route.observed_temp_avg_c != null ? ` Water averages ${route.observed_temp_avg_c}°C.` : ''}` +
    `${route.logged_swims ? ` Based on ${route.logged_swims} logged swims.` : ''}`;

  // Climatology by month, from weekly rows. This is the answer to the
  // question a travelling swimmer actually has — "what will the water be
  // like when I am there" — and it is why routes are bound to spots.
  const byMonth = [];
  if (ctx.weeks.length) {
    for (let m = 0; m < 12; m++) {
      const lo = Math.floor(m * 52 / 12) + 1, hi = Math.floor((m + 1) * 52 / 12);
      const inMonth = ctx.weeks.filter((w) => w.week_of_year >= lo && w.week_of_year <= hi && w.mean_c != null);
      if (inMonth.length) {
        byMonth.push({
          month: MONTH_SHORT[m],
          mean: Math.round((inMonth.reduce((a, w) => a + Number(w.mean_c), 0) / inMonth.length) * 10) / 10,
        });
      }
    }
  }

  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'SwimLoading', url: SITE,
        logo: `${SITE}/icons/logo.png` },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'SwimLoading', item: SITE },
        { '@type': 'ListItem', position: 2, name: 'Where to swim', item: `${SITE}/explore` },
        { '@type': 'ListItem', position: 3, name: route.name, item: `${SITE}/swims/${route.slug}` },
      ] },
      { '@type': 'FAQPage', mainEntity: [
        { '@type': 'Question', name: `How long is the ${route.name} swim?`,
          acceptedAnswer: { '@type': 'Answer', text: dist
            ? `${route.name} is ${dist}${route.start_point && route.finish_point ? `, from ${route.start_point} to ${route.finish_point}` : ''}.`
            : `The distance for ${route.name} is not recorded.` } },
        { '@type': 'Question', name: `How cold is the water on the ${route.name} swim?`,
          acceptedAnswer: { '@type': 'Answer', text: route.observed_temp_avg_c != null
            ? `Swimmers have logged an average of ${route.observed_temp_avg_c}°C, ranging from ${route.observed_temp_min_c}°C to ${route.observed_temp_max_c}°C${route.logged_swims ? ` across ${route.logged_swims} swims` : ''}.`
            : (route.typical_temp_min_c != null
                ? `Typically ${route.typical_temp_min_c}–${route.typical_temp_max_c}°C.`
                : `Water temperature for this route is not recorded.`) } },
        { '@type': 'Question', name: `How do I book the ${route.name} swim?`,
          acceptedAnswer: { '@type': 'Answer', text: operates && ctx.operator
            ? `${route.name} is run by ${ctx.operator.display_name}. It has no fixed date — it runs when conditions allow, so you arrange it with the operator directly.`
            : `${route.name} is booked through ${route.sanctioning_body || 'its sanctioning body'}${ctx.operator ? `. ${ctx.operator.display_name} supports swimmers on this route but does not run it` : ''}.` } },
      ] },
    ],
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc.slice(0, 300))}">
<meta name="robots" content="index,follow">
<link rel="canonical" href="${SITE}/swims/${escapeHtml(route.slug)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(`Swim ${route.name}`)}">
<meta property="og:description" content="${escapeHtml(desc.slice(0, 300))}">
<meta property="og:url" content="${SITE}/swims/${escapeHtml(route.slug)}">
<meta property="og:site_name" content="SwimLoading">
<meta property="og:image" content="${SITE}/icons/logo.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap" rel="stylesheet">
<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>
<style>${STYLES}</style></head>
<body>
<nav>
  <a class="brand" href="/"><img src="/icons/logo-wave.png" alt=""><span>SwimLoading</span></a>
  <a class="cta" href="/app">Open the app</a>
</nav>
<div class="wrap">
  <nav class="crumb" aria-label="Breadcrumb">
    <a href="/explore">Where to swim</a> ›
    <a href="/explore?bookable=1">Swims you can book</a> ›
    <span>${escapeHtml(route.name)}</span>
  </nav>

  <header class="ev">
    <div class="badges">
      ${route.difficulty ? `<span class="badge b-${route.difficulty === 'medium' ? 'green' : route.difficulty === 'high' ? 'amber' : 'red'}">${escapeHtml(route.difficulty)}</span>` : ''}
      <span class="badge b-grey">${escapeHtml(route.route_type)}</span>
      ${route.requires_observer ? '<span class="badge b-grey">Observer required</span>' : ''}
      ${route.requires_support_boat ? '<span class="badge b-grey">Support boat required</span>' : ''}
    </div>
    <h1>${escapeHtml(route.name)}</h1>
    <p class="sub">${escapeHtml([route.start_point, route.finish_point].filter(Boolean).join(' → '))}</p>

    <div class="keyline">
      ${dist ? `<div><b>${escapeHtml(dist)}</b><span>Distance</span></div>` : ''}
      ${season ? `<div><b>${escapeHtml(season)}</b><span>Season</span></div>` : ''}
      ${route.observed_temp_avg_c != null ? `<div><b>${escapeHtml(String(route.observed_temp_avg_c))}°C</b><span>Water, average</span></div>` : ''}
      ${route.logged_swims ? `<div><b>${route.logged_swims}</b><span>Logged swims</span></div>` : ''}
    </div>

    <div class="actions">
      ${bookUrl ? `<a class="btn btn-primary" href="${escapeHtml(bookUrl)}" target="_blank" rel="noopener noreferrer nofollow">Book this swim</a>` : ''}
      <a class="btn" href="/explore?bookable=1">Other swims you can book</a>
    </div>
  </header>

  ${route.summary ? `<section><h2>About this swim</h2><div class="card"><p>${escapeHtml(route.summary)}</p>
    ${route.notes ? `<p style="margin-top:10px">${escapeHtml(route.notes)}</p>` : ''}</div></section>` : ''}

  <section>
    <h2>Booking and support</h2>
    <div class="card">
      ${operates
        ? `<p><b>${escapeHtml(ctx.operator ? ctx.operator.display_name : 'The operator')}</b> runs this swim.
             It has no fixed date — it goes when the weather and the water allow, so you arrange a window directly.</p>`
        : `<div class="warn" style="margin-bottom:0">This swim is <b>not booked through
             ${escapeHtml(ctx.operator ? ctx.operator.display_name : 'SwimLoading')}</b>. It is arranged through
             ${escapeHtml(route.sanctioning_body || 'its sanctioning body')}${ctx.operator
               ? `; ${escapeHtml(ctx.operator.display_name)} supports swimmers on this route but does not operate it` : ''}.</div>`}
      ${route.qualifying_swim_minutes ? `<p style="margin-top:12px">Qualifying swim:
        ${Math.round(route.qualifying_swim_minutes / 60)} hours${route.qualifying_max_temp_c != null
          ? ` at or below ${escapeHtml(String(route.qualifying_max_temp_c))}°C` : ''}.</p>` : ''}
    </div>
  </section>

  ${route.logged_swims ? `<section>
    <h2>What it actually takes</h2>
    <div class="card">
      <dl>
        <dt>Logged swims</dt><dd>${route.logged_swims}</dd>
        ${route.duration_min_minutes ? `<dt>Time taken</dt><dd>${escapeHtml(fmtMins(route.duration_min_minutes))} to ${escapeHtml(fmtMins(route.duration_max_minutes))}</dd>` : ''}
        ${route.observed_temp_avg_c != null ? `<dt>Water measured</dt><dd>${escapeHtml(String(route.observed_temp_avg_c))}°C average, ${escapeHtml(String(route.observed_temp_min_c))}–${escapeHtml(String(route.observed_temp_max_c))}°C range</dd>` : ''}
      </dl>
      <p class="srcnote">From swims actually escorted on this route, recorded by the operator
        ${route.evidence_as_at ? `as at ${escapeHtml(String(route.evidence_as_at))}` : ''}. A snapshot, not a live feed.</p>
    </div>
  </section>` : ''}

  ${byMonth.length ? `<section>
    <h2>What the water does through the year</h2>
    <div class="card tablewrap">
      <table><thead><tr>${byMonth.map(m => `<th>${m.month}</th>`).join('')}</tr></thead>
      <tbody><tr>${byMonth.map(m => `<td><b>${m.mean}°C</b></td>`).join('')}</tr></tbody></table>
      <p class="srcnote">SwimLoading estimate from Copernicus Marine satellite reanalysis, averaged over
        20 years for this venue. It describes what the water usually does in each month — useful for
        picking when to travel, not a forecast for a given day.</p>
    </div>
  </section>` : ''}

  <section>
    <h2>Planning a swimming trip?</h2>
    <div class="card">
      <p>SwimLoading tracks water temperature and conditions for open water swimmers worldwide.
         Find races and bookable crossings, see what the water is doing before you travel,
         and log the swims you do.</p>
      <div class="actions" style="margin-bottom:0">
        <a class="btn btn-primary" href="/app">Open the app — it's free</a>
        <a class="btn" href="/explore">Find more swims</a>
        <a class="btn" href="/spots">Swim spots and temperatures</a>
      </div>
    </div>
  </section>

  <footer>
    <p><a href="/explore">All open water swims</a> ·
       <a href="/explore?bookable=1">Swims you can book</a> ·
       <a href="/spots">Swim spots</a> ·
       <a href="/crossings">Channel crossings</a></p>
    <p style="margin-top:10px">Conditions and safety requirements are the operator's to set.
       Always confirm before you travel.</p>
  </footer>
</div>
<script>
document.addEventListener('mousemove',e=>{
  document.body.style.setProperty('--mouse-x',e.clientX+'px');
  document.body.style.setProperty('--mouse-y',e.clientY+'px');
});
</script>
</body>
</html>`;
}

export default async function handler(req, res) {
  const path = (req.url || '').split('?')[0];
  const parts = path.split('/').filter(Boolean);
  const slug = parts[1] || '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  // /swims/{slug} — a bookable route, not an event.
  if (parts[0] === 'swims') {
    if (!slug) { res.writeHead(301, { Location: '/explore?bookable=1' }); return res.end(); }
    // Country hubs win the namespace — a finite known set, checked first.
    const country = countryBySlug(slug);
    if (country) {
      try {
        const data = await loadCountryHub(country.code);
        res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
        return res.status(200).send(renderCountryHub(slug, country, data));
      } catch (err) {
        console.error('[events-handler /swims country]', err);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(500).send(renderShell('Something went wrong — SwimLoading',
          `<h1>Something went wrong</h1><div class="actions"><a class="btn btn-primary" href="/explore">Find a swim</a></div>`));
      }
    }
    try {
      const route = await loadRoute(slug);
      if (!route) {
        res.setHeader('Cache-Control', 'public, s-maxage=60');
        return res.status(404).send(renderShell('Swim not found — SwimLoading',
          `<h1>We do not have that swim</h1>
           <p class="sub">It may have been renamed or removed.</p>
           <div class="actions"><a class="btn btn-primary" href="/explore?bookable=1">Swims you can book</a></div>`));
      }
      const rctx = await loadRouteContext(route);
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).send(renderRoutePage(route, rctx));
    } catch (err) {
      console.error('[events-handler /swims]', err);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(500).send(renderShell('Something went wrong — SwimLoading',
        `<h1>Something went wrong</h1><p class="sub">We could not load that swim.</p>
         <div class="actions"><a class="btn btn-primary" href="/explore">Find a swim</a></div>`));
    }
  }

  if (!slug) {
    res.writeHead(301, { Location: '/explore' });
    return res.end();
  }

  try {
    const ev = await loadEvent(slug);
    if (!ev) {
      // Before 404-ing, check whether this is a slug we have RENAMED. The old
      // slugifier turned every accented character into a hyphen, so a batch
      // of published URLs was corrected (boucle-des-fa-enciers-2026 →
      // boucle-des-faienciers-2026). Those URLs are in the wild and in
      // Google's index, so they must 301 rather than die.
      //
      // Kept here rather than as vercel.json routes: a redirect route has to
      // sit before the ^/events/(.*)$ catch-all to fire at all, and it needs
      // a deploy per rename. previous_slugs travels with the row.
      const moved = await findRenamedEdition(slug);
      if (moved) {
        res.setHeader('Cache-Control', 'public, s-maxage=86400');
        res.writeHead(301, { Location: `/events/${moved}` });
        return res.end();
      }
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
