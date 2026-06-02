// app-club.js — Club tab: standings (open water) or gala results (swim club)
// Loaded after app.js, app-nav.js. All globals from app.js available.

let currentUserClubs = [];
let activeClubIndex  = 0;

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function loadUserClubs() {
  if (!currentUser) return;

  try {
    // Fetch club_members and parent links in parallel; enrich clubs separately
    const [membersRes] = await Promise.all([
      supabaseClient
        .from('club_members')
        .select('id, role, is_active, joined_at, category_id, roster_id, club_id')
        .eq('user_id', currentUser.id)
        .eq('is_active', true),
      loadParentLinks(),
    ]);

    // Exclude coach-role club_members — coaches access club data via the coach portal,
    // not the swimmer view. Without this filter, coaches with no roster_id see
    // "Not linked to roster yet" instead of useful content.
    const rows = (membersRes.data || []).filter(r => r.role !== 'coach');

    if (rows.length) {
      const clubIds = [...new Set(rows.map(r => r.club_id))];
      const [clubsRes, rosterRes] = await Promise.all([
        supabaseClient
          .from('clubs')
          .select('id, name, code, slug, city, tagline, logo_url, club_type, contact_email, training_schedule')
          .in('id', clubIds),
        supabaseClient
          .from('club_roster')
          .select('id, member_number, display_name, category, gender, date_of_birth')
          .in('id', rows.map(r => r.roster_id).filter(Boolean)),
      ]);

      const clubMap  = Object.fromEntries((clubsRes.data  || []).map(c => [c.id, c]));
      const rosterMap = Object.fromEntries((rosterRes.data || []).map(r => [r.id, r]));

      currentUserClubs = rows.map(r => ({
        ...r,
        clubs:       clubMap[r.club_id]      || null,
        club_roster: rosterMap[r.roster_id]  || null,
      }));
    } else {
      currentUserClubs = [];
    }
  } catch (err) {
    console.warn('loadUserClubs error:', err);
    currentUserClubs = [];
  }

  const btn = document.getElementById('clubNavBtn');
  if (btn) btn.style.display = (currentUserClubs.length || parentLinks.length) ? 'flex' : 'none';
}

// ─── Render Club Tab ───────────────────────────────────────────────────────────

