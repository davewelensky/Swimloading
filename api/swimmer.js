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
// SCHEMA DEPENDENCY: targets swimmer_achievements' post-correction column
// names (track_type, achievement_code, achievement_name, verification_status)
// from sql/2026-07-19_identity-v1-multitrack-correction.sql, which has NOT
// been applied yet. Do not deploy this file until that migration is applied.

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

// Pure render function — no I/O — so it can be unit tested directly without
// mocking fetch/Vercel req/res. handler() below is the only I/O boundary.
export function renderSwimmerBody({ displayName, participation, coldEntries, totalLogs, coldest }) {
    const partLabel = participation
        ? participationLabel(participation.code, participation.name)
        : 'SWIMMER';
    const partSub = participation
        ? participationSubline(participation.code, totalLogs, participation.activeWeeks)
        : `${totalLogs || 0} swims logged`;

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
          <div style="font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.8px; margin-bottom:10px;">Cold Water Identity</div>
          ${rows}`;
    }

    return `
      <div style="text-align:center; padding:36px 0 26px;">
        <div style="font-size:11px; font-weight:700; color:#38bdf8; text-transform:uppercase; letter-spacing:0.14em; margin-bottom:8px;">Swimmer identity</div>
        <h1 style="font-family:'Bebas Neue',sans-serif; font-size:52px; line-height:1; margin-bottom:10px;">${esc(displayName)}</h1>
        <div style="font-size:16px; color:#38bdf8; font-weight:700;">${esc(partLabel)}</div>
        <div style="font-size:13px; color:#64748b; margin-top:2px;">${esc(partSub)}</div>
      </div>
      <div style="display:flex; gap:10px; margin-bottom:22px;">
        <div style="flex:1; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:14px; padding:16px; text-align:center;">
          <div style="font-size:28px; font-weight:800;">${totalLogs ?? 0}</div>
          <div style="font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Swims logged</div>
        </div>
        <div style="flex:1; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:14px; padding:16px; text-align:center;">
          <div style="font-size:28px; font-weight:800;">${coldest !== null && coldest !== undefined ? coldest + '°' : '—'}</div>
          <div style="font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Coldest</div>
        </div>
      </div>
      ${coldSection}
      <div style="text-align:center; padding:30px 0 50px;">
        <a href="https://www.swimloading.com" style="display:inline-block; background:#38bdf8; color:#080f1a; border-radius:50px; font-weight:700; padding:13px 26px; text-decoration:none; font-size:15px;">Track your swims on SwimLoading</a>
      </div>`;
}

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

    const logs = await sb(`temp_logs?user_id=eq.${id}&select=temp_c&order=temp_c.asc&limit=1`);
    const coldest = logs && logs[0] ? parseFloat(logs[0].temp_c) : null;

    const countRes = await fetch(
        `${SUPABASE_URL}/rest/v1/temp_logs?user_id=eq.${id}&select=id`,
        { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Prefer': 'count=exact', 'Range': '0-0' } }
    );
    const totalLogs = countRes.ok
        ? parseInt((countRes.headers.get('content-range') || '/0').split('/')[1], 10) || 0
        : 0;

    let activeWeeks = 0;
    if (participationRow && participationRow.achievement_code === 'regular') {
        const allLogs = await sb(`temp_logs?user_id=eq.${id}&select=logged_at,created_at`) || [];
        const weeks = new Set(allLogs.map(l => {
            const d = new Date(l.logged_at || l.created_at);
            const weekStart = new Date(d);
            weekStart.setDate(d.getDate() - d.getDay());
            return weekStart.toISOString().slice(0, 10);
        }));
        activeWeeks = weeks.size;
    }

    const body = renderSwimmerBody({
        displayName: profile.display_name,
        participation: participationRow
            ? { code: participationRow.achievement_code, name: participationRow.achievement_name, activeWeeks }
            : null,
        coldEntries,
        totalLogs,
        coldest,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(page(profile.display_name, body));
}
