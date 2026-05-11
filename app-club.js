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

  const [resultsRes, upcomingRes, profileRes] = await Promise.all([
    supabaseClient
      .from('club_gala_results')
      .select('id, stroke, distance, course, time_seconds, time_text, is_pb, club_events(id, title, event_date)')
      .eq('roster_id', roster.id),

    supabaseClient
      .from('club_events')
      .select('id, title, event_date, description')
      .eq('club_id', club.id)
      .gte('event_date', today)
      .order('event_date')
      .limit(8),

    supabaseClient
      .from('club_member_profile')
      .select('date_of_birth, gender')
      .eq('roster_id', roster.id)
      .maybeSingle(),
  ]);

  const allResults = resultsRes.data  || [];
  const upcoming   = upcomingRes.data || [];
  const profile    = profileRes.data  || null;
  const qtsByEvent = getAgeGroupQTs(profile?.date_of_birth, profile?.gender);

  container.innerHTML =
    renderClubHero(club, roster, membership) +
    renderSwimStats(allResults) +
    renderEventGraphs(allResults, qtsByEvent) +
    renderUpcomingGalas(upcoming);

  lucide.createIcons();
}

// ─── Swim Club Section Renderers ───────────────────────────────────────────────

// SSA 2025/2026 qualifying times — keyed by gender → age group → event key
// Source: SSA Age Group Qualifying Times 2025/2026 PDF
// Tiers: SANJ (fastest) > L3 > L2 (entry level)
const SSA_QTS = {
  W: {
    15: {
      '50_Free_SC':  { L2: 32.83 },
      '50_Fly_SC':   { L2: 38.61 },
      '200_Free_LC': { L3: 149.27 },
      '400_Free_LC': { L3: 324.96 },
    },
  },
  M: {},
};

function getAgeGroupQTs(dob, gender) {
  if (!dob || !gender) return {};
  const birthYear = parseInt(dob.split('-')[0]);
  const age = new Date().getFullYear() - birthYear;
  const g = gender.toUpperCase() === 'F' ? 'W' : 'M';
  return SSA_QTS[g]?.[age] || {};
}

function renderSwimStats(allResults) {
  const galas = new Set(allResults.map(r => r.club_events?.id).filter(Boolean)).size;
  const pbs   = allResults.filter(r => r.is_pb).length;
  return `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
    <div class="card" style="text-align:center;padding:16px 12px;">
      <div style="font-size:32px;font-weight:900;color:var(--cyan);font-family:'Bebas Neue',sans-serif;line-height:1;">${galas}</div>
      <div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-top:2px;text-transform:uppercase;letter-spacing:0.08em;">Galas</div>
    </div>
    <div class="card" style="text-align:center;padding:16px 12px;">
      <div style="font-size:32px;font-weight:900;color:var(--green);font-family:'Bebas Neue',sans-serif;line-height:1;">${pbs}</div>
      <div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-top:2px;text-transform:uppercase;letter-spacing:0.08em;">Personal Bests</div>
    </div>
  </div>`;
}

