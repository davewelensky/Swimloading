// GET /bluefin-reddam-report — live Learn to Swim progress report for the
// Reddam Foundation (Nicky Sheridan). Server-rendered with the service key
// so it can read club_progress_reports despite RLS (admins/coaches/approved
// parents/the swimmer only — no anonymous-read policy exists, by design).
// Only PUBLISHED reports are ever shown here — a coach must review and
// publish via the Progress Reports tab before anything appears. No caching:
// this is meant to reflect the latest state on every refresh.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

const CLUB_SLUG  = 'bluefin';
const SQUAD_NAME = 'College Students';

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

function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' });
}

function formatGeneratedAt() {
    const d = new Date();
    const date = d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' });
    const time = d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' });
    return `${date} at ${time} SAST`;
}

// Best-effort water-safety badge classifier from free-text report bodies —
// only used to colour-code the badge; the text itself is never altered.
function safetyBadge(body) {
    const t = (body || '').toLowerCase();
    if (t.includes('not yet water safe') || t.includes('not water safe')) return { cls: 'badge-notyet', label: 'Not yet water safe' };
    if (t.includes('shallow end')) return { cls: 'badge-shallow', label: 'Water safe — shallow end' };
    if (t.includes('water safe')) return { cls: 'badge-safe', label: 'Water safe' };
    return null;
}

function notFoundPage(res, msg) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).send(`<!DOCTYPE html><html><body style="background:#080f1a;color:#f1f5f9;font-family:sans-serif;text-align:center;padding:80px 20px;">
      <h1>${esc(msg)}</h1>
    </body></html>`);
}

