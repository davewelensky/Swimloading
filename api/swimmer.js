// GET /swimmer/:id — public swimmer identity page (Identity Layer V1).
// STRICTLY opt-in: renders ONLY when profiles.identity_public = true.
// The DB trigger (trg_identity_public_guard) guarantees identity_public can
// never be true for minors or unknown-DOB accounts, so no age logic is
// needed here — a 404 is returned for every non-public profile.
//
// PRODUCT MODEL (corrected 2026-07-19): universal PARTICIPATION identity
// (always present for any swimmer with ≥1 log) + optional cold_water
// specialist identities (shown only when actually earned — never an empty
// ladder, never a numeric level/rank).
//
// ENGAGEMENT PASS (2026-07-20): added pool-vs-open-water split, favourite
// spots, temperature-journey chart, and warmest/spot-count/since stats —
// all derived from the swimmer's own temp_logs, no new schema. Every new
// section degrades to rendering nothing when data is thin (e.g. <2 months
// of logs skips the chart) rather than showing an empty/misleading widget.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sb(path) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
    });
    return res.ok ? res.json() : null;
}

export function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function notFoundBody() {
    return `
      <div style="text-align:center; padding:80px 20px;">
        <h1 style="font-family:'Bebas Neue',sans-serif; font-size:44px; color:#f1f5f9; margin:0 0 10px;">Swimmer not found</h1>
        <p style="color:#64748b; font-size:15px; margin:0 0 28px;">This profile does not exist or is private.</p>
        <a href="https://www.swimloading.com" style="display:inline-block; background:#38bdf8; color:#080f1a; border-radius:50px; font-weight:700; padding:13px 26px; text-decoration:none; font-size:15px;">Explore SwimLoading</a>
      </div>`;
}

function notFound(res) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).send(page('Swimmer not found', notFoundBody()));
}

export function page(title, body) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>${esc(title)} — SwimLoading</title>
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,300&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#080f1a; color:#f1f5f9; font-family:'DM Sans',sans-serif; min-height:100vh; }
  body::before {
    content:''; position:fixed; inset:0; pointer-events:none; z-index:9999;
    background:
      radial-gradient(18px circle at var(--mouse-x,-999px) var(--mouse-y,-999px), rgba(56,189,248,0.55), transparent 100%),
      radial-gradient(500px circle at var(--mouse-x,-999px) var(--mouse-y,-999px), rgba(56,189,248,0.07), transparent 70%);
  }
  nav { position:sticky; top:0; background:rgba(8,15,26,0.9); backdrop-filter:blur(10px); border-bottom:1px solid rgba(255,255,255,0.06); padding:14px 20px; display:flex; align-items:center; justify-content:space-between; z-index:100; }
</style>
</head>
<body>
<nav>
  <a href="https://swimloading.com" style="display:flex;align-items:center;gap:7px;text-decoration:none;font-size:20px;font-weight:800;letter-spacing:-0.5px;background:linear-gradient(135deg,#38bdf8 0%,#0ea5e9 50%,#0284c7 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
    <img src="/icons/logo-wave.png" alt="" style="height:22px;width:auto;">SwimLoading
  </a>
  <a href="https://www.swimloading.com/app" style="background:#38bdf8; color:#080f1a; border-radius:50px; font-weight:700; padding:9px 20px; text-decoration:none; font-size:13px;">Open app</a>