async function renderClubPage() {
  const container = document.getElementById('clubPageContent');
  if (!container) return;

  // Parent with no swimmer membership → parent view
  if (!currentUserClubs.length && parentLinks.length) {
    await renderParentClubPage();
    return;
  }

  // Parent with pending requests but nothing approved yet
  if (!currentUserClubs.length && !parentLinks.length) {
    // Check for pending parent requests before showing generic "no club" message
    const { data: pending } = await supabaseClient
      .from('parent_roster_links')
      .select('id')
      .eq('parent_user_id', currentUser.id)
      .eq('status', 'pending')
      .limit(1);

    if (pending?.length) {
      await renderParentClubPage();
      return;
    }

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

  try {
    if (club.club_type === 'swim_club') {
      await renderSwimClub(container, club, roster, membership);
    } else {
      await renderOpenWaterClub(container, club, roster, membership);
    }
  } catch (err) {
    console.error('renderActiveClub error:', err);
    container.innerHTML = `<div style="padding:24px 16px;text-align:center;">
      <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:6px;">Could not load club</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:16px;">${err?.message || 'Unknown error'}</div>
      <button onclick="renderActiveClub()" style="padding:9px 20px;background:var(--cyan);color:#080f1a;border:none;border-radius:20px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;">Retry</button>
    </div>`;
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

  // Fetch 28 days of attendance for weekly view
  const fourWeeksAgo = new Date(); fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  const fourWeeksFwd = new Date(); fourWeeksFwd.setDate(fourWeeksFwd.getDate() + 28);

  const [resultsRes, upcomingRes, profileRes, trialsRes, announcementsRes, attendanceRes] = await Promise.all([
    supabaseClient
      .from('club_gala_results')
      .select('id, stroke, distance, course, time_seconds, time_text, is_pb, club_events(id, title, event_date)')
      .eq('roster_id', roster.id),

    supabaseClient
      .from('club_events')
      .select('id, title, event_date, description, is_league, venue, warmup_time, event_start, logistics, entry_open, entry_deadline, sessions_json, course, pre_entry_cutoff')
      .eq('club_id', club.id)
      .gte('event_date', today)
      .order('event_date')
      .limit(20),

    supabaseClient
      .from('club_member_profile')
      .select('date_of_birth, gender')
      .eq('roster_id', roster.id)
      .maybeSingle(),

    supabaseClient
      .from('club_swimmer_times')
      .select('event, course, time_seconds, time_text, meet_date, is_pb')
      .eq('roster_id', roster.id),

    supabaseClient
      .from('club_announcements')
      .select('id, title, body, pinned, created_at')
      .eq('club_id', club.id)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5),

    supabaseClient
      .from('club_session_attendance')
      .select('session_date, session_start, status')
      .eq('roster_id', roster.id)
      .gte('session_date', fourWeeksAgo.toISOString().slice(0,10))
      .lte('session_date', fourWeeksFwd.toISOString().slice(0,10)),
  ]);

  const allResults    = resultsRes.data       || [];
  const upcoming      = upcomingRes.data      || [];
  window._upcomingGalas = upcoming;
  const profile       = profileRes.data       || null;
  const timeTrial     = trialsRes.data        || [];
  const announcements = announcementsRes.data || [];
  const attendance    = attendanceRes.data    || [];
  // Health fetched separately — non-blocking, never crashes main render
  const healthEvents  = [];
  const qtsByEvent    = getAgeGroupQTs(profile?.date_of_birth, profile?.gender);
  const rosterCat     = roster?.category || '';

  // Store context for the Galas tab (fetched lazily on first open)
  // _pbTimes: all PB swimmer times for QT comparison in galas tab
  const pbTimes = timeTrial.filter(t => t.is_pb);
  // Merge profile sources: club_member_profile is authoritative, fall back to club_roster fields
  const mergedProfile = {
    date_of_birth: profile?.date_of_birth || roster?.date_of_birth || null,
    gender:        profile?.gender        || roster?.gender        || null,
  };
  window._galasCtx = { club, roster, profile: mergedProfile, upcoming, _pbTimes: pbTimes };
  _galaTabLoaded = false; // reset so re-render reloads entries

  const hasGalas = upcoming.some(e => e.sessions_json?.length);

  container.innerHTML = `
    <div style="display:flex;gap:0;margin-bottom:16px;background:rgba(255,255,255,0.04);border-radius:50px;padding:3px;">
      <button class="club-inner-tab active" id="clubTabHome" onclick="showClubSubTab('home')" style="flex:1;padding:8px;border-radius:50px;border:none;background:rgba(56,189,248,0.15);color:var(--cyan);font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:all 0.15s;">Home</button>
      <button class="club-inner-tab" id="clubTabGalas" onclick="showClubSubTab('galas')" style="flex:1;padding:8px;border-radius:50px;border:none;background:transparent;color:var(--text-secondary);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.15s;">Galas${hasGalas ? ' <span style="font-size:10px;background:rgba(56,189,248,0.2);color:var(--cyan);padding:1px 5px;border-radius:8px;">Enter</span>' : ''}</button>
    </div>
    <div id="clubSubHome">
      ${renderSwimmerHero(club, roster, allResults, timeTrial, qtsByEvent)}
      ${renderPlanningCard(club, rosterCat, attendance, upcoming, roster.id, club.id)}
      <div id="clubHealthCard" style="margin-bottom:12px;"></div>
      ${renderAnnouncements(announcements)}
      ${renderQTProgressBars(allResults, timeTrial, qtsByEvent)}
      ${renderEventGraphs(allResults, timeTrial, qtsByEvent, roster.id, club.id)}
    </div>
    <div id="clubSubGalas" style="display:none;">
      <div style="text-align:center;padding:32px;color:var(--text-secondary);font-size:13px;">Loading galas…</div>
    </div>`;

  lucide.createIcons();

  // Load health events non-blocking — fills placeholder div after main render
  const _rId = roster.id, _cId = club.id;
  supabaseClient
    .from('club_health_events')
    .select('id, type, body_part, side, severity, notes, created_at, resolved_at')
    .eq('club_id', _cId)
    .eq('roster_id', _rId)
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .then(({ data, error }) => {
      if (error) return; // RLS or other error — silently skip
      try {
        const el = document.getElementById('clubHealthCard');
        if (!el) return;
        el.innerHTML = renderClubHealthCard(data || [], _rId, _cId);
        if (window.lucide) lucide.createIcons();
      } catch (e) { console.warn('Health card render error:', e); }
    });
}

// ─── Swim Club Section Renderers ───────────────────────────────────────────────

// SSA 2025/2026 qualifying times — keyed by gender → age group → distance_stroke_course
// Source: SSA Age Group Qualifying Times 2025/2026 PDF (June 2025)
// Tiers: SANJ (fastest) > L3 > L2 (entry level). Times in seconds.
const SSA_QTS = {
  W: {
    15: {
      // SHORT COURSE
      '50_Free_SC':    { L2: 32.83 },
      '100_Free_SC':   { SANJ: 61.70, L3: 66.13, L2: 73.61 },
      '200_Free_SC':   { SANJ: 135.92, L3: 146.07, L2: 167.14 },
      '400_Free_SC':   { SANJ: 288.59, L3: 318.56 },
      '50_Back_SC':    { L2: 40.41 },
      '100_Back_SC':   { SANJ: 70.68, L3: 78.02, L2: 87.52 },
      '200_Back_SC':   { SANJ: 153.47, L3: 170.22, L2: 198.87 },
      '50_Breast_SC':  { L2: 45.35 },
      '100_Breast_SC': { SANJ: 80.25, L3: 88.14, L2: 100.91 },
      '200_Breast_SC': { SANJ: 174.96, L3: 191.18, L2: 226.68 },
      '50_Fly_SC':     { L2: 38.61 },
      '100_Fly_SC':    { SANJ: 70.82, L3: 76.16, L2: 96.33 },
      '200_IM_SC':     { SANJ: 154.65, L3: 170.16, L2: 188.90 },
      '400_IM_SC':     { SANJ: 333.63 },
      // LONG COURSE
      '50_Free_LC':    { L2: 33.63 },
      '100_Free_LC':   { SANJ: 63.30, L3: 67.73, L2: 75.21 },
      '200_Free_LC':   { SANJ: 139.12, L3: 149.27, L2: 170.34 },
      '400_Free_LC':   { SANJ: 294.99, L3: 324.96 },
      '50_Back_LC':    { L2: 41.01 },
      '100_Back_LC':   { SANJ: 71.88, L3: 79.22, L2: 88.72 },
      '200_Back_LC':   { SANJ: 155.87, L3: 172.62, L2: 201.27 },
      '50_Breast_LC':  { L2: 46.35 },
      '100_Breast_LC': { SANJ: 82.25, L3: 90.14, L2: 102.91 },
      '200_Breast_LC': { SANJ: 178.96, L3: 195.18, L2: 230.68 },
      '50_Fly_LC':     { L2: 39.31 },
      '100_Fly_LC':    { SANJ: 72.22, L3: 77.56, L2: 97.73 },
      '200_IM_LC':     { SANJ: 157.85, L3: 173.36, L2: 192.10 },
      '400_IM_LC':     { SANJ: 340.03 },
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

// "1:09.78" or "69.78" → seconds
function parseTimeInput(val) {
  val = String(val).trim().replace(',', '.');
  const mmss = val.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (mmss) return { seconds: parseInt(mmss[1]) * 60 + parseFloat(mmss[2]), text: val };
  const ss = val.match(/^(\d+(?:\.\d+)?)$/);
  if (ss) return { seconds: parseFloat(ss[1]), text: val };
  return null;
}

// 69.78 → "1:09.78"
function secondsToTimeText(s) {
  if (s < 60) return s.toFixed(2);
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(2).padStart(5, '0');
  return `${m}:${sec}`;
}

// "50 Free" + "SC" → "50_Free_SC"  (matches SSA_QTS key format)
function swimTimeToGroupKey(event, course) {
  const m = event.match(/^(\d+)\s+(.+)$/);
  if (!m) return null;
  return `${m[1]}_${m[2]}_${course}`;
}

// ─── Swimmer Hero ──────────────────────────────────────────────────────────────

function renderSwimmerHero(club, roster, allResults, timeTrial, qtsByEvent) {
  const galas   = new Set(allResults.map(r => r.club_events?.id).filter(Boolean)).size;
  const pbs     = allResults.filter(r => r.is_pb).length + (timeTrial || []).filter(r => r.is_pb).length;
  const cat     = roster?.category || '';

  // Find best QT achievement to feature in hero
  const bestByKey = {};
  allResults.forEach(r => {
    const key = `${r.distance}_${r.stroke}_${r.course}`;
    const t = parseFloat(r.time_seconds);
    if (!bestByKey[key] || t < bestByKey[key].t) bestByKey[key] = { t, text: r.time_text, stroke: r.stroke, distance: r.distance, course: r.course };
  });

  // Find showcase event: prefer L3/SANJ achieved, else L2, else fastest event
  let showcase = null;
  let showcaseTier = '';
  Object.entries(bestByKey).forEach(([key, b]) => {
    const qt = qtsByEvent[key];
    if (!qt) return;
    const tiers = [['SANJ', qt.SANJ], ['L3', qt.L3], ['L2', qt.L2]].filter(([,v]) => v != null);
    const achieved = tiers.filter(([,t]) => b.t <= t);
    if (!achieved.length) return;
    const tier = achieved[0][0]; // hardest achieved
    if (!showcase || ['SANJ','L3','L2'].indexOf(tier) < ['SANJ','L3','L2'].indexOf(showcaseTier)) {
      showcase = b; showcaseTier = tier;
    }
  });
  // Fallback: just pick lowest time
  if (!showcase && Object.keys(bestByKey).length) {
    showcase = Object.values(bestByKey).sort((a,b) => a.t - b.t)[0];
  }

  const catColor = catColorMap(cat);

  return `
  <div style="margin-bottom:12px;background:linear-gradient(135deg,#0a1e3a 0%,#051225 100%);border:1px solid rgba(56,189,248,0.2);border-radius:16px;overflow:hidden;">
    <div style="padding:16px 16px 0;display:flex;align-items:center;justify-content:space-between;">
      <div>
        ${club.logo_url ? `<img src="${club.logo_url}" alt="" style="height:28px;width:auto;object-fit:contain;display:block;margin-bottom:8px;">` : `<div style="font-size:11px;font-weight:700;color:var(--cyan);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:4px;">${club.name}</div>`}
        <div style="font-size:22px;font-weight:900;color:var(--text);line-height:1.1;">${roster?.display_name || 'Swimmer'}</div>
        <div style="margin-top:6px;">
          ${cat ? `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;${catColor}">${cat}</span>` : ''}
        </div>
      </div>
      ${showcase ? `
      <div style="text-align:right;flex-shrink:0;margin-left:12px;">
        <div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px;">Season best</div>
        <div style="font-size:36px;font-weight:900;color:var(--text);font-family:'Bebas Neue',sans-serif;line-height:1;">${showcase.text}</div>
        <div style="font-size:11px;color:var(--text-secondary);">${showcase.distance}m ${showcase.stroke} ${showcase.course}</div>
        ${showcaseTier ? `<span style="font-size:10px;font-weight:800;color:var(--green);background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:2px 8px;display:inline-block;margin-top:4px;">QT ${showcaseTier}</span>` : ''}
      </div>` : ''}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;margin-top:14px;border-top:1px solid rgba(255,255,255,0.06);">
      <div style="text-align:center;padding:12px 8px;">
        <div style="font-size:28px;font-weight:900;color:var(--cyan);font-family:'Bebas Neue',sans-serif;line-height:1;">${galas}</div>
        <div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.06em;margin-top:1px;">Galas</div>
      </div>
      <div style="text-align:center;padding:12px 8px;border-left:1px solid rgba(255,255,255,0.06);border-right:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:28px;font-weight:900;color:#10b981;font-family:'Bebas Neue',sans-serif;line-height:1;">${pbs}</div>
        <div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.06em;margin-top:1px;">PBs</div>
      </div>
      <div style="text-align:center;padding:12px 8px;">
        <div style="font-size:28px;font-weight:900;color:var(--amber);font-family:'Bebas Neue',sans-serif;line-height:1;">${Object.entries(qtsByEvent).filter(([k,qt]) => { const b = bestByKey[k]; return b && [['SANJ',qt.SANJ],['L3',qt.L3],['L2',qt.L2]].some(([,t]) => t && b.t <= t); }).length}</div>
        <div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.06em;margin-top:1px;">QTs</div>
      </div>
    </div>
  </div>`;
}

// ─── Today / Next Session ──────────────────────────────────────────────────────

function renderTrainingToday(club, rosterCategory) {
  const schedule = club.training_schedule;
  if (!schedule?.length) return '';

  const now     = new Date();
  const todayDay = now.getDay();   // 0=Sun … 6=Sat
  const hhmm     = now.getHours() * 60 + now.getMinutes();

  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Find today's session (check if cat is in squads, or show all if no cat)
  const todaySession = schedule.find(s => {
    if (s.day !== todayDay) return false;
    if (rosterCategory && s.squads?.length) {
      return s.squads.some(sq => rosterCategory.toLowerCase().includes(sq.toLowerCase()) || sq.toLowerCase().includes(rosterCategory.toLowerCase()));
    }
    return true;
  });

  // Find next upcoming session after today
  const nextSession = (() => {
    for (let d = 1; d <= 7; d++) {
      const checkDay = (todayDay + d) % 7;
      const s = schedule.find(s2 => {
        if (s2.day !== checkDay) return false;
        if (rosterCategory && s2.squads?.length) {
          return s2.squads.some(sq => rosterCategory.toLowerCase().includes(sq.toLowerCase()) || sq.toLowerCase().includes(rosterCategory.toLowerCase()));
        }
        return true;
      });
      if (s) {
        const nextDate = new Date(now);
        nextDate.setDate(now.getDate() + d);
        return { ...s, daysAway: d, dayName: DAYS[checkDay], shortDay: SHORT[checkDay], date: nextDate.getDate(), mon: nextDate.toLocaleDateString('en-ZA', { month: 'short' }) };
      }
    }
    return null;
  })();

  // Parse "16:30" to minutes
  const toMins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

  if (todaySession) {
    const endMins   = toMins(todaySession.end);
    const startMins = toMins(todaySession.start);
    const isPast    = hhmm > endMins;
    const isNow     = hhmm >= startMins && hhmm <= endMins;

    if (!isPast) {
      const squadStr = todaySession.squads?.join(' & ') || '';
      const statusLabel = isNow
        ? `<span style="font-size:10px;font-weight:800;color:#10b981;background:rgba(16,185,129,0.15);border-radius:8px;padding:2px 8px;margin-left:8px;">IN SESSION</span>`
        : `<span style="font-size:10px;font-weight:800;color:var(--cyan);background:rgba(56,189,248,0.12);border-radius:8px;padding:2px 8px;margin-left:8px;">TODAY</span>`;

      return `
      <div class="card" style="margin-bottom:12px;background:linear-gradient(135deg,rgba(16,185,129,0.08),rgba(56,189,248,0.06));border:1px solid rgba(16,185,129,0.2);">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="display:flex;align-items:center;margin-bottom:4px;">
              <i data-lucide="waves" style="width:14px;height:14px;color:#10b981;margin-right:6px;flex-shrink:0;"></i>
              <span style="font-size:12px;font-weight:700;color:#10b981;text-transform:uppercase;letter-spacing:0.08em;">Training${statusLabel}</span>
            </div>
            <div style="font-size:22px;font-weight:900;color:var(--text);font-family:'Bebas Neue',sans-serif;letter-spacing:0.02em;">${todaySession.start} → ${todaySession.end}</div>
            ${squadStr ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${squadStr}</div>` : ''}
            ${todaySession.venue ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:1px;opacity:0.7;">${todaySession.venue}</div>` : ''}
          </div>
          <i data-lucide="calendar-check" style="width:32px;height:32px;color:#10b981;opacity:0.3;flex-shrink:0;"></i>
        </div>
      </div>`;
    }
  }

  // Show next session
  if (nextSession) {
    const squadStr = nextSession.squads?.join(' & ') || '';
    const daysLabel = nextSession.daysAway === 1 ? 'Tomorrow' : nextSession.dayName;
    return `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Next session</div>
          <div style="font-size:18px;font-weight:900;color:var(--text);font-family:'Bebas Neue',sans-serif;">${daysLabel} · ${nextSession.start}</div>
          ${squadStr ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${squadStr}</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:28px;font-weight:900;color:var(--cyan);font-family:'Bebas Neue',sans-serif;line-height:1;">${nextSession.daysAway}</div>
          <div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;">day${nextSession.daysAway > 1 ? 's' : ''}</div>
        </div>
      </div>
    </div>`;
  }

  return '';
}

// ─── Next Gala Countdown ───────────────────────────────────────────────────────

function renderNextGala(upcoming) {
  const next = upcoming[0];
  if (!next) return '';

  const eventDate = new Date(next.event_date + 'T12:00:00');
  const today     = new Date(); today.setHours(0,0,0,0);
  const daysAway  = Math.round((eventDate - today) / 86400000);
  const dateStr   = eventDate.toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' });
  const urgency   = daysAway <= 7 ? 'var(--amber)' : 'var(--cyan)';

  return `
  <div class="card" style="margin-bottom:12px;background:linear-gradient(135deg,rgba(56,189,248,0.07),rgba(2,132,199,0.04));border:1px solid rgba(56,189,248,0.15);">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Next gala</div>
        <div style="font-size:16px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${next.title}</div>
        <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${dateStr}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;margin-left:14px;">
        <div style="font-size:38px;font-weight:900;color:${urgency};font-family:'Bebas Neue',sans-serif;line-height:1;">${daysAway}</div>
        <div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;">day${daysAway !== 1 ? 's' : ''}</div>
      </div>
    </div>
  </div>`;
}

// ─── Announcements ─────────────────────────────────────────────────────────────

function renderAnnouncements(announcements) {
  if (!announcements.length) return '';

  let expanded = null; // track open item index

  const items = announcements.map((a, i) => {
    const d   = new Date(a.created_at);
    const ago = (() => {
      const diff = (Date.now() - d) / 1000;
      if (diff < 3600)  return `${Math.round(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
      return `${Math.round(diff / 86400)}d ago`;
    })();

    const bodyPreview = (a.body || '').split('\n')[0].slice(0, 80);
    const hasMore     = (a.body || '').length > bodyPreview.length || (a.body || '').includes('\n');

    return `
    <div style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;cursor:pointer;" onclick="toggleAnnouncement('ann_${i}')">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
            ${a.pinned ? `<i data-lucide="pin" style="width:11px;height:11px;color:var(--amber);flex-shrink:0;"></i>` : ''}
            <span style="font-size:13px;font-weight:700;color:var(--text);">${a.title}</span>
          </div>
          <div id="ann_${i}_preview" style="font-size:12px;color:var(--text-secondary);line-height:1.4;">${bodyPreview}${hasMore ? '…' : ''}</div>
          <div id="ann_${i}_full" style="display:none;font-size:12px;color:var(--text-secondary);line-height:1.6;margin-top:6px;white-space:pre-wrap;">${a.body || ''}</div>
        </div>
        <div style="flex-shrink:0;text-align:right;">
          <div style="font-size:10px;color:var(--text-secondary);">${ago}</div>
          ${hasMore ? `<i id="ann_${i}_chevron" data-lucide="chevron-down" style="width:14px;height:14px;color:var(--text-secondary);margin-top:4px;display:block;margin-left:auto;"></i>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  return `
  <div class="card" style="margin-bottom:12px;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;">
      <i data-lucide="megaphone" style="width:15px;height:15px;color:var(--cyan);"></i>
      <span style="font-size:15px;font-weight:700;">From the coach</span>
    </div>
    ${items}
  </div>`;
}

function toggleAnnouncement(id) {
  const preview  = document.getElementById(id + '_preview');
  const full     = document.getElementById(id + '_full');
  const chevron  = document.getElementById(id + '_chevron');
  if (!full) return;
  const isOpen = full.style.display !== 'none';
  full.style.display    = isOpen ? 'none' : 'block';
  if (preview) preview.style.display = isOpen ? 'block' : 'none';
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
  lucide.createIcons();
}

// ─── Planning Card (this week's sessions + next gala) ─────────────────────────

function renderPlanningCard(club, rosterCat, attendance, upcoming, rosterId, clubId) {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr = today.toISOString().slice(0,10);

  // On Sunday show NEXT week — swimmers plan ahead, current week is almost done
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() + (dow === 0 ? 1 : -(dow - 1)));
  const showingNextWeek = dow === 0;

  const SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const schedule = club.training_schedule || [];

  // Build ordered list of this week's sessions — sorted by day then start time
  const weekSessions = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dayNum = d.getDay();
    const dateStr = d.toISOString().slice(0,10);
    // Collect all matching sessions for this day, sort by start time
    const daySessions = schedule.filter(s => {
      if (s.day !== dayNum) return false;
      // Masters sessions always show — coach requires at least 1 per week
      if (s.type === 'masters') return true;
      // For squad sessions: if the session targets specific squads and the swimmer
      // has a category set, only show sessions that match their category
      if (rosterCat && s.squads?.length) {
        return s.squads.some(sq =>
          rosterCat.toLowerCase().includes(sq.toLowerCase()) ||
          sq.toLowerCase().includes(rosterCat.toLowerCase())
        );
      }
      return true;
    }).sort((a, b) => a.start.localeCompare(b.start));

    // Each session needs its own attendance lookup — key by dateStr + start time
    daySessions.forEach(s => {
      const attKey = `${dateStr}_${s.start}`;
      const att = attendance.find(a => a.session_date === dateStr && a.session_start === s.start)
               || attendance.find(a => a.session_date === dateStr && !a.session_start && s.type !== 'masters'); // legacy fallback
      weekSessions.push({ date: d, dateStr, dayName: SHORT[dayNum], session: s, status: att?.status || null, attKey });
    });
  }

  // Only count sessions as "started" if their start time has passed today
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const toMins  = t => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + m; };
  const hasStarted = ws =>
    ws.dateStr < todayStr || (ws.dateStr === todayStr && toMins(ws.session.start) <= nowMins);

  // Separate squad vs masters for stats
  const pastOrToday = weekSessions.filter(hasStarted);
  const squadPast   = pastOrToday.filter(ws => ws.session.type !== 'masters');
  const mastersPast = pastOrToday.filter(ws => ws.session.type === 'masters');
  const squadDone   = squadPast.filter(ws => ws.status === 'attending').length;
  const mastersDone = mastersPast.filter(ws => ws.status === 'attending').length;
  const mastersThisWeek = weekSessions.filter(ws => ws.session.type === 'masters' && ws.status === 'attending').length;

  // Next gala block
  const nextGala = upcoming[0];
  let galaHtml = '';
  if (nextGala) {
    const galaDate = new Date(nextGala.event_date + 'T12:00:00');
    const galaToday = new Date(); galaToday.setHours(0,0,0,0);
    const daysAway = Math.round((galaDate - galaToday) / 86400000);
    const uc = daysAway <= 7 ? 'var(--amber)' : 'var(--cyan)';
    const hasDetail = nextGala.venue || nextGala.warmup_time || nextGala.event_start || nextGala.logistics;
    const detailBtn = hasDetail
      ? `<button onclick="openGalaDetail('${nextGala.id}')" style="margin-top:5px;padding:4px 12px;border-radius:20px;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.25);color:var(--cyan);font-size:11px;font-weight:700;cursor:pointer;">Info &amp; details</button>`
      : '';
    galaHtml = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.07);margin-bottom:12px;">
      <div>
        <div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.08em;">Next Gala</div>
        <div style="font-size:15px;font-weight:800;color:var(--text);margin-top:2px;">${nextGala.title}</div>
        ${nextGala.venue ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:1px;">${nextGala.venue}</div>` : ''}
        ${detailBtn}
      </div>
      <div style="text-align:right;flex-shrink:0;margin-left:14px;">
        <div style="font-size:38px;font-weight:900;color:${uc};font-family:'Bebas Neue',sans-serif;line-height:1;">${daysAway}</div>
        <div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;">day${daysAway!==1?'s':''}</div>
      </div>
    </div>`;
  }

  // Session rows
  let sessionsHtml = '';
  if (weekSessions.length) {
    const rows = weekSessions.map(ws => {
      const isMasters = ws.session.type === 'masters';
      const isPast    = ws.dateStr < todayStr;
      const isToday   = ws.dateStr === todayStr;

      const isDryland = ws.session.type === 'dryland';
      // Accent colour: masters = amber, dryland = purple, squad = cyan
      const accent = isMasters ? '#f59e0b' : isDryland ? '#a78bfa' : '#38bdf8';

      // Dryland rows: no attendance toggle, just informational
      if (isDryland) {
        const todayBadge = isToday ? `<span style="font-size:9px;font-weight:800;color:#a78bfa;background:rgba(167,139,250,0.12);border-radius:6px;padding:1px 5px;margin-left:5px;">TODAY</span>` : '';
        return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);opacity:${isPast ? 0.4 : 1};">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="text-align:center;min-width:32px;">
              <div style="font-size:9px;font-weight:700;color:var(--text-secondary);">${ws.dayName}</div>
              <div style="font-size:18px;font-weight:900;color:${isToday ? '#a78bfa' : 'var(--text)'};font-family:'Bebas Neue',sans-serif;line-height:1.1;">${ws.date.getDate()}</div>
            </div>
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--text);">${ws.session.start}${ws.session.end ? ` – ${ws.session.end}` : ''}${todayBadge}<span style="font-size:9px;font-weight:800;color:#a78bfa;background:rgba(167,139,250,0.1);border:1px solid rgba(167,139,250,0.25);border-radius:6px;padding:1px 6px;margin-left:5px;">Dryland</span></div>
              <div style="font-size:11px;color:var(--text-secondary);">${ws.session.note || 'Compulsory'}</div>
            </div>
          </div>
          <div style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:rgba(167,139,250,0.08);border:1.5px solid rgba(167,139,250,0.2);display:flex;align-items:center;justify-content:center;">
            <i data-lucide="dumbbell" style="width:14px;height:14px;color:#a78bfa;"></i>
          </div>
        </div>`;
      }

      let statusIcon, statusBg, statusBorder, statusColor;
      if (ws.status === 'attending') {
        statusIcon = 'check';     statusColor = '#10b981';
        statusBg   = 'rgba(16,185,129,0.15)'; statusBorder = 'rgba(16,185,129,0.4)';
      } else if (ws.status === 'absent') {
        statusIcon = 'x';         statusColor = isMasters ? '#f59e0b' : '#ef4444';
        statusBg   = isMasters ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.08)';
        statusBorder = isMasters ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.25)';
      } else {
        statusIcon = 'help-circle'; statusColor = 'var(--text-secondary)';
        statusBg   = 'rgba(255,255,255,0.06)'; statusBorder = 'rgba(255,255,255,0.12)';
      }

      const todayBadge = isToday
        ? `<span style="font-size:9px;font-weight:800;color:${accent};background:rgba(56,189,248,0.12);border-radius:6px;padding:1px 5px;margin-left:5px;">TODAY</span>`
        : '';
      const mastersBadge = isMasters
        ? `<span style="font-size:9px;font-weight:800;color:#f59e0b;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);border-radius:6px;padding:1px 6px;margin-left:5px;">Masters</span>`
        : '';
      const arriveNote = ws.session.arrive_by
        ? `<span style="font-size:10px;color:var(--text-secondary);"> · arrive ${ws.session.arrive_by}</span>`
        : '';
      const safeStatus = ws.status || '';
      const safeStart  = ws.session.start;

      return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);opacity:${isPast ? 0.5 : 1};">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="text-align:center;min-width:32px;">
            <div style="font-size:9px;font-weight:700;color:var(--text-secondary);">${ws.dayName}</div>
            <div style="font-size:18px;font-weight:900;color:${isToday ? accent : 'var(--text)'};font-family:'Bebas Neue',sans-serif;line-height:1.1;">${ws.date.getDate()}</div>
          </div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--text);">${safeStart}${ws.session.end ? ` – ${ws.session.end}` : ''}${todayBadge}${mastersBadge}</div>
            <div style="font-size:11px;color:var(--text-secondary);">${ws.session.label || (isMasters ? 'Masters' : 'Squad')}${arriveNote}</div>
          </div>
        </div>
        <button onclick="toggleAttendance('${ws.dateStr}','${safeStart}','${rosterId}','${clubId}','${safeStatus}')"
          style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:${statusBg};border:1.5px solid ${statusBorder};display:flex;align-items:center;justify-content:center;cursor:pointer;">
          <i data-lucide="${statusIcon}" style="width:16px;height:16px;color:${statusColor};pointer-events:none;"></i>
        </button>
      </div>`;
    }).join('');

    // Stats line: squad sessions only (exclude dryland from count)
    const squadTotal = weekSessions.filter(ws => ws.session.type === 'squad' && hasStarted(ws)).length;
    let statsLine = '';
    if (squadTotal > 0 || mastersDone > 0) {
      const mastersNote = mastersThisWeek >= 1
        ? `<span style="color:#10b981;"> · ${mastersThisWeek} masters ✓</span>`
        : `<span style="color:#f59e0b;font-weight:700;"> · 0 masters — 1 required this week</span>`;
      statsLine = `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px;">${squadDone} of ${squadTotal} squad sessions${mastersNote}</div>`;
    } else {
      statsLine = `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px;">Tap a session to mark attendance</div>`;
    }

    sessionsHtml = `
    <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px;">${showingNextWeek ? 'Next week' : 'This week'}</div>
    ${statsLine}
    ${rows}
    <div style="font-size:11px;color:rgba(245,158,11,0.6);margin-top:8px;">Masters sessions are optional — Britt recommends at least 1 per week.</div>`;
  } else if (!schedule.length) {
    sessionsHtml = `<div style="font-size:12px;color:var(--text-secondary);">No training schedule set yet.</div>`;
  } else {
    sessionsHtml = `<div style="font-size:12px;color:var(--text-secondary);">No sessions this week.</div>`;
  }

  return `
  <div class="card" style="margin-bottom:12px;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:14px;">
      <i data-lucide="calendar" style="width:15px;height:15px;color:var(--cyan);"></i>
      <span style="font-size:15px;font-weight:700;">My Week</span>
    </div>
    ${galaHtml}
    ${sessionsHtml}
  </div>`;
}

