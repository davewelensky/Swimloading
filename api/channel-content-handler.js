// SSR handler for the English Channel content cluster.
// Routes /english-channel/{cost|training-plan|qualifying-swim|pilots|records|relay|jellyfish|tide-windows|famous-swims}
// Some pages (pilots, records) hydrate with live data from the channel_solo_swims database.

import { dbRpc, escapeHtml } from './seo-utils.js';

export const CLUSTER_SLUGS = [
  'cost',
  'training-plan',
  'qualifying-swim',
  'pilots',
  'records',
  'relay',
  'jellyfish',
  'tide-windows',
  'famous-swims',
  'data-sources',
];

const BASE = 'https://www.swimloading.com';
const HUB = '/crossings/english-channel';

export default async function handler(req, res) {
  const path = (req.url || '').split('?')[0];
  const parts = path.split('/').filter(Boolean);
  // /english-channel/<slug>
  const slug = parts[1] || '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  if (!CLUSTER_SLUGS.includes(slug)) return res.status(404).send(renderNotFound(slug));

  try {
    const dynamic = await fetchDynamic(slug);
    const page = PAGES[slug];
    const html = renderPage(slug, page, dynamic);
    return res.status(200).send(html);
  } catch (err) {
    console.error('[channel-content-handler]', slug, err);
    return res.status(500).send(renderError());
  }
}

// ─── DYNAMIC DATA FETCH (live from DB for pilots + records) ────────────────────