</nav>
<main style="max-width:560px; margin:0 auto; padding:20px;">${body}</main>
<script>
document.addEventListener('mousemove', function(e) {
  document.body.style.setProperty('--mouse-x', e.clientX + 'px');
  document.body.style.setProperty('--mouse-y', e.clientY + 'px');
});
</script>
</body>
</html>`;
}

const PARTICIPATION_ORDER = ['first_swim', 'regular', 'committed', 'consistent', 'established', 'centurion'];
const COLD_ORDER = ['shoulder_season', 'coldwater', 'deep_winter'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_NAMES_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// "{Name} SWIMMER" for every milestone except First Swim (mirrors the
// client-side label in app-identity.js — keep both in sync if this changes).
export function participationLabel(code, name) {
    if (code === 'first_swim') return (name || 'First Swim').toUpperCase();
    return `${(name || code).toUpperCase()} SWIMMER`;
}

export function participationSubline(code, totalLogs, activeWeeks) {
    if (code === 'first_swim') return 'The start of your SwimLoading story';
    if (code === 'regular') return `Active across ${activeWeeks || 0} weeks`;
    return `${totalLogs || 0} swims logged`;
}

export function formatSinceDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    return `${MONTH_NAMES_FULL[d.getMonth()]} ${d.getFullYear()}`;
}

// Pool vs Open Water split — a simple two-segment bar. Renders nothing if
// there's no data at all (never show a 0/0 empty bar).
export function renderWaterSplit(pool, openWater) {
    const total = (pool || 0) + (openWater || 0);
    if (!total) return '';
    const poolPct = Math.round((pool / total) * 100);
    const openPct = 100 - poolPct;
    return `
      <div style="margin-bottom:22px;">
        <div style="font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.8px; margin-bottom:10px;">Pool vs Open Water</div>
        <div style="display:flex; justify-content:space-between; font-size:12px; color:#94a3b8; margin-bottom:8px;">
          <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#818cf8;margin-right:5px;"></span>Pool — ${poolPct}%</span>
          <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#38bdf8;margin-right:5px;"></span>Open Water — ${openPct}%</span>
        </div>
        <div style="display:flex; height:10px; border-radius:6px; overflow:hidden; background:rgba(255,255,255,0.04);">
          <div style="width:${poolPct}%; background:#818cf8;"></div>
          <div style="width:${openPct}%; background:#38bdf8;"></div>
        </div>
      </div>`;
}

// Favourite spots — ranked list. Renders nothing if empty.
export function renderTopSpots(topSpots) {
    if (!topSpots || !topSpots.length) return '';
    const rows = topSpots.map((s, i) => `
      <div style="display:flex; align-items:center; justify-content:space-between; padding:11px 16px; ${i > 0 ? 'border-top:1px solid rgba(255,255,255,0.05);' : ''}">
        <div style="font-size:13px; color:#f1f5f9; font-weight:600;">${i + 1}. ${esc(s.name)}</div>
        <div style="font-size:12px; color:#64748b;">${s.count} swim${s.count === 1 ? '' : 's'}</div>
      </div>`).join('');
    return `
      <div style="margin-bottom:22px;">
        <div style="font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.8px; margin-bottom:10px;">Favourite spots</div>
        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:14px; overflow:hidden;">
          ${rows}
        </div>
      </div>`;
}

// Temperature journey — inline SVG, no client JS. Needs at least 2 distinct
// months to draw a line; with fewer, there's no "journey" to show, so it
// renders nothing rather than a single dot or flat line.
export function renderTempChart(monthlyTemps) {
    if (!monthlyTemps || monthlyTemps.length < 2) return '';
    const W = 480, H = 150, padX = 22, padTop = 26, padBottom = 24;
    const temps = monthlyTemps.map(m => m.avgTemp);
    const minT = Math.min(...temps), maxT = Math.max(...temps);
    const range = (maxT - minT) || 1;
    const plotH = H - padTop - padBottom;
    const n = monthlyTemps.length;
    const stepX = n > 1 ? (W - padX * 2) / (n - 1) : 0;

    const points = monthlyTemps.map((m, i) => ({
        x: padX + i * stepX,
        y: padTop + (1 - (m.avgTemp - minT) / range) * plotH,
        month: m.month,
        avgTemp: m.avgTemp,
    }));

    const polyline = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const dots = points.map(p =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#38bdf8"/>`).join('');

    // Label every point's month if there's room, otherwise thin them out so
    // labels never overlap on a long history.
    const labelEvery = n <= 8 ? 1 : Math.ceil(n / 8);
    const labels = points.map((p, i) => i % labelEvery === 0
        ? `<text x="${p.x.toFixed(1)}" y="${H - 6}" font-size="10" fill="#64748b" text-anchor="middle" font-family="DM Sans, sans-serif">${esc(MONTH_NAMES[parseInt(p.month.split('-')[1], 10) - 1])}</text>`
        : '').join('');

    const first = points[0], last = points[points.length - 1];
    const valueLabels = `
      <text x="${first.x.toFixed(1)}" y="${Math.max(first.y - 10, 12)}" font-size="12" fill="#f1f5f9" text-anchor="middle" font-weight="700" font-family="DM Sans, sans-serif">${first.avgTemp}°</text>
      <text x="${last.x.toFixed(1)}" y="${Math.max(last.y - 10, 12)}" font-size="12" fill="#f1f5f9" text-anchor="middle" font-weight="700" font-family="DM Sans, sans-serif">${last.avgTemp}°</text>`;

    return `
      <div style="margin-bottom:22px;">
        <div style="font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.8px; margin-bottom:10px;">Temperature journey</div>
        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:14px; padding:14px 10px 8px;">
          <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">
            <polyline points="${polyline}" fill="none" stroke="#38bdf8" stroke-width="2"/>
            ${dots}
            ${labels}
            ${valueLabels}
          </svg>
        </div>
      </div>`;
}