// ─── Club Health Card (swimmer-facing) ────────────────────────────────────────

function renderClubHealthCard(events, rosterId, clubId) {
  const sevColor = s => s === 'serious' || s === 'significant' ? 'var(--danger)' : s === 'moderate' ? 'var(--amber)' : '#10b981';
  const sevBg    = s => s === 'serious' || s === 'significant' ? 'rgba(239,68,68,0.1)' : s === 'moderate' ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)';

  const rows = events.map(e => {
    const label = [e.body_part, e.side ? `(${e.side})` : ''].filter(Boolean).join(' ') || e.type;
    const date  = e.created_at
      ? new Date(e.created_at).toLocaleDateString('en-ZA', { day:'numeric', month:'short' })
      : '';
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:var(--text);text-transform:capitalize;">${label}</div>
        ${e.notes ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${e.notes}</div>` : ''}
        <div style="font-size:11px;color:var(--text-dim);margin-top:2px;">${date}</div>
      </div>
      <span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;background:${sevBg(e.severity)};color:${sevColor(e.severity)};text-transform:uppercase;flex-shrink:0;">${e.severity}</span>
      <button onclick="resolveClubHealthEvent('${e.id}','${rosterId}','${clubId}')"
        style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);border-radius:6px;padding:5px 10px;font-size:11px;font-weight:700;color:#10b981;cursor:pointer;flex-shrink:0;">
        Resolved
      </button>
    </div>`;
  }).join('');

  return `<div class="card" style="padding:14px 16px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${events.length ? 10 : 0}px;">
      <div style="display:flex;align-items:center;gap:6px;">
        <i data-lucide="activity" style="width:15px;height:15px;color:var(--amber);"></i>
        <span style="font-size:15px;font-weight:700;">Health</span>
        ${events.length ? `<span style="font-size:10px;font-weight:700;background:rgba(245,158,11,0.12);color:var(--amber);padding:2px 7px;border-radius:8px;">${events.length} active</span>` : ''}
      </div>
      <button onclick="openClubHealthLog('${rosterId}','${clubId}')"
        style="display:flex;align-items:center;gap:6px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);color:var(--amber);border-radius:20px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;">
        <i data-lucide="plus" style="width:13px;height:13px;"></i> Log injury / illness
      </button>
    </div>
    ${rows || `<div style="font-size:13px;color:var(--text-secondary);padding:4px 0;">No active health notes.</div>`}
  </div>`;
}

