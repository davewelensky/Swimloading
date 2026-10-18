// Deterministic HTML/CSS templates for 1080x1350 (Instagram 4:5). Facebook feed reuses the same
// image. No AI imagery, no third-party map tiles. Pure functions: (post, assets) -> HTML string.
// Brand: dark navy, cyan #38bdf8, orange accent, Bebas Neue + DM Sans, wave logo, no emojis.
import { CATEGORIES } from './config.js';

export const SIZE = { w: 1080, h: 1350 };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const F = (p, k) => p.facts.find((f) => f.key === k)?.text;

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;700&display=swap');
:root{--bg:#080f1a;--card:#0d1728;--cyan:#38bdf8;--orange:#f97316;--text:#f1f5f9;--sec:#94a3b8}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1350px;background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;overflow:hidden}
.slide{position:relative;width:1080px;height:1350px;padding:72px;display:flex;flex-direction:column;
  background:radial-gradient(900px 600px at 85% -5%,rgba(56,189,248,.18),transparent 60%),radial-gradient(700px 500px at -10% 105%,rgba(14,165,233,.14),transparent 60%),var(--bg)}
.tag{align-self:flex-start;background:rgba(8,15,26,.82);font:700 26px 'DM Sans';letter-spacing:5px;text-transform:uppercase;color:var(--cyan);border:2px solid rgba(56,189,248,.45);border-radius:50px;padding:12px 28px}
.tag.o{color:var(--orange);border-color:rgba(249,115,22,.5)}
h1{font:400 150px/0.9 'Bebas Neue';letter-spacing:1px}
h1.m{font-size:118px}h1.s{font-size:92px;line-height:1.05}
.sub{font:500 38px/1.3 'DM Sans';color:var(--sec)}
.cy{color:var(--cyan)}.or{color:var(--orange)}
.fit{overflow:hidden}
.brand{margin-top:auto;display:flex;align-items:center;justify-content:space-between;padding-top:36px;border-top:2px solid rgba(255,255,255,.08)}
.brand .l{display:flex;align-items:center;gap:14px;font:800 36px 'DM Sans';white-space:nowrap;letter-spacing:-.5px;background:linear-gradient(135deg,#38bdf8,#0ea5e9 50%,#0284c7);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.brand img{height:46px}.brand .u{font:500 24px 'DM Sans';color:var(--sec);white-space:nowrap;margin-left:24px}
.credit{position:absolute;left:72px;bottom:150px;font:400 22px 'DM Sans';color:var(--sec)}
.stat{background:var(--card);border:2px solid rgba(255,255,255,.07);border-radius:28px;padding:34px 38px}
.stat b{display:block;font:400 112px/1 'Bebas Neue';color:var(--cyan)}
.stat span{font:500 32px/1.3 'DM Sans';color:var(--text)}
.chip{display:inline-block;font:700 28px 'DM Sans';padding:10px 26px;border-radius:50px;background:rgba(56,189,248,.15);color:var(--cyan)}
ul.f{list-style:none;display:flex;flex-direction:column;gap:20px}
ul.f li{font:500 36px/1.3 'DM Sans';padding-left:44px;position:relative}
ul.f li:before{content:'';position:absolute;left:0;top:16px;width:18px;height:18px;border-radius:50%;background:var(--cyan)}
.row{display:flex;align-items:center;gap:36px;background:var(--card);border:2px solid rgba(255,255,255,.07);border-radius:28px;padding:34px 40px}
.row .n{font:400 110px/1 'Bebas Neue';color:var(--orange);width:70px}
.row .t{font:400 66px/1 'Bebas Neue'}.row .a{font:500 28px 'DM Sans';color:var(--sec);margin-top:8px}
.photo{position:absolute;left:0;top:0;width:1080px;height:700px;background-size:cover;background-position:center}
.photo:after{content:'';position:absolute;inset:0;background:linear-gradient(to bottom,rgba(8,15,26,.75),rgba(8,15,26,.1) 28%,rgba(8,15,26,.25) 55%,#080f1a 100%)}
.pn{position:absolute;right:72px;bottom:-0px}
`;

const brand = (a, url = 'swimloading.com') =>
  `<div class="brand"><div class="l"><img src="${a.logo}" alt="">SwimLoading</div><div class="u">${esc(url)}</div></div>`;

const wave = `<svg width="1080" height="120" viewBox="0 0 1080 120" style="position:absolute;left:0;bottom:190px;opacity:.12"><path d="M0 60 Q 90 0 180 60 T 360 60 T 540 60 T 720 60 T 900 60 T 1080 60 V120 H0Z" fill="#38bdf8"/></svg>`;

function frame(inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${inner}</body></html>`;
}

const T = {
  [CATEGORIES.SWIM_SPOTLIGHT](p, a) {
    const hasPhoto = !!a.photo;
    const opened = p.facts.find((f) => f.key === 'opened');
    const bullets = ['fact0', 'fact1'].map((k) => F(p, k)).filter(Boolean);
    return frame(`<div class="slide">
      ${hasPhoto ? `<div class="photo" style="background-image:url('${a.photo}')"></div><div class="credit">${esc(p.image.credit)}</div>` : wave}
      <div class="tag" style="position:relative">${esc(p.category)}</div>
      <div style="position:relative;margin-top:${hasPhoto ? 430 : 120}px" class="fit">
        <h1 class="${F(p, 'name').length > 16 ? 'm' : ''}">${esc(F(p, 'name'))}</h1>
        <div class="sub" style="margin-top:18px">${esc([F(p, 'area'), F(p, 'country')].filter(Boolean).join(', '))} <span class="chip" style="margin-left:14px">${esc(F(p, 'water_type'))}</span></div>
        ${opened ? `<div style="margin-top:34px;font:400 96px/1 'Bebas Neue'" class="or">${esc(opened.text.toUpperCase())}</div>` : ''}
        ${bullets.length ? `<ul class="f" style="margin-top:34px">${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : `<div class="sub" style="margin-top:40px">Live and recent water temperatures, where available, on SwimLoading.</div>`}
      </div>
      ${brand(a)}</div>`);
  },
  [CATEGORIES.CROSSING_INTELLIGENCE](p, a) {
    return frame(`<div class="slide">${wave}
      <div class="tag">${esc(p.category)}</div>
      <h1 style="margin-top:70px">${esc(F(p, 'name'))}</h1>
      <div class="sub" style="margin-top:20px">${esc(F(p, 'route'))}</div>
      <svg width="936" height="110" style="margin:46px 0 10px"><line x1="30" y1="55" x2="906" y2="55" stroke="#38bdf8" stroke-width="5" stroke-dasharray="4 16" stroke-linecap="round"/><circle cx="30" cy="55" r="20" fill="#f97316"/><circle cx="906" cy="55" r="20" fill="#38bdf8"/></svg>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:20px">
        <div class="stat"><b>${esc(F(p, 'distance'))}</b><span>Route distance</span></div>
        <div class="stat"><b>${esc(String(p.facts.find((f) => f.key === 'qualifying').value / 60))} H</b><span>Witnessed continuous swim in the qualifying requirement</span></div>
      </div>
      <div class="sub" style="margin-top:36px">${esc(F(p, 'observer'))}. Check the governing body's current rules before you plan.</div>
      ${brand(a, 'swimloading.com/english-channel')}</div>`);
  },
  [CATEGORIES.BEHIND_THE_BRAND](p, a) {
    return frame(`<div class="slide">${wave}
      <div class="tag o">${esc(p.category)}</div>
      <div style="margin-top:56px;background:#fff;border-radius:28px;padding:44px;display:flex;justify-content:center"><img src="${a.partnerLogo}" style="height:150px;max-width:760px;object-fit:contain" alt="${esc(p.partner.name)}"></div>
      <h1 class="m" style="margin-top:64px">${esc(F(p, 'claim'))}</h1>
      <div class="sub" style="margin-top:30px">${esc(F(p, 'range'))}</div>
      <div class="sub cy" style="margin-top:14px">${esc(F(p, 'stock'))}</div>
      <div class="sub" style="margin-top:auto;font-size:28px">Official SwimLoading partner</div>
      ${brand(a, 'swimloading.com/partners/maurten')}</div>`);
  },
  [CATEGORIES.DISCOVERS](p, a) {
    return frame(`<div class="slide">
      <div class="tag">${esc(p.category)}</div>
      <h1 class="m" style="margin-top:56px">Outdoor swimming<br><span class="cy">around ${esc(p.region)}</span></h1>
      <div style="display:flex;flex-direction:column;gap:26px;margin-top:56px">
        ${p.spots.map((s, i) => `<div class="row"><div class="n">${i + 1}</div><div class="fit"><div class="t">${esc(s.name)}</div><div class="a">${esc(s.type)}${s.area ? ' · ' + esc(s.area) : ''}</div></div></div>`).join('')}
      </div>
      ${brand(a, 'swimloading.com/spots')}</div>`);
  },
};

/** THIS WEEK carousel: slide 0 = cover, 1..n = one event each. */
export function weekSlides(p, a) {
  const title = p.windowDays === 7 ? 'THIS WEEK IN OPEN WATER' : 'COMING UP IN OPEN WATER';
  const cover = frame(`<div class="slide">${wave}
    <div class="tag o">${esc(title)}</div>
    <h1 style="margin-top:80px">${p.events.length} listed swims<br><span class="cy">${p.windowDays === 7 ? 'this week' : 'next ' + p.windowDays + ' days'}</span></h1>
    <div style="display:flex;flex-direction:column;gap:18px;margin-top:56px">${p.events.map((e) => `<div class="sub" style="color:var(--text);font-size:34px"><span class="or" style="font-weight:700">${esc(e.date)}</span> &nbsp;${esc(e.place)}</div>`).join('')}</div>
    <div class="sub" style="margin-top:44px">Swipe for the details</div>${brand(a, 'swimloading.com/explore')}</div>`);
  const slides = p.events.map((e, i) => frame(`<div class="slide">
    <div class="tag o">${esc(title)}</div>
    <div class="or" style="margin-top:70px;font:400 120px/1 'Bebas Neue'">${esc(e.date)}</div>
    <h1 class="s fit" style="margin-top:24px;max-height:300px">${esc(e.title)}</h1>
    <div class="sub" style="margin-top:34px;color:var(--text)">${esc(e.place)}</div>
    ${e.distance ? `<div style="margin-top:34px"><span class="chip">${esc(e.distance)}</span></div>` : ''}
    <div class="sub" style="margin-top:auto;font-size:28px">Listed on SwimLoading Explore. Check the organiser's page for entry, dates and conditions.</div>
    <div style="font:700 26px 'DM Sans';color:var(--sec);margin:18px 0 28px">${i + 1} / ${p.events.length}</div>
    ${brand(a, 'swimloading.com/explore')}</div>`));
  return [cover, ...slides];
}

export function renderHtml(post, assets) {
  if (post.category === CATEGORIES.THIS_WEEK) return weekSlides(post, assets);
  const fn = T[post.category];
  if (!fn) throw new Error(`no template for ${post.category}`);
  return [fn(post, assets)];
}
