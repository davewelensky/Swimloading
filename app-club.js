// app-club.js — Club tab: standings (open water) or gala results (swim club)
// Loaded after app.js, app-nav.js. All globals from app.js available.

let currentUserClubs = [];
let activeClubIndex  = 0;

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function loadUserClubs() {
  if (!currentUser) return;

  const { data } = await supabaseClient
    .from('club_members')
    .select(`
      id, role, is_active, joined_at, category_id,
      roster_id,
      clubs ( id, name, code, slug, city, tagline, logo_url, club_type, contact_email ),
      club_roster ( id, member_number, display_name, category, gender )
    `)
    .eq('user_id', currentUser.id)
    .eq('is_active', true);

  currentUserClubs = data || [];

  const btn = document.getElementById('clubNavBtn');
  if (btn) btn.style.display = currentUserClubs.length ? 'flex' : 'none';
}

// ─── Render Club Tab ───────────────────────────────────────────────────────────

async function renderClubPage() {
  const container = document.getElementById('clubPageContent');
  if (!container) return;

  if (!currentUserClubs.length) {
    container.innerHTML = `
      <div class="card" style="text-align:center;padding:40px 24px;">
        <i data-lucide="users" style="width:40px;height:40px;color:var(--text-secondary);margin-bottom:16px;display:block;margin-left:auto;margin-right:auto;"></i>
        <div style="font-size:17px;font-weight:700;margin-bottom:8px;">No club yet</div>
        <div style="font-size:13px;color:var(--text-secondary);">Join a club via your club's invite link to see your results and upcoming galas here.</div>
      </div>`;
    lucide.createIcons();
    return;
  }

  renderClubSwitcher();
  await renderActiveClub();
}

function renderClubSwitcher() {
  const el = document.getElementById('clubSwitcher');
  if (!el) return;
  if (currentUserClubs.length <= 1) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = `<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;">
    ${currentUserClubs.map((m, i) => `
      <button onclick="switchClub(${i})" style="
        flex-shrink:0;padding:7px 16px;border-radius:20px;font-size:13px;font-weight:700;
        border:1px solid ${i===activeClubIndex ? 'var(--cyan)' : 'rgba(255,255,255,0.1)'};
        background:${i===activeClubIndex ? 'rgba(56,189,248,0.12)' : 'transparent'};
        color:${i===activeClubIndex ? 'var(--cyan)' : 'var(--text-secondary)'};cursor:pointer;">
        ${m.clubs?.name || 'Club'}
      </button>`).join('')}
  </div>`;
}

async function switchClub(idx) {
  activeClubIndex = idx;
  renderClubSwitcher();
  await renderActiveClub();
}

async function renderActiveClub() {
  const container = document.getElementById('clubPageContent');
  if (!container) return;
  container.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text-secondary);font-size:13px;">Loading…</div>`;

  const membership = currentUserClubs[activeClubIndex];
  if (!membership) return;

  const club   = membership.clubs;
  const roster = membership.club_roster;

  if (club.club_type === 'swim_club') {
    await renderSwimClub(container, club, roster, membership);
  } else {
    await renderOpenWaterClub(container, club, roster, membership);
  }
}

// ─── Swim Club View ────────────────────────────────────────────────────────────

async function renderSwimClub(container, club, roster, membership) {
  if (!roster?.id) {
    container.innerHTML = renderClubHero(club, roster, membership) + `
      <div class="card" style="margin-bottom:12px;text-align:center;padding:28px 16px;">
        <div style="font-size:14px;font-weight:700;margin-bottom:6px;">Not linked to roster yet</div>
        <div style="font-size:12px;color:var(--text-secondary);">Ask your coach to link your account so your results appear here.</div>
      </div>`;
    lucide.createIcons();
    return;
  }

  const today = new Date().toISOString().slice(0,10);

  const [resultsRes, upcomingRes, pbRes] = await Promise.all([
    // My gala results — fetch with event info
    supabaseClient
      .from('club_gala_results')
      .select('id, stroke, distance, course, time_seconds, time_text, is_pb, club_events(id, title, event_date)')
      .eq('roster_id', roster.id)
      .order('time_seconds'),

    // Upcoming galas
    supabaseClient
      .from('club_events')
      .select('id, title, event_date, description')
      .eq('club_id', club.id)
      .gte('event_date', today)
      .order('event_date')
      .limit(8),

    // My PBs
    supabaseClient
      .from('club_swimmer_times')
      .select('stroke, distance, course, time_seconds, time_text')
      .eq('roster_id', roster.id)
      .eq('is_pb', true),
  ]);

  const allResults  = resultsRes.data  || [];
  const upcoming    = upcomingRes.data || [];
  const pbs         = pbRes.data       || [];

  container.innerHTML =
    renderClubHero(club, roster, membership) +
    renderMyPBs(pbs) +
    renderMyGalas(allResults) +
    renderUpcomingGalas(upcoming);

  lucide.createIcons();
}