let _healthLogRosterId = null;
let _healthLogClubId   = null;
let _clubHealthType    = '';
let _clubHealthSev     = '';

function openClubHealthLog(rosterId, clubId) {
  _healthLogRosterId = rosterId;
  _healthLogClubId   = clubId;
  _clubHealthType    = '';
  _clubHealthSev     = '';
  document.querySelectorAll('.chl-type-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.chl-sev-btn').forEach(b => b.classList.remove('active'));
  const bp = document.getElementById('chlBodyPart');
  const sd = document.getElementById('chlSide');
  const nt = document.getElementById('chlNotes');
  if (bp) bp.value = '';
  if (sd) sd.value = '';
  if (nt) nt.value = '';
  const br = document.getElementById('chlBodyRow');
  if (br) br.style.display = 'none';
  const m = document.getElementById('clubHealthLogModal');
  if (m) m.style.display = 'flex';
  if (window.lucide) lucide.createIcons();
}

function closeClubHealthLog() {
  const m = document.getElementById('clubHealthLogModal');
  if (m) m.style.display = 'none';
}

function selectClubHealthType(type) {
  _clubHealthType = type;
  document.querySelectorAll('.chl-type-btn').forEach(b => {
    b.style.background = b.dataset.t === type ? 'var(--amber)' : 'rgba(255,255,255,0.05)';
    b.style.color      = b.dataset.t === type ? '#080f1a'      : 'var(--text-secondary)';
  });
  const br = document.getElementById('chlBodyRow');
  if (br) br.style.display = (type === 'injury' || type === 'soreness') ? '' : 'none';
}

function selectClubHealthSev(sev) {
  _clubHealthSev = sev;
  document.querySelectorAll('.chl-sev-btn').forEach(b => {
    b.style.background = b.dataset.s === sev ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.05)';
    b.style.color      = b.dataset.s === sev ? 'var(--amber)'          : 'var(--text-secondary)';
  });
}

async function saveClubHealthEvent() {
  if (!_clubHealthType || !_clubHealthSev) {
    alert('Please select a type and severity.');
    return;
  }
  const today = new Date().toISOString().slice(0,10);
  const bp    = document.getElementById('chlBodyPart')?.value || null;
  const sd    = document.getElementById('chlSide')?.value     || null;
  const nt    = document.getElementById('chlNotes')?.value?.trim() || null;

  const uid = supabaseClient.auth?.getUser ? (await supabaseClient.auth.getUser()).data?.user?.id : currentUser?.id;
  const { error } = await supabaseClient.from('club_health_events').insert({
    club_id:   _healthLogClubId,
    roster_id: _healthLogRosterId,
    type:      _clubHealthType,
    body_part: bp || null,
    side:      sd || null,
    severity:  _clubHealthSev,
    notes:     nt,
    logged_by: uid || null,
  });

  if (error) { console.error('Health save error:', error); alert('Could not save: ' + error.message); return; }
  closeClubHealthLog();
  // Reload club card to refresh health section
  if (typeof loadUserClubs === 'function') loadUserClubs();
}

async function resolveClubHealthEvent(eventId, rosterId, clubId) {
  const today = new Date().toISOString();
  await supabaseClient.from('club_health_events').update({ resolved_at: today }).eq('id', eventId);
  if (typeof loadUserClubs === 'function') loadUserClubs();
}

// ─── Gala Detail Modal ────────────────────────────────────────────────────────

