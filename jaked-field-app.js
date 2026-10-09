// Jaked x Carina Field Test Programme — UI. All numbers come from test-programme-lib.js; this file only fetches, renders and saves.
(function () {
  'use strict';
  var L = window.TestProgramme;
  var SUPABASE_URL = 'https://szgkzuswelntnevobnoh.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';
  var PROGRAM_SLUG = 'jaked-carina';
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var S = { user: null, isAdmin: false, program: null, products: [], sessions: [], sps: [], obs: [], market: [], strava: null, stravaSpots: {}, tracked: null, view: 'programme', arg: null, reportMode: 'private' };
  var D = null;          // the swim being logged / edited
  var busy = false;

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(d) { if (!d) return ''; var p = String(d).slice(0, 10).split('-'); return parseInt(p[2], 10) + ' ' + MONTHS[parseInt(p[1], 10) - 1] + ' ' + p[0]; }
  function localDate(offsetDays) { var d = new Date(); d.setDate(d.getDate() - (offsetDays || 0)); var m = d.getMonth() + 1, day = d.getDate(); return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day; }   // never toISOString(): SAST shifts a day
  function numIn(v) { v = String(v == null ? '' : v).trim().replace(',', '.'); if (v === '') return null; var x = Number(v); return isFinite(x) ? x : NaN; }
  function secToHMS(sec) { if (sec == null) return ''; var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 3200); }

  var IC = {
    plus: '<path d="M5 12h14M12 5v14"/>', chev: '<path d="m9 18 6-6-6-6"/>', back: '<path d="m15 18-6-6 6-6"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    bars: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'
  };
  function icon(n, sz) { sz = sz || 18; return '<svg class="ic" width="' + sz + '" height="' + sz + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[n] + '</svg>'; }

  // ── data ──────────────────────────────────────────────────────
  async function fetchAll(table, programId, orderCols) {
    var out = [], from = 0, size = 1000;
    for (;;) {
      var q = sb.from(table).select('*').eq('program_id', programId);
      (orderCols || ['id']).forEach(function (c) { q = q.order(c); });   // stable order so pages never overlap
      var r = await q.range(from, from + size - 1);
      if (r.error) throw r.error;
      out = out.concat(r.data);
      if (r.data.length < size) break;
      from += size;
    }
    return out;
  }
  function sortSessions() {
    S.sessions.sort(function (a, b) {
      if (!a.session_date !== !b.session_date) return a.session_date ? 1 : -1;   // undated (still to complete) first
      var d = String(b.session_date || '').localeCompare(String(a.session_date || ''));
      return d || String(b.created_at).localeCompare(String(a.created_at));
    });
  }
  async function loadAll() {
    var p = await sb.from('test_programs').select('*').eq('slug', PROGRAM_SLUG).maybeSingle();
    if (p.error || !p.data) return false;
    S.program = p.data;
    var pid = p.data.id;
    var res = await Promise.all([
      fetchAll('test_products', pid), fetchAll('test_sessions', pid), fetchAll('test_session_products', pid, ['session_id', 'product_id']),
      fetchAll('test_observations', pid), fetchAll('test_market_signals', pid),
      sb.from('test_program_members').select('role').eq('program_id', pid).eq('user_id', S.user.id).maybeSingle()
    ]);
    S.products = res[0].sort(function (a, b) { return a.sort_order - b.sort_order; });
    S.sessions = res[1]; S.sps = res[2]; S.obs = res[3]; S.market = res[4];
    S.isAdmin = !!(res[5].data && res[5].data.role === 'admin');
    sortSessions();
    return true;
  }
  async function refresh() { await loadAll(); }
  function data() { return { sessions: S.sessions, sessionProducts: S.sps, observations: S.obs }; }
  function garage() { return L.garage(S.products); }
  function profile(g, opts) { return L.productProfile(g, data(), opts); }
  function sessionById(id) { return S.sessions.filter(function (s) { return s.id === id; })[0]; }
  function productById(id) { return S.products.filter(function (p) { return p.id === id; })[0]; }
  function productsOfSession(id) { return S.sps.filter(function (sp) { return sp.session_id === id; }); }
  function obsOf(sid, pid) { return S.obs.filter(function (o) { return o.session_id === sid && o.product_id === pid; }); }
  function catOf(p) { return L.CATEGORIES[p.category] || L.CATEGORIES.other; }

  // ── auth ──────────────────────────────────────────────────────
  function showAuth(msg) {
    $('appView').hidden = true; $('authScreen').hidden = false;
    var e = $('authError'); if (msg) { e.textContent = msg; e.hidden = false; } else e.hidden = true;
    $('authInfo').hidden = true;
  }
  async function boot() {
    var ok = false;
    try { ok = await loadAll(); } catch (err) { console.error(err); }
    if (!ok) { await sb.auth.signOut(); S.user = null; showAuth('This programme is private. Your account is not a member.'); return false; }
    $('authScreen').hidden = true; $('appView').hidden = false;
    $('signOut').textContent = 'Sign out';
    route();
    return true;
  }
  async function init() {
    var s = (await sb.auth.getSession()).data.session;
    if (s) { S.user = s.user; if (await boot()) return; }
    showAuth();
  }
  $('authForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var r = await sb.auth.signInWithPassword({ email: $('authEmail').value.trim(), password: $('authPassword').value });
    if (r.error || !r.data.user) { showAuth(r.error ? r.error.message : 'Sign in failed'); return; }
    S.user = r.data.user; await boot();
  });
  // Same reset mechanism as the main app: an emailed link lands on /app, where she sets a new password, then returns here.
  $('forgot').addEventListener('click', async function () {
    var email = $('authEmail').value.trim(), err = $('authError'), info = $('authInfo');
    err.hidden = true; info.hidden = true;
    if (!email) { err.textContent = 'Enter your email above first, then tap this again.'; err.hidden = false; return; }
    var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/app' });
    if (r.error) { err.textContent = 'Could not send the reset link: ' + r.error.message; err.hidden = false; return; }
    info.textContent = 'If that email has a SwimLoading account, a reset link is on its way. Set a new password there, then come back to this page and sign in.'; info.hidden = false;
  });
  $('signOut').addEventListener('click', async function () { await sb.auth.signOut(); S.user = null; location.hash = ''; showAuth(); });

  // ── routing ───────────────────────────────────────────────────
  function route() {
    var h = (location.hash || '#programme').slice(1).split('/');
    S.view = h[0] || 'programme'; S.arg = h[1] || null;
    if (S.view === 'log') D = S.arg ? draftFromSession(S.arg) : (D && !D.id ? D : newDraft());
    render(false);
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  function renderTabs() {
    var cur = { programme: 'programme', product: 'programme', compare: 'programme', market: 'programme', history: 'history', session: 'history', log: 'log', insights: 'insights', report: 'report' }[S.view] || 'programme';
    var T = [['programme', 'grid', 'Programme'], ['history', 'clock', 'History'], ['log', null, 'Log'], ['insights', 'bars', 'Insights'], ['report', 'file', 'Report']];
    $('tabs').innerHTML = T.map(function (t) {
      var on = cur === t[0] ? ' aria-current="page"' : '';
      if (t[0] === 'log') return '<button class="tab log" data-act="nav" data-to="#log"' + on + ' aria-label="Log a swim"><span class="pill">' + icon('plus', 22) + '</span></button>';
      return '<button class="tab" data-act="nav" data-to="#' + t[0] + '"' + on + '>' + icon(t[1], 22) + t[2] + '</button>';
    }).join('');
  }
  function render(keepScroll) {
    var y = window.scrollY, html;
    renderTabs();
    try {
      html = ({ programme: vProgramme, product: vProduct, history: vHistory, session: vSession, log: vLog, insights: vInsights, report: vReport, compare: vCompare, market: vMarket }[S.view] || vProgramme)();
    } catch (err) { console.error(err); html = '<p class="msg err">Something went wrong drawing this screen. Reload and try again.</p>'; }
    $('main').innerHTML = html;
    if (keepScroll) window.scrollTo(0, y);
  }

  // ── shared pieces ─────────────────────────────────────────────
  function statusPill(st) {
    var c = { early_testing: 'early', active_testing: 'active', long_term_testing: 'long', test_complete: 'done', awaiting_product: 'wait' }[st] || '';
    return '<span class="status ' + c + '"><i></i>' + esc(L.STATUS[st] || st) + '</span>';
  }
  function fig(k, v) { return v == null || v === '' ? '' : '<div class="fig"><div class="k">' + esc(k) + '</div><div class="v num">' + v + '</div></div>'; }
  function stageTrack(stage, full) {
    if (!stage || stage.index < 0) return '';
    var bars = stage.stages.map(function (s, i) { return '<b class="' + (i <= stage.index ? 'on' : '') + '"></b>'; }).join('');
    if (full) {
      return '<div class="track" aria-hidden="true">' + bars + '</div><ol class="stage-list">' + stage.stages.map(function (s, i) {
        return '<li class="' + (i === stage.index ? 'on' : i < stage.index ? 'done' : '') + '">' + esc(s) + '</li>'; }).join('') + '</ol>';
    }
    return '<div class="track" aria-hidden="true">' + bars + '</div><div class="track-labels"><span class="on">' + esc(stage.label) + '</span><span>' + (stage.index + 1) + ' of ' + stage.stages.length + '</span></div>';
  }
  function latestObservation(g) {
    var prof = profile(g);
    if (prof.latestNote) return prof.latestNote.note;
    // A session-level note is about the swim, not about one product. Credit it to a product only when that
    // product was the sole one reported on in that session (quick "no change" products do not count).
    var ids = g.ids, best = null;
    S.sessions.forEach(function (s) {
      if (!s.athlete_note) return;
      var reported = S.sps.filter(function (sp) { return sp.session_id === s.id && sp.report_mode === 'report'; });
      if (reported.length !== 1 || ids.indexOf(reported[0].product_id) < 0) return;
      if (!best || String(s.session_date || '9999') > String(best.session_date || '9999')) best = s;
    });
    return best ? best.athlete_note : null;
  }
  function shortNote(t, n) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > (n || 120) ? t.slice(0, (n || 120) - 1).trim() + '…' : t; }
  function sparkline(series) {
    if (series.length < 2) return '';
    var w = 84, h = 26, pad = 3, pts = series.map(function (p, i) { return [pad + i * (w - 2 * pad) / (series.length - 1), h - pad - (p.score - 1) / 4 * (h - 2 * pad)]; });
    var last = pts[pts.length - 1];
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Trend over ' + series.length + ' swims"><polyline points="' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '" fill="none" stroke="#38bdf8" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/><circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.6" fill="#38bdf8"/></svg>';
  }
  function criterionSeries(ids, key) {
    var out = [];
    S.obs.forEach(function (o) {
      if (o.kind !== 'rating' || o.criterion !== key || ids.indexOf(o.product_id) < 0) return;
      var s = sessionById(o.session_id); out.push({ date: s ? s.session_date : null, created: s ? s.created_at : '', score: o.score });
    });
    return out.sort(function (a, b) { return String(a.date || a.created).localeCompare(String(b.date || b.created)); });
  }

  // ── PROGRAMME ─────────────────────────────────────────────────
  function vProgramme() {
    var sum = L.programmeSummary(S.products, data()), g = garage();
    var stats =
      '<div class="stat"><div class="v num">' + sum.productsInTest + '</div><div class="l">Products in test</div></div>' +
      '<div class="stat"><div class="v num">' + sum.sessions + '</div><div class="l">Total sessions</div></div>' +
      '<div class="stat"><div class="v num">' + (sum.kmKnownOn ? sum.km + '<small>KM</small>' : '&mdash;') + '</div><div class="l">Total test distance</div></div>' +
      '<div class="stat"><div class="v num">' + (sum.hours ? sum.hours + '<small>H</small>' : '&mdash;') + '</div><div class="l">Total test hours</div></div>';
    var foot = sum.partialSessions ? '<p class="foot">' + plural(sum.partialSessions, 'session') + (sum.partialSessions === 1 ? ' still needs' : ' still need') + ' details. Totals count only what has been recorded.</p>' : '';
    var items = g.map(function (it) {
      var prof = profile(it), u = prof.usage, note = latestObservation(it);
      var awaiting = it.status === 'awaiting_product';
      var meta = awaiting ? '' :
        '<div><div class="k">Uses</div><div class="v num">' + u.uses + '</div></div>' +
        '<div><div class="k">Distance</div><div class="v num">' + (u.kmKnownOn ? u.km + ' km' : '&mdash;') + '</div></div>' +
        '<div><div class="k">Athlete rating</div><div class="v">' + (prof.ratedSessions ? plural(prof.ratedSessions, 'session') : 'Not yet') + '</div></div>';
      var received = it.received_on ? 'Received ' + fmtDate(it.received_on) : 'Date received to be added';
      return '<button class="garage-item" data-act="nav" data-to="#product/' + esc(it.id) + '">' +
        '<div class="gi-head"><div><div class="gi-name">' + esc(it.name) + '</div><div class="gi-cat">' + esc(catOf(it).label) + (it.isGroup ? ' &middot; ' + it.ids.length + ' costumes' : '') + '</div></div>' + statusPill(it.status) + '</div>' +
        (meta ? '<div class="gi-meta">' + meta + '</div>' : '') +
        (note ? '<p class="gi-note">&ldquo;' + esc(shortNote(note, 110)) + '&rdquo;</p>' : '') +
        stageTrack(prof.stage) +
        '<div class="gi-foot"><span>' + esc(received) + '</span><span>' + icon('chev', 16) + '</span></div></button>';
    }).join('');
    return '<section style="padding-top:34px"><p class="kicker">Jaked &times; Carina</p><h1 class="hero">FIELD TEST<br>PROGRAMME</h1>' +
      '<p class="lede">Real-world product testing by Carina Bruwer<br><span style="font-size:14px">Powered by SwimLoading</span></p>' +
      '<div class="stats">' + stats + '</div>' + foot +
      '<p style="margin:22px 0 0"><button class="btn" data-act="nav" data-to="#log">' + icon('plus') + ' Log a swim</button></p></section>' +
      '<section class="section"><h2 class="sec">WHAT CARINA IS TESTING</h2><p class="sec-sub">Product Garage</p>' + items + '</section>' +
      '<section class="section learn"><h2 class="sec">WHAT WE ARE LEARNING</h2>' + learningHTML(g) + '</section>' +
      '<section class="section learn"><h2 class="sec">ARE ANY ISSUES EMERGING?</h2>' + issuesHTML(g) + '</section>' +
      '<section class="section"><h2 class="sec">MORE</h2>' +
      '<button class="row-btn" data-act="nav" data-to="#compare"><span>Controlled comparisons</span>' + icon('chev') + '</button>' +
      '<button class="row-btn" data-act="nav" data-to="#market"><span>Market signal</span>' + icon('chev') + '</button></section>';
  }
  function learningHTML(g) {
    var any = false, out = g.filter(function (it) { return it.status !== 'awaiting_product'; }).map(function (it) {
      var prof = profile(it), f = L.findings(prof);
      if (!f.enough) return '<p class="quiet"><strong>' + esc(it.name) + '</strong><br>' + esc(f.statement) + '</p>';
      any = true;
      var top = f.positives.slice(0, 2).map(function (p) { return '<p class="pos">' + esc(p.text) + '</p>'; }).join('');
      var obs = f.observations.slice(0, 2).map(function (p) { return '<p class="obsv">' + esc(p.text) + '</p>'; }).join('');
      return '<div><strong>' + esc(it.name) + '</strong>' + (top || obs ? top + obs : '<p class="quiet">Enough ratings to average, nothing standing out yet.</p>') + '</div>';
    }).join('');
    return out + '<p class="why">Findings are computed from logged sessions only. They start once a product has ' + L.EVIDENCE_THRESHOLDS.minSessionsForAverage + ' rated sessions, and are never a claim that one product beats another.</p>';
  }
  function issuesHTML(g) {
    var lines = [], answered = 0, labels = {};
    Object.keys(L.CATEGORIES).forEach(function (c) { L.CATEGORIES[c].issues.forEach(function (i) { labels[i.key] = i.label; }); });
    labels.damage_or_wear = 'Damage or wear noticed';
    g.forEach(function (it) {
      var inc = profile(it).issues; answered += inc.sessionsAnswered;
      Object.keys(inc.counts).forEach(function (k) { lines.push('<li><strong>' + esc(it.name) + '</strong> &middot; ' + esc(labels[k] || k) + ' in ' + inc.counts[k] + ' of ' + plural(inc.sessionsAnswered, 'session') + '</li>'); });
    });
    if (!answered) return '<p class="quiet">No issue data logged yet. This is not the same as no issues.</p>';
    if (!lines.length) return '<p class="pos">None reported across ' + plural(answered, 'answered session') + '.</p>';
    return '<ul class="list">' + lines.join('') + '</ul>';
  }

  // ── PRODUCT DETAIL ────────────────────────────────────────────
  function vProduct() {
    var g = garage().filter(function (x) { return x.id === S.arg; })[0];
    if (!g) return '<p class="msg err">Product not found.</p>';
    var prof = profile(g), u = prof.usage, cat = catOf(g), isCostume = g.category === 'training_swimwear';
    var head = '<button class="back" data-act="nav" data-to="#programme">' + icon('back', 16) + 'Programme</button>' +
      '<p class="kicker">' + esc(cat.label) + '</p><h1 class="hero" style="font-size:clamp(44px,12vw,72px)">' + esc(g.name.toUpperCase()) + '</h1><p style="margin:0 0 4px">' + statusPill(g.status) + '</p>' +
      '<p class="foot">' + (g.received_on ? 'Received ' + fmtDate(g.received_on) : 'Date received to be added') + '</p>';
    var stats = '<div class="stats">' +
      '<div class="stat"><div class="v num">' + u.uses + '</div><div class="l">' + (u.uses === 1 ? 'Use' : 'Uses') + '</div></div>' +
      '<div class="stat"><div class="v num">' + (u.kmKnownOn ? u.km + '<small>KM</small>' : '&mdash;') + '</div><div class="l">Distance</div></div>' +
      '<div class="stat"><div class="v num">' + (u.hours ? u.hours + '<small>H</small>' : '&mdash;') + '</div><div class="l">Hours</div></div>' +
      '<div class="stat"><div class="v num">' + (u.tempMin !== null ? (u.tempMin === u.tempMax ? u.tempMin : u.tempMin + '&ndash;' + u.tempMax) + '<small>&deg;C</small>' : '&mdash;') + '</div><div class="l">Water range</div></div></div>';
    var split = '<p class="foot">Pool ' + u.pool + ' &middot; Open water ' + u.openWater + (isCostume ? ' &middot; Chlorine exposures ' + u.chlorineExposures + ' &middot; Sea exposures ' + u.seaExposures : '') + '</p>';
    var stage = prof.stage.index >= 0 ? '<section class="section"><h2 class="sec">EVIDENCE STAGE</h2><p class="sec-sub">' + esc(prof.stage.label) + ' &middot; testing confidence ' + esc(prof.confidence.toLowerCase()) + '</p>' + stageTrack(prof.stage, true) + '</section>' : '';
    var meters = cat.ratings.filter(function (r) { return prof.ratings[r.key]; }).map(function (r) {
      var s = prof.ratings[r.key], series = criterionSeries(g.ids, r.key), last = series[series.length - 1].score;
      var dots = s.scores.map(function (v) { return '<i class="dot" style="left:' + ((v - 1) / 4 * 100) + '%"></i>'; }).join('');
      var avgM = s.avg !== null ? '<i class="avg" style="left:' + ((s.avg - 1) / 4 * 100) + '%"></i>' : '';
      var sub = s.avg !== null ? (s.consistent ? 'Consistent across ' + s.n + ' swims' : 'Average of ' + s.n + ' swims') : 'Latest of ' + s.n + (s.n === 1 ? ' swim' : ' swims') + '. Average needs ' + L.EVIDENCE_THRESHOLDS.minSessionsForAverage;
      return '<div class="meter"><div class="name">' + esc(r.label) + '</div><div class="val num">' + (s.avg !== null ? s.avg.toFixed(1) : last) + '<small>' + esc(sub) + '</small></div>' +
        '<div class="viz"><div class="vz-main"><div class="scale-track" role="img" aria-label="' + esc(r.label) + ' scores">' + dots + avgM + '</div>' +
        '<div class="ends"><span>1 &middot; ' + esc(r.low) + '</span><span>5 &middot; ' + esc(r.high) + '</span></div></div>' + sparkline(series) + '</div></div>';
    }).join('');
    var ratings = '<section class="section"><h2 class="sec">ATHLETE RATINGS</h2><p class="sec-sub">Each dot is one swim. The white mark is the average, shown once there are enough swims.</p>' + (meters || '<p class="quiet">No ratings logged yet.</p>') + '</section>';
    var inc = L.incidenceLine(prof, cat.chafingKeys.length ? cat.chafingKeys : ['__none__'], cat.chafingKeys.length ? (g.category === 'wetsuit' ? 'chafing' : 'rubbing') : 'issue');
    var issues = '<section class="section"><h2 class="sec">ISSUES</h2>' + (prof.issues.sessionsAnswered ? '<ul class="list">' +
      (inc && cat.chafingKeys.length ? '<li>' + esc(inc) + '</li>' : '') +
      Object.keys(prof.issues.counts).map(function (k) { return '<li>' + esc(issueLabel(k)) + ': ' + prof.issues.counts[k] + ' of ' + plural(prof.issues.sessionsAnswered, 'session') + '</li>'; }).join('') +
      (!Object.keys(prof.issues.counts).length ? '<li>None reported across ' + plural(prof.issues.sessionsAnswered, 'answered session') + '</li>' : '') + '</ul>' : '<p class="quiet">No issue data logged yet. This is not the same as no issues.</p>') + '</section>';
    var notes = '<section class="section"><h2 class="sec">CARINA&rsquo;S OBSERVATIONS</h2>' + (prof.notes.length ? prof.notes.map(function (n) {
      return '<div class="tl"><div class="when">' + (n.date ? esc(fmtDate(n.date)) : 'Date to be added') + '</div><p>' + esc(n.note) + '</p></div>';
    }).join('') : '<p class="quiet">No product notes yet.</p>') + '</section>';
    var pr = L.nextPriorities(prof, data());
    var next = '<section class="section"><h2 class="sec">NEXT TESTING PRIORITIES</h2><ul class="list">' + pr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></section>';
    var members = g.isGroup ? '<section class="section"><h2 class="sec">THE ' + g.ids.length + ' COSTUMES</h2><ul class="list">' + g.members.map(function (m) {
      return '<li>' + esc(m.name) + (m.model_name ? ' &middot; ' + esc(m.model_name) : '') + ' &middot; ' + plural(L.productUsage(m.id, data()).uses, 'use') + '</li>'; }).join('') + '</ul></section>' : '';
    return head + stats + split + stage + ratings + issues + notes + next + members + (S.isAdmin ? adminProductForm(g) : '');
  }
  function issueLabel(k) {
    if (k === 'damage_or_wear') return 'Damage or wear noticed';
    for (var c in L.CATEGORIES) { var m = L.CATEGORIES[c].issues.filter(function (i) { return i.key === k; })[0]; if (m) return m.label; }
    return k;
  }
  function adminProductForm(g) {
    var opts = Object.keys(L.STATUS).map(function (k) { return '<option value="' + k + '"' + (g.status === k ? ' selected' : '') + '>' + L.STATUS[k] + '</option>'; }).join('');
    return '<section class="section"><h2 class="sec">PRODUCT DETAILS</h2><p class="sec-sub">Admin only. Model names stay blank until Jaked confirms them.</p>' +
      '<div class="field"><label for="pf-status">Testing status</label><select class="in" id="pf-status">' + opts + '</select></div>' +
      '<div class="field"><label for="pf-received">Date received</label><input class="in" type="date" id="pf-received" value="' + esc(g.received_on || '') + '"></div>' +
      g.members.map(function (m) { return '<div class="field"><label for="pf-m-' + esc(m.id) + '">Model name &middot; ' + esc(m.name) + '</label><input class="in" id="pf-m-' + esc(m.id) + '" value="' + esc(m.model_name || '') + '" placeholder="Enter once confirmed"></div>'; }).join('') +
      '<button class="btn ghost" data-act="save-product" data-id="' + esc(g.id) + '">Save product details</button></section>';
  }

  // ── HISTORY + SESSION ─────────────────────────────────────────
  function sessionOverall(sid) {
    var v = S.obs.filter(function (o) { return o.session_id === sid && o.kind === 'rating' && o.criterion === 'overall'; });
    return v.length ? v[0].score : null;
  }
  function vHistory() {
    if (!S.sessions.length) return '<section style="padding-top:34px"><p class="kicker">Swim history</p><h1 class="hero" style="font-size:56px">NO SWIMS YET</h1><p class="lede">Log the first one and it appears here.</p><p style="margin-top:20px"><button class="btn" data-act="nav" data-to="#log">' + icon('plus') + ' Log a swim</button></p></section>';
    var cards = S.sessions.map(function (s) {
      var names = productsOfSession(s.id).map(function (sp) { var p = productById(sp.product_id); return p ? p.name : ''; }).filter(Boolean);
      var ov = sessionOverall(s.id), partial = s.data_status === 'partial';
      var note = s.athlete_note || (S.obs.filter(function (o) { return o.session_id === s.id && o.kind === 'note' && o.note; })[0] || {}).note;
      return '<button class="sess" data-act="nav" data-to="#session/' + esc(s.id) + '">' +
        '<div class="d ' + (s.session_date ? '' : 'todo') + '">' + (s.session_date ? esc(fmtDate(s.session_date)) : 'Date to be added') + (s.environment ? ' &middot; ' + esc(L.ENVIRONMENTS[s.environment]) : '') + '</div>' +
        '<div class="loc">' + esc(s.location || 'Location to be added') + '</div>' +
        '<div class="figs">' + fig('Distance', s.distance_km != null ? Number(s.distance_km) + ' km' : null) + fig('Water', s.water_temp_c != null ? Number(s.water_temp_c) + '&deg;C' : null) +
        fig('Pace /100m', L.fmtPace(s.avg_pace_sec_per_100m)) + fig('Overall', ov != null ? ov + ' / 5' : null) + fig('Effort', s.rpe != null ? s.rpe + ' / 10' : null) + '</div>' +
        '<div class="chips">' + names.map(function (n) { return '<span class="chip">' + esc(n) + '</span>'; }).join('') + (partial ? '<span class="chip todo">To complete</span>' : '') + '</div>' +
        (note ? '<p class="quote">&ldquo;' + esc(shortNote(note, 110)) + '&rdquo;</p>' : '') + '</button>';
    }).join('');
    return '<section style="padding-top:34px"><p class="kicker">Swim history</p><h1 class="hero" style="font-size:clamp(44px,12vw,72px)">EVERY SWIM</h1></section><div>' + cards + '</div>';
  }
  function vSession() {
    var s = sessionById(S.arg); if (!s) return '<p class="msg err">Session not found.</p>';
    var sps = productsOfSession(s.id);
    var banner = s.data_status === 'partial' ? '<p class="msg warn">This swim is saved as partial. Add the real details when you have them. <button class="link" data-act="nav" data-to="#log/' + esc(s.id) + '">Complete it</button></p>' : '';
    var figs = '<div class="figs" style="margin:16px 0">' + fig('Distance', s.distance_km != null ? Number(s.distance_km) + ' km' : null) + fig('Time', L.fmtDuration(s.duration_seconds)) +
      fig('Water', s.water_temp_c != null ? Number(s.water_temp_c) + '&deg;C' : null) + fig('Air', s.air_temp_c != null ? Number(s.air_temp_c) + '&deg;C' : null) +
      fig('Conditions', s.conditions ? L.CONDITIONS[s.conditions] : null) + fig('Wind', s.wind ? L.WIND[s.wind] : null) + fig('Pace /100m', L.fmtPace(s.avg_pace_sec_per_100m)) +
      fig('Heart rate', s.avg_hr != null ? s.avg_hr + ' bpm' : null) + fig('Stroke rate', s.avg_stroke_rate != null ? Number(s.avg_stroke_rate) + ' spm' : null) + fig('Effort', s.rpe != null ? s.rpe + ' / 10' : null) + '</div>';
    var prods = sps.map(function (sp) {
      var p = productById(sp.product_id); if (!p) return '';
      var cat = catOf(p), os = obsOf(s.id, p.id);
      var rs = cat.ratings.filter(function (r) { return os.some(function (o) { return o.kind === 'rating' && o.criterion === r.key; }); }).map(function (r) {
        var o = os.filter(function (x) { return x.kind === 'rating' && x.criterion === r.key; })[0];
        return '<div class="meter" style="padding:10px 0"><div class="name">' + esc(r.label) + '</div><div class="val num">' + o.score + '</div></div>'; }).join('');
      var iss = os.filter(function (o) { return o.kind === 'issue'; }).map(function (o) { return o.criterion === 'none' ? 'No issues' : issueLabel(o.criterion) + (o.note ? ' (' + o.note + ')' : ''); });
      var ns = os.filter(function (o) { return o.kind === 'note' && o.note; }).map(function (o) { return o.note; });
      return '<div class="prod-block"><h3>' + esc(p.name) + (p.is_reference ? ' <span class="chip">Comparison suit</span>' : '') + '</h3>' +
        (sp.report_mode === 'no_change' ? '<p class="quiet">Used. No change to report.</p>' : (rs || '<p class="quiet">No ratings recorded.</p>') +
          (iss.length ? '<h4>Issues</h4><p>' + esc(iss.join(' · ')) + '</p>' : '') + (ns.length ? '<h4>Notes</h4>' + ns.map(function (n) { return '<p>' + esc(n) + '</p>'; }).join('') : '')) + '</div>';
    }).join('');
    var verdict = s.vs_expectation ? '<h4 style="margin:22px 0 4px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)">Against expectation</h4><p>' + ({ worse: 'Worse than expected', as_expected: 'As expected', better: 'Better than expected' }[s.vs_expectation]) + (s.confidence ? ' &middot; ' + esc(s.confidence) + ' confidence' : '') + '</p>' : '';
    var notes = (s.athlete_note ? '<div class="tl"><div class="when">Carina&rsquo;s note</div><p>' + esc(s.athlete_note) + '</p></div>' : '') + (s.partner_note ? '<div class="tl"><div class="when">For Jaked</div><p>' + esc(s.partner_note) + '</p></div>' : '');
    return '<button class="back" data-act="nav" data-to="#history">' + icon('back', 16) + 'History</button>' +
      '<p class="kicker">' + (s.session_date ? esc(fmtDate(s.session_date)) : 'Date to be added') + (s.environment ? ' &middot; ' + esc(L.ENVIRONMENTS[s.environment]) : '') + ' &middot; ' + esc(L.SESSION_KINDS[s.session_kind] || '') + '</p>' +
      '<h1 class="hero" style="font-size:clamp(40px,11vw,64px)">' + esc((s.location || 'Location to be added').toUpperCase()) + '</h1>' + banner + figs + notes + verdict + prods +
      (s.comparison_group_id ? '<p class="foot">Part of a controlled comparison. <button class="link" data-act="nav" data-to="#compare">View</button></p>' : '') +
      '<p style="margin-top:26px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn ghost" data-act="nav" data-to="#log/' + esc(s.id) + '">Edit this swim</button>' +
      (S.isAdmin ? '<button class="btn ghost" data-act="delete-session" data-id="' + esc(s.id) + '">Delete</button>' : '') + '</p>';
  }

  // ── LOG ───────────────────────────────────────────────────────
  function newDraft() {
    return { id: null, session_date: '', location: '', environment: '', session_kind: 'training', distance_km: '', duration: '', water_temp_c: '', air_temp_c: '', conditions: '', wind: '',
      pace: '', avg_hr: '', avg_stroke_rate: '', rpe: null, strava_import_id: null, comparison_group_id: null, athlete_note: '', partner_note: '', vs_expectation: '', confidence: '', products: {}, stravaOpen: false, msgs: [] };
  }
  function newPanel(p) {
    var used = L.productUsage(p.id, data()).uses;
    var quick = ['training_swimwear', 'goggles', 'cap'].indexOf(p.category) >= 0 && used > 0;
    return { mode: quick ? 'no_change' : 'report', ratings: {}, issues: [], issue_note: '', wear: '', wear_note: '', note: '', more: false, usage_km: '' };
  }
  function draftFromSession(id) {
    var s = sessionById(id), d = newDraft(); if (!s) return d;
    d.id = s.id;
    ['session_date', 'location', 'environment', 'session_kind', 'conditions', 'wind', 'strava_import_id', 'comparison_group_id', 'athlete_note', 'partner_note', 'vs_expectation', 'confidence'].forEach(function (k) { d[k] = s[k] == null ? '' : s[k]; });
    if (!d.session_kind) d.session_kind = 'training';
    d.strava_import_id = s.strava_import_id || null; d.comparison_group_id = s.comparison_group_id || null;
    d.distance_km = s.distance_km != null ? String(Number(s.distance_km)) : ''; d.duration = secToHMS(s.duration_seconds);
    d.water_temp_c = s.water_temp_c != null ? String(Number(s.water_temp_c)) : ''; d.air_temp_c = s.air_temp_c != null ? String(Number(s.air_temp_c)) : '';
    d.pace = L.fmtPace(s.avg_pace_sec_per_100m) || ''; d.avg_hr = s.avg_hr != null ? String(s.avg_hr) : ''; d.avg_stroke_rate = s.avg_stroke_rate != null ? String(Number(s.avg_stroke_rate)) : ''; d.rpe = s.rpe;
    productsOfSession(id).forEach(function (sp) {
      var p = productById(sp.product_id); if (!p) return;
      var pn = { mode: sp.report_mode, ratings: {}, issues: [], issue_note: '', wear: '', wear_note: '', note: '', more: false, usage_km: sp.usage_km != null ? String(Number(sp.usage_km)) : '' };
      obsOf(id, p.id).forEach(function (o) {
        if (o.kind === 'rating') pn.ratings[o.criterion] = o.score;
        else if (o.kind === 'issue') { if (o.criterion === 'damage_or_wear') { pn.wear = 'yes'; pn.wear_note = o.note || ''; } else pn.issues.push(o.criterion); }
        else if (o.kind === 'note') { if (o.criterion === 'issue_note') pn.issue_note = o.note || ''; else pn.note = o.note || ''; }
      });
      if (sp.report_mode === 'report' && !pn.wear && pn.issues.length) pn.wear = 'no';
      d.products[p.id] = pn;
    });
    return d;
  }
  function segBtns(field, map, cur, cls) {
    return '<div class="seg ' + (cls || '') + '">' + Object.keys(map).map(function (k) { return '<button type="button" data-act="seg" data-field="' + field + '" data-value="' + k + '" aria-pressed="' + (cur === k) + '">' + esc(map[k]) + '</button>'; }).join('') + '</div>';
  }
  function scaleBtns(attrs, cur, max) {
    var b = ''; for (var i = 1; i <= max; i++) b += '<button type="button" ' + attrs + ' data-score="' + i + '" aria-pressed="' + (cur === i) + '" aria-label="' + i + '">' + i + '</button>';
    return b;
  }
  function vLog() {
    if (!D) D = newDraft();
    var env = D.environment, picked = Object.keys(D.products);
    var strava = '<div class="field"><button type="button" class="btn ghost small" data-act="strava-toggle">Use a Strava swim</button></div>' + (D.stravaOpen ? stravaList() : '');
    var sessionSec =
      '<section class="form-sec"><h2 class="sec">1 &middot; SESSION</h2>' + strava +
      '<div class="field"><label for="f-date">Date</label><div class="grid2"><input class="in" type="date" id="f-date" data-field="session_date" value="' + esc(D.session_date) + '"><div class="seg"><button type="button" data-act="date" data-off="0">Today</button><button type="button" data-act="date" data-off="1">Yesterday</button></div></div></div>' +
      '<div class="field"><label for="f-loc">Location</label><input class="in" id="f-loc" data-field="location" value="' + esc(D.location) + '" list="locs" autocomplete="off"><datalist id="locs">' + locationOptions() + '</datalist></div>' +
      '<div class="field"><div class="lab">Where</div>' + segBtns('environment', L.ENVIRONMENTS, env) + '</div>' +
      '<div class="grid2"><div class="field"><label for="f-dist">Distance km</label><input class="in" id="f-dist" inputmode="decimal" data-field="distance_km" value="' + esc(D.distance_km) + '"></div>' +
      '<div class="field"><label for="f-dur">Duration <span class="opt">h:mm:ss</span></label><input class="in" id="f-dur" inputmode="numeric" data-field="duration" value="' + esc(D.duration) + '" placeholder="0:45:00"></div></div>' +
      '<div class="grid2"><div class="field"><label for="f-wt">Water &deg;C</label><input class="in" id="f-wt" inputmode="decimal" data-field="water_temp_c" value="' + esc(D.water_temp_c) + '"></div>' +
      '<div class="field"><label for="f-at">Air &deg;C <span class="opt">optional</span></label><input class="in" id="f-at" inputmode="decimal" data-field="air_temp_c" value="' + esc(D.air_temp_c) + '"></div></div>' +
      (env === 'pool' ? '' : '<div class="field"><div class="lab">Conditions</div>' + segBtns('conditions', L.CONDITIONS, D.conditions, 'wrap') + '</div><div class="field"><div class="lab">Wind</div>' + segBtns('wind', L.WIND, D.wind, 'wrap') + '</div>') +
      '<div class="field"><div class="lab">Type</div>' + segBtns('session_kind', L.SESSION_KINDS, D.session_kind) + '</div></section>';
    var perf =
      '<section class="form-sec"><h2 class="sec">2 &middot; PERFORMANCE <span class="opt" style="font-family:var(--font-body);font-size:13px;letter-spacing:0;color:var(--faint)">all optional</span></h2>' +
      '<div class="grid2"><div class="field"><label for="f-pace">Pace /100m <span class="opt">m:ss</span></label><input class="in" id="f-pace" inputmode="numeric" data-field="pace" value="' + esc(D.pace) + '" placeholder="1:45"></div>' +
      '<div class="field"><label for="f-hr">Average heart rate</label><input class="in" id="f-hr" inputmode="numeric" data-field="avg_hr" value="' + esc(D.avg_hr) + '"></div></div>' +
      '<div class="field"><label for="f-sr">Average stroke rate</label><input class="in" id="f-sr" inputmode="decimal" data-field="avg_stroke_rate" value="' + esc(D.avg_stroke_rate) + '"></div>' +
      '<div class="field"><div class="lab">Effort (RPE)</div><div class="scale ten">' + scaleBtns('data-act="rpe"', D.rpe, 10) + '</div><div class="ends"><span>1 &middot; Very easy</span><span>10 &middot; All out</span></div></div></section>';
    var chips = S.products.filter(function (p) { return !p.is_reference; }).map(function (p) { return pickChip(p); }).join('');
    var refs = S.products.filter(function (p) { return p.is_reference; }).map(function (p) { return pickChip(p); }).join('');
    var used = '<section class="form-sec"><h2 class="sec">3 &middot; WHAT DID YOU USE?</h2><p class="sec-sub">Choose everything you used. One swim counts toward each product.</p><div class="pick">' + chips + '</div>' +
      (refs ? '<p class="sec-sub" style="margin-top:16px">Comparison suit</p><div class="pick">' + refs + '</div>' : '') + '</section>';
    var panels = picked.map(function (pid) { return productPanel(productById(pid)); }).join('');
    var wrap =
      '<section class="form-sec"><h2 class="sec">CARINA&rsquo;S NOTE</h2><div class="field"><label for="f-note">What did you notice today?</label><textarea class="in big" id="f-note" data-field="athlete_note">' + esc(D.athlete_note) + '</textarea></div>' +
      '<div class="field"><label for="f-pn">Anything you want Jaked to know? <span class="opt">optional</span></label><textarea class="in" id="f-pn" data-field="partner_note">' + esc(D.partner_note) + '</textarea></div></section>' +
      '<section class="form-sec"><h2 class="sec">VERDICT</h2><div class="field"><div class="lab">Compared with what you expected today, it felt</div>' + segBtns('vs_expectation', { worse: 'Worse', as_expected: 'As expected', better: 'Better' }, D.vs_expectation) + '</div>' +
      '<div class="field"><div class="lab">Confidence in today&rsquo;s assessment</div>' + segBtns('confidence', { low: 'Low', medium: 'Medium', high: 'High' }, D.confidence) + '<p class="foot">Conditions and training state change how a suit feels.</p></div></section>';
    var msgs = (D.msgs || []).map(function (m) { return '<p class="msg ' + m.t + '">' + esc(m.s) + '</p>'; }).join('');
    return '<button class="back" data-act="nav" data-to="' + (D.id ? '#session/' + esc(D.id) : '#programme') + '">' + icon('back', 16) + 'Back</button>' +
      '<p class="kicker">' + (D.id ? 'Edit swim' : 'Log a swim') + '</p><h1 class="hero" style="font-size:clamp(44px,12vw,72px)">' + (D.id ? 'EDIT SWIM' : 'LOG A SWIM') + '</h1>' +
      '<p class="lede" style="font-size:15px">Only what you know. Anything left blank stays blank. Nothing is filled in for you.</p>' +
      sessionSec + used + panels + perf + wrap + '<div class="sticky-save">' + msgs + '<button class="btn block" data-act="save"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving' : 'Save swim') + '</button></div>';
  }
  function locationOptions() {
    var seen = {}, out = [];
    S.sessions.forEach(function (s) { if (s.location && !seen[s.location]) { seen[s.location] = 1; out.push('<option value="' + esc(s.location) + '">'); } });
    return out.join('');
  }
  function pickChip(p) {
    var on = !!D.products[p.id], wait = p.status === 'awaiting_product';
    return '<button type="button" class="' + (p.is_reference ? 'ref' : '') + '" data-act="pick" data-pid="' + esc(p.id) + '" aria-pressed="' + on + '"' + (wait ? ' disabled style="opacity:.4"' : '') + '>' + esc(p.name) + (wait ? ' (awaiting)' : '') + '</button>';
  }
  function productPanel(p) {
    var pn = D.products[p.id], cat = catOf(p), env = D.environment, pid = esc(p.id);
    var head = '<div class="prod-panel"><h3>' + esc(p.name.toUpperCase()) + '</h3>' +
      '<div class="field"><div class="seg"><button type="button" data-act="mode" data-pid="' + pid + '" data-mode="no_change" aria-pressed="' + (pn.mode === 'no_change') + '">No change</button><button type="button" data-act="mode" data-pid="' + pid + '" data-mode="report" aria-pressed="' + (pn.mode === 'report') + '">Something to report</button></div></div>';
    if (pn.mode === 'no_change') return head + '<p class="quiet">Counted as a use. Nothing else to fill in.</p></div>';
    var rows = cat.ratings.filter(function (r) {
      if (r.only === 'open' && env === 'pool') return false;
      if (r.only === 'pool' && (env === 'sea' || env === 'lake')) return false;
      return r.core || pn.more || pn.ratings[r.key];
    }).map(function (r) {
      return '<div class="rate"><div class="nm">' + esc(r.label) + '</div><div class="scale">' + scaleBtns('data-act="rate" data-pid="' + pid + '" data-key="' + r.key + '"', pn.ratings[r.key], 5) + '</div><div class="ends"><span>1 &middot; ' + esc(r.low) + '</span><span>5 &middot; ' + esc(r.high) + '</span></div></div>';
    }).join('');
    var hidden = cat.ratings.filter(function (r) { return !r.core && !pn.ratings[r.key]; }).length;
    var more = hidden || pn.more ? '<p><button type="button" class="link" data-act="more" data-pid="' + pid + '">' + (pn.more ? 'Fewer questions' : 'More detail (' + hidden + ' more)') + '</button></p>' : '';
    var issues = cat.issues.length ? '<div class="field"><div class="lab">Issues</div><div class="toggle-grid">' +
      cat.issues.map(function (i) { return '<button type="button" class="toggle" data-act="issue" data-pid="' + pid + '" data-key="' + i.key + '" aria-pressed="' + (pn.issues.indexOf(i.key) >= 0) + '">' + esc(i.label) + '</button>'; }).join('') +
      '<button type="button" class="toggle none" data-act="issue" data-pid="' + pid + '" data-key="none" aria-pressed="' + (pn.issues.indexOf('none') >= 0) + '">None</button></div>' +
      '<div style="margin-top:10px"><input class="in" data-pid="' + pid + '" data-pfield="issue_note" value="' + esc(pn.issue_note) + '" placeholder="Short note on any issue (optional)"></div></div>' : '';
    var wear = '<div class="field"><div class="lab">Any damage or wear noticed?</div><div class="seg"><button type="button" data-act="wear" data-pid="' + pid + '" data-value="no" aria-pressed="' + (pn.wear === 'no') + '">No</button><button type="button" data-act="wear" data-pid="' + pid + '" data-value="yes" aria-pressed="' + (pn.wear === 'yes') + '">Yes</button></div>' +
      (pn.wear === 'yes' ? '<div style="margin-top:10px"><input class="in" data-pid="' + pid + '" data-pfield="wear_note" value="' + esc(pn.wear_note) + '" placeholder="What did you notice?"></div>' : '') + '</div>';
    var usage = pn.more ? '<div class="field"><label>Distance in this product, km <span class="opt">only if different from the swim</span></label><input class="in" inputmode="decimal" data-pid="' + pid + '" data-pfield="usage_km" value="' + esc(pn.usage_km) + '"></div>' : '';
    var note = '<div class="field"><label>Note on this product <span class="opt">optional</span></label><textarea class="in" data-pid="' + pid + '" data-pfield="note" style="min-height:90px">' + esc(pn.note) + '</textarea></div>';
    return head + rows + more + issues + wear + usage + note + '</div>';
  }
  function stravaList() {
    if (S.strava === null) return '<p class="foot">Loading your Strava swims</p>';
    if (!S.strava.length) return '<p class="msg">No Strava swims found. Enter the swim by hand.</p>';
    var logged = {}; S.sessions.forEach(function (s) { if (s.strava_import_id) logged[s.strava_import_id] = true; });
    return '<ul class="list" style="margin-bottom:18px">' + S.strava.map(function (r) {
      var spot = S.stravaSpots[r.matched_spot_id];
      return '<li><button type="button" class="row-btn" style="border:0;padding:0" data-act="strava-pick" data-id="' + esc(r.id) + '"><span><strong>' + esc(fmtDate(String(r.start_date_local).slice(0, 10))) + '</strong> &middot; ' + (r.distance_m ? Math.round(r.distance_m / 10) / 100 + ' km' : '') + (spot ? ' &middot; ' + esc(spot.name) : '') + (logged[r.id] ? ' &middot; <span style="color:var(--green)">logged</span>' : '') + '</span>' + icon('chev', 16) + '</button></li>';
    }).join('') + '</ul>';
  }
  async function loadStrava() {
    if (S.strava !== null) return;
    var r = await sb.from('strava_imports').select('id,name,sport_type,start_date_local,distance_m,moving_time_seconds,elapsed_time_seconds,average_heartrate,matched_spot_id').eq('user_id', S.user.id).order('start_date_local', { ascending: false }).limit(40);
    S.strava = (r.data || []).filter(function (x) { return /swim/i.test(x.sport_type || '') || !x.sport_type; }).slice(0, 15);
    var ids = S.strava.map(function (x) { return x.matched_spot_id; }).filter(Boolean);
    if (ids.length) { var sp = await sb.from('spots').select('id,name,type').in('id', ids); (sp.data || []).forEach(function (x) { S.stravaSpots[x.id] = x; }); }
  }
  function buildPayload() {
    var session = {
      session_date: D.session_date || null, location: D.location.trim() || null, environment: D.environment || null, session_kind: D.session_kind || 'training',
      distance_km: numIn(D.distance_km), duration_seconds: D.duration.trim() ? L.parseDuration(D.duration) : null, water_temp_c: numIn(D.water_temp_c), air_temp_c: numIn(D.air_temp_c),
      conditions: D.environment === 'pool' ? null : (D.conditions || null), wind: D.environment === 'pool' ? null : (D.wind || null),
      avg_pace_sec_per_100m: D.pace.trim() ? L.parsePace(D.pace) : null, avg_hr: (function (v) { return v === null || isNaN(v) ? v : Math.round(v); })(numIn(D.avg_hr)), avg_stroke_rate: numIn(D.avg_stroke_rate), rpe: D.rpe,
      strava_import_id: D.strava_import_id, comparison_group_id: D.comparison_group_id, athlete_note: D.athlete_note.trim() || null, partner_note: D.partner_note.trim() || null,
      vs_expectation: D.vs_expectation || null, confidence: D.confidence || null
    };
    var errs = [];
    if (D.duration.trim() && session.duration_seconds === null) errs.push('Duration should look like 0:45:00');
    if (D.pace.trim() && session.avg_pace_sec_per_100m === null) errs.push('Pace should look like 1:45');
    var products = [];
    Object.keys(D.products).forEach(function (pid) {
      var pn = D.products[pid], p = productById(pid), obs = [];
      if (pn.mode === 'report') {
        Object.keys(pn.ratings).forEach(function (k) { obs.push({ kind: 'rating', criterion: k, score: pn.ratings[k] }); });
        pn.issues.forEach(function (k) { obs.push({ kind: 'issue', criterion: k }); });
        if (pn.wear === 'yes') obs.push({ kind: 'issue', criterion: 'damage_or_wear', note: pn.wear_note.trim() || null });
        if (pn.issue_note.trim()) obs.push({ kind: 'note', criterion: 'issue_note', note: pn.issue_note.trim() });
        if (pn.note.trim()) obs.push({ kind: 'note', criterion: 'product_note', note: pn.note.trim() });
      }
      var uk = numIn(pn.usage_km);
      products.push({ product_id: pid, report_mode: pn.mode, usage_km: pn.mode === 'report' ? uk : null, observations: obs, _ratings: Object.keys(pn.ratings).map(function (k) { return { criterion: k, score: pn.ratings[k] }; }), _name: p ? p.name : '' });
    });
    var v = L.validateSession(Object.assign({}, session, { products: products.map(function (p) { return { ratings: p._ratings }; }) }));
    session.data_status = v.dataStatus;
    products.forEach(function (p) { delete p._ratings; delete p._name; });
    return { session: session, products: products, errors: errs.concat(v.errors), warnings: v.warnings };
  }
  async function saveDraft() {
    if (busy) return;
    var pay = buildPayload();
    D.msgs = [];
    if (pay.errors.length) { pay.errors.forEach(function (e) { D.msgs.push({ t: 'err', s: e }); }); render(true); return; }
    busy = true; render(true);
    var r = await sb.rpc('test_save_session', { p_program: S.program.id, p_session_id: D.id, p_session: pay.session, p_products: pay.products });
    busy = false;
    if (r.error) { D.msgs = [{ t: 'err', s: 'Could not save: ' + r.error.message }]; render(true); return; }
    var id = r.data;
    await refresh();
    D = null;
    toast(pay.warnings.length ? 'Saved. Some details still to add.' : 'Swim saved');
    go('#session/' + id);
  }

  // ── INSIGHTS ──────────────────────────────────────────────────
  function vInsights() {
    var sum = L.programmeSummary(S.products, data()), g = garage();
    var cond = Object.keys(sum.conditions).map(function (k) { return L.CONDITIONS[k] + ' ' + sum.conditions[k]; }).join(' · ');
    var blocks = g.map(function (it) {
      var prof = profile(it), f = L.findings(prof), cat = catOf(it);
      if (it.status === 'awaiting_product') return '<div class="prod-block"><h3>' + esc(it.name) + '</h3><p class="quiet">Awaiting product.</p></div>';
      var body = !f.enough ? '<p class="quiet">' + esc(f.statement) + '</p>' :
        f.positives.map(function (p) { return '<p class="pos">' + esc(p.text) + '</p>'; }).join('') + f.observations.map(function (p) { return '<p class="obsv">' + esc(p.text) + '</p>'; }).join('') || '<p class="quiet">Nothing standing out.</p>';
      var inc = cat.chafingKeys.length ? L.incidenceLine(prof, cat.chafingKeys, it.category === 'wetsuit' ? 'chafing' : 'rubbing') : null;
      return '<div class="prod-block"><h3>' + esc(it.name) + '</h3><p class="foot" style="margin:2px 0 8px">' + esc(prof.stage.label) + ' &middot; ' + plural(prof.usage.uses, 'use') + (prof.usage.kmKnownOn ? ' &middot; ' + prof.usage.km + ' km' : '') + ' &middot; confidence ' + esc(prof.confidence.toLowerCase()) + '</p>' + body + (inc ? '<p class="quiet">' + esc(inc) + '</p>' : '') + '</div>';
    }).join('');
    var tested = '<section class="section"><h2 class="sec">CONDITIONS TESTED</h2><ul class="list">' +
      '<li>Water: ' + (sum.tempMin !== null ? (sum.tempMin === sum.tempMax ? sum.tempMin + '°C' : sum.tempMin + ' to ' + sum.tempMax + '°C') : 'no temperatures logged yet') + '</li>' +
      '<li>Open water ' + sum.openWater + ' &middot; Pool ' + sum.pool + '</li>' + (cond ? '<li>' + esc(cond) + '</li>' : '') + '<li>Longest swim: ' + (sum.longestKm !== null ? sum.longestKm + ' km' : 'none logged yet') + '</li></ul></section>';
    var prio = '<section class="section"><h2 class="sec">NEXT TESTING PRIORITIES</h2>' + g.filter(function (it) { return it.status !== 'awaiting_product'; }).map(function (it) {
      return '<p style="margin:0 0 4px"><strong>' + esc(it.name) + '</strong></p><ul class="list" style="margin-bottom:16px">' + L.nextPriorities(profile(it), data()).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; }).join('') + '</section>';
    return '<section style="padding-top:34px"><p class="kicker">Insights</p><h1 class="hero" style="font-size:clamp(44px,12vw,72px)">WHAT THE EVIDENCE SAYS</h1>' +
      '<p class="lede" style="font-size:15px">' + plural(sum.sessions, 'session') + ' logged. Averages appear from ' + L.EVIDENCE_THRESHOLDS.minSessionsForAverage + ' rated swims. These are trends from one athlete&rsquo;s logs, not proof of cause.</p></section>' + blocks + tested + prio;
  }

  // ── COMPARE ───────────────────────────────────────────────────
  function vCompare() {
    var groups = {}; S.sessions.forEach(function (s) { if (s.comparison_group_id) (groups[s.comparison_group_id] = groups[s.comparison_group_id] || []).push(s); });
    var cards = Object.keys(groups).map(function (gid) {
      var c = L.compareGroup(gid, S.products, data()), arms = c.arms;
      var th = '<th></th>' + arms.map(function (a) { return '<th>' + esc(a.suits.join(' + ') || 'Session') + '</th>'; }).join('');
      function row(label, fn) { return '<tr><th>' + label + '</th>' + arms.map(function (a) { var v = fn(a); return '<td class="num">' + (v == null || v === '' ? '&mdash;' : v) + '</td>'; }).join('') + '</tr>'; }
      var observed = '<h4 style="margin:18px 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan)">Observed data</h4><div class="scroll-x"><table class="compare"><thead><tr>' + th + '</tr></thead><tbody>' +
        row('Date', function (a) { return a.observed.date ? esc(fmtDate(a.observed.date)) : null; }) + row('Location', function (a) { return esc(a.observed.location || ''); }) +
        row('Distance', function (a) { return a.observed.distance_km != null ? a.observed.distance_km + ' km' : null; }) + row('Water', function (a) { return a.observed.water_temp_c != null ? a.observed.water_temp_c + '°C' : null; }) +
        row('Conditions', function (a) { return a.observed.conditions ? L.CONDITIONS[a.observed.conditions] : null; }) + row('Pace /100m', function (a) { return L.fmtPace(a.observed.pace_sec_per_100m); }) +
        row('Heart rate', function (a) { return a.observed.avg_hr; }) + row('Stroke rate', function (a) { return a.observed.stroke_rate; }) + row('Effort', function (a) { return a.observed.rpe != null ? a.observed.rpe + ' / 10' : null; }) + '</tbody></table></div>';
      var keys = {}; arms.forEach(function (a) { Object.keys(a.perception.ratings).forEach(function (pid) { Object.keys(a.perception.ratings[pid]).forEach(function (k) { keys[k] = 1; }); }); });
      var labelFor = {}; Object.keys(L.CATEGORIES).forEach(function (c2) { L.CATEGORIES[c2].ratings.forEach(function (r) { labelFor[r.key] = r.label; }); });
      var perception = '<h4 style="margin:22px 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--amber)">Athlete perception</h4><div class="scroll-x"><table class="compare"><thead><tr>' + th + '</tr></thead><tbody>' +
        Object.keys(keys).map(function (k) { return row(esc(labelFor[k] || k), function (a) { var v = []; Object.keys(a.perception.ratings).forEach(function (pid) { if (a.perception.ratings[pid][k] != null) v.push(a.perception.ratings[pid][k] + ' / 5'); }); return v.join(', '); }); }).join('') +
        row('Against expectation', function (a) { return a.perception.vs_expectation ? ({ worse: 'Worse', as_expected: 'As expected', better: 'Better' }[a.perception.vs_expectation]) : null; }) +
        row('Confidence', function (a) { return a.perception.confidence ? esc(a.perception.confidence) : null; }) + '</tbody></table></div>';
      var warn = c.warnings.length ? '<p class="msg warn">Not like for like: ' + esc(c.warnings.join('; ')) + '.</p>' : (arms.length >= 2 ? '<p class="msg ok">Conditions look comparable on the data entered.</p>' : '');
      return '<div class="prod-block"><h3>Comparison &middot; ' + esc(fmtDate(arms[0] && arms[0].observed.date) || 'date to be added') + '</h3>' + warn + observed + perception +
        '<p class="foot">' + esc(c.caution) + '</p>' + (S.isAdmin ? '<p><button class="link" data-act="dissolve" data-gid="' + esc(gid) + '">Remove this comparison</button></p>' : '') + '</div>';
    }).join('');
    var pick = S.sessions.length >= 2 ? '<section class="section"><h2 class="sec">NEW COMPARISON</h2><p class="sec-sub">Tick two or more swims that were done to compare suits. Same route and distance gives the cleanest read.</p>' +
      S.sessions.filter(function (s) { return !s.comparison_group_id; }).map(function (s) {
        var names = productsOfSession(s.id).map(function (sp) { return (productById(sp.product_id) || {}).name; }).filter(Boolean).join(' + ');
        return '<label class="row-btn" style="gap:12px;cursor:pointer"><span><strong>' + esc(s.session_date ? fmtDate(s.session_date) : 'Date to be added') + '</strong> &middot; ' + esc(s.location || '') + ' &middot; ' + esc(names) + '</span><input type="checkbox" class="cmp-pick" value="' + esc(s.id) + '" style="width:22px;height:22px"></label>'; }).join('') +
      '<p style="margin-top:14px"><button class="btn ghost" data-act="make-compare">Create comparison</button></p></section>' : '';
    var ref = S.isAdmin ? '<section class="section"><h2 class="sec">COMPARISON SUITS</h2><p class="sec-sub">Any suit can be a comparison. Manufacturer specifications are not test evidence and are not stored here.</p><ul class="list">' +
      S.products.filter(function (p) { return p.is_reference; }).map(function (p) { return '<li>' + esc(p.name) + '</li>'; }).join('') + '</ul>' +
      '<div class="grid2"><div class="field"><input class="in" id="ref-name" placeholder="Suit name"></div><div class="field"><select class="in" id="ref-cat">' + Object.keys(L.CATEGORIES).filter(function (k) { return k !== 'other'; }).map(function (k) { return '<option value="' + k + '">' + esc(L.CATEGORIES[k].label) + '</option>'; }).join('') + '</select></div></div>' +
      '<button class="btn ghost small" data-act="add-ref">Add comparison suit</button></section>' : '';
    return '<button class="back" data-act="nav" data-to="#programme">' + icon('back', 16) + 'Programme</button><p class="kicker">Controlled comparison</p><h1 class="hero" style="font-size:clamp(44px,12vw,72px)">SIDE BY SIDE</h1>' +
      '<p class="lede" style="font-size:15px">Measured data and felt experience are kept apart on purpose.</p>' + (cards || '<p class="quiet" style="margin-top:20px">No comparisons yet. Nothing here is estimated or pre-filled.</p>') + pick + ref;
  }

  // ── MARKET ────────────────────────────────────────────────────
  function vMarket() {
    var m = L.marketSummary(S.market);
    var tiles = Object.keys(L.SIGNALS).map(function (k) { return '<div class="stat"><div class="v num">' + m.byType[k] + '</div><div class="l">' + esc(L.SIGNALS[k]) + '</div></div>'; }).join('');
    var tracked = S.isAdmin ? (S.tracked ? '<p class="foot">Tracked automatically on /jaked, last 30 days: ' + S.tracked.views + ' views from ' + S.tracked.unique + ' visitors. Not entered by hand.</p>' : '') : '';
    if (S.isAdmin && S.tracked === null) loadTracked();
    var types = Object.keys(L.SIGNALS).map(function (k) { return '<option value="' + k + '">' + esc(L.SIGNALS[k]) + '</option>'; }).join('');
    var prods = '<option value="">General (no specific product)</option>' + S.products.filter(function (p) { return !p.is_reference; }).map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('');
    var recent = S.market.slice(0, 20).map(function (x) {
      var p = x.product_id ? productById(x.product_id) : null;
      return '<li><strong>' + esc(L.SIGNALS[x.signal_type]) + '</strong> &times; ' + x.count + ' &middot; ' + esc(fmtDate(x.signal_date)) + (x.channel ? ' &middot; ' + esc(x.channel) : '') + (p ? ' &middot; ' + esc(p.name) : '') + (x.note ? '<br><span style="color:var(--mute)">' + esc(x.note) + '</span>' : '') +
        (S.isAdmin ? ' <button class="link" data-act="del-signal" data-id="' + esc(x.id) + '">remove</button>' : '') + '</li>'; }).join('');
    return '<button class="back" data-act="nav" data-to="#programme">' + icon('back', 16) + 'Programme</button><p class="kicker">Market evidence</p><h1 class="hero" style="font-size:clamp(44px,12vw,72px)">MARKET SIGNAL</h1>' +
      '<p class="lede" style="font-size:15px">What happened in the market. This is a separate stream from product testing and never feeds a product finding.</p>' +
      '<div class="market-wrap"><div class="stats" style="grid-template-columns:repeat(2,1fr)">' + tiles + '</div>' + tracked + '</div>' +
      '<section class="section"><h2 class="sec">RECORD A SIGNAL</h2><div class="grid2"><div class="field"><label for="m-type">Type</label><select class="in" id="m-type">' + types + '</select></div><div class="field"><label for="m-count">How many</label><input class="in" id="m-count" inputmode="numeric" value="1"></div></div>' +
      '<div class="field"><label for="m-prod">Product</label><select class="in" id="m-prod">' + prods + '</select></div><div class="grid2"><div class="field"><label for="m-date">Date</label><input class="in" type="date" id="m-date" value="' + localDate(0) + '"></div><div class="field"><label for="m-chan">Where it came from <span class="opt">optional</span></label><input class="in" id="m-chan" placeholder="Instagram, WhatsApp, club"></div></div>' +
      '<div class="field"><label for="m-note">Note <span class="opt">optional</span></label><textarea class="in" id="m-note" style="min-height:80px"></textarea></div><button class="btn" data-act="add-signal">Record signal</button></section>' +
      '<section class="section"><h2 class="sec">RECENT</h2>' + (recent ? '<ul class="list">' + recent + '</ul>' : '<p class="quiet">Nothing recorded yet.</p>') + '</section>';
  }
  async function loadTracked() {
    S.tracked = false;
    try {
      var tok = (await sb.auth.getSession()).data.session.access_token;
      var r = await fetch('/api/partner-stats?partner=jaked&days=30', { headers: { Authorization: 'Bearer ' + tok } });
      if (!r.ok) return;
      var j = await r.json(); S.tracked = { views: j.totals.views, unique: j.totals.uniqueVisitors };
      if (S.view === 'market') render(true);
    } catch (e) { /* tracked views are a bonus line; the manual stream works without them */ }
  }

  // ── REPORT ────────────────────────────────────────────────────
  function vReport() {
    var mode = S.reportMode, rep = L.buildReport(S.products, data(), mode), pub = mode === 'publishable', sum = rep.programme;
    var dates = S.sessions.map(function (s) { return s.session_date; }).filter(Boolean).sort();
    var period = dates.length ? fmtDate(dates[0]) + (dates.length > 1 && dates[dates.length - 1] !== dates[0] ? ' to ' + fmtDate(dates[dates.length - 1]) : '') : 'No dated sessions yet';
    var cond = Object.keys(sum.conditions).map(function (k) { return L.CONDITIONS[k] + ' ' + sum.conditions[k]; }).join(', ');
    var toggle = '<div class="seg" style="margin:20px 0 6px"><button type="button" data-act="report-mode" data-mode="private" aria-pressed="' + !pub + '">Private product feedback</button><button type="button" data-act="report-mode" data-mode="publishable" aria-pressed="' + pub + '">Publishable findings</button></div>' +
      '<p class="foot">' + (pub ? 'Shows only observations an admin has marked publishable. Nothing private appears here.' : 'Candid feedback for Jaked product development. Not for publication.') + '</p>';
    var head = '<section class="report-head"><p class="kicker">' + (pub ? '<span class="private-tag public-tag">Publishable</span>' : '<span class="private-tag">Private</span>') + '</p><h1>SOUTH AFRICA<br>FIELD REPORT</h1><p class="lede" style="font-size:15px;margin:-6px 0 14px">Jaked &times; Carina Field Test Programme</p><dl class="kv"><dt>Athlete</dt><dd>Carina Bruwer</dd><dt>Testing</dt><dd>SwimLoading</dd><dt>Reporting period</dt><dd>' + esc(period) + '</dd></dl></section>';
    var overview = '<section class="section"><h2 class="sec">PROGRAMME OVERVIEW</h2><div class="stats">' +
      '<div class="stat"><div class="v num">' + sum.productsInTest + '</div><div class="l">Products tested</div></div><div class="stat"><div class="v num">' + sum.sessions + '</div><div class="l">Sessions</div></div>' +
      '<div class="stat"><div class="v num">' + (sum.kmKnownOn ? sum.km + '<small>KM</small>' : '&mdash;') + '</div><div class="l">Kilometres</div></div><div class="stat"><div class="v num">' + (sum.hours ? sum.hours + '<small>H</small>' : '&mdash;') + '</div><div class="l">Hours</div></div></div>' +
      '<ul class="list" style="margin-top:18px"><li>Water: ' + (sum.tempMin !== null ? (sum.tempMin === sum.tempMax ? sum.tempMin + '°C' : sum.tempMin + ' to ' + sum.tempMax + '°C') : 'no temperatures logged yet') + '</li><li>Pool ' + sum.pool + ' &middot; Open water ' + sum.openWater + '</li>' + (cond ? '<li>Conditions: ' + esc(cond) + '</li>' : '') + '<li>Longest swim: ' + (sum.longestKm !== null ? sum.longestKm + ' km' : 'none logged yet') + '</li></ul></section>';
    var findingsHTML = '<section class="section"><h2 class="sec">PRODUCT FINDINGS</h2>' + rep.sections.map(function (sec) {
      var f = sec.findings, prof = sec.profile, cat = L.CATEGORIES[sec.category] || L.CATEGORIES.other;
      var pos = f.enough ? (f.positives.length ? f.positives.map(function (p) { return '<p class="pos">' + esc(p.text) + '</p>'; }).join('') : '<p class="quiet">None recorded yet.</p>') : '<p class="quiet">' + esc(f.statement) + '</p>';
      var obs = f.enough ? (f.observations.length ? f.observations.map(function (p) { return '<p class="obsv">' + esc(p.text) + '</p>'; }).join('') : '<p class="quiet">None recorded.</p>') : '';
      var inc = !pub && cat.chafingKeys.length ? L.incidenceLine(prof, cat.chafingKeys, sec.category === 'wetsuit' ? 'chafing' : 'rubbing') : null;
      return '<div class="prod-block"><h3>' + esc(sec.name) + '</h3><p class="foot" style="margin:4px 0 0">' + statusText(sec.status) + '</p>' +
        '<h4>Evidence volume</h4><p>' + esc(sec.evidenceVolume) + (prof.stage.index >= 0 ? ' &middot; ' + esc(prof.stage.label) : '') + '</p>' +
        '<h4>Positive findings</h4>' + pos + (f.enough ? '<h4>Issues and observations</h4>' + obs : '') + (inc ? '<p class="quiet">' + esc(inc) + '</p>' : '') +
        '<h4>Testing confidence</h4><p>' + esc(sec.confidence) + '</p><h4>Next testing priority</h4><ul class="list">' + sec.nextPriorities.slice(0, 3).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
        (sec.category === 'racing_swimwear' ? '<p class="foot">Race times carry too many variables to support a claim about a suit.</p>' : '') + '</div>';
    }).join('') + '</section>';
    var notes = [];
    rep.sections.forEach(function (sec) { sec.profile.notes.forEach(function (n) { notes.push({ date: n.date, text: n.note, who: sec.name }); }); });
    if (!pub) S.sessions.forEach(function (s) {
      var who = productsOfSession(s.id).map(function (sp) { return (productById(sp.product_id) || {}).name; }).filter(Boolean).join(' + ');
      if (s.athlete_note) notes.push({ date: s.session_date, text: s.athlete_note, who: who }); if (s.partner_note) notes.push({ date: s.session_date, text: s.partner_note, who: who, direct: true });
    });
    notes.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
    var obsSec = '<section class="section"><h2 class="sec">ATHLETE OBSERVATIONS</h2>' + (notes.length ? notes.map(function (n) { return '<div class="tl"><div class="when">' + (n.date ? esc(fmtDate(n.date)) : 'Date to be added') + ' &middot; ' + esc(n.who) + (n.direct ? ' &middot; for Jaked' : '') + '</div><p>' + esc(n.text) + '</p></div>'; }).join('') : '<p class="quiet">' + (pub ? 'No observations have been marked publishable.' : 'No notes logged yet.') + '</p>') + '</section>';
    var close = '<p class="foot" style="margin-top:28px">Generated only from logged sessions. It makes no performance claims and does not compare Jaked with any other brand.</p>';
    return toggle + head + overview + findingsHTML + obsSec + (S.isAdmin && !pub ? publishReview() : '') + close;
  }
  function statusText(st) { return esc(L.STATUS[st] || st); }
  function publishReview() {
    var items = S.obs.filter(function (o) { return (o.kind === 'note' && o.note) || (o.kind === 'issue' && o.criterion !== 'none'); });
    var byProd = {}; S.obs.forEach(function (o) { if (o.kind === 'rating') (byProd[o.product_id] = byProd[o.product_id] || []).push(o); });
    var ratingRows = Object.keys(byProd).map(function (pid) {
      var p = productById(pid), allPub = byProd[pid].every(function (o) { return o.visibility === 'publishable'; });
      return '<li><span><strong>' + esc(p ? p.name : '') + '</strong> ratings (' + byProd[pid].length + ')</span> <button class="link" data-act="pub-ratings" data-pid="' + esc(pid) + '" data-to="' + (allPub ? 'private' : 'publishable') + '">' + (allPub ? 'Publishable. Make private' : 'Private. Publish') + '</button></li>'; }).join('');
    var rows = items.map(function (o) {
      var p = productById(o.product_id), s = sessionById(o.session_id), on = o.visibility === 'publishable';
      var text = o.kind === 'note' ? o.note : issueLabel(o.criterion) + (o.note ? ' (' + o.note + ')' : '');
      return '<li><span>' + esc(p ? p.name : '') + ' &middot; ' + esc(s && s.session_date ? fmtDate(s.session_date) : 'undated') + '<br>' + esc(shortNote(text, 140)) + '</span> <button class="link" data-act="pub-obs" data-id="' + esc(o.id) + '" data-to="' + (on ? 'private' : 'publishable') + '">' + (on ? 'Publishable. Make private' : 'Private. Publish') + '</button></li>'; }).join('');
    return '<section class="section"><h2 class="sec">PUBLISH REVIEW</h2><p class="sec-sub">Admin only. Everything is private until you mark it. Editing a swim returns its observations to private.</p><ul class="list">' + (ratingRows + rows || '<li class="quiet">Nothing to review yet.</li>') + '</ul></section>';
  }

  // ── events ────────────────────────────────────────────────────
  var main = $('main'), tabs = $('tabs');
  function onClick(e) {
    var t = e.target.closest('[data-act]'); if (!t) return;
    var a = t.getAttribute('data-act'), d = t.dataset;
    if (a === 'nav') { go(d.to); return; }
    if (a === 'seg') { D[d.field] = D[d.field] === d.value ? '' : d.value; if (d.field === 'environment' && D.environment === 'pool') { D.conditions = ''; D.wind = ''; } render(true); return; }
    if (a === 'date') { D.session_date = localDate(parseInt(d.off, 10)); render(true); return; }
    if (a === 'rpe') { var sc = parseInt(d.score, 10); D.rpe = D.rpe === sc ? null : sc; render(true); return; }
    if (a === 'pick') { if (D.products[d.pid]) delete D.products[d.pid]; else D.products[d.pid] = newPanel(productById(d.pid)); render(true); return; }
    if (a === 'mode') { D.products[d.pid].mode = d.mode; render(true); return; }
    if (a === 'more') { D.products[d.pid].more = !D.products[d.pid].more; render(true); return; }
    if (a === 'rate') { var pn = D.products[d.pid], s2 = parseInt(d.score, 10); if (pn.ratings[d.key] === s2) delete pn.ratings[d.key]; else pn.ratings[d.key] = s2; render(true); return; }
    if (a === 'issue') { var p2 = D.products[d.pid]; p2.issues = L.toggleIssue(p2.issues, d.key); render(true); return; }
    if (a === 'wear') { var p3 = D.products[d.pid]; p3.wear = p3.wear === d.value ? '' : d.value; render(true); return; }
    if (a === 'strava-toggle') { D.stravaOpen = !D.stravaOpen; render(true); if (D.stravaOpen && S.strava === null) loadStrava().then(function () { if (S.view === 'log') render(true); }); return; }
    if (a === 'strava-pick') { pickStrava(d.id); return; }
    if (a === 'save') { saveDraft(); return; }
    if (a === 'save-product') { saveProduct(d.id); return; }
    if (a === 'delete-session') { deleteSession(d.id); return; }
    if (a === 'make-compare') { makeComparison(); return; }
    if (a === 'dissolve') { dissolve(d.gid); return; }
    if (a === 'add-ref') { addRef(); return; }
    if (a === 'add-signal') { addSignal(); return; }
    if (a === 'del-signal') { delSignal(d.id); return; }
    if (a === 'report-mode') { S.reportMode = d.mode; render(true); return; }
    if (a === 'pub-obs') { setVisibility([d.id], d.to); return; }
    if (a === 'pub-ratings') { setVisibility(S.obs.filter(function (o) { return o.kind === 'rating' && o.product_id === d.pid; }).map(function (o) { return o.id; }), d.to); return; }
  }
  function onInput(e) {
    var t = e.target;
    if (t.dataset.field && D) { D[t.dataset.field] = t.value; return; }
    if (t.dataset.pid && t.dataset.pfield && D && D.products[t.dataset.pid]) D.products[t.dataset.pid][t.dataset.pfield] = t.value;
  }
  main.addEventListener('click', onClick); tabs.addEventListener('click', onClick);
  main.addEventListener('input', onInput); main.addEventListener('change', onInput);

  async function pickStrava(id) {
    var r = S.strava.filter(function (x) { return x.id === id; })[0]; if (!r) return;
    var dr = L.stravaToDraft(r, S.stravaSpots[r.matched_spot_id]);
    D.strava_import_id = dr.strava_import_id; D.session_date = dr.session_date || D.session_date;
    D.distance_km = dr.distance_km != null ? String(dr.distance_km) : D.distance_km; D.duration = dr.duration_seconds ? secToHMS(dr.duration_seconds) : D.duration;
    D.pace = dr.avg_pace_sec_per_100m ? L.fmtPace(dr.avg_pace_sec_per_100m) : D.pace; D.avg_hr = dr.avg_hr != null ? String(dr.avg_hr) : D.avg_hr;
    if (dr.location) D.location = dr.location; if (dr.environment) D.environment = dr.environment;
    D.stravaOpen = false; toast('Filled from Strava. Add the water temperature yourself.'); render(true);
  }
  async function saveProduct(gid) {
    var g = garage().filter(function (x) { return x.id === gid; })[0]; if (!g) return;
    var status = $('pf-status').value, rec = $('pf-received').value || null;
    for (var i = 0; i < g.members.length; i++) {
      var m = g.members[i], mn = $('pf-m-' + m.id).value.trim() || null;
      var r = await sb.from('test_products').update({ status: status, received_on: rec, model_name: mn }).eq('id', m.id);
      if (r.error) { toast('Could not save: ' + r.error.message); return; }
    }
    await refresh(); toast('Product details saved'); render(true);
  }
  async function deleteSession(id) {
    if (!window.confirm('Delete this swim and all of its ratings? This cannot be undone.')) return;
    var r = await sb.from('test_sessions').delete().eq('id', id);
    if (r.error) { toast('Could not delete: ' + r.error.message); return; }
    await refresh(); toast('Swim deleted'); go('#history');
  }
  function uuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); }
  async function makeComparison() {
    var ids = Array.prototype.map.call(document.querySelectorAll('.cmp-pick:checked'), function (x) { return x.value; });
    if (ids.length < 2) { toast('Tick at least two swims'); return; }
    var r = await sb.from('test_sessions').update({ comparison_group_id: uuid() }).in('id', ids);   // one shared id for every ticked swim
    if (r.error) { toast('Could not save: ' + r.error.message); return; }
    await refresh(); toast('Comparison created'); render(true);
  }
  async function dissolve(gid) {
    var r = await sb.from('test_sessions').update({ comparison_group_id: null }).eq('comparison_group_id', gid);
    if (r.error) { toast('Could not save: ' + r.error.message); return; }
    await refresh(); render(true);
  }
  async function addRef() {
    var name = $('ref-name').value.trim(); if (!name) { toast('Enter the suit name'); return; }
    var r = await sb.from('test_products').insert({ program_id: S.program.id, name: name, category: $('ref-cat').value, status: 'active_testing', is_reference: true, sort_order: 90 + S.products.length });
    if (r.error) { toast('Could not add: ' + r.error.message); return; }
    await refresh(); toast('Comparison suit added'); render(true);
  }
  async function addSignal() {
    var count = parseInt($('m-count').value, 10); if (!(count >= 1)) { toast('Enter how many'); return; }
    var row = { program_id: S.program.id, signal_type: $('m-type').value, count: count, signal_date: $('m-date').value || localDate(0), channel: $('m-chan').value.trim() || null, note: $('m-note').value.trim() || null, product_id: $('m-prod').value || null };
    var r = await sb.from('test_market_signals').insert(row);
    if (r.error) { toast('Could not save: ' + r.error.message); return; }
    await refresh(); toast('Signal recorded'); render(true);
  }
  async function delSignal(id) {
    var r = await sb.from('test_market_signals').delete().eq('id', id);
    if (r.error) { toast('Could not remove: ' + r.error.message); return; }
    await refresh(); render(true);
  }
  async function setVisibility(ids, to) {
    if (!ids.length) return;
    var r = await sb.from('test_observations').update({ visibility: to }).in('id', ids);
    if (r.error) { toast('Could not save: ' + r.error.message); return; }
    S.obs.forEach(function (o) { if (ids.indexOf(o.id) >= 0) o.visibility = to; });
    render(true);
  }

  init();
})();