// ─── Swim Club Section Renderers ───────────────────────────────────────────────

function renderMyPBs(pbs) {
  if (!pbs.length) return '';

  const order = ['Free','Back','Breast','Fly','IM'];
  const sorted = [...pbs].sort((a, b) => {
    const si = order.indexOf(a.stroke) - order.indexOf(b.stroke);
    return si !== 0 ? si : a.distance - b.distance;
  });

  const rows = sorted.map(p => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-color);">
      <span style="font-size:13px;color:var(--text-secondary);">${p.distance}m ${p.stroke} <span style="font-size:10px;opacity:0.6;">${p.course}</span></span>
      <span style="font-size:15px;font-weight:800;color:var(--text);font-family:'Bebas Neue',sans-serif;letter-spacing:0.05em;">${p.time_text}</span>
    </div>`).join('');

  return `
  <div class="card" style="margin-bottom:12px;">
    <div style="font-size:15px;font-weight:700;margin-bottom:12px;">My Best Times</div>
    ${rows}
  </div>`;
}

function renderMyGalas(allResults) {
  if (!allResults.length) return `
  <div class="card" style="margin-bottom:12px;">
    <div style="font-size:15px;font-weight:700;margin-bottom:6px;">My Galas</div>
    <div style="font-size:13px;color:var(--text-secondary);">No results yet — they'll appear here after your first gala.</div>
  </div>`;

  // Group by event
  const byEvent = {};
  allResults.forEach(r => {
    const ev = r.club_events;
    if (!ev) return;
    if (!byEvent[ev.id]) byEvent[ev.id] = { event: ev, results: [] };
    byEvent[ev.id].results.push(r);
  });

  // Sort events newest first
  const events = Object.values(byEvent).sort((a, b) =>
    b.event.event_date.localeCompare(a.event.event_date));

  const cards = events.map(({ event, results }) => {
    const d    = new Date(event.event_date + 'T12:00:00');
    const date = d.toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' });
    const pbCount = results.filter(r => r.is_pb).length;

    const rows = results
      .sort((a, b) => a.distance - b.distance || a.stroke.localeCompare(b.stroke))
      .map(r => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
          <span style="font-size:12px;color:var(--text-secondary);">${r.distance}m ${r.stroke} <span style="font-size:10px;opacity:0.6;">${r.course}</span></span>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:14px;font-weight:800;color:var(--text);font-family:'Bebas Neue',sans-serif;letter-spacing:0.05em;">${r.time_text}</span>
            ${r.is_pb ? `<span style="font-size:10px;font-weight:800;color:var(--green);background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);border-radius:10px;padding:1px 7px;">PB</span>` : ''}
          </div>
        </div>`).join('');

    return `
    <div style="margin-bottom:14px;background:rgba(255,255,255,0.02);border:1px solid var(--border-color);border-radius:12px;overflow:hidden;">
      <div style="padding:12px 14px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--text);">${event.title}</div>
          <div style="font-size:11px;color:var(--text-secondary);margin-top:1px;">${date}</div>
        </div>
        ${pbCount > 0 ? `<span style="font-size:11px;font-weight:800;color:var(--green);background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);border-radius:20px;padding:3px 10px;">${pbCount} PB${pbCount > 1 ? 's' : ''}</span>` : ''}
      </div>
      <div style="padding:4px 14px 8px;">${rows}</div>
    </div>`;
  }).join('');

  return `
  <div class="card" style="margin-bottom:12px;">
    <div style="font-size:15px;font-weight:700;margin-bottom:14px;">My Galas</div>
    ${cards}
  </div>`;
}

