// app-club.js — Club tab: standings, events, pre-entry
// Loaded after app.js, app-nav.js. All globals from app.js available.

let currentUserClubs = [];   // [{club, member, roster}]
let activeClubIndex  = 0;

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function loadUserClubs() {
  if (!currentUser) return;

  const { data } = await supabaseClient
    .from('club_members')
    .select(`
      id, role, is_active, joined_at, category_id,
      roster_id,
      clubs ( id, name, code, slug, city, tagline, logo_url ),
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
        <div style="font-size:13px;color:var(--text-secondary);">Join a club via your club's invite link to see league standings, events and results here.</div>
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
  const year   = new Date().getFullYear();

  // Fetch standings + upcoming events in parallel
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

  const myStandings = standingsRes.data || [];
  const events      = eventsRes.data || [];

  container.innerHTML = `
    ${renderClubHero(club, roster, membership)}
    ${renderMyStandings(myStandings, year)}
    ${renderUpcomingEvents(events, club)}
    ${renderFullLeaderboardLink(club)}
  `;
  lucide.createIcons();
}

// ─── Section renderers ─────────────────────────────────────────────────────────

function renderClubHero(club, roster, membership) {
  const cat = roster?.category || '';
  const num = roster?.member_number ? `#${roster.member_number}` : '';
  const catColor = catColorMap(cat);

  return `
  <div class="card" style="margin-bottom:12px;background:linear-gradient(135deg,rgba(2,132,199,0.12),rgba(12,74,110,0.2));border:1px solid rgba(56,189,248,0.2);">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--cyan);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">${club.city || ''}</div>
        <div style="font-size:22px;font-weight:800;color:var(--text);line-height:1.1;">${club.name}</div>
        ${club.tagline ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">${club.tagline}</div>` : ''}
      </div>
      ${num ? `<div style="text-align:right;">
        <div style="font-size:28px;font-weight:900;color:var(--cyan);line-height:1;font-family:'Bebas Neue',sans-serif;letter-spacing:0.05em;">${num}</div>
        <div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.1em;">Race number</div>
      </div>` : ''}
    </div>
    ${cat ? `<span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;${catColor}">${cat}</span>` : ''}
  </div>`;
}

function renderMyStandings(standings, year) {
  if (!standings.length) {
    return `
    <div class="card" style="margin-bottom:12px;">
      <div style="font-size:15px;font-weight:700;margin-bottom:4px;">${year} Season</div>
      <div style="font-size:13px;color:var(--text-secondary);">No results recorded yet — standings will appear here after your first race.</div>
    </div>`;
  }

  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
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
    const day  = d.toLocaleDateString('en-ZA',{weekday:'short'});
    const date = d.toLocaleDateString('en-ZA',{day:'numeric',month:'short'});
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

// ─── Pre-entry ─────────────────────────────────────────────────────────────────

async function openPreEntry(eventId, eventTitle, clubId) {
  const membership = currentUserClubs[activeClubIndex];
  if (!membership) return;

  // Check if already entered
  const { data: existing } = await supabaseClient
    .from('club_race_entries')
    .select('id')
    .eq('club_event_id', eventId)
    .eq('user_id', currentUser.id)
    .single();

  if (existing) {
    showToast('Already entered for this race');
    return;
  }

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
  };
  return m[cat] || m.Sailfish;
}