function openGalaDetail(eventId) {
  // Find event from the last loaded upcoming list — stored on window for re-use
  const ev = (window._upcomingGalas || []).find(e => e.id === eventId);
  if (!ev) return;

  const d       = new Date(ev.event_date + 'T12:00:00');
  const dateStr = d.toLocaleDateString('en-ZA', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const daysAway = Math.round((d - new Date().setHours(0,0,0,0)) / 86400000);
  const urgentColor = daysAway <= 14 ? 'var(--amber)' : 'var(--cyan)';

  const rows = [
    ev.venue        && { icon:'map-pin',   label:'Venue',       val: ev.venue },
    ev.warmup_time  && { icon:'clock',     label:'Warm-up',     val: ev.warmup_time },
    ev.event_start  && { icon:'flag',      label:'Events start',val: ev.event_start },
    ev.entry_deadline && { icon:'calendar', label:'Entry deadline', val: new Date(ev.entry_deadline + 'T12:00:00').toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'}) },
  ].filter(Boolean);

  const infoRows = rows.map(r => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <i data-lucide="${r.icon}" style="width:14px;height:14px;color:var(--cyan);flex-shrink:0;margin-top:2px;"></i>
      <div>
        <div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.07em;">${r.label}</div>
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-top:2px;">${r.val}</div>
      </div>
    </div>`).join('');

  const logisticsHtml = ev.logistics ? `
    <div style="margin-top:16px;">
      <div style="font-size:11px;font-weight:700;color:var(--cyan);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Coach notes</div>
      <div style="font-size:13px;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;">${ev.logistics}</div>
    </div>` : '';

  const el = document.getElementById('galaDetailModal');
  if (!el) return;
  document.getElementById('galaDetailTitle').textContent    = ev.title;
  document.getElementById('galaDetailDate').textContent     = dateStr;
  document.getElementById('galaDetailDays').textContent     = daysAway;
  document.getElementById('galaDetailDays').style.color     = urgentColor;
  document.getElementById('galaDetailRows').innerHTML       = infoRows || '<div style="font-size:12px;color:var(--text-secondary);padding:8px 0;">No details added yet — check back closer to the gala.</div>';
  document.getElementById('galaDetailLogistics').innerHTML  = logisticsHtml;
  el.style.display = 'flex';
  lucide.createIcons();
}

function closeGalaDetail() {
  const el = document.getElementById('galaDetailModal');
  if (el) el.style.display = 'none';
}

async function toggleAttendance(sessionDate, sessionStart, rosterId, clubId, currentStatus) {
  // Cycle: (none) → attending → absent → (none)
  const next = !currentStatus ? 'attending' : currentStatus === 'attending' ? 'absent' : null;

  if (!next) {
    await supabaseClient
      .from('club_session_attendance')
      .delete()
      .eq('roster_id', rosterId)
      .eq('session_date', sessionDate)
      .eq('session_start', sessionStart);
  } else {
    await supabaseClient
      .from('club_session_attendance')
      .upsert(
        { roster_id: rosterId, club_id: clubId, session_date: sessionDate, session_start: sessionStart, status: next },
        { onConflict: 'roster_id,session_date,session_start' }
      );
  }
  await renderActiveClub();
}

// ─── QT Progress Bars ──────────────────────────────────────────────────────────

function renderQTProgressBars(allResults, timeTrial, qtsByEvent) {
  if (!Object.keys(qtsByEvent).length) return '';

  // Best and first times per event key
  const bestByKey  = {};
  const firstByKey = {};

  allResults.forEach(r => {
    const key = `${r.distance}_${r.stroke}_${r.course}`;
    const t   = parseFloat(r.time_seconds);
    if (!bestByKey[key]  || t < bestByKey[key].t)  bestByKey[key]  = { t, text: r.time_text };
    const date = r.club_events?.event_date || '9999';
    if (!firstByKey[key] || date < firstByKey[key].date) firstByKey[key] = { t, date };
  });
  (timeTrial || []).forEach(r => {
    const key = swimTimeToGroupKey(r.event, r.course);
    if (!key) return;
    const t = parseFloat(r.time_seconds);
    if (!bestByKey[key]  || t < bestByKey[key].t)  bestByKey[key]  = { t, text: r.time_text };
    const date = r.meet_date || '9999';
    if (!firstByKey[key] || date < firstByKey[key].date) firstByKey[key] = { t, date };
  });

  const items = [];
  Object.entries(qtsByEvent).forEach(([key, qt]) => {
    const best = bestByKey[key];
    if (!best) return;
    const parts    = key.split('_');
    const course   = parts[parts.length - 1];
    const distance = parseInt(parts[0]);
    const stroke   = parts.slice(1, -1).join(' ');

    // tiers sorted fastest→slowest: SANJ, L3, L2
    const tiers = [['SANJ', qt.SANJ], ['L3', qt.L3], ['L2', qt.L2]].filter(([, v]) => v != null);
    if (!tiers.length) return;

    const achieved    = tiers.filter(([, t]) => best.t <= t);
    const notAchieved = tiers.filter(([, t]) => best.t > t);
    const bestAchieved = achieved.length    > 0 ? achieved[0][0]                      : null;
    const nextTgt      = notAchieved.length > 0 ? notAchieved[notAchieved.length - 1] : null;

    const firstTime   = firstByKey[key]?.t || best.t;
    const hardTarget  = tiers[0][1]; // SANJ or hardest available

    // bar range: from slightly slower than first time to hardest target
    const barStart = Math.max(firstTime, best.t) * 1.025;
    const barEnd   = hardTarget;
    const barRange = barStart - barEnd;

    items.push({ key, stroke, distance, course, best, bestAchieved, nextTgt, tiers, barStart, barEnd, barRange });
  });

  if (!items.length) return '';

  // Sort: closest gap first, then all-achieved
  items.sort((a, b) => {
    const gA = a.nextTgt ? a.best.t - a.nextTgt[1] : null;
    const gB = b.nextTgt ? b.best.t - b.nextTgt[1] : null;
    if (gA !== null && gB !== null) return gA - gB;
    if (gA !== null) return -1;
    if (gB !== null) return 1;
    return 0;
  });

  const tierColors = { SANJ: '#f59e0b', L3: '#a78bfa', L2: '#64748b' };

  const bars = items.map(item => {
    const { best, tiers, bestAchieved, nextTgt, barStart, barEnd, barRange } = item;
    const pos = t => barRange > 0 ? Math.min(100, Math.max(0, ((barStart - t) / barRange) * 100)) : 0;

    const fillPct    = pos(best.t);
    const currentPos = pos(best.t);

    const tierTicks = tiers.map(([tier, tierTime]) => {
      const p = pos(tierTime);
      const c = tierColors[tier] || '#64748b';
      const ach = best.t <= tierTime;
      return `
      <div style="position:absolute;left:${p.toFixed(1)}%;top:-18px;transform:translateX(-50%);z-index:3;">
        <div style="font-size:8px;font-weight:800;color:${ach ? c : 'rgba(255,255,255,0.25)'};white-space:nowrap;">${tier}</div>
      </div>
      <div style="position:absolute;left:${p.toFixed(1)}%;top:0;bottom:0;width:1.5px;background:${ach ? c : 'rgba(255,255,255,0.12)'};z-index:2;"></div>`;
    }).join('');

    const achievedBadge = bestAchieved
      ? `<span style="font-size:10px;font-weight:800;color:var(--green);background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:2px 7px;">QT ${bestAchieved}</span>`
      : '';

    const gapText = nextTgt
      ? `<span style="font-size:11px;font-weight:700;color:var(--amber);">−${(best.t - nextTgt[1]).toFixed(2)}s to ${nextTgt[0]} (${secondsToTimeText(nextTgt[1])})</span>`
      : `<span style="font-size:11px;font-weight:700;color:var(--green);">All targets achieved!</span>`;

    return `
    <div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <span style="font-size:13px;font-weight:700;color:var(--text);">${item.distance}m ${item.stroke} <span style="font-size:11px;font-weight:500;color:var(--text-secondary);">${item.course}</span></span>
        <span style="font-size:15px;font-weight:900;color:var(--text);font-family:'Bebas Neue',sans-serif;">${best.text}</span>
      </div>
      <div style="position:relative;height:7px;background:rgba(255,255,255,0.07);border-radius:4px;margin:22px 0 8px;">
        ${tierTicks}
        <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(56,189,248,0.4),rgba(56,189,248,0.85));border-radius:4px;width:${fillPct.toFixed(1)}%;"></div>
        <div style="position:absolute;left:${currentPos.toFixed(1)}%;top:50%;transform:translate(-50%,-50%);z-index:4;width:12px;height:12px;border-radius:50%;background:var(--cyan);border:2px solid #080f1a;box-shadow:0 0 6px rgba(56,189,248,0.7);"></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${achievedBadge}${gapText}</div>
    </div>`;
  }).join('');

  const inProgressCount = items.filter(i => i.nextTgt).length;

  return `
  <div class="card" style="margin-bottom:12px;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
      <i data-lucide="target" style="width:15px;height:15px;color:var(--cyan);"></i>
      <span style="font-size:15px;font-weight:700;">QT Progress</span>
    </div>
    <div style="font-size:11px;color:var(--text-secondary);margin-bottom:16px;">SSA Age Group 2025/2026 · ${inProgressCount} event${inProgressCount!==1?'s':''} in progress</div>
    ${bars}
  </div>`;
}

function renderQTGoals(allResults, timeTrial, qtsByEvent) {
  if (!Object.keys(qtsByEvent).length) return '';

  // Current best per event key from both gala results and time trials
  const bestByKey = {};
  allResults.forEach(r => {
    const key = `${r.distance}_${r.stroke}_${r.course}`;
    const t = parseFloat(r.time_seconds);
    if (!bestByKey[key] || t < bestByKey[key].t) bestByKey[key] = { t, text: r.time_text };
  });
  (timeTrial || []).forEach(r => {
    const key = swimTimeToGroupKey(r.event, r.course);
    if (!key) return;
    const t = parseFloat(r.time_seconds);
    if (!bestByKey[key] || t < bestByKey[key].t) bestByKey[key] = { t, text: r.time_text };
  });

  // Build one goal item per event key that has BOTH a recorded time AND a QT
  const items = [];
  Object.entries(qtsByEvent).forEach(([key, qt]) => {
    const best = bestByKey[key];
    if (!best) return;
    const parts   = key.split('_');
    const course   = parts[parts.length - 1];
    const distance = parseInt(parts[0]);
    const stroke   = parts.slice(1, -1).join(' ');

    // tiers sorted fastest → slowest: SANJ, L3, L2
    const tiers = [['SANJ', qt.SANJ], ['L3', qt.L3], ['L2', qt.L2]].filter(([, v]) => v != null);
    const achieved    = tiers.filter(([, t]) => best.t <= t);          // swimmer IS faster than QT
    const notAchieved = tiers.filter(([, t]) => best.t > t);           // swimmer is slower
    const bestAchieved  = achieved.length    > 0 ? achieved[0][0]                         : null;
    const nextTarget    = notAchieved.length > 0 ? notAchieved[notAchieved.length - 1]    : null;
    const gap = nextTarget ? best.t - nextTarget[1] : null;

    items.push({ key, stroke, distance, course, best, bestAchieved, nextTarget: nextTarget?.[0], targetTime: nextTarget?.[1], gap });
  });

  if (!items.length) return '';

  // Sort: events with gap (closest first) → fully achieved (no gap)
  items.sort((a, b) => {
    if (a.gap !== null && b.gap !== null) return a.gap - b.gap;
    if (a.gap !== null) return -1;
    if (b.gap !== null) return 1;
    return 0;
  });

  const rows = items.map(item => {
    const label = `${item.distance}m ${item.stroke}`;
    const course = `<span style="font-size:10px;color:var(--text-secondary);margin-left:4px;">${item.course}</span>`;
    const achievedBadge = item.bestAchieved
      ? `<span style="font-size:9px;font-weight:800;color:var(--green);background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:1px 5px;margin-left:4px;">${item.bestAchieved}</span>`
      : '';

    if (!item.nextTarget) {
      return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <div style="font-size:13px;font-weight:600;color:var(--text);">${label}${course}${achievedBadge}</div>
        <span style="font-size:13px;font-weight:800;font-family:'Bebas Neue',sans-serif;color:var(--green);">${item.best.text}</span>
      </div>`;
    }

    const isClose   = item.gap < 3;
    const gapStr    = item.gap.toFixed(2);
    const targetTxt = secondsToTimeText(item.targetTime);
    const gapColor  = isClose ? '#f59e0b' : 'var(--text-secondary)';

    return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <div>
        <span style="font-size:13px;font-weight:600;color:var(--text);">${label}${course}</span>
        ${achievedBadge}
        <div style="font-size:10px;color:${gapColor};margin-top:1px;">−${gapStr}s → ${item.nextTarget} (${targetTxt})</div>
      </div>
      <span style="font-size:13px;font-weight:800;font-family:'Bebas Neue',sans-serif;color:var(--text);flex-shrink:0;margin-left:10px;">${item.best.text}</span>
    </div>`;
  }).join('');

  const gapCount = items.filter(i => i.gap !== null).length;

  return `
  <div class="card" style="margin-bottom:12px;">
    <div style="font-size:15px;font-weight:700;margin-bottom:2px;">Qualifying Targets</div>
    <div style="font-size:11px;color:var(--text-secondary);margin-bottom:14px;">SSA Age Group 2025/2026 · ${gapCount} events in progress</div>
    ${rows}
  </div>`;
}

function renderEventGraphs(allResults, timeTrial, qtsByEvent, rosterId, clubId) {
  if (!allResults.length && !(timeTrial || []).length) return `
  <div class="card" style="margin-bottom:12px;">
    <div style="font-size:15px;font-weight:700;margin-bottom:6px;">My Events</div>
    <div style="font-size:13px;color:var(--text-secondary);">No results yet — they'll appear here after your first gala.</div>
  </div>`;

  // Group by distance_stroke_course (matches SSA_QTS key format)
  const groups = {};
  const addPt = (key, stroke, distance, course, pt) => {
    if (!groups[key]) groups[key] = { stroke, distance, course, pts: [] };
    groups[key].pts.push(pt);
  };

  allResults.forEach(r => {
    const ev = r.club_events;
    if (!ev) return;
    addPt(`${r.distance}_${r.stroke}_${r.course}`, r.stroke, r.distance, r.course, {
      date: ev.event_date, time_seconds: parseFloat(r.time_seconds),
      time_text: r.time_text, is_pb: r.is_pb, gala: ev.title, isTT: false,
    });
  });

  (timeTrial || []).forEach(r => {
    const key = swimTimeToGroupKey(r.event, r.course);
    if (!key) return;
    const parts = key.split('_');
    const course = parts[parts.length - 1];
    const distance = parseInt(parts[0]);
    const stroke = parts.slice(1, -1).join(' ');
    addPt(key, stroke, distance, course, {
      date: r.meet_date, time_seconds: parseFloat(r.time_seconds),
      time_text: r.time_text, is_pb: r.is_pb, gala: 'Time Trial', isTT: true,
    });
  });

  Object.values(groups).forEach(g => g.pts.sort((a, b) => a.date.localeCompare(b.date)));

  const strokeOrder = ['Free','Back','Breast','Fly','IM'];
  const sorted = Object.values(groups).sort((a, b) => {
    const si = strokeOrder.indexOf(a.stroke) - strokeOrder.indexOf(b.stroke);
    return si !== 0 ? si : a.distance - b.distance;
  });

  const cards = sorted.map(g => {
    const key  = `${g.distance}_${g.stroke}_${g.course}`;
    const qt   = qtsByEvent[key] || null;
    const times = g.pts.map(p => p.time_seconds);
    const bestTime  = Math.min(...times);
    const firstTime = g.pts[0].time_seconds;
    const bestPt    = g.pts.find(p => p.time_seconds === bestTime);
    const improvement = firstTime - bestTime;

    // QT badge / next target (fixed: next = easiest unachieved tier)
    let qtHtml = '';
    if (qt) {
      const tiers       = [['SANJ', qt.SANJ], ['L3', qt.L3], ['L2', qt.L2]].filter(([, v]) => v != null);
      const achieved    = tiers.filter(([, t]) => bestTime <= t);
      const notAchieved = tiers.filter(([, t]) => bestTime > t);
      const bestAch     = achieved.length    > 0 ? achieved[0][0]                       : null;
      const nextTgt     = notAchieved.length > 0 ? notAchieved[notAchieved.length - 1]  : null;
      if (bestAch) qtHtml += `<span style="font-size:10px;font-weight:800;color:var(--green);background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);border-radius:10px;padding:2px 8px;display:inline-block;margin-top:3px;">QT ${bestAch}</span>`;
      if (nextTgt) {
        const gap = (bestTime - nextTgt[1]).toFixed(2);
        qtHtml += `<div style="font-size:10px;font-weight:700;color:var(--amber);margin-top:2px;">−${gap}s to ${nextTgt[0]}</div>`;
      }
    }

    const resultRows = [...g.pts].reverse().map(p => {
      const d       = new Date(p.date + 'T12:00:00');
      const dateStr = d.toLocaleDateString('en-ZA', { day:'numeric', month:'short' });
      const ttBadge = p.isTT ? `<span style="font-size:9px;color:var(--text-secondary);background:rgba(255,255,255,0.06);border-radius:6px;padding:1px 5px;">TT</span>` : '';
      return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="font-size:11px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;">${p.gala} <span style="opacity:0.5;">${dateStr}</span></span>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          ${ttBadge}
          <span style="font-size:13px;font-weight:800;color:var(--text);font-family:'Bebas Neue',sans-serif;letter-spacing:0.05em;">${p.time_text}</span>
          ${p.is_pb ? `<span style="font-size:9px;font-weight:800;color:var(--green);background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:1px 5px;">PB</span>` : ''}
        </div>
      </div>`;
    }).join('');

    const logBtn = rosterId ? `<button onclick="openTimeTrialModal(${g.distance},'${g.stroke}','${g.course}','${rosterId}','${clubId}')"
      style="flex-shrink:0;padding:4px 10px;border-radius:20px;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.25);color:var(--cyan);font-size:11px;font-weight:700;cursor:pointer;">+ Log time</button>` : '';

    return `
    <div style="margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid var(--border-color);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:4px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-size:14px;font-weight:800;color:var(--text);">${g.distance}m ${g.stroke} <span style="font-size:11px;font-weight:600;color:var(--text-secondary);">${g.course}</span></span>
            ${logBtn}
          </div>
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

// ─── Time Trial Logging ────────────────────────────────────────────────────────

function openTimeTrialModal(distance, stroke, course, rosterId, clubId) {
  const existing = document.getElementById('timeTrialModal');
  if (existing) existing.remove();

  const today = new Date().toISOString().slice(0, 10);
  document.body.insertAdjacentHTML('beforeend', `
  <div id="timeTrialModal" style="position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10010;display:flex;align-items:flex-end;justify-content:center;">
    <div style="background:#0d1728;border-radius:20px 20px 0 0;width:100%;max-width:480px;padding:24px;border-top:1px solid rgba(255,255,255,0.1);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <div style="font-size:17px;font-weight:800;">${distance}m ${stroke} ${course} — Log time</div>
        <button onclick="document.getElementById('timeTrialModal').remove()" style="background:none;border:none;color:var(--text-secondary);font-size:24px;cursor:pointer;padding:0;line-height:1;">×</button>
      </div>
      <div style="margin-bottom:14px;">
        <label style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.08em;display:block;margin-bottom:6px;">Date</label>
        <input type="date" id="ttDate" value="${today}" style="width:100%;padding:11px 14px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:10px;color:var(--text);font-size:15px;box-sizing:border-box;">
      </div>
      <div style="margin-bottom:24px;">
        <label style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.08em;display:block;margin-bottom:6px;">Time (1:09.50 or 32.45)</label>
        <input type="text" id="ttTime" placeholder="e.g. 32.45" inputmode="decimal"
          style="width:100%;padding:11px 14px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:10px;color:var(--text);font-size:26px;font-family:'Bebas Neue',sans-serif;letter-spacing:0.05em;box-sizing:border-box;">
        <div id="ttTimeErr" style="font-size:11px;color:var(--danger);margin-top:5px;display:none;">Invalid format — use 1:09.50 or 32.45</div>
      </div>
      <button onclick="saveTimeTrial(${distance},'${stroke}','${course}','${rosterId}','${clubId}')"
        style="width:100%;padding:14px;background:var(--cyan);color:#080f1a;font-size:15px;font-weight:800;border:none;border-radius:50px;cursor:pointer;">
        Save time trial
      </button>
    </div>
  </div>`);
  setTimeout(() => document.getElementById('ttTime')?.focus(), 80);
}

async function saveTimeTrial(distance, stroke, course, rosterId, clubId) {
  const timeVal = document.getElementById('ttTime')?.value || '';
  const dateVal = document.getElementById('ttDate')?.value || '';
  const parsed  = parseTimeInput(timeVal);

  if (!parsed) {
    const errEl = document.getElementById('ttTimeErr');
    if (errEl) errEl.style.display = 'block';
    return;
  }

  const timeText = secondsToTimeText(parsed.seconds);
  const eventStr = `${distance} ${stroke}`;

  // Is this a PB for this event?
  const { data: existing } = await supabaseClient
    .from('club_swimmer_times')
    .select('time_seconds')
    .eq('roster_id', rosterId)
    .eq('event', eventStr)
    .eq('course', course)
    .order('time_seconds')
    .limit(1);

  const isPb = !existing?.length || parsed.seconds < parseFloat(existing[0].time_seconds);

  const { error } = await supabaseClient
    .from('club_swimmer_times')
    .insert({
      club_id:      clubId,
      roster_id:    rosterId,
      event:        eventStr,
      course,
      time_text:    timeText,
      time_seconds: parsed.seconds,
      meet_name:    'Time Trial',
      meet_date:    dateVal,
      season:       '2025/2026',
      is_pb:        isPb,
      source:       'manual',
    });

  if (error) { showToast('Could not save: ' + error.message); return; }

  document.getElementById('timeTrialModal')?.remove();
  showToast(isPb ? `PB! ${timeText} saved.` : `Time trial ${timeText} saved.`);
  await renderActiveClub();
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

// ─── Parent View ───────────────────────────────────────────────────────────────
// Shown when user has approved parent_roster_links but no club_members row.
// Reuses the same swim-club data pipeline — same data, parent's perspective.

let parentLinks        = [];   // approved parent_roster_links
let activeParentIndex  = 0;

async function loadParentLinks() {
  if (!currentUser) return;
  const { data } = await supabaseClient
    .from('parent_roster_links')
    .select(`
      id, relationship, status,
      clubs ( id, name, slug, club_type ),
      club_roster ( id, member_number, display_name, category, gender )
    `)
    .eq('parent_user_id', currentUser.id)
    .eq('status', 'approved');

  parentLinks = data || [];

  // Show Club nav tab if parent has approved links (even with no membership)
  if (parentLinks.length && !currentUserClubs.length) {
    const btn = document.getElementById('clubNavBtn');
    if (btn) btn.style.display = 'flex';
  }
}

async function renderParentClubPage() {
  const container = document.getElementById('clubPageContent');
  if (!container) return;

  // Check for any pending requests too — show helpful message
  const { data: pending } = await supabaseClient
    .from('parent_roster_links')
    .select('id, club_roster(display_name), clubs(name)')
    .eq('parent_user_id', currentUser.id)
    .eq('status', 'pending');

  if (!parentLinks.length) {
    container.innerHTML = `
      <div class="card" style="text-align:center;padding:40px 24px;">
        <i data-lucide="clock" style="width:40px;height:40px;color:var(--text-secondary);margin-bottom:16px;display:block;margin-left:auto;margin-right:auto;"></i>
        <div style="font-size:17px;font-weight:700;margin-bottom:8px;">Access pending</div>
        <div style="font-size:13px;color:var(--text-secondary);line-height:1.65;">
          ${pending?.length
            ? `Your request to follow <strong style="color:var(--text-primary);">${pending.map(p => p.club_roster?.display_name || '—').join(', ')}</strong> is waiting for the club admin to approve.`
            : 'Your parent access request is waiting for the club admin to approve.'}
          <br>You\'ll be able to see their results once confirmed.
        </div>
      </div>`;
    lucide.createIcons();
    return;
  }

  renderParentSwitcher();
  await renderActiveParentSwimmer();
}

function renderParentSwitcher() {
  const el = document.getElementById('clubSwitcher');
  if (!el) return;
  if (parentLinks.length <= 1) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = `<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;">
    ${parentLinks.map((l, i) => `
      <button onclick="switchParentSwimmer(${i})" style="
        flex-shrink:0;padding:7px 16px;border-radius:20px;font-size:13px;font-weight:700;
        border:1px solid ${i===activeParentIndex ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.1)'};
        background:${i===activeParentIndex ? 'rgba(167,139,250,0.12)' : 'transparent'};
        color:${i===activeParentIndex ? '#a78bfa' : 'var(--text-secondary)'};cursor:pointer;">
        ${l.club_roster?.display_name?.split(' ')[0] || 'Swimmer'}
      </button>`).join('')}
  </div>`;
}

async function switchParentSwimmer(idx) {
  activeParentIndex = idx;
  renderParentSwitcher();
  await renderActiveParentSwimmer();
}

async function renderActiveParentSwimmer() {
  const container = document.getElementById('clubPageContent');
  if (!container) return;
  container.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text-secondary);font-size:13px;">Loading…</div>`;

  const link   = parentLinks[activeParentIndex];
  if (!link) return;
  const club   = link.clubs;
  const roster = link.club_roster;

  if (!roster?.id) {
    container.innerHTML = `<div class="card" style="text-align:center;padding:28px;"><div style="font-size:14px;color:var(--text-secondary);">Swimmer profile not found. Contact the club admin.</div></div>`;
    lucide.createIcons();
    return;
  }

  // Reuse the exact same data fetch as renderSwimClub
  const today       = new Date().toISOString().slice(0,10);
  const fourWeeksAgo = new Date(); fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  const fourWeeksFwd = new Date(); fourWeeksFwd.setDate(fourWeeksFwd.getDate() + 28);

  const [resultsRes, upcomingRes, profileRes, trialsRes, announcementsRes, attendanceRes] = await Promise.all([
    supabaseClient.from('club_gala_results')
      .select('id, stroke, distance, course, time_seconds, time_text, is_pb, club_events(id, title, event_date)')
      .eq('roster_id', roster.id),
    supabaseClient.from('club_events')
      .select('id, title, event_date, description, is_league, venue, warmup_time, event_start, logistics, entry_open, entry_deadline, sessions_json, course, pre_entry_cutoff')
      .eq('club_id', club.id).gte('event_date', today).order('event_date').limit(20),
    supabaseClient.from('club_member_profile')
      .select('date_of_birth, gender').eq('roster_id', roster.id).maybeSingle(),
    supabaseClient.from('club_swimmer_times')
      .select('event, course, time_seconds, time_text, meet_date, is_pb').eq('roster_id', roster.id),
    supabaseClient.from('club_announcements')
      .select('id, title, body, pinned, created_at').eq('club_id', club.id)
      .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(5),
    supabaseClient.from('club_session_attendance')
      .select('session_date, session_start, status').eq('roster_id', roster.id)
      .gte('session_date', fourWeeksAgo.toISOString().slice(0,10))
      .lte('session_date', fourWeeksFwd.toISOString().slice(0,10)),
  ]);

  const allResults    = resultsRes.data    || [];
  const upcoming      = upcomingRes.data   || [];
  const profile       = profileRes.data    || null;
  const timeTrial     = trialsRes.data     || [];
  const announcements = announcementsRes.data || [];
  const attendance    = attendanceRes.data || [];
  const mergedProfile2 = {
    date_of_birth: profile?.date_of_birth || roster?.date_of_birth || null,
    gender:        profile?.gender        || roster?.gender        || null,
  };
  const qtsByEvent    = getAgeGroupQTs(mergedProfile2.date_of_birth, mergedProfile2.gender);
  const rosterCat     = roster?.category || '';

  // Parent context banner
  const parentBanner = `
    <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;
      background:rgba(167,139,250,0.07);border:1px solid rgba(167,139,250,0.2);
      border-radius:12px;margin-bottom:12px;">
      <i data-lucide="heart-handshake" style="width:16px;height:16px;color:#a78bfa;flex-shrink:0;"></i>
      <div style="font-size:13px;color:rgba(241,245,249,0.7);">
        Viewing <strong style="color:var(--text-primary);">${roster.display_name}</strong>'s profile
        <span style="color:#a78bfa;"> · ${link.relationship || 'Parent'}</span>
        <span style="color:var(--text-secondary);font-size:11px;"> · read only</span>
      </div>
    </div>`;

  container.innerHTML =
    parentBanner +
    renderSwimmerHero(club, roster, allResults, timeTrial, qtsByEvent) +
    renderPlanningCard(club, rosterCat, attendance, upcoming, roster.id, club.id) +
    renderAnnouncements(announcements) +
    renderQTProgressBars(allResults, timeTrial, qtsByEvent) +
    renderEventGraphs(allResults, timeTrial, qtsByEvent, roster.id, club.id);

  lucide.createIcons();
}

