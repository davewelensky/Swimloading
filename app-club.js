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

  const [resultsRes, upcomingRes, profileRes, trialsRes] = await Promise.all([
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

    supabaseClient
      .from('club_swimmer_times')
      .select('event, course, time_seconds, time_text, meet_date, is_pb')
      .eq('roster_id', roster.id),
  ]);

  const allResults = resultsRes.data  || [];
  const upcoming   = upcomingRes.data || [];
  const profile    = profileRes.data  || null;
  const timeTrial  = trialsRes.data   || [];
  const qtsByEvent = getAgeGroupQTs(profile?.date_of_birth, profile?.gender);

  container.innerHTML =
    renderClubHero(club, roster, membership) +
    renderSwimStats(allResults, timeTrial) +
    renderQTGoals(allResults, timeTrial, qtsByEvent) +
    renderEventGraphs(allResults, timeTrial, qtsByEvent, roster.id, club.id) +
    renderUpcomingGalas(upcoming);

  lucide.createIcons();
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

function renderSwimStats(allResults, timeTrial) {
  const galas = new Set(allResults.map(r => r.club_events?.id).filter(Boolean)).size;
  const pbs   = allResults.filter(r => r.is_pb).length + (timeTrial || []).filter(r => r.is_pb).length;
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