async function fetchDynamic(slug) {
  if (slug === 'pilots') {
    return { pilots: await dbRpc('channel_pilot_stats', { p_min_swims: 20, p_limit: 30 }) || [] };
  }
  if (slug === 'records') {
    const [men, women, men2w, women2w, men3w, men4w, totals] = await Promise.all([
      dbRpc('channel_fastest', { p_direction: 'E-F', p_gender: 'M', p_n_ways: 1, p_limit: 10 }),
      dbRpc('channel_fastest', { p_direction: 'E-F', p_gender: 'F', p_n_ways: 1, p_limit: 10 }),
      dbRpc('channel_fastest', { p_direction: null,  p_gender: 'M', p_n_ways: 2, p_limit: 3 }),
      dbRpc('channel_fastest', { p_direction: null,  p_gender: 'F', p_n_ways: 2, p_limit: 3 }),
      dbRpc('channel_fastest', { p_direction: null,  p_gender: null, p_n_ways: 3, p_limit: 3 }),
      dbRpc('channel_fastest', { p_direction: null,  p_gender: null, p_n_ways: 4, p_limit: 3 }),
      dbRpc('channel_totals'),
    ]);
    return {
      records: {
        men: men || [], women: women || [],
        men2w: men2w || [], women2w: women2w || [],
        men3w: men3w || [], men4w: men4w || [],
        totals: totals?.[0] || null,
      },
    };
  }
  return {};
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function fmtTime(secs) {
  if (secs === null || secs === undefined) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return s > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${h}h ${String(m).padStart(2, '0')}m`;
}

function swimHref(r) {
  return `/english-channel/swim/${r.slug || r.unique_id}`;
}

// ─── PAGE RENDERER ─────────────────────────────────────────────────────────────

function renderPage(slug, page, dynamic) {
  const canonicalUrl = `${BASE}/english-channel/${slug}`;
  const sectionsHtml = (page.sections || []).map(sec => renderSection(sec, dynamic)).join('');
  const faqsHtml = page.faqs?.length ? renderFaqs(page.faqs) : '';
  const relatedHtml = renderRelated(slug);

  const schema = buildSchema(page, canonicalUrl, dynamic);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(page.title)} | SwimLoading</title>
<meta name="description" content="${escapeHtml(page.meta)}">
<link rel="canonical" href="${canonicalUrl}">
<meta property="og:title" content="${escapeHtml(page.title)}">
<meta property="og:description" content="${escapeHtml(page.meta)}">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:type" content="article">
<meta name="theme-color" content="#0a1628">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap" rel="stylesheet">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<style>
:root {
  --bg:#0a1628; --bg-card:#111c30; --bg-card-2:#162236; --ocean:#0ea5e9; --ocean-light:#38bdf8;
  --text:#f0f9ff; --text-sec:#94a3b8; --warm:#f59e0b; --green:#22c55e; --danger:#ef4444;
  --border:rgba(255,255,255,0.06); --border-strong:rgba(255,255,255,0.10);
}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',-apple-system,sans-serif;line-height:1.62;min-height:100vh;padding-bottom:60px;}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:9999;background:radial-gradient(500px circle at var(--mouse-x,-999px) var(--mouse-y,-999px),rgba(56,189,248,0.06),transparent 70%);}
.header{padding:14px 16px;border-bottom:1px solid var(--border);position:sticky;top:0;background:rgba(10,22,40,0.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:50;}
.header-inner{display:flex;align-items:center;gap:12px;max-width:680px;margin:0 auto;}
.brand{display:flex;align-items:center;gap:7px;text-decoration:none;font-size:17px;font-weight:800;letter-spacing:-0.5px;background:linear-gradient(135deg,#38bdf8 0%,#0ea5e9 50%,#0284c7 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
.brand img{height:22px;}
.crumb{margin-left:auto;font-size:12px;color:var(--text-sec);}
.crumb a{color:var(--ocean-light);text-decoration:none;}
.container{max-width:680px;margin:0 auto;padding:18px 16px;}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:0.16em;color:var(--ocean-light);text-transform:uppercase;margin-bottom:8px;}
.h1{font-family:'Bebas Neue',sans-serif;font-size:42px;letter-spacing:1px;line-height:1.05;color:var(--text);margin-bottom:14px;}
.lede{font-size:16px;color:var(--text-sec);line-height:1.6;margin-bottom:22px;}
.lede strong{color:var(--text);font-weight:700;}
section.block{margin-bottom:26px;}
.h2{font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px;color:var(--text);margin-bottom:12px;padding-top:8px;}
.h3{font-size:15px;font-weight:800;color:var(--ocean-light);margin:14px 0 6px;letter-spacing:0.02em;}
.p{font-size:14.5px;color:var(--text);line-height:1.65;margin-bottom:10px;}
.p strong{font-weight:700;color:var(--text);}
.p em{font-style:normal;color:var(--ocean-light);font-weight:600;}
.p a{color:var(--ocean-light);text-decoration:none;}
.p a:hover{text-decoration:underline;}
ul.bullets{margin:10px 0 16px 18px;padding:0;}
ul.bullets li{font-size:14.5px;color:var(--text);line-height:1.6;padding:3px 0;}
ul.bullets li strong{color:var(--text);font-weight:700;}
.card{background:var(--bg-card);border-radius:14px;padding:16px 18px;margin-bottom:14px;border:1px solid var(--border);}
.card-label{font-size:10px;font-weight:700;letter-spacing:0.16em;color:var(--text-sec);text-transform:uppercase;margin-bottom:12px;}
.fact{display:flex;gap:12px;padding:9px 0;border-bottom:1px solid var(--border);font-size:13.5px;}
.fact:last-child{border-bottom:none;}
.fact-key{color:var(--text-sec);width:160px;flex-shrink:0;}
.fact-val{color:var(--text);font-weight:600;flex:1;}
.callout{background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.18);border-left:3px solid var(--ocean-light);border-radius:8px;padding:12px 14px;margin:14px 0;font-size:13.5px;color:var(--text);line-height:1.55;}
.callout.warn{background:rgba(245,158,11,0.06);border-color:rgba(245,158,11,0.25);border-left-color:var(--warm);}
.callout strong{display:block;font-size:10px;color:var(--ocean-light);letter-spacing:0.14em;text-transform:uppercase;margin-bottom:4px;font-weight:800;}
.callout.warn strong{color:var(--warm);}
.swim-row{display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid var(--border);text-decoration:none;color:inherit;}
.swim-row:last-child{border-bottom:none;}
.swim-pos{font-size:14px;font-weight:800;width:24px;color:var(--text-sec);}
.swim-name{font-size:13.5px;font-weight:700;color:var(--ocean-light);}
.swim-meta{font-size:11.5px;color:var(--text-sec);margin-top:1px;}
.swim-time{font-size:14px;font-weight:700;color:var(--ocean-light);margin-left:auto;flex-shrink:0;}
.pilot-row{display:flex;align-items:flex-start;gap:10px;padding:12px 0;border-bottom:1px solid var(--border);}
.pilot-rank{font-size:14px;font-weight:800;width:30px;color:var(--text-sec);text-align:right;}
.pilot-body{flex:1;}
.pilot-name{font-size:14px;font-weight:700;color:var(--text);}
.pilot-meta{font-size:11.5px;color:var(--text-sec);margin-top:2px;line-height:1.5;}
.pilot-count{font-size:20px;font-weight:900;color:var(--ocean-light);flex-shrink:0;}
.faq{border-bottom:1px solid var(--border);}
.faq summary{cursor:pointer;padding:13px 0;font-size:13.5px;font-weight:700;color:var(--text);list-style:none;display:flex;justify-content:space-between;align-items:center;gap:10px;}
.faq summary::-webkit-details-marker{display:none;}
.faq summary::after{content:'+';color:var(--ocean-light);font-size:18px;font-weight:400;flex-shrink:0;}
.faq[open] summary::after{content:'−';}
.faq[open] summary{color:var(--ocean-light);}
.faq p{font-size:13.5px;color:var(--text-sec);line-height:1.65;padding:0 0 12px;margin:0;}
.faq p strong{color:var(--text);}
.related-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;}
@media (max-width:480px){.related-grid{grid-template-columns:1fr;}.h1{font-size:34px;}}
.related-card{display:block;padding:13px;border:1px solid var(--border);border-radius:10px;text-decoration:none;background:rgba(14,165,233,0.03);color:var(--text);}
.related-card:hover{border-color:rgba(56,189,248,0.30);background:rgba(14,165,233,0.06);}
.related-card-title{font-size:13.5px;font-weight:700;color:var(--ocean-light);}
.related-card-desc{font-size:11.5px;color:var(--text-sec);margin-top:3px;line-height:1.45;}
.cta-row{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;}
.cta-btn{display:inline-block;padding:11px 22px;border-radius:50px;background:var(--ocean-light);color:#080f1a;font-size:13px;font-weight:700;text-decoration:none;}
.cta-btn.ghost{background:rgba(14,165,233,0.10);border:1px solid rgba(14,165,233,0.40);color:var(--ocean-light);}
.foot{text-align:center;padding:14px;font-size:11px;color:var(--text-sec);margin-top:20px;}
.foot a{color:var(--ocean-light);text-decoration:none;}
.table{width:100%;border-collapse:collapse;font-size:13.5px;margin:8px 0 16px;}
.table th{text-align:left;padding:8px 10px;background:rgba(14,165,233,0.04);border-bottom:1px solid var(--border-strong);font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-sec);font-weight:700;}
.table td{padding:8px 10px;border-bottom:1px solid var(--border);color:var(--text);}
.table td.num{font-weight:700;color:var(--ocean-light);text-align:right;}
.totals-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:8px 0 16px;}
.totals-cell{background:var(--bg-card-2);border-radius:10px;padding:12px 10px;text-align:center;border:1px solid var(--border);}
.totals-val{font-size:22px;font-weight:900;color:var(--ocean-light);line-height:1;}
.totals-lbl{font-size:10.5px;color:var(--text-sec);margin-top:5px;line-height:1.3;}
</style>
</head>
<body>
<header class="header">
  <div class="header-inner">
    <a class="brand" href="https://swimloading.com"><img src="/icons/logo-wave.png" alt="">SwimLoading</a>
    <div class="crumb"><a href="${HUB}">&larr; English Channel hub</a></div>
  </div>
</header>

<div class="container">
  <div class="eyebrow">${escapeHtml(page.eyebrow || 'English Channel')}</div>
  <h1 class="h1">${escapeHtml(page.h1)}</h1>
  ${page.lede ? `<div class="lede">${page.lede}</div>` : ''}

  ${sectionsHtml}

  ${faqsHtml}

  ${relatedHtml}

  <div class="card" style="text-align:center;margin-top:18px;">
    <div class="card-label">Open the Channel intelligence hub</div>
    <div style="font-size:13px;color:var(--text-sec);line-height:1.6;margin-bottom:14px;">Live conditions, 16-day forecast, 3,443 ratified swims, pilot leaderboard, and your personal tide window.</div>
    <div class="cta-row" style="justify-content:center;">
      <a href="${HUB}" class="cta-btn">Open Channel hub</a>
      <a href="/app" class="cta-btn ghost">SwimLoading app</a>
    </div>
  </div>

  <div class="foot">Source: public Channel solo swim database (CSA + CS&PF + historical) · <a href="https://db.marathonswimmers.org" target="_blank" rel="noopener">LongSwims</a> · <a href="${HUB}">&larr; back to the Channel hub</a></div>
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

// ─── SECTION RENDERER ──────────────────────────────────────────────────────────

function renderSection(sec, dynamic) {
  // sec is one of: { h2, p, bullets, callout, table, html, dynamic: 'pilots' | 'records-leaderboards' }
  let html = '';
  if (sec.h2) html += `<section class="block"><h2 class="h2">${escapeHtml(sec.h2)}</h2>`;
  if (sec.p) {
    const paras = Array.isArray(sec.p) ? sec.p : [sec.p];
    paras.forEach(p => { html += `<p class="p">${p}</p>`; });
  }
  if (sec.h3) html += `<div class="h3">${escapeHtml(sec.h3)}</div>`;
  if (sec.bullets) {
    html += `<ul class="bullets">${sec.bullets.map(b => `<li>${b}</li>`).join('')}</ul>`;
  }
  if (sec.callout) {
    const cls = sec.callout.warn ? 'callout warn' : 'callout';
    html += `<div class="${cls}"><strong>${escapeHtml(sec.callout.label || 'Note')}</strong>${sec.callout.body}</div>`;
  }
  if (sec.table) {
    html += `<table class="table"><thead><tr>${sec.table.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${sec.table.rows.map(r => `<tr>${r.map((c, i) => `<td${i === r.length - 1 ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  if (sec.html) html += sec.html;
  if (sec.dynamic === 'pilots' && dynamic?.pilots) {
    html += renderPilotsLive(dynamic.pilots);
  }
  if (sec.dynamic === 'records-leaderboards' && dynamic?.records) {
    html += renderRecordsLive(dynamic.records);
  }
  if (sec.h2) html += `</section>`;
  return html;
}

function renderPilotsLive(pilots) {
  if (!pilots.length) return '<p class="p">Live pilot data unavailable.</p>';
  return `<div class="card"><div class="card-label">Pilot leaderboard — live</div>${pilots.map((p, i) => {
    const active = p.last_year >= 2023;
    const activeTag = active
      ? '<span style="font-size:10px;font-weight:700;color:var(--green);">ACTIVE</span>'
      : '<span style="font-size:10px;color:var(--text-sec);">retired</span>';
    const fastest = p.fastest_time_seconds ? fmtTime(p.fastest_time_seconds) : '—';
    return `<div class="pilot-row">
      <div class="pilot-rank">${i + 1}</div>
      <div class="pilot-body">
        <div class="pilot-name">${escapeHtml(p.pilot)}</div>
        <div class="pilot-meta">${p.total_swims} ratified swims · ${p.first_year}–${p.last_year} · ${activeTag}${p.fastest_swimmer ? `<br>Fastest: ${fastest} (${escapeHtml(p.fastest_swimmer)}, ${p.fastest_year})` : ''}${p.boats ? `<br><span style="opacity:.7;">${escapeHtml(p.boats.length > 70 ? p.boats.slice(0, 70) + '…' : p.boats)}</span>` : ''}</div>
      </div>
      <div class="pilot-count">${p.total_swims}</div>
    </div>`;
  }).join('')}</div>`;
}

function renderRecordsLive(r) {
  let html = '';
  if (r.totals) {
    html += `<div class="totals-grid">
      <div class="totals-cell"><div class="totals-val">${Number(r.totals.total_swims).toLocaleString()}</div><div class="totals-lbl">Ratified solo swims<br>1875–${r.totals.latest_year}</div></div>
      <div class="totals-cell"><div class="totals-val">${Number(r.totals.unique_individuals).toLocaleString()}</div><div class="totals-lbl">Unique individuals</div></div>
      <div class="totals-cell"><div class="totals-val">${fmtTime(Math.round(r.totals.median_time_seconds))}</div><div class="totals-lbl">Median time<br>solo, 1-way</div></div>
    </div>`;
  }
  const leader = (label, rows, accent) => {
    if (!rows.length) return '';
    return `<div class="card"><div class="card-label">${label}</div>${rows.map((s, i) => `<a class="swim-row" href="${swimHref(s)}">
      <div class="swim-pos" style="color:${i === 0 ? accent : i < 3 ? '#cbd5e1' : 'var(--text-sec)'};">${i + 1}</div>
      <div style="flex:1;">
        <div class="swim-name">${escapeHtml(s.full_name)}</div>
        <div class="swim-meta">${s.year} · ${escapeHtml(s.nationality_when_swam || '—')}${s.pilot ? ' · pilot: ' + escapeHtml(s.pilot) : ''}</div>
      </div>
      <div class="swim-time">${fmtTime(s.time_seconds)}</div>
    </a>`).join('')}</div>`;
  };
  html += leader("Top 10 men's solo E→F", r.men, '#f59e0b');
  html += leader("Top 10 women's solo E→F", r.women, '#ec4899');
  html += leader("Men's two-way records",   r.men2w,   '#38bdf8');
  html += leader("Women's two-way records", r.women2w, '#ec4899');
  html += leader("Three-way records",       r.men3w,   '#38bdf8');
  html += leader("Four-way records",        r.men4w,   '#22c55e');
  return html;
}

function renderFaqs(faqs) {
  return `<section class="block"><h2 class="h2">Frequently asked questions</h2>${faqs.map(f =>
    `<details class="faq"><summary>${escapeHtml(f.q)}</summary><p>${f.a}</p></details>`
  ).join('')}</section>`;
}

// ─── RELATED PAGES ─────────────────────────────────────────────────────────────

function renderRelated(currentSlug) {
  const meta = {
    'cost':              { title: 'How much does it cost?',          desc: 'Pilot fees, registration, training, total budget' },
    'training-plan':     { title: 'How to train for the Channel',    desc: '24-month plan, cold acclimatisation, taper' },
    'qualifying-swim':   { title: 'The 6-hour qualifying swim',      desc: 'Rules, venues, observer, common reasons people fail' },
    'pilots':            { title: 'Pilot leaderboard',               desc: 'Live: most ratified crossings by pilot' },
    'records':           { title: 'Channel records — all-time',      desc: 'Fastest M/F, multi-way, by-decade' },
    'relay':             { title: 'Channel relay swims',             desc: 'Rules, teams, records, costs' },
    'jellyfish':         { title: 'Jellyfish in the Channel',        desc: 'Species, peak months, sting handling' },
    'tide-windows':      { title: 'Tide windows explained',          desc: 'Neap vs spring, position 1-7, calendar' },
    'famous-swims':      { title: 'Famous Channel swims',            desc: 'Webb, Ederle, Streeter, Thomas, Waschburger' },
    'data-sources':      { title: 'Data sources & attribution',      desc: 'Where the data comes from and how to request removal' },
  };
  const others = CLUSTER_SLUGS.filter(s => s !== currentSlug);
  return `<section class="block"><h2 class="h2">Continue reading</h2><div class="related-grid">${
    others.map(s => `<a class="related-card" href="/english-channel/${s}">
      <div class="related-card-title">${escapeHtml(meta[s].title)}</div>
      <div class="related-card-desc">${escapeHtml(meta[s].desc)}</div>
    </a>`).join('')
  }</div></section>`;
}

// ─── SCHEMA.ORG ────────────────────────────────────────────────────────────────

function buildSchema(page, canonicalUrl, dynamic) {
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: page.title,
    description: page.meta,
    url: canonicalUrl,
    publisher: {
      '@type': 'Organization',
      name: 'SwimLoading',
      url: BASE,
    },
    mainEntityOfPage: canonicalUrl,
  };
  if (!page.faqs?.length) return article;
  const faqPage = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: page.faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: stripHtml(f.a) },
    })),
  };
  return [article, faqPage];
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// ─── ERROR / 404 ──────────────────────────────────────────────────────────────