// ─── Club inner tab switcher ───────────────────────────────────────────────────

let _galaTabLoaded = false;

function showClubSubTab(tab) {
  const home  = document.getElementById('clubSubHome');
  const galas = document.getElementById('clubSubGalas');
  const btnHome  = document.getElementById('clubTabHome');
  const btnGalas = document.getElementById('clubTabGalas');
  if (!home || !galas) return;

  if (tab === 'home') {
    home.style.display  = '';
    galas.style.display = 'none';
    btnHome.style.background  = 'rgba(56,189,248,0.15)';
    btnHome.style.color        = 'var(--cyan)';
    btnGalas.style.background = 'transparent';
    btnGalas.style.color      = 'var(--text-secondary)';
  } else {
    home.style.display  = 'none';
    galas.style.display = '';
    btnGalas.style.background = 'rgba(56,189,248,0.15)';
    btnGalas.style.color       = 'var(--cyan)';
    btnHome.style.background  = 'transparent';
    btnHome.style.color       = 'var(--text-secondary)';
    if (!_galaTabLoaded) { _galaTabLoaded = true; loadGalasTab(); }
  }
}

// ─── Galas tab ────────────────────────────────────────────────────────────────

let _galasQtMap    = {};   // "event|course" → { L2, L3, SANJ } in seconds — fetched once
let _galasEntries  = {};   // eventId → [entry rows] — fetched once then kept in sync
let _galasQtFetched = false;