function renderUpcomingGalas(events) {
  if (!events.length) return '';

  const items = events.map(e => {
    const d    = new Date(e.event_date + 'T12:00:00');
    const day  = d.toLocaleDateString('en-ZA', { weekday:'short' });
    const day2 = d.getDate();
    const mon  = d.toLocaleDateString('en-ZA', { month:'short' });
    return `
    <div style="display:flex;gap:14px;align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--border-color);">
      <div style="text-align:center;min-width:40px;flex-shrink:0;">
        <div style="font-size:9px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;">${day}</div>
        <div style="font-size:20px;font-weight:900;color:var(--cyan);font-family:'Bebas Neue',sans-serif;line-height:1.1;">${day2}</div>
        <div style="font-size:9px;color:var(--text-secondary);">${mon}</div>
      </div>
      <div style="flex:1;padding-top:2px;">
        <div style="font-size:14px;font-weight:700;">${e.title}</div>
        ${e.description ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${e.description.split('.')[0]}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `
  <div class="card" style="margin-bottom:12px;">
    <div style="font-size:15px;font-weight:700;margin-bottom:2px;">Season Calendar</div>
    <div style="font-size:11px;color:var(--text-secondary);margin-bottom:12px;">Upcoming galas — 2026/27 season</div>
    ${items}
  </div>`;
}

// ─── Open Water Club View (DUC etc.) ──────────────────────────────────────────

async function renderOpenWaterClub(container, club, roster, membership) {
  const year = new Date().getFullYear();

  const [standingsRes, eventsRes] = await Promise.all([
    supabaseClient
      .from('club_season_standings')
      .select('course, position, total_points, top10_points, swims_count, jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec')
      .eq('club_id', club.id)
      .eq('year', year)
      .eq('roster_id', roster?.id || 'none'),

    supabaseClient
      .from('club_events')
      .select('id, title, event_date, is_league, description')
      .eq('club_id', club.id)
      .gte('event_date', new Date().toISOString().slice(0,10))
      .order('event_date')
      .limit(5),
  ]);

  container.innerHTML =
    renderClubHero(club, roster, membership) +
    renderMyStandings(standingsRes.data || [], year) +
    renderUpcomingEvents(eventsRes.data || [], club) +
    renderFullLeaderboardLink(club);

  lucide.createIcons();
}

// ─── Shared Hero ───────────────────────────────────────────────────────────────

function renderClubHero(club, roster, membership) {
  const cat      = roster?.category || '';
  const num      = roster?.member_number ? `#${roster.member_number}` : '';
  const catColor = catColorMap(cat);
  const isSwim   = club.club_type === 'swim_club';

  return `
  <div class="card" style="margin-bottom:12px;background:linear-gradient(135deg,rgba(2,132,199,0.12),rgba(12,74,110,0.2));border:1px solid rgba(56,189,248,0.2);">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
      <div style="flex:1;">
        ${club.logo_url && isSwim ? `<img src="${club.logo_url}" alt="" style="height:32px;width:auto;object-fit:contain;margin-bottom:8px;display:block;">` : ''}
        <div style="font-size:12px;font-weight:700;color:var(--cyan);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:3px;">${club.city || ''}</div>
        <div style="font-size:20px;font-weight:800;color:var(--text);line-height:1.1;">${club.name}</div>
        ${club.tagline ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">${club.tagline}</div>` : ''}
      </div>
      ${num && !isSwim ? `<div style="text-align:right;flex-shrink:0;">
        <div style="font-size:28px;font-weight:900;color:var(--cyan);line-height:1;font-family:'Bebas Neue',sans-serif;">${num}</div>
        <div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.1em;">Race number</div>
      </div>` : ''}
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      ${cat ? `<span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;${catColor}">${cat}</span>` : ''}
      ${roster?.display_name ? `<span style="font-size:12px;color:var(--text-secondary);">${roster.display_name}</span>` : ''}
    </div>
  </div>`;
}

// ─── Open Water Section Renderers (unchanged) ──────────────────────────────────

function renderMyStandings(standings, year) {
  if (!standings.length) return `
  <div class="card" style="margin-bottom:12px;">
    <div style="font-size:15px;font-weight:700;margin-bottom:4px;">${year} Season</div>
    <div style="font-size:13px;color:var(--text-secondary);">No results recorded yet — standings will appear here after your first race.</div>
  </div>`;

  const months      = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return standings.map(s => {
    const racePoints = months.map((m, i) => s[m] ? `
      <div style="text-align:center;">
        <div style="font-size:11px;color:var(--text-secondary);">${monthLabels[i]}</div>
        <div style="font-size:14px;font-weight:700;color:var(--cyan);">${s[m]}</div>
      </div>` : '').filter(Boolean).join('');

    const qualifies = s.swims_count >= 7;
    return `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div>
          <div style="font-size:12px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.1em;">${s.course === 'LC' ? '2km Long Course' : '1km Short Course'}</div>
          <div style="display:flex;align-items:baseline;gap:8px;margin-top:2px;">
            <span style="font-size:28px;font-weight:900;color:var(--text);font-family:'Bebas Neue',sans-serif;">P${s.position}</span>
            <span style="font-size:13px;color:var(--text-secondary);">${s.top10_points} pts</span>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:22px;font-weight:800;color:${qualifies ? 'var(--green)' : 'var(--amber)'};">${s.swims_count}</div>
          <div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.08em;">of 11 swims</div>
          <div style="font-size:10px;margin-top:2px;color:${qualifies ? 'var(--green)' : 'var(--amber)'};">${qualifies ? 'Qualifies' : `Need ${7 - s.swims_count} more`}</div>
        </div>
      </div>
      ${racePoints ? `<div style="display:flex;gap:12px;flex-wrap:wrap;">${racePoints}</div>` : ''}
    </div>`;
  }).join('');
}

function renderUpcomingEvents(events, club) {
  if (!events.length) return '';
  const items = events.map(e => {
    const d    = new Date(e.event_date);
    const day  = d.toLocaleDateString('en-ZA', { weekday:'short' });
    const date = d.toLocaleDateString('en-ZA', { day:'numeric', month:'short' });
    return `
    <div style="display:flex;gap:14px;align-items:flex-start;padding:14px 0;border-bottom:1px solid var(--border-color);">
      <div style="text-align:center;min-width:44px;">
        <div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;">${day}</div>
        <div style="font-size:16px;font-weight:800;color:var(--cyan);">${date.split(' ')[0]}</div>
        <div style="font-size:10px;color:var(--text-secondary);">${date.split(' ')[1]}</div>
      </div>
      <div style="flex:1;">
        <div style="font-size:14px;font-weight:700;margin-bottom:2px;">${e.title}</div>
        ${e.is_league ? `<span style="font-size:10px;font-weight:700;color:var(--cyan);text-transform:uppercase;letter-spacing:0.1em;background:rgba(56,189,248,0.1);padding:2px 8px;border-radius:10px;">League</span>` : ''}
        ${e.description ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">${e.description}</div>` : ''}
      </div>
      <button onclick="openPreEntry('${e.id}','${e.title.replace(/'/g,"\\'")}','${club.id}')"
        style="flex-shrink:0;padding:8px 14px;border-radius:20px;background:var(--cyan);color:#080f1a;font-size:12px;font-weight:800;border:none;cursor:pointer;">
        Enter
      </button>
    </div>`;
  }).join('');

  return `
  <div class="card" style="margin-bottom:12px;">
    <div style="font-size:15px;font-weight:700;margin-bottom:2px;">Upcoming races</div>
    ${items}
  </div>`;
}

function renderFullLeaderboardLink(club) {
  return `
  <div class="card" style="margin-bottom:12px;text-align:center;">
    <a href="/clubs/${club.slug || club.id}" style="color:var(--cyan);font-size:13px;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">
      <i data-lucide="bar-chart-2" style="width:14px;height:14px;"></i>
      Full league standings
    </a>
  </div>`;
}

// ─── Pre-entry (open water) ────────────────────────────────────────────────────

async function openPreEntry(eventId, eventTitle, clubId) {
  const membership = currentUserClubs[activeClubIndex];
  if (!membership) return;

  const { data: existing } = await supabaseClient
    .from('club_race_entries')
    .select('id')
    .eq('club_event_id', eventId)
    .eq('user_id', currentUser.id)
    .single();

  if (existing) { showToast('Already entered for this race'); return; }
  if (!confirm(`Enter for ${eventTitle}?`)) return;

  const { error } = await supabaseClient
    .from('club_race_entries')
    .insert({
      club_event_id:  eventId,
      user_id:        currentUser.id,
      club_member_id: membership.id,
      category_id:    membership.category_id || null,
      race_number:    String(membership.club_roster?.member_number || membership.member_number || ''),
    });

  if (error) { showToast('Could not enter: ' + error.message); return; }
  showToast('Entered! See you at the start line.');
  await renderActiveClub();
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function catColorMap(cat) {
  const m = {
    Guppies:     'color:#34d399;background:rgba(52,211,153,0.1);border:1px solid rgba(52,211,153,0.25);',
    Sailfish:    'color:#38bdf8;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.25);',
    Makos:       'color:#f59e0b;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);',
    Walrus:      'color:#a78bfa;background:rgba(167,139,250,0.1);border:1px solid rgba(167,139,250,0.25);',
    Coelacanths: 'color:#fb923c;background:rgba(251,146,60,0.1);border:1px solid rgba(251,146,60,0.25);',
    Gold:        'color:#f59e0b;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);',
    Silver:      'color:#94a3b8;background:rgba(148,163,184,0.1);border:1px solid rgba(148,163,184,0.25);',
    Bronze:      'color:#fb923c;background:rgba(251,146,60,0.1);border:1px solid rgba(251,146,60,0.25);',
    Junior:      'color:#a78bfa;background:rgba(167,139,250,0.1);border:1px solid rgba(167,139,250,0.25);',
    Senior:      'color:#38bdf8;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.25);',
  };
  return m[cat] || 'color:var(--text-secondary);background:rgba(255,255,255,0.04);border:1px solid var(--border-color);';
}