function renderNotFound(slug) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Page not found</title><meta name="robots" content="noindex"><style>body{background:#0a1628;color:#f0f9ff;font-family:sans-serif;text-align:center;padding:60px 20px;}a{color:#38bdf8;}</style></head><body><h1>Page not found</h1><p>${escapeHtml(slug || 'No page')} isn't part of the English Channel content hub.</p><p style="margin-top:20px;"><a href="${HUB}">&larr; English Channel hub</a></p></body></html>`;
}
function renderError() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error</title></head><body style="background:#0a1628;color:#f0f9ff;font-family:sans-serif;padding:40px;text-align:center;"><h1>Something went wrong</h1><p><a href="${HUB}" style="color:#38bdf8;">Back to the Channel hub</a></p></body></html>`;
}

// ════════════════════════════════════════════════════════════════════════════
// CONTENT — 9 pages
// ════════════════════════════════════════════════════════════════════════════

const PAGES = {

  // ─── 1. COST ─────────────────────────────────────────────────────────────
  'cost': {
    title: 'How much does it cost to swim the English Channel?',
    meta: 'A solo English Channel swim costs £4,500–£8,500 all-in. Full breakdown: pilot fees (£3,000–£4,500), registration, observer, qualifier, training travel, Dover wait week.',
    eyebrow: 'English Channel · Cost guide',
    h1: 'How much does it cost to swim the English Channel?',
    lede: 'A solo Channel attempt costs <strong>£4,500–£8,500 all-in</strong> for most swimmers. The pilot fee is the biggest line item, but the costs you don\'t always plan for — the qualifier, the wait-week accommodation, two years of training trips to Dover — quietly add up.',

    sections: [
      {
        h2: 'The TL;DR budget',
        p: 'Most swimmers we see end up spending between £4,500 and £8,500 across the 18–24 months from booking to attempt. The pilot is roughly half of that. The rest is fees, travel, training, and the unavoidable Dover wait-week.',
        table: {
          headers: ['Item', 'Typical cost (GBP)'],
          rows: [
            ['Pilot fee',                         '£3,000 – £4,500'],
            ['Governing body registration (CSA or CS&PF)', '£155 – £200/year'],
            ['Observer fee (swim day)',           '£200 – £300'],
            ['Ratification + certificate',        '£70 – £100'],
            ['Medical certificate',               '£50 – £150/year'],
            ['Qualifying swim (entry, travel)',   '£100 – £400'],
            ['Training travel (Dover, May–Sep)',  '£500 – £2,000'],
            ['Weather wait week (5–7 nights)',    '£600 – £1,500'],
            ['Equipment + nutrition',             '£200 – £500'],
            ['<strong>Total all-in</strong>',     '<strong>£4,500 – £8,500+</strong>'],
          ],
        },
      },
      {
        h2: 'Pilot fees in detail',
        p: 'The pilot does the navigation, calls the conditions, and witnesses the swim. There are about 12 active CSA pilots and 8 CS&PF pilots; popular ones book out 2+ years ahead.',
        bullets: [
          '<strong>Standard solo pilot fee:</strong> £3,000–£4,500 depending on pilot and year',
          '<strong>Deposit to secure a slot:</strong> £700–£1,200 paid at booking, non-refundable',
          '<strong>Balance:</strong> due in the weeks before your tide window',
          '<strong>Cancellation:</strong> if conditions don\'t allow a swim during your week, you typically forfeit the deposit and rebook for a future tide (some pilots offer rollovers)',
        ],
        callout: { label: 'Watch out', warn: true, body: 'Pilots usually take 4–7 swimmers in a single tide window, ranked 1st through 7th. If you\'re 5th or later you may not swim — and you still pay. Position is everything; book early.' },
      },
      {
        h2: 'The qualifying swim cost',
        p: [
          'Every Channel swimmer must complete a <strong>6-hour swim in water ≤16°C</strong> in the same calendar year as the attempt, witnessed by an approved observer.',
          'For UK swimmers this is usually Dover Harbour on a summer weekend; cost is typically just travel + a small observer fee (£50–£100). International swimmers may need a flight to an organised qualifier at Lake Vyrnwy, Coniston, or similar.',
        ],
      },
      {
        h2: 'The wait week is the hidden cost',
        p: 'Pilots book swimmers into a tide window — a 5–7 day slot. You\'re expected to be in Dover, ready, for the entire week, even though your actual swim may take 1 day. Accommodation in Dover during peak season (Jul–Sep) is £80–£200/night.',
        bullets: [
          'B&Bs near Marine Parade: £80–£140/night',
          'Self-catering apartments: £130–£200/night',
          'Plan for support crew accommodation too if they fly in',
          'Add £300–£800 for travel + meals during the wait',
        ],
      },
      {
        h2: 'How most people fund it',
        p: 'Channel attempts get funded in three common ways:',
        bullets: [
          '<strong>Self-funded</strong> — most swimmers save over the build-up period',
          '<strong>Charity swim</strong> — fundraise for a cause; some swimmers cover their full costs through pledges',
          '<strong>Sponsor support</strong> — rare for solo attempts unless you have a media profile; more common for relays',
        ],
      },
    ],

    faqs: [
      { q: 'Is the pilot fee per swim or per booking?',
        a: 'Per booking. If conditions force you to not swim in your tide window, the deposit is usually forfeited and you re-book and pay again for the next attempt.' },
      { q: 'What\'s cheaper — CSA or CS&PF?',
        a: 'Roughly the same. Registration and observer fees are within ~£20 of each other. Pilot fees vary by individual, not by governing body.' },
      { q: 'Do support crew on the pilot boat have to pay?',
        a: 'No — your support crew rides on the pilot boat for free. They may want to contribute to fuel or tips, but it\'s not required.' },
      { q: 'How much do relays cost compared to solos?',
        a: 'Relays split the pilot fee between team members (4–6 people), so it\'s typically £500–£900 per person plus shared accommodation. See the <a href="/english-channel/relay">relay guide</a>.' },
      { q: 'Are there any cheaper alternatives to the English Channel?',
        a: 'Shorter UK crossings exist — Bristol Channel, the Solent — but they don\'t have the prestige or ratification structure. The English Channel is the original; the cost reflects 150 years of infrastructure.' },
    ],
  },

  // ─── 2. TRAINING PLAN ────────────────────────────────────────────────────
  'training-plan': {
    title: 'English Channel training plan',
    meta: 'How to train for an English Channel solo swim: 18-24 month build, volume progression, cold-water acclimatisation, qualifying swim, taper, sample weeks.',
    eyebrow: 'English Channel · Training guide',
    h1: 'How to train for an English Channel swim',
    lede: 'Most successful Channel swimmers train for <strong>18–24 months</strong>, building from a few kilometres a week to <strong>50+ kilometres at peak</strong>. The pool work matters, but the swim is won in cold open water — not the lap pool.',

    sections: [
      {
        h2: 'The 24-month outline',
        p: 'Channel training breaks down into four phases. The exact timing depends on your starting fitness and your booked tide window, but the pattern is the same for everyone.',
        bullets: [
          '<strong>Months 1–6 (base):</strong> Build pool volume to 20–30 km/week. Get comfortable with continuous 5–7 km sessions.',
          '<strong>Months 7–12 (open water entry):</strong> Move 1–2 sessions/week outdoors. Build to 10 km long swims by autumn.',
          '<strong>Months 13–18 (cold acclimatisation):</strong> Stay in the water through winter at 5–10°C. This phase determines whether you finish.',
          '<strong>Months 19–24 (specific prep + taper):</strong> Peak volume 40–60 km/week, qualifying swim in May–June, taper into your tide window.',
        ],
      },
      {
        h2: 'A sample peak-volume week',
        p: 'Most swimmers training for a July–September attempt look something like this in June (peak block):',
        table: {
          headers: ['Day', 'Session', 'Approx volume'],
          rows: [
            ['Monday',    'Pool — aerobic threshold, 4×1km',     '6 km'],
            ['Tuesday',   'Pool — speed/IM mix',                  '5 km'],
            ['Wednesday', 'Open water — continuous',              '8 km'],
            ['Thursday',  'Pool — long aerobic',                  '7 km'],
            ['Friday',    'Rest or short swim',                   '0–3 km'],
            ['Saturday',  'Open water — long swim with feeds',    '12–15 km'],
            ['Sunday',    'Open water — back-to-back day',        '8 km'],
            ['<strong>Total</strong>', '<strong>—</strong>',      '<strong>46–52 km</strong>'],
          ],
        },
        callout: { label: 'Reality check', body: 'These numbers are typical for swimmers chasing a sub-15-hour crossing. Slower swimmers train less volume but more time-in-water; finishing-only attempts often peak around 30–35 km/week.' },
      },
      {
        h2: 'Cold-water acclimatisation — the make-or-break phase',
        p: [
          'The qualifying swim requires <strong>6 hours in water ≤16°C</strong>. The actual Channel can be anywhere from 14°C to 18°C. The difference between finishers and DNFs is almost always cold tolerance, not pace.',
          'Cold acclimatisation isn\'t about getting tough — it\'s a measurable physiological adaptation. Repeated exposure thickens insulating tissue and reduces the cold-shock response.',
        ],
        bullets: [
          '<strong>October–March:</strong> Swim 2–3× per week in cold open water (5–10°C). Start with 10-minute swims and build.',
          '<strong>Skin first, then duration:</strong> Get used to the entry before extending time. Cold-shock kills attempts.',
          '<strong>Costume only, no wetsuit:</strong> Channel rules require a standard costume. Acclimatise to the same kit.',
          '<strong>Recovery matters:</strong> Eat warm food, dress immediately, never drive home shivering.',
        ],
        callout: { label: 'Safety', warn: true, body: 'Cold-water swimming kills people every year. Always swim with company, in a known location, with someone watching from shore. Get formal cold-water training before going long.' },
      },
      {
        h2: 'Where to train in the UK',
        bullets: [
          '<strong>Dover Harbour</strong> (May–September) — the unofficial Channel training HQ. Saturday/Sunday morning swims with experienced organisers. Most British swimmers do their qualifier here.',
          '<strong>Lake Vyrnwy, Wales</strong> — cold mountain reservoir, hosts organised qualifying swims',
          '<strong>Lake Coniston</strong> — large body of water, used for endurance training',
          '<strong>Local lidos and lakes</strong> — Tooting Bec, Brockwell, Hampstead, Serpentine — all support cold-water training',
        ],
      },
      {
        h2: 'The qualifying swim — your last training milestone',
        p: 'Your final formal training milestone is the qualifier: 6 continuous hours in ≤16°C water, witnessed by an approved observer. Plan it for May or June so you finish before your tide window. See the <a href="/english-channel/qualifying-swim">qualifying swim guide</a> for rules and venues.',
      },
      {
        h2: 'Tapering into your tide window',
        p: 'The two weeks before your attempt are about freshness, not fitness. Drop volume 50% in the final 10 days. Keep one moderate open water swim 3–4 days out so you don\'t feel rusty. Eat properly, sleep more, hydrate, and pack the bag a week ahead.',
      },
    ],

    faqs: [
      { q: 'How fast do I need to be?',
        a: 'There\'s no minimum pace. The fastest crossings are sub-7 hours; the slowest ratified swims have taken over 27 hours. What matters is that your pace × tidal sweep ≤ 12–16 hours from your tide window\'s middle of the night start.' },
      { q: 'Can I train mostly in a pool?',
        a: 'You can do most of the volume in a pool, but you must do significant open-water cold-water training to acclimatise. People who only pool-train usually fail at the qualifier, not the Channel.' },
      { q: 'How much sleep should I be getting?',
        a: 'Endurance training breaks if you sleep less than 8 hours. Most successful Channel swimmers prioritise sleep aggressively in the 6 months before attempt.' },
      { q: 'Is there a typical Channel-swimmer body type?',
        a: 'No. Body fat helps with insulation but isn\'t a requirement. The faster swimmers are typically leaner; finishers come in all shapes. Mental preparation and cold tolerance matter more than physique.' },
      { q: 'How long is the actual swim?',
        a: 'Average is 12–16 hours. World record 6h 45m. Slowest ratified ~27 hours. Most swimmers in their tide window swim 11–18 hours.' },
    ],
  },

  // ─── 3. QUALIFYING SWIM ──────────────────────────────────────────────────
  'qualifying-swim': {
    title: 'English Channel qualifying swim: rules and venues',
    meta: '6 hours non-stop in water ≤16°C, witnessed by an approved observer. Where to qualify (Dover Harbour, Lake Vyrnwy, Coniston), how to prepare, common reasons people fail.',
    eyebrow: 'English Channel · Qualifier guide',
    h1: 'The 6-hour qualifying swim',
    lede: 'Before any Channel pilot will take you out, you must complete a <strong>6-hour non-stop swim in water at or below 16°C</strong>, witnessed by an approved observer, in the same calendar year as your attempt. No qualifier, no swim.',

    sections: [
      {
        h2: 'What the qualifying swim is — and why',
        p: [
          'The qualifier exists because pilots and observers need evidence that you can handle the cold and the duration before they commit a boat and crew to a 12+ hour effort. It\'s not a fitness test of speed; it\'s a proof of cold tolerance.',
          'Both ratifying bodies (CSA and CS&PF) require it, with slightly different rules but the same core: 6 hours, ≤16°C, witnessed.',
        ],
      },
      {
        h2: 'The rules in detail',
        bullets: [
          '<strong>Duration:</strong> 6 hours continuous swimming. Touching the bank/wall counts; getting out does not.',
          '<strong>Water temperature:</strong> 16°C (61°F) or colder for the duration. Temperature must be measured by the observer.',
          '<strong>Equipment:</strong> Standard swimming costume (no neoprene), one cap, goggles, ear plugs. No wetsuit. No tow-floats unless approved.',
          '<strong>Witness:</strong> An approved observer must be present from start to finish. Some clubs and CSA/CS&PF officers do this for free; others charge.',
          '<strong>Feeds:</strong> Allowed every 30–45 minutes, taken from the side without supporting your weight on the boat or pontoon.',
          '<strong>Timing:</strong> Must be completed in the calendar year of your Channel attempt. Last year\'s qualifier doesn\'t count.',
          '<strong>Medical certificate:</strong> Separate requirement — your GP must sign you off as fit for cold-water endurance swimming.',
        ],
        callout: { label: 'Detail that catches people out', warn: true, body: 'If the water temperature rises above 16°C during your swim, the clock stops. Some swimmers have to extend past 6h or come back another day. Confirm temperature monitoring with your observer before you start.' },
      },
      {
        h2: 'Where to do it',
        p: 'Five places UK-based swimmers commonly qualify:',
        bullets: [
          '<strong>Dover Harbour</strong> — Saturday/Sunday morning training sessions from May. Organised, observed, and the closest you can get to actual Channel water without a boat. Most British swimmers qualify here.',
          '<strong>Lake Vyrnwy, Wales</strong> — Cold mountain reservoir, runs an annual organised qualifier in May/June.',
          '<strong>Lake Coniston, Cumbria</strong> — Large body of water, supports multi-hour swims year-round. Cold-water focused.',
          '<strong>Loch Lomond / Scottish lochs</strong> — Cold, scenic, well-organised swim communities. Lengthy season.',
          '<strong>Organised CSA/CS&PF events</strong> — both governing bodies run a few qualifier-friendly events each year. Check their websites.',
        ],
      },
      {
        h2: 'When to do it',
        p: 'Most swimmers aim for <strong>May or June</strong> qualifiers. The water is cold enough (12–15°C in UK lakes and Dover Harbour) and you finish before your peak training month or your tide window. Qualifying later than mid-July leaves you stressed if the swim doesn\'t go to plan.',
      },
      {
        h2: 'Common reasons people fail the qualifier',
        bullets: [
          '<strong>Cold tolerance, not fitness.</strong> Swimmers who can do 6h in the pool can\'t always do 4h in 14°C water. Train cold for 6+ months first.',
          '<strong>Skipping the feed plan.</strong> A 6-hour swim needs ~3–4 feeds. Practice with your actual race-day nutrition before the qualifier.',
          '<strong>Going too hard early.</strong> The qualifier is about completion, not pace. Settle into your Channel pace from minute one.',
          '<strong>Cold-shock from a bad entry.</strong> Acclimatise the entry first; never dive in cold.',
          '<strong>Mental wall around hour 4.</strong> Mental prep is half the work — visualise the back end of the swim before you do it.',
        ],
      },
      {
        h2: 'After you qualify',
        p: 'Once you\'ve qualified, send the observer\'s confirmation to your pilot and the ratifying body. Then keep training — the qualifier is one piece; you still have to handle the longer, colder, harder real swim.',
      },
    ],

    faqs: [
      { q: 'Does it have to be salt water?',
        a: 'No. Lake or reservoir qualifiers are valid. The temperature is the requirement, not the salinity.' },
      { q: 'Can I do two 3-hour swims instead?',
        a: 'No. It must be continuous. Some bodies allow exit only briefly for the toilet, but planned multi-part swims don\'t count.' },
      { q: 'What if I get out at 5h 45m?',
        a: 'You haven\'t qualified. You\'ll need to redo the full 6 hours another day.' },
      { q: 'I qualified last year — does that still count?',
        a: 'No. Both CSA and CS&PF require the qualifier in the same calendar year as your attempt.' },
      { q: 'How much does it cost?',
        a: '£0–£200 for the swim itself depending on venue. Add £50–£150 for the medical certificate (which is annual). See <a href="/english-channel/cost">cost guide</a>.' },
    ],
  },

  // ─── 4. PILOTS ───────────────────────────────────────────────────────────
  'pilots': {
    title: 'English Channel pilots: registered boats and how to book',
    meta: 'Live pilot leaderboard — most ratified English Channel solo crossings by pilot. CSA and CS&PF registered pilots, boats, fees, and how tide windows work.',
    eyebrow: 'English Channel · Pilots',
    h1: 'English Channel pilots and how to book',
    lede: 'A registered pilot is mandatory for any ratified solo crossing. The pilot navigates, monitors conditions, and witnesses your swim. There are around 12 active CSA pilots and 8 CS&PF pilots; the best book out 2+ years ahead.',

    sections: [
      {
        h2: 'Live pilot leaderboard',
        p: 'Ranked by total ratified solo crossings since 1875. Built from the public Channel solo swim database (CSA + CS&PF + historical). Pilots marked ACTIVE have a ratified swim in the last 3 years.',
        dynamic: 'pilots',
      },
      {
        h2: 'CSA vs CS&PF',
        p: [
          'The <strong>Channel Swimming Association (CSA)</strong> is the original governing body, founded 1927. The <strong>Channel Swimming & Piloting Federation (CS&PF)</strong> was formed in 1999 by pilots who wanted independent governance.',
          'For the swimmer, the difference is mostly administrative. Both ratify swims, both publish records, both require qualifiers. Some pilots are registered with both. Pick the body your pilot prefers, or go with the body whose rules suit your situation.',
        ],
      },
      {
        h2: 'How to choose a pilot',
        bullets: [
          '<strong>Availability</strong> — when does your tide window fall? Some pilots are full 2 years out.',
          '<strong>Position</strong> — ask what position you\'d be in their tide. 1st–3rd is comfortable; 5th+ is risky.',
          '<strong>Boat</strong> — bigger boats handle weather better; smaller boats may be cheaper.',
          '<strong>Communication</strong> — talk to past clients. Channel pilots are accessible — call them.',
          '<strong>Specialism</strong> — some pilots do faster swims with elite athletes; others are excellent for first-time finishers.',
        ],
      },
      {
        h2: 'The booking process',
        bullets: [
          '<strong>Contact the pilot directly</strong> — by phone or email, listed on CSA/CS&PF websites.',
          '<strong>Discuss your tide window preferences</strong> — neap tides are easier; spring tides have more sweep.',
          '<strong>Pay deposit £700–£1,200</strong> — secures your slot. Non-refundable.',
          '<strong>Sign the contract</strong> — covers responsibilities, cancellation, force majeure.',
          '<strong>Register with CSA or CS&PF</strong> — annual fee, your pilot will confirm which body.',
          '<strong>Pay balance</strong> — typically due 4–8 weeks before your tide window.',
        ],
        callout: { label: 'Tide window positions', body: 'Your pilot will likely take 4–7 swimmers in the same tide window, ranked 1st through 7th. The leader swims first when weather lifts; later positions wait their turn and may not get a chance if weather closes out. Book early to secure an early position.' },
      },
      {
        h2: 'What the pilot does on the day',
        bullets: [
          '<strong>Calls the swim on or off</strong> the evening before based on forecast',
          '<strong>Navigates the optimal track</strong> through the tide and shipping lanes',
          '<strong>Monitors your condition</strong> with the observer; calls a stop if needed',
          '<strong>Handles feeds and support crew</strong> on the boat',
          '<strong>Witnesses the finish</strong> for ratification',
        ],
      },
    ],

    faqs: [
      { q: 'How early do I need to book?',
        a: 'Popular pilots book 18–24 months ahead for peak season slots. If you want a specific tide window in 2027, book in 2025 or early 2026.' },
      { q: 'Can I switch pilots if my schedule changes?',
        a: 'Sometimes, but deposits are non-refundable. Always discuss flexibility with the pilot at booking.' },
      { q: 'Do I need to bring my own boat?',
        a: 'No — pilots provide the boat, crew and observer. You arrive with your swim kit, feeds, and a support person.' },
      { q: 'Why do pilots take multiple swimmers per tide window?',
        a: 'A tide window is 5–7 days. Only some days are swimmable. Booking 4–7 swimmers lets the pilot send out whoever\'s ready when conditions allow. The trade-off is that not everyone gets to swim.' },
      { q: 'What if my pilot can\'t take me out (illness, mechanical)?',
        a: 'They\'ll usually arrange cover with another pilot in the same body. Confirmed in your contract.' },
    ],
  },

  // ─── 5. RECORDS ──────────────────────────────────────────────────────────
  'records': {
    title: 'English Channel swim records: all-time fastest and milestones',
    meta: 'Live English Channel records: fastest men\'s and women\'s solo, multi-way records, total ratified swims, oldest, youngest, Queen and King of the Channel.',
    eyebrow: 'English Channel · Records',
    h1: 'English Channel records — all-time',
    lede: 'Live records from the <strong>3,443 ratified solo crossings</strong> in the public Channel database (CSA + CS&PF + historical, 1875–present). Click any swimmer\'s name to open their swim page.',

    sections: [
      {
        h2: 'By the numbers',
        p: 'Solo, one-way crossings across all years and both ratifying bodies:',
        dynamic: 'records-leaderboards',
      },
      {
        h2: 'Channel legends',
        bullets: [
          '<strong>Alison Streeter MBE</strong> — 43 successful crossings · "Queen of the Channel"',
          '<strong>Kevin Murphy</strong> — 34+ crossings · "King of the Channel"',
          '<strong>Otto Thaning</strong> — Oldest at 73 (2014, South African cardiologist)',
          '<strong>Tom Gregory</strong> — Youngest at 11 (1988, before age limits)',
          '<strong>Captain Matthew Webb</strong> — First ever, 24–25 Aug 1875, 21h 45m',
          '<strong>Gertrude Ederle</strong> — First woman, 6 Aug 1926, 14h 39m (faster than all 5 previous men)',
          '<strong>Sarah Thomas</strong> — First 4-way crossing, Sep 2019, 54h 10m (cancer survivor)',
        ],
      },
      {
        h2: 'Historical milestones',
        bullets: [
          '<strong>1875</strong> — Webb proves it can be done',
          '<strong>1923</strong> — Enrico Tiraboschi (Italy) wins the Daily Mail prize for first crossing under 16 hours',
          '<strong>1926</strong> — Gertrude Ederle becomes the first woman; her time would have set the men\'s world record',
          '<strong>1961</strong> — Antonio Abertondo (Argentina) completes first two-way crossing',
          '<strong>1981</strong> — Jon Erikson (USA) completes first three-way',
          '<strong>1987</strong> — Philip Rush (NZ) sets the modern multi-way standard with 28h 21m three-way',
          '<strong>2007</strong> — Petar Stoychev (Bulgaria) holds the record briefly before the modern era',
          '<strong>2012</strong> — Trent Grimsey (Australia) sets the world record at 6h 55m',
          '<strong>2019</strong> — Sarah Thomas (USA) completes first four-way',
          '<strong>2023</strong> — Andreas Waschburger (Germany) breaks Grimsey\'s record at 6h 45m 25s',
        ],
      },
    ],

    faqs: [
      { q: 'How is the world record measured?',
        a: 'From entry to exit of water, witnessed by an approved CSA or CS&PF observer. The exit must be on dry land or rock above the waterline.' },
      { q: 'Why are there separate men\'s and women\'s records?',
        a: 'Both bodies ratify gender-separated records. Yvetta Hlaváčová\'s 7:25:15 (2006) is the women\'s record; Andreas Waschburger\'s 6:45:25 (2023) is the men\'s.' },
      { q: 'What\'s the difference between a "ratified" swim and just a swim?',
        a: 'Ratification means the governing body verified that the swim met all rules (witness, equipment, no contact). Unratified swims aren\'t included in records.' },
      { q: 'Are wetsuit swims included?',
        a: 'No. Wetsuit swims are recorded separately and aren\'t eligible for the official records.' },
      { q: 'Why are some old swims missing?',
        a: 'Pre-2000 records are still being verified. The public database flags swims as confirmed by swimmer/family or pulled from historical archives ("Cold in the Channel" and similar).' },
    ],
  },

  // ─── 6. RELAY ────────────────────────────────────────────────────────────
  'relay': {
    title: 'English Channel relay swims: rules, teams, records',
    meta: 'How English Channel relay swims work: 2/3/4/6-person teams, 1-hour rotation rule, costs, finding teammates, records.',
    eyebrow: 'English Channel · Relays',
    h1: 'English Channel relay swims',
    lede: 'Relays let teams of 2–6 swimmers split the crossing with <strong>1-hour rotations</strong>. They\'re cheaper than solos, more social, and a popular entry point for swimmers who aren\'t ready for the full distance — or want to do it with friends.',

    sections: [
      {
        h2: 'How relay rules work',
        bullets: [
          '<strong>Team size</strong> — usually 4 or 6 swimmers. 2 and 3 are allowed; the smaller the team, the harder the swim.',
          '<strong>1-hour rotations</strong> — each swimmer does exactly 1 hour in the water, in a fixed order, looped through the team for the duration of the swim.',
          '<strong>No order changes</strong> — once the team starts, you swim in the same sequence. A swimmer who has to pull out for injury can\'t be replaced.',
          '<strong>Standard equipment</strong> — same as solo: costume, cap, goggles, no neoprene.',
          '<strong>Handovers</strong> — incoming swimmer enters the water; outgoing swimmer touches the incoming swimmer to complete the change.',
        ],
      },
      {
        h2: 'Cost vs solo',
        p: 'The pilot fee is the same; it just gets split between team members. A 4-person relay typically costs each swimmer <strong>£800–£1,200</strong> all-in including registration. A 6-person relay drops that to £600–£900 each.',
      },
      {
        h2: 'Team dynamics',
        p: 'Relays succeed or fail on how well the team trains together. Most successful teams do at least 3–6 group training sessions in the year leading up, including a multi-hour back-to-back in cold water.',
        callout: { label: 'Common mistake', warn: true, body: 'Relay teams formed from solo training partners often underestimate how hard re-entry to cold water is after sitting on a boat for 3 hours. Practice the rotation, not just the swim.' },
      },
      {
        h2: 'Finding teammates',
        bullets: [
          'Local masters clubs and open-water groups',
          'Channel-focused Facebook groups (e.g. "Channel Swimmers")',
          'Dover Harbour summer training — many relay teams form there',
          'Charity swim platforms — sometimes you join an existing team',
        ],
      },
      {
        h2: 'Relay records',
        bullets: [
          '<strong>4-person fastest:</strong> Around 7h. Elite international teams have gone sub-7h.',
          '<strong>6-person fastest:</strong> Sub-7h has been done by mixed-elite teams.',
          '<strong>Youngest relay:</strong> Junior teams (~12yo) have completed crossings with parent crews.',
        ],
        p: 'Relay records aren\'t held to the same scrutiny as solo world records, but CSA and CS&PF both publish ratified relay times.',
      },
    ],

    faqs: [
      { q: 'Can I do a relay as my first Channel swim before going solo?',
        a: 'Yes, and many people do. It gives you boat experience, weather understanding, and a sense of the route before you commit to a solo.' },
      { q: 'What if a teammate gets injured mid-swim?',
        a: 'The team is disqualified — relays can\'t substitute swimmers. Confirmed in writing before the swim.' },
      { q: 'Does the relay still count if conditions force a stop?',
        a: 'If the team comes out of the water before reaching France, no, it\'s not ratified. Same as solo.' },
      { q: 'Is the relay shorter than the solo?',
        a: 'No, same distance. The team usually finishes faster than a solo though, since fresh swimmers each hour.' },
      { q: 'Can mixed-gender teams do relays?',
        a: 'Yes. Both CSA and CS&PF accept mixed-gender teams.' },
    ],
  },

  // ─── 7. JELLYFISH ───────────────────────────────────────────────────────
  'jellyfish': {
    title: 'Jellyfish in the English Channel: species, timing, stings',
    meta: 'What jellyfish are in the English Channel, when they peak (lion\'s mane Aug-Sep, compass Jul-Aug), how to handle stings, and what swimmers do about them.',
    eyebrow: 'English Channel · Jellyfish guide',
    h1: 'Jellyfish in the English Channel',
    lede: 'Most Channel swimmers get stung. Few abandon their swim because of it. Knowing what\'s in the water and how to handle stings is part of the preparation — not something to fear.',

    sections: [
      {
        h2: 'The four common species',
        bullets: [
          '<strong>Lion\'s mane (Cyanea capillata)</strong> — Reddish-brown, large (50cm+ bell), trailing tentacles up to several metres. The big one Channel swimmers worry about. Peak late August through September.',
          '<strong>Compass jellyfish (Chrysaora hysoscella)</strong> — Pale with dark V-shaped markings on the bell. Painful sting but usually short-lived. Peak July–August.',
          '<strong>Moon jellyfish (Aurelia aurita)</strong> — Translucent with four pink rings. Common but mild sting; many swimmers don\'t feel them.',
          '<strong>Barrel jellyfish (Rhizostoma pulmo)</strong> — Big (up to 1m), creamy-white. Rare in the Channel; mild sting if at all.',
        ],
      },
      {
        h2: 'When jellyfish peak',
        p: 'Channel jellyfish numbers are very weather-dependent. Warm summers + onshore winds can bring big blooms; cooler summers may see almost none. As a rough guide:',
        bullets: [
          '<strong>May–June:</strong> Few jellyfish; moon if any',
          '<strong>July–early August:</strong> Compass jellies appear; some lion\'s mane juveniles',
          '<strong>Late August–September:</strong> Peak lion\'s mane season; biggest stings of the year',
          '<strong>October onwards:</strong> Numbers drop as water cools',
        ],
        callout: { label: 'Tip', body: 'Pilots often know the day-of jellyfish density from their morning trip out. Ask before you start. They can sometimes steer slightly off-line to avoid known patches, though once you\'re in the open Channel it\'s luck.' },
      },
      {
        h2: 'What a sting feels like',
        bullets: [
          '<strong>Lion\'s mane</strong> — sharp, burning, leaves visible welts. The tentacles can wrap around limbs and the sting continues until detached. Worst stings can take hours to ease.',
          '<strong>Compass</strong> — sharp localised sting, like a slap. Usually fades in 20–40 minutes.',
          '<strong>Moon</strong> — most swimmers feel nothing or a mild tingle.',
          '<strong>Cumulative effect</strong> — multiple stings over hours wear you down mentally more than physically.',
        ],
      },
      {
        h2: 'How to handle a sting during a swim',
        bullets: [
          '<strong>Don\'t rub.</strong> Rubbing breaks unfired nematocysts and makes it worse.',
          '<strong>Don\'t pee on it.</strong> Doesn\'t work, may make it worse, you\'re also in the sea.',
          '<strong>Keep moving.</strong> Once you\'re past the jellyfish, the sting will ease on its own.',
          '<strong>Note where you got stung.</strong> Tell your boat at the next feed so they can prep recovery.',
          '<strong>Lion\'s mane wrap-around?</strong> Try to peel tentacles off with the back of your hand or arm, not fingertips.',
        ],
      },
      {
        h2: 'After the swim',
        p: 'Vinegar (white, undiluted) deactivates remaining nematocysts on the skin. Most pilot boats carry it. After vinegar, warm water (40–45°C) or a hot shower helps with pain. Anti-inflammatories like ibuprofen reduce welts and itching. Severe stings may need medical attention but rarely do.',
      },
      {
        h2: 'Will jellyfish stop you from finishing?',
        p: 'Almost never on their own. Most successful Channel swimmers report multiple stings. The cumulative mental cost can compound with cold and fatigue, so build mental resilience to discomfort during training — including swimming through brief stings if you encounter them in open water.',
      },
    ],

    faqs: [
      { q: 'Is there a sting-blocking suit?',
        a: 'Some swimmers wear "stinger suits" (full-body lycra). Not allowed under Channel rules — only standard costume, cap, goggles permitted.' },
      { q: 'Does cold water mean fewer jellyfish?',
        a: 'Generally yes, but blooms are weather-driven. A cold August can still have lion\'s mane if conditions are right.' },
      { q: 'Are there sharks or stingrays?',
        a: 'Very rarely sighted in the Channel. Not a real risk for swimmers.' },
      { q: 'Should I take anti-histamines as a precaution?',
        a: 'Many swimmers take ibuprofen at feeds to reduce inflammation from jelly stings. Discuss with your doctor and your pilot before the swim.' },
      { q: 'Has anyone been seriously injured by Channel jellyfish?',
        a: 'Severe reactions are rare. The cumulative effect of dozens of lion\'s mane stings has stopped a small number of swimmers, but it\'s uncommon.' },
    ],
  },

  // ─── 8. TIDE WINDOWS ─────────────────────────────────────────────────────
  'tide-windows': {
    title: 'English Channel tide windows: how booking and timing work',
    meta: 'Channel tides cycle every 14 days between neap and spring. How pilots book tide windows, what 1st-7th position means, and why most swimmers book neaps.',
    eyebrow: 'English Channel · Tide windows',
    h1: 'How English Channel tide windows work',
    lede: 'Channel tides cycle every <strong>14 days</strong> between neap (lower water movement) and spring (higher). Your booked "tide window" is a 5–7 day slot in one of those cycles. Understanding tides is the difference between a swim that goes and one that doesn\'t.',

    sections: [
      {
        h2: 'The 14-day cycle',
        p: 'The Channel is semi-diurnal: two highs and two lows every ~24 hours. Twice each lunar month, around the new and full moon, you get <strong>spring tides</strong> — bigger range, stronger currents. Halfway between, around the quarter moons, you get <strong>neap tides</strong> — smaller range, gentler currents.',
        callout: { label: 'How to read it', body: 'For Dover specifically, High Water above ~6.1m means spring tide; below ~6.1m means neap. Live tide data is on the Channel hub page.' },
      },
      {
        h2: 'Spring vs neap — what it means for your swim',
        table: {
          headers: ['', 'Neap', 'Spring'],
          rows: [
            ['Tide range Dover',    '~3.0–5.5m',         '~5.5–7.5m'],
            ['Current strength',    'Moderate',          'Strong'],
            ['Effective distance',  '~35 km',            '~40 km'],
            ['Predictability',      'High',              'Moderate'],
            ['Best for',            'Most swimmers',     'Faster swimmers'],
            ['Most pilots take',    'Yes',               'Some'],
          ],
        },
        p: 'Slower swimmers should book neap tides. Faster swimmers (sub-12 hour finishers) can use spring tides to their advantage but risk overshooting Cap Gris-Nez if they\'re not fast enough.',
      },
      {
        h2: 'How pilots book windows',
        bullets: [
          '<strong>Window = 5–7 day slot</strong> centered on a neap tide cycle',
          '<strong>4–7 swimmers per window</strong> with a ranked position (1st, 2nd, etc.)',
          '<strong>Position 1 goes first</strong> when weather lifts — usually a 12–18 hour swim',
          '<strong>Position 2+ wait their turn</strong> — each takes ~24–36 hours including recovery',
          '<strong>Standby position</strong> picks up if higher positions cancel',
          '<strong>Pilots make the call evening before</strong> based on weather + position',
        ],
        callout: { label: 'Reality of late positions', warn: true, body: 'If you\'re 5th in tide and the weather only allows 2 swims that week, you don\'t swim and you re-book for a future tide. Book early to secure 1st–3rd position.' },
      },
      {
        h2: 'Tide window math for your speed',
        p: 'A 13-hour swimmer in neap tides covers roughly the same effective distance (~35 km) as the straight-line crossing (~33 km). A 9-hour swimmer in spring tides may cover 40+ km because of the sweep. Your pilot will plan the line based on your expected pace.',
      },
      {
        h2: 'Upcoming neap windows (2026–2028)',
        p: 'Neap dates around the quarter moons. Pilots book these well in advance. Approximate dates (always confirm with your pilot):',
        bullets: [
          '<strong>2026:</strong> Jun 22, Jul 6, Jul 20, Aug 3, Aug 17, Aug 31, Sep 14, Sep 28',
          '<strong>2027:</strong> Jun 11, Jun 25, Jul 9, Jul 23, Aug 6, Aug 20, Sep 3, Sep 17, Oct 1',
          '<strong>2028:</strong> Jun 16, Jun 30, Jul 14, Jul 28, Aug 11, Aug 25, Sep 8, Sep 22',
        ],
      },
    ],

    faqs: [
      { q: 'Can I just pick a date and swim?',
        a: 'No. You\'re working within your pilot\'s window allocation. They give you a 5–7 day slot, not a specific day.' },
      { q: 'What if no swim happens in my window?',
        a: 'You re-book for the next available window with your pilot. Deposit usually doesn\'t roll over; you pay again.' },
      { q: 'Are weekend tides different from weekday?',
        a: 'No — tides are governed by the moon, not the calendar. Your tide window can fall any day of the week.' },
      { q: 'How early do I need to be in Dover?',
        a: 'At least 1 day before your window opens. Pilots will often want you available from day 1 since they may call a swim with 6–12 hours notice.' },
      { q: 'Why do I have to be in Dover the whole week?',
        a: 'Because weather changes daily and the call to swim happens the evening before. If you\'re in London expecting 48 hours notice, you\'ll miss your chance.' },
    ],
  },

  // ─── 9. FAMOUS SWIMS ────────────────────────────────────────────────────
  'famous-swims': {
    title: 'Famous English Channel swims: history and legends',
    meta: 'The most famous English Channel crossings: Matthew Webb (1875), Gertrude Ederle (1926), Florence Chadwick, Alison Streeter, Sarah Thomas (4-way), Andreas Waschburger.',
    eyebrow: 'English Channel · Famous swims',
    h1: 'Famous English Channel swims',
    lede: 'The Channel has 150 years of history and 3,443 ratified solo crossings. These are the swims that defined the sport — each links to the full data on their dedicated page.',

    sections: [
      {
        h2: 'Captain Matthew Webb — 24-25 August 1875',
        p: '<strong>The first.</strong> Webb proved the Channel could be swum, covering it in <strong>21 hours 45 minutes</strong> from Dover to Calais using breaststroke and porpoise fat for warmth. He died seven years later attempting to swim through the rapids below Niagara Falls. <em><a href="/english-channel/swim/matthew-webb-1875">Read his swim page →</a></em>',
      },
      {
        h2: 'Gertrude Ederle — 6 August 1926',
        p: '<strong>The first woman, and the fastest swim to that date.</strong> 19-year-old American Olympic gold medallist swam from France to England in <strong>14 hours 39 minutes</strong>, beating all five previous male crossings by hours. She came home to a New York ticker-tape parade. <em><a href="/english-channel/swim/gertrude-ederle-1926">Read her swim page →</a></em>',
      },
      {
        h2: 'Florence Chadwick — 1950, 1951, 1953',
        p: 'American swimmer who took the women\'s record in 1950 (13h 23m) and crossed both directions multiple times, becoming a celebrity and proving cold-water marathon swimming was a professional discipline.',
      },
      {
        h2: 'Antonio Abertondo — 21 September 1961',
        p: '<strong>First two-way crossing.</strong> Argentinian completed the round trip in 43h 4m. Until then most thought it was physically impossible to swim both ways back-to-back.',
      },
      {
        h2: 'Philip Rush — 16-17 August 1987',
        p: '<strong>First three-way crossing.</strong> New Zealand swimmer Rush set the modern multi-way standard in <strong>28h 21m</strong>. The record still stands.',
      },
      {
        h2: 'Alison Streeter MBE — 1982–2003',
        p: '<strong>"Queen of the Channel"</strong> — 43 successful crossings, more than anyone else in history. Made the Channel her career.',
      },
      {
        h2: 'Trent Grimsey — 8 September 2012',
        p: '<strong>Long-standing world record.</strong> Australian Olympic open-water swimmer crossed in <strong>6h 55m</strong>, holding the men\'s record for 11 years.',
      },
      {
        h2: 'Sarah Thomas — 15-17 September 2019',
        p: '<strong>First-ever four-way crossing.</strong> American Thomas swam the Channel <strong>four times non-stop</strong> in 54h 10m — a year after finishing breast cancer treatment. The swim is widely considered one of the greatest endurance feats in any sport. <em><a href="/english-channel/swim/sarah-thomas-2019">Read her swim page →</a></em>',
      },
      {
        h2: 'Andreas Waschburger — 8 September 2023',
        p: '<strong>Current world record.</strong> German Olympic open-water swimmer broke Grimsey\'s 11-year-old mark by 10 minutes, crossing in <strong>6h 45m 25s</strong>. Pilot: Michael Oram. <em><a href="/english-channel/swim/andreas-waschburger-2023">Read his swim page →</a></em>',
      },
      {
        h2: 'And 3,400+ more',
        p: 'The famous swims above are the headline acts, but every ratified crossing has its own story. <a href="${HUB}">Browse the database</a> to find any swimmer\'s record — including yours, if you\'ve done one.',
      },
    ],

    faqs: [
      { q: 'Who has swum the Channel the most times?',
        a: 'Alison Streeter MBE with 43 successful solo crossings. Kevin Murphy is the men\'s leader with 34+.' },
      { q: 'Who was the youngest to swim it?',
        a: 'Tom Gregory in 1988 at age 11. Minimum ages have since been set at 16 (CSA) and 17 (CS&PF).' },
      { q: 'Who was the oldest?',
        a: 'Otto Thaning, South African cardiologist, at age 73 in 2014.' },
      { q: 'Has anyone done a five-way crossing?',
        a: 'Not yet ratified. Sarah Thomas\'s four-way (2019) stands as the longest.' },
      { q: 'Is there a swim faster than Waschburger\'s 6:45:25?',
        a: 'Not as of 2025. Watch the records page — it updates live from the database.' },
    ],
  },

  // ─── 10. DATA SOURCES & ATTRIBUTION ──────────────────────────────────────
  'data-sources': {
    title: 'English Channel data sources & attribution',
    meta: 'Where SwimLoading\'s English Channel data comes from, how it\'s attributed, and how to request a correction or removal.',
    eyebrow: 'English Channel · Data sources',
    h1: 'Data sources & attribution',
    lede: 'SwimLoading publishes English Channel data drawn from public records, public APIs, and a community-maintained swim database. We credit every source and provide a route for individuals to request corrections or removal.',

    sections: [
      {
        h2: 'The Channel solo swim database',
        p: [
          'The 3,443 ratified solo crossings indexed on SwimLoading come from a <strong>public, community-maintained spreadsheet</strong> compiled from <strong>Channel Swimming Association (CSA)</strong> published records, <strong>Channel Swimming &amp; Piloting Federation (CS&amp;PF)</strong> records, the historical book <em>It\'s Cold in the Channel</em>, and direct confirmations from individual swimmers.',
          'The database is hosted publicly via <a href="https://db.marathonswimmers.org" target="_blank" rel="noopener">LongSwims (db.marathonswimmers.org)</a> and is maintained by the marathon swimming community.',
        ],
        callout: { label: 'Why we publish it', body: 'Channel records are part of the public sporting record — names, times, dates, and pilots have always been published by the governing bodies. We index that record so swimmers, families, and researchers can search it.' },
      },
      {
        h2: 'Live conditions and forecasts',
        bullets: [
          '<strong>Sea surface temperature</strong> — NOAA OISST v2.1 (National Oceanic &amp; Atmospheric Administration, US public domain) via the NCEI ERDDAP server',
          '<strong>Sandettie Lightship buoy</strong> (NDBC station 62304) — observed wind and water temperature, NOAA public domain',
          '<strong>16-day wind &amp; astronomy</strong> — <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> Forecast API (CC BY 4.0 attribution)',
          '<strong>10-day wave &amp; swell</strong> — Open-Meteo Marine API (CC BY 4.0 attribution)',
          '<strong>Tide times at Dover</strong> — <a href="https://www.worldtides.info" target="_blank" rel="noopener">WorldTides</a> commercial API',
        ],
      },
      {
        h2: 'What we publish about each swim',
        p: 'For each ratified crossing we display facts that are already in the public sporting record:',
        bullets: [
          'Swimmer name and nationality',
          'Year and (where known) exact date',
          'Crossing time and direction',
          'Pilot and boat',
          'Multi-way information (2/3/4-way)',
          'Governing body that ratified the swim',
          'Public honours (e.g. IMSHOF — International Marathon Swimming Hall of Fame)',
        ],
        callout: { label: 'What we do not publish', warn: true, body: 'We do not display sensitive personal information (disability or health markers) from the source database, even when present. We retain such fields in our database for completeness but render only public sporting facts on swim pages.' },
      },
      {
        h2: 'Request a correction or removal',
        p: [
          'If a swim page contains an error, or if you are the swimmer (or next of kin) and would like to be removed or have your details changed, please contact us directly. We respond within 7 working days and we don\'t require legal process for reasonable requests.',
          'Email <a href="mailto:hello@swimloading.com?subject=Channel%20swim%20page%20request"><strong>hello@swimloading.com</strong></a> with the URL of the swim page and what you\'d like changed.',
        ],
        callout: { label: 'For minors', body: 'Swims by individuals who were under 18 at the time of the crossing receive heightened protection. If you are a parent or guardian of a minor whose swim is indexed here and you\'d prefer it not be, we will remove the page on request, no questions asked.' },
      },
      {
        h2: 'How the live records pages stay current',
        p: 'The Channel solo swim database is updated by the community as new ratified swims are confirmed. We refresh our copy regularly. The most recent revision visible in our records was <strong>29 November 2025</strong>. New crossings ratified after that date are imported in periodic syncs.',
      },
      {
        h2: 'Attribution policy',
        bullets: [
          'Every records, pilots, and search result block displays the source attribution',
          'Individual swim pages link back to the LongSwims database',
          'Forecast data sources are credited where the data appears',
          'Open-Meteo data is used under CC BY 4.0 — credit displayed on the hub page',
        ],
      },
      {
        h2: 'Acceptable use of SwimLoading data',
        p: 'You\'re welcome to link to SwimLoading swim pages from articles, social posts, or your own website. If you\'d like to use SwimLoading\'s pilot leaderboard or records tables in your own publication, please email us first — we\'ll usually say yes.',
      },
    ],

    faqs: [
      { q: 'Why is my swim on SwimLoading?',
        a: 'If your Channel crossing was ratified by CSA or CS&PF, your name and time are part of the public sporting record. SwimLoading indexes that record to make it searchable. You can request removal at any time — email hello@swimloading.com.' },
      { q: 'I want my swim removed. How long does it take?',
        a: 'We respond within 7 working days. Reasonable removal requests don\'t require legal process.' },
      { q: 'The time / pilot / year is wrong for my swim. Can you fix it?',
        a: 'Yes. Email us with the swim URL and the correct details. We\'ll update our copy and may flag the correction back to the source database.' },
      { q: 'Can I download the data?',
        a: 'The underlying database is public at <a href="https://db.marathonswimmers.org" target="_blank" rel="noopener">db.marathonswimmers.org</a>. Please use that as your source rather than scraping SwimLoading.' },
      { q: 'Do you sell the data?',
        a: 'No. SwimLoading\'s paid tier (Channel Pro) provides the intelligence layer — personal tide-window scoring, 16-day forecasts, the predictor. The underlying ratified swim records are publicly viewable.' },
    ],
  },

};