async function loadGalasTab() {
  const ctx = window._galasCtx;
  if (!ctx) return;
  const { club, roster, profile, upcoming } = ctx;
  const el = document.getElementById('clubSubGalas');
  if (!el) return;

  // Fetch QTs from DB (LC and SC) and existing entries in parallel
  const dob    = profile?.date_of_birth;
  const gender = profile?.gender;
  const ssaG   = gender === 'F' ? 'W' : 'M';
  const ag     = dob ? _clubSsaAgeGroup(dob) : null;

  const fetches = [
    supabaseClient
      .from('club_gala_entries')
      .select('id, event_id, event_name, session_number, swimmer_notes, status, entry_time_text')
      .eq('club_id', club.id)
      .eq('roster_id', roster.id),
  ];

  if (!_galasQtFetched && ag && ssaG) {
    fetches.push(
      supabaseClient
        .from('ssa_qualifying_times')
        .select('event, course, level, time_seconds, time_text')
        .eq('gender', ssaG)
        .eq('age_group', ag)
        .in('level', ['L2', 'L3', 'SANJ'])
        .eq('season', '2025-2026')
    );
  }

  const [entriesRes, qtRes] = await Promise.all(fetches);

  // Build entries map
  _galasEntries = {};
  (entriesRes.data || []).forEach(e => {
    if (!_galasEntries[e.event_id]) _galasEntries[e.event_id] = [];
    _galasEntries[e.event_id].push(e);
  });

  // Build QT map: "event|course" → { L2, L3, SANJ }
  if (qtRes && !_galasQtFetched) {
    _galasQtFetched = true;
    (qtRes.data || []).forEach(row => {
      const k = row.event + '|' + row.course;
      if (!_galasQtMap[k]) _galasQtMap[k] = {};
      _galasQtMap[k][row.level] = { seconds: row.time_seconds, text: row.time_text };
    });
  }

  renderGalasTab();
}