export default async function handler(req, res) {
    if (!SERVICE_KEY) return notFoundPage(res, 'Report temporarily unavailable');

    const clubs = await sb(`clubs?slug=eq.${CLUB_SLUG}&select=id,name,logo_url,description`);
    const club = clubs && clubs[0];
    if (!club) return notFoundPage(res, 'Club not found');

    const squads = await sb(`club_squads?club_id=eq.${club.id}&name=eq.${encodeURIComponent(SQUAD_NAME)}&select=id,name`);
    const squad = squads && squads[0];
    if (!squad) return notFoundPage(res, 'Programme not found');

    const roster = await sb(
        `club_roster?club_id=eq.${club.id}&squad_id=eq.${squad.id}&is_active=eq.true&select=id,display_name,member_number&order=member_number.asc`
    ) || [];

    const rosterIds = roster.map(r => r.id);
    let reports = [];
    if (rosterIds.length) {
        reports = await sb(
            `club_progress_reports?club_id=eq.${club.id}&roster_id=in.(${rosterIds.join(',')})&is_published=eq.true&select=roster_id,term_label,body,coach_name,updated_at,published_at&order=updated_at.desc`
        ) || [];
    }

    const reportsByRoster = new Map();
    for (const r of reports) {
        if (!reportsByRoster.has(r.roster_id)) reportsByRoster.set(r.roster_id, []);
        reportsByRoster.get(r.roster_id).push(r);
    }

    const studentsWithUpdates = roster.filter(r => (reportsByRoster.get(r.id) || []).length > 0).length;
    const mostRecent = reports.length
        ? reports.reduce((a, b) => (new Date(a.updated_at) > new Date(b.updated_at) ? a : b))
        : null;

    const studentCards = roster.map(r => {
        const entries = reportsByRoster.get(r.id) || [];
        let body;
        if (!entries.length) {
            body = `<div class="no-update">No published update yet — awaiting coach review in Progress Reports.</div>`;
        } else {
            body = entries.map(e => {
                const badge = safetyBadge(e.body);
                return `
                  <div class="timeline-entry">
                    <div class="timeline-head">
                      <span class="timeline-date">${esc(formatDate(e.updated_at))}</span>
                      ${badge ? `<span class="student-badge ${badge.cls}">${esc(badge.label)}</span>` : ''}
                    </div>
                    <div class="timeline-body">${esc(e.body)}</div>
                    ${e.coach_name ? `<div class="timeline-coach">— ${esc(e.coach_name)}</div>` : ''}
                  </div>`;
            }).join('<div class="timeline-divider"></div>');
        }
        return `
          <div class="student-card">
            <div class="student-name">${esc(r.display_name)}</div>
            ${body}
          </div>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Learn to Swim Progress Report — ${esc(club.name)} × Reddam Foundation</title>
    <meta name="robots" content="noindex,nofollow">
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
    <link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.min.js"></script>
    <style>
        :root {
            --bg: #080f1a; --bg-card: #0d1728; --bg-card2: #111c30;
            --cyan: #38bdf8; --cyan-deep: #0284c7;
            --text: #f1f5f9; --text-sec: #94a3b8; --text-dim: #4a6080;
            --border: rgba(255,255,255,0.07);
            --green: #10b981; --amber: #f59e0b; --danger: #ef4444;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif; -webkit-font-smoothing: antialiased; line-height: 1.6; }
        img { max-width: 100%; display: block; }

        .nav { border-bottom: 1px solid var(--border); padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; }
        .nav-inner { max-width: 820px; margin: 0 auto; width: 100%; display: flex; align-items: center; justify-content: space-between; }
        .nav-logo { display: flex; align-items: center; gap: 8px; text-decoration: none; }
        .nav-logo img { height: 22px; width: auto; }
        .nav-logo-text { font-size: 15px; font-weight: 800; letter-spacing: -0.5px; background: linear-gradient(135deg,#38bdf8 0%,#0ea5e9 50%,#0284c7 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .nav-tag { font-size: 8.5px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-dim); background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: 20px; padding: 5px 9px; white-space: nowrap; flex-shrink: 0; }
        @media (min-width: 480px) { .nav-tag { font-size: 10px; padding: 5px 12px; letter-spacing: 0.08em; } .nav-logo-text { font-size: 15px; } }

        .header { max-width: 820px; margin: 0 auto; padding: 56px 24px 30px; text-align: center; }
        .header img.club-logo { height: 48px; width: auto; margin: 0 auto 28px; }
        .header-eyebrow { font-size: 11px; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; color: var(--cyan); margin-bottom: 14px; }
        .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: clamp(34px, 7vw, 52px); line-height: 1.02; letter-spacing: 0.5px; color: #fff; margin-bottom: 16px; }
        .header-sub { font-size: 15px; color: var(--text-sec); max-width: 560px; margin: 0 auto; line-height: 1.7; }
        .header-sub strong { color: var(--text); }
        .live-note { display: inline-flex; align-items: center; gap: 7px; margin-top: 20px; font-size: 11.5px; color: var(--text-dim); background: rgba(16,185,129,0.06); border: 1px solid rgba(16,185,129,0.2); border-radius: 20px; padding: 6px 14px; }
        .live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); flex-shrink: 0; }

        .stat-strip { max-width: 820px; margin: 0 auto; padding: 30px 24px 40px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        .stat-box { background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; padding: 18px 10px; text-align: center; }
        .stat-val { font-family: 'Bebas Neue', sans-serif; font-size: 30px; color: var(--cyan); line-height: 1; margin-bottom: 6px; }
        .stat-lbl { font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-sec); line-height: 1.3; }

        .section { max-width: 820px; margin: 0 auto; padding: 44px 24px; }
        .section-eyebrow { font-size: 11px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: var(--cyan); margin-bottom: 10px; text-align: center; }
        .section-title { font-family: 'Bebas Neue', sans-serif; font-size: clamp(26px, 5vw, 36px); letter-spacing: 0.4px; color: var(--text); margin-bottom: 16px; text-align: center; }
        .section-body { font-size: 14.5px; color: var(--text-sec); line-height: 1.75; max-width: 620px; margin: 0 auto 30px; text-align: center; }
        .divider { height: 1px; background: linear-gradient(90deg, transparent, rgba(56,189,248,0.18), transparent); max-width: 820px; margin: 0 auto; }

        .safety-legend { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        .safety-legend-item { background: var(--bg-card2); border: 1px solid var(--border); border-radius: 12px; padding: 14px; }
        .safety-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; margin-right: 7px; }
        .safety-legend-title { font-size: 12.5px; font-weight: 700; color: var(--text); margin-bottom: 4px; }
        .safety-legend-desc { font-size: 11.5px; color: var(--text-sec); line-height: 1.5; }

        .student-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 18px; margin-bottom: 12px; }
        .student-name { font-family: 'Bebas Neue', sans-serif; font-size: 22px; letter-spacing: 0.3px; color: var(--text); margin-bottom: 12px; }
        .student-badge { display: inline-flex; align-items: center; font-size: 10.5px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; border-radius: 20px; padding: 3px 10px; white-space: nowrap; }
        .badge-safe { background: rgba(16,185,129,0.12); color: var(--green); border: 1px solid rgba(16,185,129,0.3); }
        .badge-shallow { background: rgba(245,158,11,0.12); color: var(--amber); border: 1px solid rgba(245,158,11,0.3); }
        .badge-notyet { background: rgba(239,68,68,0.1); color: var(--danger); border: 1px solid rgba(239,68,68,0.28); }
        .no-update { font-size: 12.5px; color: var(--text-dim); font-style: italic; }
        .timeline-entry { margin-bottom: 4px; }
        .timeline-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
        .timeline-date { font-size: 11px; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
        .timeline-body { font-size: 12.5px; color: var(--text-sec); line-height: 1.6; }
        .timeline-coach { font-size: 11px; color: var(--text-dim); margin-top: 6px; font-style: italic; }
        .timeline-divider { height: 1px; background: var(--border); margin: 14px 0; }

        .info-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 22px; }
        .info-row { display: flex; align-items: flex-start; gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--border); }
        .info-row:last-child { border-bottom: none; padding-bottom: 0; }
        .info-row:first-child { padding-top: 0; }
        .info-icon { width: 32px; height: 32px; border-radius: 9px; background: rgba(56,189,248,0.1); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .info-icon i { width: 15px; height: 15px; color: var(--cyan); }
        .info-label { font-size: 13.5px; color: var(--text); }
        .info-label span { display: block; font-size: 12px; color: var(--text-sec); margin-top: 2px; }

        .footer { text-align: center; padding: 40px 24px 50px; border-top: 1px solid var(--border); }
        .footer-text { font-size: 12px; color: var(--text-dim); line-height: 1.8; }
        .footer-text a { color: var(--text-sec); }

        @media (max-width: 560px) {
            .stat-strip { grid-template-columns: 1fr; }
            .safety-legend { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>

<nav class="nav">
    <div class="nav-inner">
        <a href="https://swimloading.com" class="nav-logo">
            <img src="/icons/logo-wave.png" alt="">
            <span class="nav-logo-text">SwimLoading</span>
        </a>
        <span class="nav-tag">Prepared for Reddam Foundation</span>
    </div>
</nav>

<header class="header">
    ${club.logo_url ? `<img src="${esc(club.logo_url)}" alt="${esc(club.name)}" class="club-logo">` : ''}
    <div class="header-eyebrow">Learn to Swim Programme</div>
    <h1>Progress Report</h1>
    <p class="header-sub">Prepared for <strong>Nicky Sheridan</strong> and the Reddam Foundation, covering the Reddam College students learning to swim with ${esc(club.name)}.</p>
    <div class="live-note"><span class="live-dot"></span>Live — updates automatically as coaches publish new progress notes</div>
</header>

<div class="stat-strip">
    <div class="stat-box"><div class="stat-val">${roster.length}</div><div class="stat-lbl">Students in the programme</div></div>
    <div class="stat-box"><div class="stat-val">${studentsWithUpdates} of ${roster.length}</div><div class="stat-lbl">Have a published update</div></div>
    <div class="stat-box"><div class="stat-val">${mostRecent ? esc(formatDate(mostRecent.updated_at)) : '—'}</div><div class="stat-lbl">Most recent update</div></div>
</div>

<div class="divider"></div>

<section class="section">
    <div class="section-eyebrow">Water Safety Levels</div>
    <div class="section-title">How to read this report</div>
    <div class="safety-legend">
        <div class="safety-legend-item">
            <div class="safety-legend-title"><span class="safety-dot" style="background:var(--green);"></span>Water Safe</div>
            <div class="safety-legend-desc">Jumps confidently into deep water and recovers unassisted into a back float, then swims safely to the side.</div>
        </div>
        <div class="safety-legend-item">
            <div class="safety-legend-title"><span class="safety-dot" style="background:var(--amber);"></span>Water Safe — Shallow End</div>
            <div class="safety-legend-desc">Comfortable and functional in shallow water, still developing confidence and ability for deeper water.</div>
        </div>
        <div class="safety-legend-item">
            <div class="safety-legend-title"><span class="safety-dot" style="background:var(--danger);"></span>Not Yet Water Safe</div>
            <div class="safety-legend-desc">Requires supervision and further lessons to build confidence, floating, breathing and independent movement.</div>
        </div>
    </div>
</section>

<div class="divider"></div>

<section class="section">
    <div class="section-eyebrow">Student Progress</div>
    <div class="section-title">${roster.length} student${roster.length === 1 ? '' : 's'}, tracked over time</div>
    <div class="section-body">First names only, in line with ${esc(club.name)}'s own privacy practice for the programme. Each entry below is dated to the update a coach published — this list grows as new terms are reported.</div>

    ${studentCards || '<div class="no-update" style="text-align:center;">No students currently in this programme.</div>'}
</section>

<div class="divider"></div>

<section class="section">
    <div class="section-eyebrow">The Programme</div>
    <div class="section-title">Building water confidence</div>
    <div class="info-card">
        <div class="info-row">
            <div class="info-icon"><i data-lucide="calendar-days"></i></div>
            <div class="info-label">8-week programme, one 30-minute session per week <span>Delivered in the pool at Reddam House Constantia</span></div>
        </div>
        <div class="info-row">
            <div class="info-icon"><i data-lucide="waves"></i></div>
            <div class="info-label">What sessions cover <span>Safe pool entry/exit, water orientation, floating, kicking technique, breathing, arm-kick coordination, streamlining, and assisted/independent swims</span></div>
        </div>
        <div class="info-row">
            <div class="info-icon"><i data-lucide="file-text"></i></div>
            <div class="info-label">How this report works <span>A coach writes and publishes a progress note per student in SwimLoading's Progress Reports tab — this page reflects only what's been published, live, every time it's opened</span></div>
        </div>
    </div>
</section>

<footer class="footer">
    <div class="footer-text">
        ${esc(club.name)}${club.description ? `<br>${esc(club.description)}` : ''}<br>
        <span style="display:block;margin-top:10px;">Generated ${esc(formatGeneratedAt())} · Tracked and reported on SwimLoading — <a href="https://swimloading.com">swimloading.com</a></span>
    </div>
</footer>

<script>lucide.createIcons();</script>
</body>
</html>`;

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(html);
}
