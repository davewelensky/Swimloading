// SSR handler for /crossings/[slug] — the shared crossing template.
//
// SEO increment 3. The eleven /crossings/* pages were hand-written; their
// content was moved INTO the crossings table first (increments 2 + the
// page-heads migration), and this template renders it back out. The order
// mattered: rendering from the table before the backfill would have
// replaced a 1,900-word page with three facts.
//
// ENGLISH CHANNEL IS EXCLUDED BY DESIGN. Its page is 3% parity with the
// table, 197 KB, and anchors its own routed content cluster
// (/english-channel/cost, /pilots, /records…). It keeps its hand-written
// file; this handler refuses the slug so a routing mistake cannot quietly
// replace it with a thinner page.
//
// Rows without page content (custom-marathon-swim, robben-island) are
// app-side concepts, not public pages — they 404 here rather than getting
// a crossing page by accident. robben-island already has its own page at
// /robben.

import { dbGet, escapeHtml } from './seo-utils.js';
import { isPublicPageIndexable, robotsFor } from './_lib/indexability.js';

const NEVER_TEMPLATED = new Set(['english-channel']);

export default async function handler(req, res) {
  const path = (req.url || '').split('?')[0];
  const slug = path.split('/').filter(Boolean)[1] || '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  try {
    if (!slug || NEVER_TEMPLATED.has(slug)) return res.status(404).send(render404(slug));
    const rows = await dbGet(`crossings?slug=eq.${encodeURIComponent(slug)}&is_active=eq.true&select=*&limit=1`);
    const crossing = rows?.[0];
    // No row, or a row that never had a page (no backfilled content) — the
    // table holds app-side concepts too, and they must not become pages.
    if (!crossing || !crossing.intro || !crossing.key_facts?.length) {
      return res.status(404).send(render404(slug));
    }
    return res.status(200).send(renderCrossingPage(crossing));
  } catch (err) {
    console.error('[crossings-handler]', err);
    return res.status(500).send(renderError());
  }
}

// ─── THE TEMPLATE ─────────────────────────────────────────────────────────────
// Pure function of one crossings row, exported so scripts/render-crossing.mjs
// can render a page offline and diff it against the live file before any
// route is switched.