function renderGalasTab() {
  const ctx = window._galasCtx;
  if (!ctx) return;
  const { upcoming } = ctx;
  const el = document.getElementById('clubSubGalas');
  if (!el) return;

  if (!upcoming.length) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:32px 16px;">
      <div style="font-size:15px;font-weight:700;margin-bottom:6px;">No upcoming galas</div>
      <div style="font-size:13px;color:var(--text-secondary);">Your coach will add galas here when available.</div>
    </div>`;
    return;
  }

  el.innerHTML = upcoming.map(ev => renderGalaEntryCard(ev)).join('');
  lucide.createIcons();
}

function renderGalaEntryCard(ev) {
  const d        = new Date(ev.event_date + 'T12:00:00');
  const entries  = (_galasEntries[ev.id] || []).filter(e => e.status !== 'scratched');
  const count    = entries.length;
  const deadline = ev.entry_deadline;
  const deadlineStr = deadline
    ? new Date(deadline + 'T12:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
    : null;
  const isDeadlineSoon = deadline && (new Date(deadline + 'T23:59:59') - new Date()) < 3 * 86400000;
  const hasSessions = ev.sessions_json?.length > 0;
  const course = ev.course || 'LC';

  return `<div class="card" style="margin-bottom:10px;overflow:hidden;${count > 0 ? 'border-color:rgba(56,189,248,0.25);' : ''}" id="galaCard_${ev.id}">
    <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;" onclick="toggleGalaEntry('${ev.id}')">
      <div style="background:rgba(56,189,248,0.08);border-radius:10px;padding:8px 10px;min-width:46px;text-align:center;flex-shrink:0;">
        <div style="font-size:20px;font-weight:700;color:var(--cyan);line-height:1;">${d.getDate()}</div>
        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;">${d.toLocaleString('default',{month:'short'})}</div>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:15px;font-weight:700;color:var(--text);">${ev.title}</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:4px;">
          ${ev.venue ? `<span style="font-size:11px;color:var(--text-secondary);background:rgba(255,255,255,0.04);padding:2px 7px;border-radius:4px;">${ev.venue}</span>` : ''}
          <span style="font-size:11px;color:var(--text-secondary);background:rgba(255,255,255,0.04);padding:2px 7px;border-radius:4px;">${course}</span>
          ${deadlineStr ? `<span style="font-size:11px;padding:2px 7px;border-radius:4px;${isDeadlineSoon ? 'color:var(--amber);background:rgba(245,158,11,0.08);' : 'color:var(--text-secondary);background:rgba(255,255,255,0.04);'}">Closes ${deadlineStr}</span>` : ''}
          ${count > 0 ? `<span style="font-size:11px;color:var(--cyan);background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.2);padding:2px 8px;border-radius:10px;">${count} event${count!==1?'s':''} submitted</span>` : ''}
        </div>
      </div>
      <i data-lucide="chevron-down" id="galaChevron_${ev.id}" style="width:18px;height:18px;color:var(--text-dim);transition:transform 0.2s;flex-shrink:0;"></i>
    </div>
    <div id="galaPanel_${ev.id}" style="display:none;border-top:1px solid rgba(255,255,255,0.07);padding:16px;">
      ${hasSessions ? buildGalaSessionPanel(ev) : buildGalaGenericPanel(ev)}
    </div>
  </div>`;
}

function toggleGalaEntry(eventId) {
  const panel   = document.getElementById('galaPanel_'   + eventId);
  const chevron = document.getElementById('galaChevron_' + eventId);
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  // Close all
  document.querySelectorAll('[id^="galaPanel_"]').forEach(p => { p.style.display = 'none'; });
  document.querySelectorAll('[id^="galaChevron_"]').forEach(c => { c.style.transform = ''; });
  if (!isOpen) {
    panel.style.display = '';
    if (chevron) chevron.style.transform = 'rotate(180deg)';
  }
}

function buildGalaSessionPanel(ev) {
  const entries   = _galasEntries[ev.id] || [];
  const activeMap = {};
  let savedNotes  = '';
  entries.filter(e => e.status !== 'scratched').forEach(e => {
    activeMap[`${e.session_number || 0}|${e.event_name}`] = e;
    if (e.swimmer_notes) savedNotes = e.swimmer_notes;
  });

  const ctx    = window._galasCtx;
  const pbMap  = {};
  (ctx?.roster?.id ? [] : []).forEach(() => {}); // ensure ctx available

  // Build PB map from existing results
  const allTimes = window._galasCtx?._pbTimes || [];
  allTimes.forEach(t => { pbMap[t.event + '|' + (t.course||'LC')] = t; });

  const course = ev.course || 'LC';
  let html = '';
  const hasProfile = !!(ctx?.profile?.date_of_birth && ctx?.profile?.gender);

  if (!hasProfile) {
    html += `<div style="font-size:12px;color:var(--amber);background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:10px 12px;margin-bottom:14px;">
      Date of birth and gender not set — ask your coach to complete your profile for QT checks.
    </div>`;
  } else {
    html += `<div style="font-size:12px;color:var(--text-secondary);background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:10px 12px;margin-bottom:14px;line-height:1.5;">
      To enter a session you need a qualifying time at that level in <em>any</em> event. Once qualified, all events in that session are open to you.
    </div>`;
  }

  const sessions = ev.sessions_json;
  sessions.forEach((sess, si) => {
    if (si > 0) html += '<div style="border-top:1px solid rgba(255,255,255,0.06);margin:14px 0;"></div>';

    const levelCls   = sess.level === 'L3' || sess.level === 'SANJ'
      ? 'color:#38bdf8;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.2);'
      : 'color:#10b981;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);';
    const levelLabel = sess.level === 'SANJ' ? 'SANJ' : sess.level === 'L3' ? 'L3+' : 'L2';

    html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
      <span style="font-size:13px;font-weight:700;color:var(--text);">Session ${sess.number} — ${sess.label}</span>
      <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;${levelCls}">${levelLabel}</span>
      <span style="font-size:12px;color:var(--text-secondary);margin-left:auto;">${sess.start_time || ''}</span>
    </div>`;

    // Level eligibility: if the swimmer has ANY qualifying PB at this session's
    // level, all events in the session are open — not just events where they
    // have a specific PB. This matches the rule: qualify at L2 in any event →
    // can enter ALL L2 events at the next gala. Same for L3 and SANJ.
    const qualifiesAtSessionLevel = hasProfile && allTimes.some(t => {
      const qt = _galasQtMap[t.event + '|' + (t.course || course)]?.[sess.level]
              || _galasQtMap[t.event + '|' + (t.course === 'LC' ? 'SC' : 'LC')]?.[sess.level];
      return qt && t.is_pb && t.time_seconds <= qt.seconds;
    });

    (sess.events || []).forEach(evtObj => {
      const evtName = typeof evtObj === 'string' ? evtObj : evtObj.name;
      const minAge  = evtObj.min_age || null;
      const checked = !!activeMap[`${sess.number}|${evtName}`];
      const cbId    = `gcb_${ev.id}_${sess.number}_${evtName.replace(/ /g,'_')}`;

      const pb  = pbMap[evtName + '|' + course] || pbMap[evtName + '|SC'];

      let canSelect = true, rowStyle = '', rightHtml = '';
      const ageOk = !(minAge && ctx?.profile?.date_of_birth &&
        (new Date().getFullYear() - parseInt(ctx.profile.date_of_birth)) < minAge);

      if (!ageOk) {
        canSelect = false; rowStyle = 'opacity:0.4;';
        rightHtml = `<span style="font-size:10px;color:var(--text-dim);">11 &amp; over only</span>`;
      } else if (!hasProfile) {
        rightHtml = pb ? `<span style="font-size:11px;color:var(--text-secondary);">PB ${pb.time_text}</span>` : '';
      } else if (qualifiesAtSessionLevel) {
        // Swimmer qualifies at this level — all events open
        rowStyle = pb ? 'background:rgba(16,185,129,0.03);border-radius:8px;' : '';
        rightHtml = pb
          ? `<span style="font-size:11px;color:var(--green);background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);padding:2px 7px;border-radius:4px;">PB ${pb.time_text}</span>`
          : `<span style="font-size:10px;color:var(--cyan);">Level eligible</span>`;
      } else {
        // Swimmer does not yet qualify at this level
        canSelect = false; rowStyle = 'opacity:0.45;';
        const qt = _galasQtMap[evtName + '|' + course]?.[sess.level];
        rightHtml = pb
          ? `<div style="text-align:right;">
              <div style="font-size:10px;font-weight:700;color:var(--danger);margin-bottom:1px;">Not qualified at ${sess.level}</div>
              <div style="font-size:10px;color:var(--text-secondary);">PB ${pb.time_text}${qt ? ' · need ' + qt.text : ''}</div>
            </div>`
          : `<div style="text-align:right;">
              <div style="font-size:10px;font-weight:700;color:var(--danger);margin-bottom:1px;">Not qualified at ${sess.level}</div>
              <div style="font-size:10px;color:var(--text-dim);">No PB on file</div>
            </div>`;
      }

      html += `<div style="display:flex;align-items:center;gap:10px;padding:9px 8px;border-radius:8px;${rowStyle}">
        <input type="checkbox" id="${cbId}" data-event="${evtName}" data-session="${sess.number}"
          ${checked ? 'checked' : ''} ${canSelect ? '' : 'disabled'}
          style="width:18px;height:18px;accent-color:var(--cyan);flex-shrink:0;cursor:${canSelect?'pointer':'not-allowed'};">
        <label for="${cbId}" style="flex:1;font-size:14px;font-weight:${canSelect?'500':'400'};color:var(--text);cursor:${canSelect?'pointer':'default'};">${evtName}</label>
        <div style="text-align:right;flex-shrink:0;">${rightHtml}</div>
      </div>`;
    });
  });

  const totalSelected = Object.keys(activeMap).length;
  html += `
    <div style="border-top:1px solid rgba(255,255,255,0.06);margin-top:14px;padding-top:14px;">
      <textarea id="galaNotes_${ev.id}" rows="2"
        style="width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 12px;color:var(--text);font-family:inherit;font-size:13px;resize:none;outline:none;margin-bottom:10px;"
        placeholder="Note to coach (optional)">${savedNotes}</textarea>
      <button onclick="saveGalaEntryFromApp('${ev.id}')"
        style="width:100%;padding:13px;background:var(--cyan);color:#080f1a;border:none;border-radius:50px;font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;"
        id="galaSaveBtn_${ev.id}">
        ${totalSelected > 0 ? 'Update entries' : 'Submit entries'}
      </button>
      ${totalSelected > 0 ? `<button onclick="clearGalaEntryFromApp('${ev.id}')"
        style="width:100%;margin-top:8px;padding:10px;background:transparent;border:1px solid rgba(239,68,68,0.25);border-radius:50px;color:var(--danger);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;">
        Remove all my entries for this gala
      </button>` : ''}
    </div>`;

  return html;
}

function buildGalaGenericPanel(ev) {
  const EVENTS = ['50 Free','100 Free','200 Free','400 Free','800 Free','1500 Free',
    '50 Back','100 Back','200 Back','50 Breast','100 Breast','200 Breast',
    '50 Fly','100 Fly','200 Fly','100 IM','200 IM','400 IM'];
  const entries   = _galasEntries[ev.id] || [];
  const activeSet = new Set(entries.filter(e => e.status !== 'scratched').map(e => e.event_name));
  let savedNotes  = entries.find(e => e.swimmer_notes)?.swimmer_notes || '';
  const course    = ev.course || 'LC';

  // Build PB map from context
  const pbMap = {};
  (window._galasCtx?._pbTimes || []).forEach(t => {
    pbMap[t.event + '|' + (t.course || 'LC')] = t;
  });

  const rows = EVENTS.map(evtName => {
    const cbId = `gcb_${ev.id}_0_${evtName.replace(/ /g,'_')}`;
    const pb   = pbMap[evtName + '|' + course] || pbMap[evtName + '|SC'];
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 6px;border-radius:8px;${pb ? 'background:rgba(255,255,255,0.02);' : ''}">
      <input type="checkbox" id="${cbId}" data-event="${evtName}" data-session="0"
        ${activeSet.has(evtName) ? 'checked' : ''}
        style="width:18px;height:18px;accent-color:var(--cyan);cursor:pointer;flex-shrink:0;">
      <label for="${cbId}" style="flex:1;font-size:14px;color:var(--text);cursor:pointer;">${evtName}</label>
      ${pb ? `<span style="font-size:11px;color:var(--cyan);background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.15);padding:2px 8px;border-radius:4px;white-space:nowrap;">PB ${pb.time_text}</span>` : ''}
    </div>`;
  }).join('');

  const totalSelected = activeSet.size;
  return `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:10px;padding:8px 10px;background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.15);border-radius:8px;">
    Sessions not configured yet — your coach will add event levels shortly. Select what you plan to swim.
  </div>
  ${rows}
  <div style="border-top:1px solid rgba(255,255,255,0.06);margin-top:12px;padding-top:12px;">
    <textarea id="galaNotes_${ev.id}" rows="2"
      style="width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 12px;color:var(--text);font-family:inherit;font-size:13px;resize:none;outline:none;margin-bottom:10px;"
      placeholder="Note to coach (optional)">${savedNotes}</textarea>
    <button onclick="saveGalaEntryFromApp('${ev.id}')"
      style="width:100%;padding:13px;background:var(--cyan);color:#080f1a;border:none;border-radius:50px;font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;"
      id="galaSaveBtn_${ev.id}">${totalSelected > 0 ? 'Update entries' : 'Submit entries'}</button>
    ${totalSelected > 0 ? `<button onclick="clearGalaEntryFromApp('${ev.id}')"
      style="width:100%;margin-top:8px;padding:10px;background:transparent;border:1px solid rgba(239,68,68,0.25);border-radius:50px;color:var(--danger);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;">
      Remove all my entries
    </button>` : ''}
  </div>`;
}

async function saveGalaEntryFromApp(eventId) {
  const ctx = window._galasCtx;
  if (!ctx) return;
  const { club, roster } = ctx;

  const btn = document.getElementById('galaSaveBtn_' + eventId);
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  const panel = document.getElementById('galaPanel_' + eventId);
  const notes = document.getElementById('galaNotes_' + eventId)?.value?.trim() || null;
  const selected = [];
  panel?.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)').forEach(cb => {
    selected.push({ event_name: cb.dataset.event, session_number: parseInt(cb.dataset.session) || null });
  });

  // Delete existing requested entries for this event
  await supabaseClient.from('club_gala_entries')
    .delete()
    .eq('club_id', club.id).eq('event_id', eventId).eq('roster_id', roster.id).eq('status', 'requested');

  if (selected.length > 0) {
    const rows = selected.map(s => ({
      club_id: club.id, event_id: eventId, roster_id: roster.id,
      event_name: s.event_name, session_number: s.session_number,
      swimmer_notes: notes, status: 'requested',
    }));
    const { data: inserted, error } = await supabaseClient.from('club_gala_entries').insert(rows).select();
    if (error) { showToast('Save failed: ' + error.message, 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Submit entries'; } return; }
    _galasEntries[eventId] = [...(_galasEntries[eventId] || []).filter(e => e.status !== 'requested'), ...(inserted || [])];
  } else {
    _galasEntries[eventId] = (_galasEntries[eventId] || []).filter(e => e.status !== 'requested');
  }

  showToast(selected.length > 0 ? `${selected.length} event${selected.length!==1?'s':''} submitted` : 'Entries cleared', 'success');
  renderGalasTab();
}

async function clearGalaEntryFromApp(eventId) {
  if (!confirm('Remove all your entry requests for this gala?')) return;
  const ctx = window._galasCtx;
  if (!ctx) return;
  const { club, roster } = ctx;
  await supabaseClient.from('club_gala_entries')
    .delete()
    .eq('club_id', club.id).eq('event_id', eventId).eq('roster_id', roster.id).eq('status', 'requested');
  _galasEntries[eventId] = (_galasEntries[eventId] || []).filter(e => e.status !== 'requested');
  showToast('Entries removed');
  renderGalasTab();
}

function _clubSsaAgeGroup(dob) {
  if (!dob) return null;
  const age = new Date().getFullYear() - parseInt(dob.slice(0, 4), 10);
  if (age <= 10) return '10U';
  if (age <= 16) return String(age);
  return null;
}

function _fmtGapClub(sec) {
  if (sec < 60) return sec.toFixed(1) + 's';
  return Math.floor(sec / 60) + ':' + (sec % 60).toFixed(1).padStart(4, '0');
}