// Pure render function — no I/O — so it can be unit tested directly without
// mocking fetch/Vercel req/res. handler() below is the only I/O boundary.
export function renderSwimmerBody({
    displayName, participation, coldEntries, totalLogs, coldest,
    warmest, spotCount, firstSwimDate, waterSplit, topSpots, monthlyTemps,
}) {
    const partLabel = participation
        ? participationLabel(participation.code, participation.name)
        : 'SWIMMER';
    const partSub = participation
        ? participationSubline(participation.code, totalLogs, participation.activeWeeks)
        : `${totalLogs || 0} swims logged`;
    const since = formatSinceDate(firstSwimDate);

    // Cold Water Identity: rendered ONLY when the swimmer has at least one
    // EARNED (verified) specialist entry. Never an empty/incomplete ladder,
    // never shown for a swimmer who has none — this is the corrected model's
    // core rule, so it is enforced here even if upstream data is malformed.
    let coldSection = '';
    if (coldEntries && coldEntries.length) {
        const rows = coldEntries
            .slice()
            .sort((a, b) => COLD_ORDER.indexOf(a.code) - COLD_ORDER.indexOf(b.code))
            .map(e => `
              <div style="display:flex; align-items:center; justify-content:space-between; padding:13px 16px; border:1px solid rgba(16,185,129,0.35); border-radius:12px; margin-bottom:8px;">
                <div style="font-size:14px; font-weight:700; color:#f1f5f9;">${esc((e.name || '').toUpperCase())}</div>
                <span style="color:#10b981; font-weight:700; font-size:12px;">VERIFIED</span>
              </div>`).join('');
        coldSection = `
          <div style="margin-bottom:22px;">
            <div style="font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.8px; margin-bottom:10px;">Cold Water Identity</div>
            ${rows}
          </div>`;
    }

    return `
      <div style="text-align:center; padding:36px 0 26px;">
        <div style="font-size:11px; font-weight:700; color:#38bdf8; text-transform:uppercase; letter-spacing:0.14em; margin-bottom:8px;">Swimmer identity</div>
        <h1 style="font-family:'Bebas Neue',sans-serif; font-size:52px; line-height:1; margin-bottom:10px;">${esc(displayName)}</h1>
        <div style="font-size:16px; color:#38bdf8; font-weight:700;">${esc(partLabel)}</div>
        <div style="font-size:13px; color:#64748b; margin-top:2px;">${esc(partSub)}${since ? ` · swimming since ${esc(since)}` : ''}</div>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:22px;">
        <div style="flex:1; min-width:100px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:14px; padding:14px; text-align:center;">
          <div style="font-size:26px; font-weight:800;">${totalLogs ?? 0}</div>
          <div style="font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Swims logged</div>
        </div>
        <div style="flex:1; min-width:100px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:14px; padding:14px; text-align:center;">
          <div style="font-size:26px; font-weight:800;">${spotCount ?? 0}</div>
          <div style="font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Spots explored</div>
        </div>
        <div style="flex:1; min-width:100px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:14px; padding:14px; text-align:center;">
          <div style="font-size:26px; font-weight:800;">${coldest !== null && coldest !== undefined ? coldest + '°' : '—'}</div>
          <div style="font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Coldest</div>
        </div>
        <div style="flex:1; min-width:100px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:14px; padding:14px; text-align:center;">
          <div style="font-size:26px; font-weight:800;">${warmest !== null && warmest !== undefined ? warmest + '°' : '—'}</div>
          <div style="font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Warmest</div>
        </div>
      </div>
      ${waterSplit ? renderWaterSplit(waterSplit.pool, waterSplit.openWater) : ''}
      ${renderTempChart(monthlyTemps)}
      ${renderTopSpots(topSpots)}
      ${coldSection}
      <div style="text-align:center; padding:30px 0 50px;">
        <a href="https://www.swimloading.com" style="display:inline-block; background:#38bdf8; color:#080f1a; border-radius:50px; font-weight:700; padding:13px 26px; text-decoration:none; font-size:15px;">Track your swims on SwimLoading</a>
      </div>`;
}

const OPEN_WATER_TYPES = new Set(['OCEAN', 'LAGOON', 'DAM', 'LAKE']);

