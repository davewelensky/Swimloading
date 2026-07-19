// GET /swimmer/:id — public swimmer identity page (Identity Layer V1).
// STRICTLY opt-in: renders ONLY when profiles.identity_public = true.
// The DB trigger (trg_identity_public_guard) guarantees identity_public can
// never be true for minors or unknown-DOB accounts, so no age logic is
// needed here — a 404 is returned for every non-public profile.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sb(path) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
    });
    return res.ok ? res.json() : null;
}

function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function notFound(res) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).send(page('Swimmer not found', `
      <div style="text-align:center; padding:80px 20px;">
        <h1 style="font-family:'Bebas Neue',sans-serif; font-size:44px; color:#f1f5f9; margin:0 0 10px;">Swimmer not found</h1>
        <p style="color:#64748b; font-size:15px; margin:0 0 28px;">This profile does not exist or is private.</p>
        <a href="https://www.swimloading.com" style="display:inline-block; background:#38bdf8; color:#080f1a; border-radius:50px; font-weight:700; padding:13px 26px; text-decoration:none; font-size:15px;">Explore SwimLoading</a>
      </div>`));
}

function page(title, body) {
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

const LEVELS = [
    { level: 1, name: 'Cold Water', maxC: 16 },
    { level: 2, name: 'Deep Cold',  maxC: 13 },
    { level: 3, name: 'Winter',     maxC: 10 },
    { level: 4, name: 'Polar',      maxC: 7 },
    { level: 5, name: 'Ice',        maxC: 5 },
];

export default async function handler(req, res) {
    const id = String(req.query.id || '').trim();
    if (!UUID_RE.test(id)) return notFound(res);

    const profiles = await sb(`profiles?id=eq.${id}&identity_public=eq.true&select=id,display_name,identity_public`);
    const profile = profiles && profiles[0];
    if (!profile || profile.identity_public !== true) return notFound(res);

    // Earned (verified) levels only — pending/rejected never appear publicly
    const achievements = await sb(
        `swimmer_achievements?user_id=eq.${id}&achievement_type=eq.cold_level&status=eq.earned&select=level,level_name,created_at&order=level.desc`
    ) || [];
    const topLevel = achievements.length ? achievements[0] : null;

    const logs = await sb(`temp_logs?user_id=eq.${id}&select=temp_c&order=temp_c.asc&limit=1`);
    const coldest = logs && logs[0] ? parseFloat(logs[0].temp_c) : null;

    const countRes = await fetch(
        `${SUPABASE_URL}/rest/v1/temp_logs?user_id=eq.${id}&select=id`,
        { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Prefer': 'count=exact', 'Range': '0-0' } }
    );
    const swimCount = countRes.ok
        ? parseInt((countRes.headers.get('content-range') || '/0').split('/')[1], 10) || 0
        : 0;

    const earnedLevels = new Set(achievements.map(a => a.level));
    const levelRows = LEVELS.map(l => `
      <div style="display:flex; align-items:center; justify-content:space-between; padding:13px 16px; border:1px solid ${earnedLevels.has(l.level) ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.06)'}; border-radius:12px; margin-bottom:8px;">
        <div>
          <div style="font-size:14px; font-weight:700; color:${earnedLevels.has(l.level) ? '#f1f5f9' : '#64748b'};">Level ${l.level} — ${l.name}</div>
          <div style="font-size:11px; color:#64748b;">${l.maxC}°C or below</div>
        </div>
        ${earnedLevels.has(l.level)
            ? '<span style="color:#10b981; font-weight:700; font-size:12px;">EARNED</span>'
            : '<span style="color:#334155; font-size:12px;">—</span>'}
      </div>`).join('');

    const body = `
      <div style="text-align:center; padding:36px 0 26px;">
        <div style="font-size:11px; font-weight:700; color:#38bdf8; text-transform:uppercase; letter-spacing:0.14em; margin-bottom:8px;">Swimmer identity</div>
        <h1 style="font-family:'Bebas Neue',sans-serif; font-size:52px; line-height:1; margin-bottom:6px;">${esc(profile.display_name)}</h1>
        ${topLevel ? `<div style="font-size:15px; color:#38bdf8; font-weight:700;">${esc(topLevel.level_name)} — Cold Water Level ${topLevel.level}</div>` : `<div style="font-size:14px; color:#64748b;">Open water swimmer</div>`}
      </div>
      <div style="display:flex; gap:10px; margin-bottom:22px;">
        <div style="flex:1; background:rgba(56,189,248,0.07); border:1px solid rgba(56,189,248,0.2); border-radius:14px; padding:16px; text-align:center;">
          <div style="font-size:28px; font-weight:800; color:#38bdf8;">${topLevel ? 'L' + topLevel.level : '—'}</div>
          <div style="font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Cold level</div>
        </div>
        <div style="flex:1; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:14px; padding:16px; text-align:center;">
          <div style="font-size:28px; font-weight:800;">${swimCount}</div>
          <div style="font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Swims logged</div>
        </div>
        <div style="flex:1; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:14px; padding:16px; text-align:center;">
          <div style="font-size:28px; font-weight:800;">${coldest !== null ? coldest + '°' : '—'}</div>
          <div style="font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Coldest</div>
        </div>
      </div>
      <div style="font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.8px; margin-bottom:10px;">Cold water levels</div>
      ${levelRows}
      <div style="text-align:center; padding:30px 0 50px;">
        <a href="https://www.swimloading.com" style="display:inline-block; background:#38bdf8; color:#080f1a; border-radius:50px; font-weight:700; padding:13px 26px; text-decoration:none; font-size:15px;">Track your swims on SwimLoading</a>
      </div>`;

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(page(profile.display_name, body));
}
