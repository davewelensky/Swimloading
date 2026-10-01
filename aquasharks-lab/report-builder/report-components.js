/* Aqua Sharks SwimBETTER report components.
   Pure functions: (data context) -> HTML string. No fetching, no PDF parsing, no DOM globals.
   ctx = { n: normalized EO data, i: interpretation, mode, rules, prev (optional), evidenceBase } */
(function () {
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  /* never toISOString: SAST shifts the day back */
  function fmtDate(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : ''; }
  function num(x, dp) { return x == null ? '—' : (+x).toFixed(dp == null ? 1 : dp); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  /* pick mode-specific text, fall back to base */
  function t(obj, field, mode) { var v = obj && obj.variants && obj.variants[mode] && obj.variants[mode][field]; return v != null ? v : (obj ? obj[field] : ''); }
  var ORIGIN = { eo_measured: 'EO measured', eo_observation: 'EO observation', aqua: 'Aqua Sharks' };
  function evidenceList(list) {
    if (!list || !list.length) return '';
    return '<ul class="ev">' + list.map(function (e) { return '<li><span class="tag tag-' + esc(e.origin) + '">' + esc(ORIGIN[e.origin] || e.origin) + '</span>' + esc(e.text) + '</li>'; }).join('') + '</ul>';
  }
  function brandBar(label) {
    return '<div class="brandbar"><span class="mark"><i data-lucide="waves"></i>AQUA SHARKS LAB</span><span class="pgtag">' + esc(label || '') + '</span></div>';
  }

  var C = {};

  C.ReportHero = function (ctx) {
    var s = ctx.n.swimmer, name = s.name || 'Swimmer';
    var meta = [s.stroke, cap(s.primary_focus && s.primary_focus.replace('_', ' ')), s.pool_length ? s.pool_length + ' pool' : ''].filter(Boolean).join(' • ');
    return '<section class="pg hero">' + brandBar('SwimBETTER analysis') +
      '<p class="eyebrow">SwimBETTER analysis</p><h1 class="swimmer">' + esc(name) + '</h1>' +
      '<p class="meta">' + esc(meta) + '</p><p class="date">' + esc(fmtDate(s.session_date)) + '</p>' +
      '<h2 class="yst">YOUR SWIM TODAY</h2>' + C.PerformanceSummary(ctx) + '</section>';
  };

  C.PerformanceSummary = function (ctx) {
    var i = ctx.i, m = ctx.mode, watch = i.secondary_focus.filter(function (x) { return x.id === i.watch_item_id; })[0] || i.secondary_focus[0];
    function card(cls, label, text, icon) { return '<div class="sum ' + cls + '"><i data-lucide="' + icon + '"></i><span class="lbl">' + label + '</span><strong>' + esc(text) + '</strong></div>'; }
    return '<div class="sums">' +
      card('s-strength', 'YOUR STRENGTH', i.strength.card_label, 'shield-check') +
      card('s-opp', '#1 OPPORTUNITY', i.primary_focus.card_label, 'target') +
      card('s-watch', 'WATCH', watch.card_label, 'eye') +
      card('s-goal', 'YOUR GOAL', t(i.goal, 'text', m), 'flag') + '</div>' +
      C.PrimaryFocus(ctx);
  };

  C.CoachCue = function (cue, small) { return '<blockquote class="cue' + (small ? ' cue-sm' : '') + '"><span class="lbl">COACH CUE</span>“' + esc(cue) + '”</blockquote>'; };

  C.PrimaryFocus = function (ctx) {
    var p = ctx.i.primary_focus, m = ctx.mode, val = ctx.n.metrics[p.metric];
    return '<div class="focus"><p class="lbl">YOUR #1 FOCUS</p>' +
      '<h3 class="focus-h">' + p.headline.map(function (l, k) { return '<span class="' + (k === 1 ? 'em' : '') + '">' + esc(l) + '</span>'; }).join('') + '</h3>' +
      '<p class="current"><span class="lbl">CURRENT MEASURED VALUE</span><strong>' + num(val) + '%</strong> ' + esc(p.metric_caption) + '</p>' +
      '<div class="why"><p class="lbl">WHY THIS MATTERS</p><p>' + esc(t(p, 'why_it_matters', m)) + '</p></div>' + C.CoachCue(t(p, 'coach_cue', m)) + '</div>';
  };

  C.ForceDirection = function (ctx) {
    var x = ctx.n.metrics, i = ctx.i, m = ctx.mode, k = 4.4; // px per percentage point
    var side = (x.leftward_force_pct || 0) + (x.rightward_force_pct || 0);
    var fwd = x.propulsion_pct * k, dn = x.downward_force_pct * k, up = Math.max(x.upward_force_pct * k, 8);
    var cx = 60, cy = 58;
    var svg = '<svg viewBox="0 0 360 300" class="fd-svg" role="img" aria-label="Force direction, side-on view">' +
      '<defs><marker id="ah-g" markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="16" refX="8" refY="8" orient="auto"><path d="M1,2 L14,8 L1,14 z" fill="var(--gain)"/></marker>' +
      '<marker id="ah-o" markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="16" refX="8" refY="8" orient="auto"><path d="M1,2 L14,8 L1,14 z" fill="var(--waste)"/></marker></defs>' +
      '<line x1="8" y1="' + cy + '" x2="352" y2="' + cy + '" class="waterline"/><text x="352" y="' + (cy - 8) + '" class="svgnote" text-anchor="end">water surface</text>' +
      '<line x1="' + cx + '" y1="' + (cy - up) + '" x2="' + cx + '" y2="' + (cy - 6) + '" stroke="var(--waste)" stroke-width="4" stroke-linecap="round"/>' +
      '<line x1="' + cx + '" y1="' + (cy + 6) + '" x2="' + cx + '" y2="' + (cy + dn - 10) + '" stroke="var(--waste)" stroke-width="8" stroke-linecap="round" marker-end="url(#ah-o)"/>' +
      '<line x1="' + (cx + 6) + '" y1="' + cy + '" x2="' + (cx + fwd - 10) + '" y2="' + cy + '" stroke="var(--gain)" stroke-width="8" stroke-linecap="round" marker-end="url(#ah-g)"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="7" fill="var(--text)"/>' +
      '<text x="' + (cx + 12) + '" y="' + (cy + 28) + '" class="svglbl" fill="var(--gain)">FORWARD ' + num(x.propulsion_pct) + '%</text>' +
      '<text x="' + (cx + 16) + '" y="' + (cy + dn - 6) + '" class="svglbl" fill="var(--waste)">DOWN ' + num(x.downward_force_pct) + '%</text>' +
      '<text x="' + (cx + 12) + '" y="' + (cy - up - 2) + '" class="svgnote">up ' + num(x.upward_force_pct) + '%</text>' +
      '<text x="12" y="282" class="svgnote">Arrow length = share of your force.</text><text x="12" y="296" class="svgnote">Side-on view, swimming to the right.</text></svg>';
    var losses = [
      { v: x.downward_force_pct, l: 'DOWNWARD', s: 'Lifts you, does not move you', c: 'waste' },
      { v: side, l: 'SIDEWAYS', s: num(x.leftward_force_pct) + '% left, ' + num(x.rightward_force_pct) + '% right', c: 'warn' },
      { v: x.hand_drag_pct, l: 'HAND DRAG', s: 'Force working against you', c: 'waste' }
    ];
    var rows = losses.map(function (z) { return '<div class="loss l-' + z.c + '"><strong>' + num(z.v) + '%</strong><span class="ll">' + z.l + '</span><span class="ls">' + esc(z.s) + '</span><div class="bar"><i style="width:' + Math.min(100, z.v) + '%"></i></div></div>'; }).join('');
    return '<section class="pg"><p class="eyebrow">Page 2</p><h2 class="sec">WHERE DOES YOUR POWER GO?</h2>' +
      '<div class="bigstat gain"><strong>' + num(x.propulsion_pct) + '%</strong><span>MOVING YOU FORWARD</span></div>' +
      '<div class="fd">' + svg + '<div class="losses">' + rows + '</div></div>' +
      '<div class="fso"><p class="lbl">FREE SPEED OPPORTUNITY</p><p class="big">' + esc(i_(ctx).free_speed_opportunity.plain_language_explanation) + '</p><p class="muted">' + esc(i_(ctx).free_speed_opportunity.why_it_matters) + '</p></div></section>';
  };
  function i_(ctx) { return ctx.i; }
  C.FreeSpeedOpportunity = function () { return ''; }; // rendered inside ForceDirection; kept as named component hook

  function imgSrc(ctx, c, base) {
    if (c.page != null && ctx.pageImages && ctx.pageImages[c.page]) return ctx.pageImages[c.page];
    return /^(data:|https?:|\/)/.test(c.image || '') ? c.image : base + (c.image || '');
  }
  C.ScienceEvidence = function (ctx, ids) {
    var n = ctx.n, base = ctx.evidenceBase || '';
    var charts = n.evidence.charts.filter(function (c) { return (!ids || ids.indexOf(c.id) > -1) && imgSrc(ctx, c, base); });
    return charts.map(function (c) {
      var obs = n.eo_observations[c.id] || [];
      return '<details class="sci"><summary><span>' + esc(c.title) + '</span><i data-lucide="chevron-down"></i></summary><div class="sci-body">' +
        '<img loading="lazy" src="' + esc(imgSrc(ctx, c, base)) + '" alt="EO chart: ' + esc(c.title) + '">' +
        obs.map(function (o) { return '<p class="eo-quote"><span class="tag tag-eo_observation">EO observation</span>' + esc(o) + '</p>'; }).join('') +
        '</div></details>';
    }).join('');
  };

  C.StrokePhaseCards = function (ctx) {
    var i = ctx.i, labels = { strong: 'STRONG', watch: 'WATCH', focus: 'FOCUS' };
    var cards = i.stroke_cards.map(function (c) {
      return '<article class="scard st-' + esc(c.status) + '"><header><h3>' + esc(c.label) + '</h3><span class="chip chip-' + esc(c.status) + '">' + labels[c.status] + '</span></header>' +
        '<dl><dt>What we saw</dt><dd>' + esc(c.saw) + '</dd><dt>Why it matters</dt><dd>' + esc(c.why) + '</dd><dt>What to feel</dt><dd class="feel">' + esc(c.feel) + '</dd></dl>' +
        '<details class="sci sci-mini"><summary><span>SEE THE SCIENCE</span><i data-lucide="chevron-down"></i></summary><div class="sci-body">' + C.ScienceEvidence(ctx, c.evidence_ids) + '</div></details></article>';
    }).join('');
    return '<section class="pg"><p class="eyebrow">Page 3</p><h2 class="sec">YOUR STROKE</h2><div class="scards">' + cards + '</div>' +
      (i.approval.status !== 'approved' ? '<p class="muted small">Catch, Pull and Power ratings are drafts until your coach approves them.</p>' : '') + '</section>';
  };

  C.LeftRightComparison = function (ctx) {
    var lr = ctx.i.left_right, m = ctx.n.metrics, full = ctx.mode === 'masters';
    var maxI = Math.max(m.left_impulse, m.right_impulse);
    var rows = lr.rows.filter(function (r) { return ctx.mode !== 'junior' || ['impulse', 'path', 'glide'].indexOf(r.key) > -1; }).map(function (r) {
      var bar = '';
      if (r.key === 'impulse') bar = '<div class="duo"><i class="L" style="width:' + (m.left_impulse / maxI * 100) + '%"></i><i class="R" style="width:' + (m.right_impulse / maxI * 100) + '%"></i></div>';
      if (r.key === 'glide' || r.key === 'pull' || r.key === 'recovery') bar = '<div class="duo"><i class="L" style="width:' + Math.min(100, parseFloat(r.left) * 1.4) + '%"></i><i class="R" style="width:' + Math.min(100, parseFloat(r.right) * 1.4) + '%"></i></div>';
      return '<div class="lrrow"><div class="lrh">' + esc(r.label) + '</div><div class="lrv"><span class="L">' + esc(r.left) + '</span><span class="R">' + esc(r.right) + '</span></div>' + bar + '<p class="muted small">' + esc(r.plain) + '</p></div>';
    }).join('');
    var extra = full ? '<p class="muted small mono">Phase seconds (lap avg): left ' + num(m.left_glide_s, 2) + ' / ' + num(m.left_pull_s, 2) + ' / ' + num(m.left_recovery_s, 2) + ', right ' + num(m.right_glide_s, 2) + ' / ' + num(m.right_pull_s, 2) + ' / ' + num(m.right_recovery_s, 2) + ' (glide / pull / recovery). Stroke rate ' + num(m.stroke_rate_left) + ' / ' + num(m.stroke_rate_right) + ' spm.</p>' : '';
    return '<section class="pg"><p class="eyebrow">Page 4</p><h2 class="sec">HOW BALANCED IS YOUR STROKE?</h2>' +
      '<div class="lrhead"><span class="L">LEFT ARM</span><span class="R">RIGHT ARM</span></div>' + rows +
      '<p class="big">' + esc(lr.headline_plain) + '</p><p class="muted">' + esc(lr.note) + '</p>' + extra + '</section>';
  };

  C.DrillCard = function (step, d, n) {
    return '<article class="drill"><span class="step">' + n + '</span><p class="lbl">' + step + '</p><h3>' + esc(d.title) + '</h3>' +
      '<dl><dt>What to do</dt><dd>' + esc(d.what) + '</dd><dt>What to feel</dt><dd>' + esc(d.feel) + '</dd><dt>Why you are doing it</dt><dd>' + esc(d.why) + '</dd></dl>' +
      '<p class="origin">' + esc(d.origin) + '</p></article>';
  };

  C.TrainingPlan = function (ctx) {
    var p = ctx.i.plan;
    return '<section class="pg"><p class="eyebrow">Page 5</p><h2 class="sec">TURN THE DATA INTO SPEED</h2><div class="drills">' +
      C.DrillCard('1  FEEL IT', p.feel_it, 1) + C.DrillCard('2  BUILD IT', p.build_it, 2) + C.DrillCard('3  HOLD IT', p.hold_it, 3) + '</div></section>';
  };

  C.NextSession = function (ctx) {
    var s = ctx.i.next_session;
    return '<section class="pg"><p class="eyebrow">Page 6</p><h2 class="sec">YOUR NEXT POOL SESSION</h2><ol class="session">' +
      s.blocks.map(function (b) { return '<li><span class="bn">' + esc(b.name) + '</span><span class="bd">' + esc(b.detail) + '</span></li>'; }).join('') +
      '</ol><p class="muted small">' + esc(s.volume_note) + '</p></section>';
  };

  C.RetestTargets = function (ctx) {
    var cards = ctx.i.retest_targets.map(function (r) {
      var cur, tgt, note = r.reference_note || '';
      if (r.metric) {
        cur = num(ctx.n.metrics[r.metric]) + '%';
        tgt = r.target_value != null ? num(r.target_value) + '%' : (r.direction === 'lower' ? '↓ Lower' : '↑ Higher');
      } else { cur = r.current_text; tgt = r.target_text; }
      return '<div class="rt"><p class="lbl">' + esc(r.title.toUpperCase()) + '</p><div class="rt-row"><div><span class="lbl">CURRENT</span><strong class="' + (r.metric ? '' : 'txt') + '">' + esc(cur) + '</strong></div><i data-lucide="arrow-right"></i><div><span class="lbl">TARGET</span><strong class="tgt ' + (r.metric ? '' : 'txt') + '">' + esc(tgt) + '</strong></div></div>' + (note ? '<p class="muted small">' + esc(note) + '</p>' : '') + '</div>';
    }).join('');
    return '<section class="pg"><p class="eyebrow">Page 7</p><h2 class="sec">WHAT WE’RE TRYING TO CHANGE</h2><div class="rts">' + cards + '</div>' +
      '<div class="cta">RETEST <i data-lucide="arrow-right"></i> MEASURE <i data-lucide="arrow-right"></i> PROVE THE CHANGE</div></section>';
  };

  C.ProgressComparison = function (ctx) {
    var pv = ctx.prev; if (!pv) return '';
    var rules = ctx.rules, rows = Object.keys(pv.metrics).map(function (k) {
      var cur = (pv.current_override && pv.current_override[k] != null) ? pv.current_override[k] : ctx.n.metrics[k];
      var r = rules.metrics[k]; if (!r || cur == null) return '';
      var ch = rules.describeChange(k, pv.metrics[k], cur); if (!ch) return '';
      var u = r.unit || '';
      return '<div class="pr"><span class="pn">' + esc(r.label) + '</span><span class="pv">' + num(pv.metrics[k], r.dp) + u + '</span><span class="pa">→</span><span class="pc">' + num(cur, r.dp) + u + '</span><span class="pd tone-' + ch.tone + '">' + ch.arrow + ' ' + Math.abs(ch.delta) + '</span></div>';
    }).join('');
    var lbl = { resolved: 'RESOLVED', improving: 'IMPROVING', still: 'STILL WORKING ON', 'new': 'NEW' };
    var pri = ctx.i.priorities.map(function (p) { var st = pv.priority_status[p.id] || 'new'; return '<li><span class="chip chip-' + st + '">' + lbl[st] + '</span>' + esc(p.title) + '</li>'; })
      .concat((pv.resolved || []).map(function (p) { return '<li><span class="chip chip-resolved">RESOLVED</span>' + esc(p.title) + '</li>'; })).join('');
    return '<section class="pg"><p class="eyebrow">Progress</p><h2 class="sec">YOUR PROGRESS</h2>' +
      (pv.demo ? '<p class="demo-flag">DEMO DATA. Illustrative numbers to test the layout. Not this swimmer’s results.</p>' : '') +
      '<p class="muted">Previous (' + esc(fmtDate(pv.date)) + ') → current. Arrows show direction of change only. Colours appear once a coaching rule is approved.</p>' +
      '<div class="prog">' + rows + '</div><h3 class="sub">COACHING PRIORITIES</h3><ul class="pri">' + pri + '</ul></section>';
  };

  C.Science = function (ctx) {
    var mm = ctx.n.metrics, ss = (ctx.n.single_stroke_examples || [])[0];
    return '<section class="pg sci-sec"><p class="eyebrow">The science</p><h2 class="sec">THE SCIENCE</h2>' +
      '<p class="muted">The original EO Labs evidence behind this report, for coaches and the technically curious. Everything above makes sense without opening it.</p>' +
      C.ScienceEvidence(ctx) +
      '<p class="muted small note-ss"><strong>Note on the glide figure.</strong> EO’s narrative quotes ' + ss.glide_pct + '% glide and ' + ss.pull_pct + '% pull for ' + esc(ss.label) + ' (one stroke). The lap averages used in this report are left ' + mm.left_glide_pct + '% glide / ' + mm.left_pull_pct + '% pull and right ' + mm.right_glide_pct + '% / ' + mm.right_pull_pct + '%.</p>' +
      '<p class="muted small">Data: EO Labs SwimBETTER (' + esc(ctx.n.source.original_filename) + '). Interpretation and coaching: Aqua Sharks Lab.</p></section>';
  };

  C.render = function (ctx) {
    var i = ctx.i;
    return (i.approval && i.approval.status !== 'approved' ? '<div class="draftbar screen-only">DRAFT. Interpretation and ratings are pending coach approval. Coaching rules are unapproved, so no change is labelled good or bad.</div>' : '') +
      '<main class="report">' + C.ReportHero(ctx) + C.ForceDirection(ctx) + C.StrokePhaseCards(ctx) + C.LeftRightComparison(ctx) +
      C.TrainingPlan(ctx) + C.NextSession(ctx) + C.RetestTargets(ctx) + C.ProgressComparison(ctx) + C.Science(ctx) +
      '<p class="footer">Aqua Sharks Lab \u2022 Measurements by EO Labs SwimBETTER \u2022 Interpretation by Aqua Sharks</p></main>';
  };
  window.RC = C; window.RC.util = { esc: esc, fmtDate: fmtDate };
})();