export default async function handler(req, res) {
    const id = String(req.query.id || '').trim();
    if (!UUID_RE.test(id)) return notFound(res);

    const profiles = await sb(`profiles?id=eq.${id}&identity_public=eq.true&select=id,display_name,identity_public`);
    const profile = profiles && profiles[0];
    if (!profile || profile.identity_public !== true) return notFound(res);

    const achievements = await sb(
        `swimmer_achievements?user_id=eq.${id}&select=track_type,achievement_code,achievement_name,verification_status`
    ) || [];

    const participationRow = achievements
        .filter(a => a.track_type === 'participation' && a.verification_status === 'earned')
        .sort((a, b) => PARTICIPATION_ORDER.indexOf(b.achievement_code) - PARTICIPATION_ORDER.indexOf(a.achievement_code))[0];

    // Public page shows EARNED cold entries only — pending/self-reported
    // verification never appears on a public-facing page.
    const coldEntries = achievements
        .filter(a => a.track_type === 'cold_water' && a.verification_status === 'earned')
        .map(a => ({ code: a.achievement_code, name: a.achievement_name }));

    // Single fetch of every log's spot_id/temp_c/date — every stat and chart
    // below (water split, favourite spots, temp journey, since-date, warmest,
    // coldest, spot count) derives from this one dataset, no repeat queries.
    const allLogs = await sb(`temp_logs?user_id=eq.${id}&select=spot_id,temp_c,logged_at,created_at`) || [];
    const totalLogs = allLogs.length;

    let coldest = null, warmest = null, firstSwimDate = null;
    let activeWeeks = 0;
    const weekSet = new Set();
    const spotCounts = new Map();      // spot_id -> count
    const monthTemps = new Map();      // 'YYYY-MM' -> { sum, n }

    for (const log of allLogs) {
        const t = parseFloat(log.temp_c);
        if (!isNaN(t)) {
            if (coldest === null || t < coldest) coldest = t;
            if (warmest === null || t > warmest) warmest = t;
        }
        const d = new Date(log.logged_at || log.created_at);
        if (!isNaN(d.getTime())) {
            const iso = d.toISOString().slice(0, 10);
            if (!firstSwimDate || iso < firstSwimDate) firstSwimDate = iso;
            const weekStart = new Date(d);
            weekStart.setDate(d.getDate() - d.getDay());
            weekSet.add(weekStart.toISOString().slice(0, 10));
            const monthKey = iso.slice(0, 7);
            const cur = monthTemps.get(monthKey) || { sum: 0, n: 0 };
            if (!isNaN(t)) { cur.sum += t; cur.n += 1; }
            monthTemps.set(monthKey, cur);
        }
        if (log.spot_id) spotCounts.set(log.spot_id, (spotCounts.get(log.spot_id) || 0) + 1);
    }
    activeWeeks = weekSet.size;

    const monthlyTemps = [...monthTemps.entries()]
        .filter(([, v]) => v.n > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, v]) => ({ month, avgTemp: Math.round((v.sum / v.n) * 10) / 10 }));

    const spotIds = [...spotCounts.keys()];
    let spotsInfo = [];
    if (spotIds.length) {
        spotsInfo = await sb(`spots?id=in.(${spotIds.join(',')})&select=id,name,water_type`) || [];
    }
    const spotById = new Map(spotsInfo.map(s => [s.id, s]));

    let poolCount = 0, openWaterCount = 0;
    for (const [spotId, count] of spotCounts.entries()) {
        const wt = spotById.get(spotId)?.water_type;
        if (wt === 'POOL') poolCount += count;
        else if (OPEN_WATER_TYPES.has(wt)) openWaterCount += count;
    }

    const topSpots = [...spotCounts.entries()]
        .map(([spotId, count]) => ({ name: spotById.get(spotId)?.name || null, count }))
        .filter(s => s.name)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    if (participationRow && participationRow.achievement_code === 'regular') {
        // activeWeeks already computed above from allLogs — no extra query needed.
    }

    const body = renderSwimmerBody({
        displayName: profile.display_name,
        participation: participationRow
            ? { code: participationRow.achievement_code, name: participationRow.achievement_name, activeWeeks }
            : null,
        coldEntries,
        totalLogs,
        coldest,
        warmest,
        spotCount: spotIds.length,
        firstSwimDate,
        waterSplit: (poolCount + openWaterCount) > 0 ? { pool: poolCount, openWater: openWaterCount } : null,
        topSpots,
        monthlyTemps,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(page(profile.display_name, body));
}