export function renderCrossingPage(c) {
  const copy = c.page_copy || {};
  const facts = c.key_facts || [];
  const fact = (re) => facts.find(f => re.test(f.label));

  // "False Bay Crossing" renders as "False Bay"; names already ending in
  // "Swim" (Rottnest Channel Swim, Manhattan Island Marathon Swim) keep it.
  const displayName = c.name.replace(/\s+Crossing$/i, '');
  const titleName = /swim$/i.test(displayName) ? displayName : `${displayName} Swim`;
  const title = `${titleName} — Conditions, Distance & Preparation | SwimLoading`;
  const description = c.seo_description || c.description || '';
  const canonical = `https://www.swimloading.com/crossings/${c.slug}`;

  // Hero h1 — the cyan span is cosmetic; last word, or last two on long names.
  const words = displayName.toUpperCase().split(/\s+/);
  const cut = words.length >= 4 ? words.length - 2 : words.length - 1;
  const h1 = `${escapeHtml(words.slice(0, cut).join(' '))} <span>${escapeHtml(words.slice(cut).join(' '))}</span>`;

  const DIFF_CLASS = { 'extreme': 'diff-extreme', 'very hard': 'diff-vh', 'hard': 'diff-h' };
  const diffLabel = copy.difficulty_label || (c.difficulty === 'extreme' ? 'Extreme' : 'Hard');
  const diffClass = DIFF_CLASS[diffLabel.toLowerCase()] || 'diff-h';

  const chips = [
    fact(/^distance/i) && `<span class="stat-chip dist">${escapeHtml(fact(/^distance/i).val)}</span>`,
    fact(/temperature/i) && `<span class="stat-chip temp">${escapeHtml(fact(/temperature/i).val)}</span>`,
    `<span class="stat-chip ${diffClass}">${escapeHtml(diffLabel)}</span>`,
    fact(/season/i) && `<span class="stat-chip season">${escapeHtml(fact(/season/i).val)}</span>`,
  ].filter(Boolean).join('\n        ');

  const factCards = facts.map(f => `
            <div class="card">
                <div class="fact-label">${escapeHtml(f.label)}</div>
                <div class="fact-val">${escapeHtml(f.val)}</div>
                ${f.note ? `<div class="fact-note">${escapeHtml(f.note)}</div>` : ''}
            </div>`).join('');

  const list = (items) => (items || []).map(i => `<li>${escapeHtml(i)}</li>`).join('\n                ');
  const aboutParas = (c.about_md || '').split(/\n\n+/).filter(Boolean)
    .map(p => `<p>${escapeHtml(p)}</p>`).join('\n                ');
  const prepParas = (c.preparation || []).map(p => `<p>${escapeHtml(p)}</p>`).join('\n                ');

  const faqItems = (c.faqs || []).map(f => `
            <div class="faq-item">
                <div class="faq-q">${escapeHtml(f.q)}</div>
                <div class="faq-a">${escapeHtml(f.a)}</div>
            </div>`).join('');

  const jsonLdBreadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'SwimLoading', item: 'https://www.swimloading.com' },
      { '@type': 'ListItem', position: 2, name: 'Crossings', item: 'https://www.swimloading.com/crossings' },
      { '@type': 'ListItem', position: 3, name: c.name, item: canonical },
    ],
  };
  const jsonLdFaq = (c.faqs || []).length ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: c.faqs.map(f => ({
      '@type': 'Question', name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  } : null;
  const ldTags = [jsonLdBreadcrumb, jsonLdFaq].filter(Boolean)
    .map(d => `<script type="application/ld+json">${JSON.stringify(d)}</script>`).join('\n    ');

  const robots = robotsFor(isPublicPageIndexable(c, 'crossing'));

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-89R519Y9T4"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-89R519Y9T4');</script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta name="robots" content="${robots}">
    <link rel="canonical" href="${canonical}">
    <meta property="og:title" content="${escapeHtml(titleName)} Guide | SwimLoading">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="${canonical}">
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
    <link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet">
    ${ldTags}
    <style>${PAGE_CSS}</style>
</head>
<body>
<nav>
    <a href="/" class="nav-brand"><img src="/icons/logo-wave.png" alt="">SwimLoading</a>
    <div class="nav-right">
        <a href="/crossings" class="nav-back">All crossings</a>
        <a href="/app" class="nav-cta">Open App</a>
    </div>
</nav>

<div class="hero">
    <div class="hero-eyebrow">${escapeHtml(copy.eyebrow || '')}</div>
    <h1>${h1}</h1>
    <p class="hero-sub">${escapeHtml(c.intro)}</p>
    <div class="stat-row">
        ${chips}
    </div>
</div>

<div class="container">
    <div class="section">
        <div class="section-title">Key Facts</div>
        <div class="two-col">${factCards}
        </div>
    </div>

    <div class="section">
        <div class="section-title">${escapeHtml(copy.challenge_title || 'What Makes It Challenging')}</div>
        <div class="highlight-box">
            <h3>Primary Hazards</h3>
            <ul>
                ${list(c.hazards)}
            </ul>
        </div>
        <div class="highlight-box amber">
            <h3>Conditions Overview</h3>
            <ul>
                ${list(c.conditions)}
            </ul>
        </div>
    </div>

    ${aboutParas ? `<div class="section">
        <div class="section-title">About The Crossing</div>
        <div class="card">
            <div class="prose">
                ${aboutParas}
            </div>
        </div>
    </div>` : ''}

    <div class="section">
        <div class="section-title">Preparation Guide</div>
        ${(c.prep_benchmarks || []).length ? `<div class="highlight-box green">
            <h3>${escapeHtml(copy.benchmarks_label || 'Training Benchmarks')}</h3>
            <ul>
                ${list(c.prep_benchmarks)}
            </ul>
        </div>` : ''}
        ${prepParas ? `<div class="card">
            <div class="prose">
                ${prepParas}
            </div>
        </div>` : ''}
    </div>

    ${faqItems ? `<div class="section">
        <div class="section-title">Frequently Asked Questions</div>
        <div class="card">${faqItems}
        </div>
    </div>` : ''}

    <div class="readiness-section">
        <h2>${escapeHtml(copy.readiness_title || `${displayName} Readiness Check`)}</h2>
        <p>${escapeHtml(copy.readiness_blurb || 'Enter your current training stats for an indicative readiness score.')}</p>
        <div class="readiness-form">
            <div class="form-field">
                <label>Longest single swim (km)</label>
                <input type="number" id="rc_longest" placeholder="e.g. 10" min="0" step="0.5">
            </div>
            <div class="form-field">
                <label>Weekly volume (km)</label>
                <input type="number" id="rc_weekly" placeholder="e.g. 25" min="0" step="1">
            </div>
            <div class="form-field">
                <label>Coldest water swum (°C)</label>
                <input type="number" id="rc_coldest" placeholder="e.g. 14" min="0" max="35" step="0.5">
            </div>
            <div class="form-field">
                <label>Open water swims this year</label>
                <input type="number" id="rc_ow" placeholder="e.g. 20" min="0" step="1">
            </div>
        </div>
        <button class="readiness-submit" onclick="calcReadiness()">Calculate My Readiness</button>
        <div class="score-result" id="rc_result"></div>
    </div>

    <div class="bottom-cta">
        <h2>${escapeHtml(copy.cta_title || 'Build Your Open Water Log')}</h2>
        <p>${escapeHtml(copy.cta_blurb || `Track every training swim and water temperature as you build toward your ${displayName} crossing.`)}</p>
        <div class="cta-row">
            <a href="/app" class="btn-primary">Open SwimLoading</a>
            <a href="/crossings" class="btn-ghost">All Crossings</a>
        </div>
    </div>
</div>

<script>
const CROSSING={name:${JSON.stringify(c.name)},distKm:${Number(c.distance_km) || 0},tempMin:${Number(c.typical_temp_min_c) || 0},tempMax:${Number(c.typical_temp_max_c) || 0}};
function calcReadiness(){
    const longest=parseFloat(document.getElementById('rc_longest').value)||0;
    const weekly=parseFloat(document.getElementById('rc_weekly').value)||0;
    const coldest=parseFloat(document.getElementById('rc_coldest').value);
    const owSwims=parseFloat(document.getElementById('rc_ow').value)||0;
    const resultEl=document.getElementById('rc_result');
    if(isNaN(coldest)){alert('Please enter your coldest water temperature.');return;}
    const ls=Math.min(30,longest/CROSSING.distKm*30);
    const ws=Math.min(25,weekly/(CROSSING.distKm*1.5)*25);
    const cs=coldest<=CROSSING.tempMin?25:coldest<=CROSSING.tempMax?18:8;
    const os=Math.min(20,owSwims/12*20);
    const total=Math.round(ls+ws+cs+os);
    const bands=[{min:80,label:'Strong preparation base',color:'#10b981'},{min:60,label:'Developing preparation base',color:'#38bdf8'},{min:40,label:'Significant preparation gaps',color:'#f59e0b'},{min:0,label:'Early preparation stage',color:'#ef4444'}];
    const band=bands.find(b=>total>=b.min);
    resultEl.innerHTML='<div style="text-align:center;margin-bottom:16px;"><div class="score-number" style="color:'+band.color+'">'+total+'</div><div style="font-size:11px;color:var(--text-sec);margin-top:2px;">out of 100</div><div style="font-size:13px;font-weight:700;color:'+band.color+';margin-top:4px;">'+band.label+'</div></div><div class="score-breakdown"><div class="score-item"><div class="score-item-label">Long swim</div><div class="score-item-val" style="color:'+(Math.round(ls)>=20?'#10b981':'#f59e0b')+'">'+Math.round(ls)+'/30</div></div><div class="score-item"><div class="score-item-label">Weekly volume</div><div class="score-item-val" style="color:'+(Math.round(ws)>=18?'#10b981':'#f59e0b')+'">'+Math.round(ws)+'/25</div></div><div class="score-item"><div class="score-item-label">Cold water</div><div class="score-item-val" style="color:'+(cs>=22?'#10b981':'#f59e0b')+'">'+cs+'/25</div></div><div class="score-item"><div class="score-item-label">Open water</div><div class="score-item-val" style="color:'+(Math.round(os)>=15?'#10b981':'#f59e0b')+'">'+Math.round(os)+'/20</div></div></div><div class="disclaimer">Readiness scoring is indicative only and does not replace coaching or medical advice.</div>';
    resultEl.className='score-result visible';
    if(typeof gtag==='function')gtag('event','readiness_score_calculated',{crossing_name:CROSSING.name,readiness_score:total});
}
document.addEventListener('mousemove',e=>{document.body.style.setProperty('--mouse-x',e.clientX+'px');document.body.style.setProperty('--mouse-y',e.clientY+'px');});
</script>
</body>
</html>`;
}

// Verbatim from the hand-written crossing pages this template replaced
// (deleted 2026-08-14; strait-of-gibraltar.html was the canonical
// generation — see git history). The template was a re-plumbing, not a
// redesign. Brand rules: #080f1a, cyan #38bdf8, Bebas Neue + DM Sans,
// pill buttons, mouse spotlight.
const PAGE_CSS = `
    :root{--bg:#080f1a;--bg-card:#0d1728;--cyan:#38bdf8;--ocean:#0ea5e9;--text:#f1f5f9;--text-sec:#64748b;--border:rgba(255,255,255,0.06);--amber:#f59e0b;--green:#10b981;--danger:#ef4444;}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    body{background:var(--bg);color:var(--text);font-family:'DM Sans',-apple-system,sans-serif;min-height:100vh;padding-bottom:60px;}
    body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:9999;background:radial-gradient(18px circle at var(--mouse-x,-999px) var(--mouse-y,-999px),rgba(56,189,248,0.55),transparent 100%),radial-gradient(500px circle at var(--mouse-x,-999px) var(--mouse-y,-999px),rgba(56,189,248,0.07),transparent 70%);}
    nav{background:rgba(8,15,26,0.92);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:12px 20px;position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;}
    .nav-brand{display:flex;align-items:center;gap:7px;text-decoration:none;font-size:18px;font-weight:800;letter-spacing:-0.5px;background:linear-gradient(135deg,#38bdf8 0%,#0ea5e9 50%,#0284c7 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
    .nav-brand img{height:22px;width:auto;}
    .nav-right{display:flex;align-items:center;gap:10px;}
    .nav-back{font-size:12px;color:var(--text-sec);text-decoration:none;padding:6px 12px;border:1px solid var(--border);border-radius:50px;}
    .nav-back:hover{color:var(--cyan);border-color:rgba(56,189,248,0.3);}
    .nav-cta{display:inline-block;padding:8px 18px;border-radius:50px;background:var(--cyan);color:#080f1a;font-size:13px;font-weight:700;text-decoration:none;}
    .hero{padding:48px 20px 36px;max-width:700px;margin:0 auto;text-align:center;}
    .hero-eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.25);padding:4px 14px;border-radius:50px;margin-bottom:20px;}
    .hero h1{font-family:'Bebas Neue',sans-serif;font-size:clamp(36px,8vw,60px);line-height:1.05;color:var(--text);margin-bottom:16px;letter-spacing:.02em;}
    .hero h1 span{color:var(--cyan);}
    .hero-sub{font-size:15px;color:var(--text-sec);line-height:1.65;max-width:520px;margin:0 auto 28px;}
    .stat-row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:32px;}
    .stat-chip{display:flex;align-items:center;gap:6px;padding:8px 16px;border-radius:50px;border:1px solid var(--border);background:var(--bg-card);font-size:13px;font-weight:600;}
    .stat-chip.temp{color:var(--cyan);border-color:rgba(56,189,248,0.25);}
    .stat-chip.dist{color:var(--green);border-color:rgba(16,185,129,0.25);}
    .stat-chip.diff-extreme{color:var(--danger);border-color:rgba(239,68,68,0.25);}
    .stat-chip.diff-vh{color:var(--amber);border-color:rgba(245,158,11,0.25);}
    .stat-chip.diff-h{color:#a78bfa;border-color:rgba(167,139,250,0.25);}
    .stat-chip.season{color:var(--amber);border-color:rgba(245,158,11,0.25);}
    .container{max-width:820px;margin:0 auto;padding:0 16px;}
    .section{margin-bottom:40px;}
    .section-title{font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:.04em;color:var(--text);margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--border);}
    .card{background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:20px;margin-bottom:14px;}
    .two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
    .fact-label{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-sec);margin-bottom:4px;}
    .fact-val{font-size:20px;font-weight:800;color:var(--text);}
    .fact-note{font-size:12px;color:var(--text-sec);margin-top:2px;}
    .prose{font-size:14px;color:var(--text-sec);line-height:1.75;}
    .prose p{margin-bottom:12px;}
    .prose p:last-child{margin-bottom:0;}
    .highlight-box{background:linear-gradient(135deg,rgba(239,68,68,0.08),rgba(8,15,26,0.5));border:1px solid rgba(239,68,68,0.2);border-radius:14px;padding:18px 20px;margin-bottom:14px;}
    .highlight-box.amber{background:linear-gradient(135deg,rgba(245,158,11,0.08),rgba(8,15,26,0.5));border-color:rgba(245,158,11,0.2);}
    .highlight-box.green{background:linear-gradient(135deg,rgba(16,185,129,0.08),rgba(8,15,26,0.5));border-color:rgba(16,185,129,0.2);}
    .highlight-box h3{font-size:13px;font-weight:700;color:var(--danger);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;}
    .highlight-box.amber h3{color:var(--amber);}
    .highlight-box.green h3{color:var(--green);}
    .highlight-box ul{padding-left:0;list-style:none;}
    .highlight-box ul li{font-size:13px;color:var(--text-sec);padding:4px 0;display:flex;gap:8px;align-items:flex-start;line-height:1.5;}
    .highlight-box ul li::before{content:'→';flex-shrink:0;margin-top:1px;}
    .highlight-box li::before{color:var(--danger);}
    .highlight-box.amber li::before{color:var(--amber);}
    .highlight-box.green li::before{color:var(--green);}
    .faq-item{border-bottom:1px solid var(--border);padding:16px 0;}
    .faq-item:last-child{border-bottom:none;}
    .faq-q{font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px;}
    .faq-a{font-size:13px;color:var(--text-sec);line-height:1.65;}
    .readiness-section{background:var(--bg-card);border:1px solid rgba(56,189,248,0.2);border-radius:20px;padding:28px 24px;margin:40px 0;}
    .readiness-section h2{font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:.04em;color:var(--text);margin-bottom:8px;}
    .readiness-section p{font-size:13px;color:var(--text-sec);line-height:1.6;margin-bottom:20px;}
    .readiness-form{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;}
    .form-field label{display:block;font-size:11px;font-weight:600;color:var(--text-sec);margin-bottom:5px;text-transform:uppercase;letter-spacing:.06em;}
    .form-field input{width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(56,189,248,0.25);background:rgba(14,165,233,0.05);color:var(--text);font-size:14px;font-family:'DM Sans',sans-serif;}
    .form-field input:focus{outline:none;border-color:var(--cyan);}
    .readiness-submit{width:100%;padding:12px;border-radius:50px;border:none;background:var(--cyan);color:#080f1a;font-size:14px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;transition:opacity .15s;}
    .readiness-submit:hover{opacity:.88;}
    .score-result{margin-top:20px;padding:20px;border-radius:14px;border:1px solid var(--border);background:rgba(8,15,26,0.5);display:none;}
    .score-result.visible{display:block;}
    .score-number{font-family:'Bebas Neue',sans-serif;font-size:72px;line-height:1;letter-spacing:.02em;}
    .score-breakdown{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0;}
    .score-item{background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;padding:12px;}
    .score-item-label{font-size:10px;font-weight:700;letter-spacing:.08em;color:var(--text-sec);text-transform:uppercase;margin-bottom:4px;}
    .score-item-val{font-size:18px;font-weight:800;}
    .disclaimer{font-size:11px;color:var(--text-sec);opacity:.65;line-height:1.55;padding-top:12px;border-top:1px solid var(--border);margin-top:12px;}
    .bottom-cta{background:linear-gradient(135deg,rgba(14,165,233,0.12),rgba(8,15,26,0.5));border:1px solid rgba(14,165,233,0.25);border-radius:20px;padding:36px 24px;text-align:center;margin:0 0 48px;}
    .bottom-cta h2{font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:.04em;color:var(--text);margin-bottom:12px;}
    .bottom-cta p{font-size:14px;color:var(--text-sec);line-height:1.65;margin-bottom:24px;max-width:440px;margin-left:auto;margin-right:auto;}
    .cta-row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;}
    .btn-primary{display:inline-block;padding:13px 28px;border-radius:50px;background:var(--cyan);color:#080f1a;font-size:14px;font-weight:700;text-decoration:none;transition:opacity .15s;}
    .btn-primary:hover{opacity:.88;}
    .btn-ghost{display:inline-block;padding:13px 28px;border-radius:50px;background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--text);font-size:14px;font-weight:600;text-decoration:none;transition:border-color .15s;}
    .btn-ghost:hover{border-color:rgba(56,189,248,0.5);color:var(--cyan);}
    @media(max-width:520px){.two-col{grid-template-columns:1fr;}.readiness-form{grid-template-columns:1fr;}.score-breakdown{grid-template-columns:1fr;}.stat-row{gap:8px;}}
`;

function render404(slug) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Crossing Not Found | SwimLoading</title>
    <meta name="robots" content="noindex,follow">
    <link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
    <style>${PAGE_CSS}</style>
</head>
<body>
<nav>
    <a href="/" class="nav-brand"><img src="/icons/logo-wave.png" alt="">SwimLoading</a>
    <div class="nav-right"><a href="/crossings" class="nav-back">All crossings</a><a href="/app" class="nav-cta">Open App</a></div>
</nav>
<div class="hero">
    <h1>CROSSING <span>NOT FOUND</span></h1>
    <p class="hero-sub">There is no crossing guide at ${escapeHtml(`/crossings/${slug}`)}.</p>
    <div class="cta-row"><a href="/crossings" class="btn-primary">Browse all crossings</a></div>
</div>
</body>
</html>`;
}

function renderError() {
  return `<!DOCTYPE html><html><head><title>Error | SwimLoading</title></head><body style="font-family:sans-serif;padding:40px;text-align:center"><p>Something went wrong. <a href="/crossings">Back to crossings</a></p></body></html>`;
}