function renderEventGraphs(allResults, qtsByEvent) {
  if (!allResults.length) return `
  <div class="card" style="margin-bottom:12px;">
    <div style="font-size:15px;font-weight:700;margin-bottom:6px;">My Events</div>
    <div style="font-size:13px;color:var(--text-secondary);">No results yet — they'll appear here after your first gala.</div>
  </div>`;

  // Group by stroke_distance_course
  const groups = {};
  allResults.forEach(r => {
    const ev = r.club_events;
    if (!ev) return;
    const key = `${r.stroke}_${r.distance}_${r.course}`;
    if (!groups[key]) groups[key] = { stroke: r.stroke, distance: r.distance, course: r.course, pts: [] };
    groups[key].pts.push({
      date:         ev.event_date,
      time_seconds: parseFloat(r.time_seconds),
      time_text:    r.time_text,
      is_pb:        r.is_pb,
      gala:         ev.title,
    });
  });

  Object.values(groups).forEach(g => g.pts.sort((a, b) => a.date.localeCompare(b.date)));

  const strokeOrder = ['Free','Back','Breast','Fly','IM'];
  const sorted = Object.values(groups).sort((a, b) => {
    const si = strokeOrder.indexOf(a.stroke) - strokeOrder.indexOf(b.stroke);
    return si !== 0 ? si : a.distance - b.distance;
  });

  const cards = sorted.map(g => {
    const key  = `${g.stroke}_${g.distance}_${g.course}`;
    const qt   = qtsByEvent[key] || null;
    const times = g.pts.map(p => p.time_seconds);
    const bestTime  = Math.min(...times);
    const firstTime = g.pts[0].time_seconds;
    const bestPt    = g.pts.find(p => p.time_seconds === bestTime);
    const improvement = firstTime - bestTime;

    // QT badge / next target
    let qtHtml = '';
    if (qt) {
      const tiers = [['SANJ', qt.SANJ], ['L3', qt.L3], ['L2', qt.L2]].filter(([, v]) => v != null);
      const achieved = tiers.filter(([, t]) => bestTime <= t);
      const nextTarget = tiers.find(([, t]) => bestTime > t);
      if (achieved.length) {
        qtHtml += `<span style="font-size:10px;font-weight:800;color:var(--green);background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);border-radius:10px;padding:2px 8px;display:inline-block;margin-top:3px;">QT ${achieved[achieved.length-1][0]}</span>`;
      }
      if (nextTarget) {
        const gap = (bestTime - nextTarget[1]).toFixed(2);
        qtHtml += `<div style="font-size:10px;font-weight:700;color:var(--amber);margin-top:2px;">−${gap}s to ${nextTarget[0]}</div>`;
      }
    }

    const resultRows = [...g.pts].reverse().map(p => {
      const d       = new Date(p.date + 'T12:00:00');
      const dateStr = d.toLocaleDateString('en-ZA', { day:'numeric', month:'short' });
      return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="font-size:11px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;">${p.gala} <span style="opacity:0.5;">${dateStr}</span></span>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <span style="font-size:13px;font-weight:800;color:var(--text);font-family:'Bebas Neue',sans-serif;letter-spacing:0.05em;">${p.time_text}</span>
          ${p.is_pb ? `<span style="font-size:9px;font-weight:800;color:var(--green);background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:1px 5px;">PB</span>` : ''}
        </div>
      </div>`;
    }).join('');

    return `
    <div style="margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid var(--border-color);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:4px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:800;color:var(--text);">${g.distance}m ${g.stroke} <span style="font-size:11px;font-weight:600;color:var(--text-secondary);">${g.course}</span></div>
          ${improvement > 0.01 ? `<div style="font-size:11px;color:var(--green);margin-top:2px;">↓ ${improvement.toFixed(2)}s faster</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:12px;">
          <div style="font-size:26px;font-weight:900;color:var(--text);font-family:'Bebas Neue',sans-serif;line-height:1;">${bestPt?.time_text || ''}</div>
          ${qtHtml}
        </div>
      </div>
      ${g.pts.length > 1 ? renderSparkline(g.pts, qt) : ''}
      <div>${resultRows}</div>
    </div>`;
  }).join('');

  return `
  <div class="card" style="margin-bottom:12px;">
    <div style="font-size:15px;font-weight:700;margin-bottom:16px;">My Events</div>
    ${cards}
  </div>`;
}

function renderSparkline(pts, qt) {
  const W = 300, H = 52, PAD = 6;
  if (pts.length < 2) return '';

  const times = pts.map(p => p.time_seconds);
  const qtTimes = qt ? Object.values(qt).filter(Boolean) : [];
  const allT = [...times, ...qtTimes];
  const minT = Math.min(...allT);
  const maxT = Math.max(...allT);
  const range = maxT - minT || 1;

  const xs = pts.map((_, i) => PAD + (i / (pts.length - 1)) * (W - 2 * PAD));
  const ys = times.map(t => H - PAD - ((maxT - t) / range) * (H - 2 * PAD));

  const pathD = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');

  let qtLines = '';
  if (qt) {
    const tierColors = { SANJ: '#f59e0b', L3: '#a78bfa', L2: '#64748b' };
    Object.entries(qt).forEach(([tier, t]) => {
      if (!t) return;
      const qy = (H - PAD - ((maxT - t) / range) * (H - 2 * PAD)).toFixed(1);
      const c  = tierColors[tier] || '#64748b';
      qtLines += `<line x1="${PAD}" y1="${qy}" x2="${W - PAD - 18}" y2="${qy}" stroke="${c}" stroke-width="1" stroke-dasharray="3,3" opacity="0.65"/>
        <text x="${W - PAD - 15}" y="${(parseFloat(qy) + 3.5).toFixed(1)}" font-size="8" fill="${c}" opacity="0.8">${tier}</text>`;
    });
  }

  const dots = pts.map((p, i) => `<circle cx="${xs[i].toFixed(1)}" cy="${ys[i].toFixed(1)}" r="${p.is_pb ? 4 : 3}" fill="${p.is_pb ? '#10b981' : '#38bdf8'}" opacity="${p.is_pb ? 1 : 0.65}"/>`).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;overflow:visible;margin:6px 0 4px;" preserveAspectRatio="none">
    <path d="${pathD}" fill="none" stroke="#38bdf8" stroke-width="1.5" opacity="0.45"/>
    ${qtLines}
    ${dots}
  </svg>`;
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
