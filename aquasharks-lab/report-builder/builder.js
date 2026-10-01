/* Aqua Sharks Lab report builder: upload EO PDF -> extract -> coach review -> interpret -> coach review -> report.
   Extraction and interpretation run server-side (/api/lab-report). Rendering reuses RC (report-components.js). */
(function () {
  var SUPABASE_URL = 'https://szgkzuswelntnevobnoh.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';
  var DEV = !!window.__LAB_DEV;
  var sb = window.supabase && !DEV ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
  var esc = RC.util.esc;
  var app = document.getElementById('app'), root = document.getElementById('report-root');

  var S = { token: null, form: {}, file: null, pdfB64: null, pageImages: {}, normalized: null, conf: {}, notes: {}, missing: [], interp: null, warnings: [], prev: null, savedId: null, previousId: null, step: 'form' };

  var METRIC_GROUPS = [
    { title: 'Force direction', keys: [['propulsion_pct', 'Propulsive', '%'], ['downward_force_pct', 'Downward', '%'], ['upward_force_pct', 'Upward', '%'], ['leftward_force_pct', 'Leftward', '%'], ['rightward_force_pct', 'Rightward', '%'], ['hand_drag_pct', 'Hand drag', '%']] },
    { title: 'Left and right', keys: [['left_impulse', 'Average impulse, left (orange)', ''], ['right_impulse', 'Average impulse, right (blue)', ''], ['stroke_rate_left', 'Stroke rate, left', 'spm'], ['stroke_rate_right', 'Stroke rate, right', 'spm'], ['stroke_rate', 'Stroke rate, overall', 'spm']] },
    { title: 'Phase timing, lap average', keys: [['left_glide_pct', 'Left glide', '%'], ['left_pull_pct', 'Left pull', '%'], ['left_recovery_pct', 'Left recovery', '%'], ['right_glide_pct', 'Right glide', '%'], ['right_pull_pct', 'Right pull', '%'], ['right_recovery_pct', 'Right recovery', '%'], ['left_glide_s', 'Left glide', 's'], ['left_pull_s', 'Left pull', 's'], ['left_recovery_s', 'Left recovery', 's'], ['right_glide_s', 'Right glide', 's'], ['right_pull_s', 'Right pull', 's'], ['right_recovery_s', 'Right recovery', 's']] },
    { title: 'Other', keys: [['distance_per_stroke_m', 'Distance per stroke', 'm'], ['propulsion_efficiency_pct', 'Propulsion efficiency', '%'], ['avg_pps_w', 'Average power', 'W'], ['total_work_kj', 'Total work', 'kJ'], ['time_s', 'Time', 's']] },
  ];
  var OBS = [['stroke_rate_force', 'Stroke rate and force'], ['power_distribution', 'Power distribution'], ['left_stroke_path', 'Stroke path: left'], ['right_stroke_path', 'Stroke path: right'], ['path_consistency', 'Path consistency'], ['stroke_phase_timing', 'Stroke phase timing'], ['propulsive_force_profile', 'Propulsive force profile'], ['vertical_lateral_forces', 'Vertical and lateral forces'], ['fixes_drills', 'Fixes and drills (one per line)'], ['summary_next_steps', 'Summary and next steps']];
  var SECTION_TITLES = { stroke_rate_force: 'Stroke rate and force', power_distribution: 'Power distribution', left_stroke_path: 'Stroke path: left arm', right_stroke_path: 'Stroke path: right arm', path_consistency: 'Path consistency', stroke_phase_timing: 'Stroke phase timing', propulsive_force_profile: 'Propulsive force profile', vertical_lateral_forces: 'Vertical and lateral forces' };
  var STAGES_A = ['Uploading report', 'Reading EO analysis', 'Extracting measurements'];
  var STAGES_B = ['Building swimmer profile', 'Identifying priorities', 'Creating coaching plan', 'Generating report'];

  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function icons() { if (window.lucide) lucide.createIcons(); }
  function setSteps(cur) {
    var order = [['form', 'Upload'], ['data', 'Review EO data'], ['interp', 'Review coaching'], ['report', 'Report']];
    var idx = order.findIndex(function (o) { return o[0] === cur; });
    document.getElementById('steps').innerHTML = order.map(function (o, k) { return '<span class="' + (k < idx ? 'done' : k === idx ? 'on' : '') + '">' + (k + 1) + ' ' + o[1] + '</span>'; }).join('');
  }
  function show(html, step) { S.step = step; setSteps(step); root.innerHTML = ''; root.style.display = 'none'; app.style.display = ''; app.innerHTML = html; window.scrollTo(0, 0); icons(); }

  /* ---------------- API ---------------- */
  function api(action, payload) {
    return fetch('/api/lab-report', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token }, body: JSON.stringify(Object.assign({ action: action }, payload || {})) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.detail || j.error || ('HTTP ' + r.status)); e.code = j.error; e.status = r.status; throw e; } return j; }); });
  }
  function friendly(e) {
    if (e.code === 'not_an_admin') return 'This account is not an Aquasharks club admin.';
    if (e.code === 'storage_not_ready') return 'Saving is not switched on yet (the assessments table has not been created). Your report is still on screen: use Save as PDF.';
    return e.message || 'Something went wrong.';
  }

  /* ---------------- auth ---------------- */
  function boot() {
    if (DEV) { S.token = 'dev'; return start(); }
    sb.auth.getSession().then(function (r) {
      var sess = r.data && r.data.session;
      if (!sess) return renderAuth();
      S.token = sess.access_token; start();
    });
  }
  function renderAuth(msg) {
    show('<h1>SIGN IN</h1><p class="lede">The report builder is for Aquasharks club admins. Enter your admin email and we will send a sign-in link.</p>' +
      '<div class="panel"><label class="f">Email<input class="in" id="em" type="email" autocomplete="email"></label>' + (msg ? '<p class="ok">' + esc(msg) + '</p>' : '') +
      '<div class="actions"><button class="btn primary" id="sendlink">Send sign-in link</button></div></div>', 'form');
    document.getElementById('sendlink').onclick = function () {
      var email = document.getElementById('em').value.trim(); if (!email) return;
      sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.href } }).then(function (r) { renderAuth(r.error ? 'Could not send: ' + r.error.message : 'Link sent. Open it on this device.'); });
    };
  }
  function start() {
    var id = new URLSearchParams(location.search).get('id');
    if (id) return openSaved(id);
    renderForm();
  }

  /* ---------------- step 1: form ---------------- */
  function renderForm(err) {
    var f = S.form; f.session_date = f.session_date || today();
    function opt(v, l, cur) { return '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + l + '</option>'; }
    show('<h1>CREATE SWIMBETTER REPORT</h1><p class="lede">Upload the EO Labs SwimBETTER AI report. We read it, you check it, then Aqua Sharks turns it into a coaching report. EO measures. Aqua Sharks coaches.</p>' +
      '<div class="panel"><h2>Swimmer</h2><div class="grid2">' +
      '<label class="f">Swimmer name<input class="in" id="f_name" value="' + esc(f.name || '') + '" autocomplete="off"></label>' +
      '<label class="f">Age<input class="in" id="f_age" type="number" min="3" max="99" value="' + esc(f.age || '') + '"></label>' +
      '<label class="f">Swimmer type<select class="in" id="f_type">' + opt('junior', 'Junior', f.type) + opt('senior', 'Senior', f.type) + opt('masters', 'Masters', f.type || 'masters') + '</select></label>' +
      '<label class="f">Primary swimming focus<select class="in" id="f_focus">' + opt('sprint', 'Sprint', f.focus) + opt('pool', 'Pool', f.focus) + opt('distance', 'Distance', f.focus) + opt('open_water', 'Open Water', f.focus) + '</select></label>' +
      '<label class="f">Stroke<input class="in" id="f_stroke" value="' + esc(f.stroke || 'Freestyle') + '"></label>' +
      '<label class="f">Pool length<select class="in" id="f_pool">' + opt('', 'Not stated', f.pool || '') + opt('25 m', '25 m', f.pool) + opt('50 m', '50 m', f.pool) + '</select></label>' +
      '<label class="f">Session date<input class="in" id="f_date" type="date" value="' + esc(f.session_date) + '"></label>' +
      '<label class="f">Coach<input class="in" id="f_coach" value="' + esc(f.coach || '') + '"></label></div>' +
      '<div style="margin-top:14px"><label class="f">Previous Aqua Sharks assessment (optional)<select class="in" id="f_prev"><option value="">None. First test.</option></select></label><p class="hint" id="prevhint" style="margin-top:6px">Type the swimmer name to find earlier assessments.</p></div></div>' +
      '<div class="panel"><h2>EO report</h2><div class="drop' + (S.file ? ' has' : '') + '" id="drop" tabindex="0" role="button"><i data-lucide="' + (S.file ? 'file-check' : 'upload') + '" style="font-size:30px;color:var(--cyan)"></i><strong>' + (S.file ? esc(S.file.name) : 'Drop EO Labs SwimBETTER AI Report here') + '</strong><span class="muted">' + (S.file ? 'Click to choose a different file' : 'PDF. Or click to choose a file.') + '</span><input type="file" id="file" accept="application/pdf" hidden></div></div>' +
      (err ? '<p class="err">' + esc(err) + '</p>' : '') +
      '<div class="actions"><button class="btn primary" id="go">Read EO report <i data-lucide="arrow-right"></i></button></div>' +
      '<div id="recent"></div>', 'form');
    function val(id) { return document.getElementById(id).value; }
    function grab() { S.form = { name: val('f_name').trim(), age: val('f_age'), type: val('f_type'), focus: val('f_focus'), stroke: val('f_stroke').trim(), pool: val('f_pool'), session_date: val('f_date'), coach: val('f_coach').trim(), prev: val('f_prev') }; }
    var drop = document.getElementById('drop'), file = document.getElementById('file');
    function take(fl) { if (!fl) return; if (fl.type !== 'application/pdf' && !/\.pdf$/i.test(fl.name)) return renderFormKeep('That is not a PDF.'); if (fl.size > 20 * 1024 * 1024) return renderFormKeep('PDF is over 20 MB.'); S.file = fl; renderFormKeep(); }
    function renderFormKeep(e) { grab(); renderForm(e); }
    drop.onclick = function () { file.click(); }; drop.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') file.click(); };
    file.onchange = function () { take(file.files[0]); };
    ['dragover', 'dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); if (ev === 'drop') take(e.dataTransfer.files[0]); }); });
    var prevSel = document.getElementById('f_prev');
    function loadPrev() {
      var n = val('f_name').trim(); if (n.length < 2) return;
      api('list', { name: n }).then(function (r) {
        var a = r.assessments || [];
        prevSel.innerHTML = '<option value="">None. First test.</option>' + a.map(function (x) { return '<option value="' + x.id + '"' + (x.id === f.prev ? ' selected' : '') + '>' + esc((x.session_date || 'undated') + ' (' + x.status + ')') + '</option>'; }).join('');
        document.getElementById('prevhint').textContent = a.length ? a.length + ' earlier assessment(s) found.' : 'No earlier assessments for this name.';
      }).catch(function () { document.getElementById('prevhint').textContent = 'Earlier assessments are unavailable right now.'; });
    }
    document.getElementById('f_name').onblur = loadPrev; if (f.name) loadPrev();
    document.getElementById('go').onclick = function () {
      grab(); if (!S.form.name) return renderForm('Enter the swimmer name.'); if (!S.file) return renderForm('Choose the EO PDF first.');
      S.previousId = S.form.prev || null; runExtraction();
    };
    api('list', {}).then(function (r) {
      var a = (r.assessments || []).slice(0, 8); if (!a.length) return;
      document.getElementById('recent').innerHTML = '<div class="panel" style="margin-top:22px"><h2>Recent assessments</h2>' + a.map(function (x) { return '<p style="margin-top:8px"><a class="btn" style="padding:8px 16px" href="?id=' + x.id + '">' + esc(x.swimmer_name) + ' • ' + esc(x.session_date || 'undated') + ' • ' + esc(x.status) + '</a></p>'; }).join('') + '</div>';
    }).catch(function () {});
  }

  /* ---------------- processing ---------------- */
  function processing(title, stages, upto) {
    show('<h1>' + esc(title) + '</h1><ul class="stages">' + stages.map(function (s, k) { return '<li id="st' + k + '" class="' + (k < upto ? 'done' : k === upto ? 'on' : '') + '"><span class="dot"></span>' + esc(s) + '</li>'; }).join('') + '</ul><p class="muted small" id="pnote">This can take up to a minute.</p>', S.step === 'interp' ? 'data' : 'form');
    return function (k) { stages.forEach(function (_, i) { var el = document.getElementById('st' + i); if (el) el.className = i < k ? 'done' : i === k ? 'on' : ''; }); };
  }
  function toBase64(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(file); }); }
  function renderPages(file) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    return file.arrayBuffer().then(function (buf) { return pdfjsLib.getDocument({ data: buf }).promise; }).then(function (pdf) {
      var out = {}, chain = Promise.resolve();
      for (var p = 1; p <= Math.min(pdf.numPages, 12); p++) (function (n) {
        chain = chain.then(function () { return pdf.getPage(n); }).then(function (page) {
          var vp = page.getViewport({ scale: 1.5 }), c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
          return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () { out[n] = c.toDataURL('image/jpeg', 0.72); });
        });
      })(p);
      // pdf.js stalls while the tab is hidden; never let that block extraction. Keep whatever rendered in time.
      return Promise.race([chain.then(function () { return out; }), new Promise(function (res) { setTimeout(function () { res(out); }, 25000); })]);
    });
  }
  function runExtraction() {
    var mark = processing('READING YOUR EO REPORT', STAGES_A, 0);
    toBase64(S.file).then(function (b64) { S.pdfB64 = b64; mark(1); return renderPages(S.file).catch(function () { return {}; }); })
      .then(function (pages) { S.pageImages = pages; mark(2); return api('extract', { pdf_base64: S.pdfB64, filename: S.file.name }); })
      .then(function (x) { buildNormalized(x); renderReviewData(); })
      .catch(function (e) { renderForm('Could not read the report: ' + friendly(e)); });
  }
  function buildNormalized(x) {
    var f = S.form, charts = [];
    Object.keys(x.section_pages || {}).forEach(function (k) { var pg = (x.section_pages[k] || [])[0]; if (pg != null && SECTION_TITLES[k]) charts.push({ id: k, title: SECTION_TITLES[k], page: pg }); });
    S.normalized = {
      swimmer: { name: f.name, age: f.age ? +f.age : null, swimmer_type: f.type, primary_focus: f.focus, stroke: f.stroke || null, pool_length: f.pool || null, session_date: f.session_date || null, coach: f.coach || null },
      source: { provider: 'EO Labs', product: 'SwimBETTER', original_filename: S.file.name, analysis_type: (x.swimmer_found && x.swimmer_found.analysis_type) || null },
      metrics: x.metrics, provenance: Object.keys(x.confidence || {}).reduce(function (o, k) { o[k] = { confidence: x.confidence[k], note: (x.source_notes || {})[k] || null }; return o; }, {}),
      eo_observations: x.eo_observations || {}, single_stroke_examples: x.single_stroke_examples || [], missing: x.missing || [],
      evidence: { charts: charts },
    };
    S.conf = JSON.parse(JSON.stringify(x.confidence || {})); S.found = x.swimmer_found || {};
  }

  /* ---------------- step 3: review EO data ---------------- */
  function renderReviewData() {
    var n = S.normalized, m = n.metrics, found = S.found || {};
    var nameWarn = found.name && found.name.toLowerCase().indexOf(S.form.name.toLowerCase().split(' ')[0]) < 0 ? '<p class="warn">The report names "' + esc(found.name) + '" but you entered "' + esc(S.form.name) + '". Check this is the right file.</p>' : '';
    var groups = METRIC_GROUPS.map(function (g) {
      return '<div class="panel"><h2>' + esc(g.title) + '</h2>' + g.keys.map(function (k) {
        var key = k[0], c = S.conf[key], v = m[key], note = (n.provenance[key] || {}).note;
        return '<div class="mrow"><div class="nm">' + esc(k[1]) + ' <span class="sub">' + esc(k[2]) + (note ? ' • ' + esc(note) : '') + '</span></div>' +
          '<input class="in' + (v == null ? ' empty' : '') + '" data-m="' + key + '" inputmode="decimal" value="' + (v == null ? '' : v) + '" placeholder="not in report"><span class="cf cf-' + (v == null ? 'null' : c || 'low') + '" data-cf="' + key + '">' + (v == null ? 'not in report' : (c || 'low')) + '</span></div>';
      }).join('') + '</div>';
    }).join('');
    var obs = OBS.map(function (o) { return '<div class="obs-l">' + esc(o[1]) + '</div><textarea class="in" data-o="' + o[0] + '" rows="3">' + esc((n.eo_observations[o[0]] || []).join('\n')) + '</textarea>'; }).join('');
    var ss = (n.single_stroke_examples || []).map(function (s) { return '<p class="warn">Single-stroke figure kept separate from lap averages: ' + esc(s.label) + ', glide ' + esc(s.glide_pct) + '%, pull ' + esc(s.pull_pct) + '%, recovery ' + esc(s.recovery_pct) + '%.' + (s.note ? ' ' + esc(s.note) : '') + '</p>'; }).join('');
    show('<h1>EO ANALYSIS EXTRACTED</h1><p class="lede">Check every value against the EO report. Edit anything that is wrong. Empty means the report does not contain it, and it stays empty. Nothing is built until you approve.</p>' + nameWarn +
      '<div class="legend"><span class="cf cf-high" style="padding:4px 10px">high: printed value</span><span class="cf cf-medium" style="padding:4px 10px">medium: read from a chart label</span><span class="cf cf-low" style="padding:4px 10px">low: uncertain, check</span><span class="cf cf-edited" style="padding:4px 10px">edited by you</span></div>' +
      '<div class="dash-note no-print" style="margin-bottom:12px"><span class="srcbadge sb-eo">EO measured data</span></div>' + groups + ss +
      '<div class="panel"><h2>Source observations <span class="srcbadge sb-eo">EO observations</span></h2><p class="hint">EO’s own sentences, one per line. Edit to correct extraction errors only.</p>' + obs + '</div>' +
      '<div class="panel"><h2>Missing data</h2><p class="hint">Not in the EO report. The coaching report will not mention these.</p><div class="miss">' + ((n.missing || []).length ? n.missing.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') : '<span>Nothing flagged</span>') + '</div></div>' +
      '<div class="panel"><h2>Aqua Sharks interpretation <span class="srcbadge sb-aqua">Aqua Sharks</span></h2><p class="hint">Created in the next step, from the values you approve here. You will review and edit it before the report is made.</p></div>' +
      '<div class="actions"><button class="btn" id="back"><i data-lucide="arrow-left"></i> Start again</button><button class="btn primary" id="approve">Approve EO data and build coaching <i data-lucide="arrow-right"></i></button></div>', 'data');
    app.querySelectorAll('[data-m]').forEach(function (el) {
      el.addEventListener('input', function () {
        var key = el.dataset.m, t = el.value.trim(), num = t === '' ? null : Number(t);
        if (t !== '' && !isFinite(num)) { el.classList.add('edited'); return; }
        m[key] = num; el.classList.toggle('empty', num == null); el.classList.add('edited');
        var cf = app.querySelector('[data-cf="' + key + '"]'); cf.className = 'cf cf-edited'; cf.textContent = num == null ? 'cleared' : 'edited'; S.conf[key] = 'high';
      });
    });
    app.querySelectorAll('[data-o]').forEach(function (el) { el.addEventListener('input', function () { n.eo_observations[el.dataset.o] = el.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }); });
    document.getElementById('back').onclick = function () { renderForm(); };
    document.getElementById('approve').onclick = runInterpretation;
  }

  /* ---------------- step 4: interpret ---------------- */
  function previousPayload() { return S.prev ? { date: S.prev.session_date, metrics: S.prev.metrics, priorities: S.prev.priorities } : null; }
  function loadPrevious() {
    if (!S.previousId) { S.prev = null; return Promise.resolve(); }
    return api('get', { id: S.previousId }).then(function (r) {
      var a = r.assessment; S.prev = { id: a.id, session_date: a.session_date, metrics: (a.normalized || {}).metrics || {}, priorities: ((a.interpretation || {}).priorities) || [] };
    }).catch(function () { S.prev = null; });
  }
  function rulesPayload() { var r = window.AS_RULES, o = { status: r.status, source: r.source, metrics: {} }; Object.keys(r.metrics).forEach(function (k) { var x = r.metrics[k]; o.metrics[k] = { label: x.label, direction: x.direction, approved: x.approved, reference: x.reference }; }); return o; }
  function runInterpretation() {
    S.normalized.metrics = S.normalized.metrics; var mark = processing('BUILDING YOUR COACHING PLAN', STAGES_B, 0); S.step = 'interp';
    var t1 = setTimeout(function () { mark(1); }, 6000), t2 = setTimeout(function () { mark(2); }, 18000);
    loadPrevious().then(function () { return api('interpret', { normalized: S.normalized, mode: S.normalized.swimmer.swimmer_type, rules: rulesPayload(), previous: previousPayload() }); })
      .then(function (r) {
        clearTimeout(t1); clearTimeout(t2); mark(3);
        S.interp = r.interpretation; S.warnings = r.warnings || [];
        if (S.prev) S.interp.progress = { previous_id: S.prev.id, date: S.prev.session_date, metrics: S.prev.metrics, priority_status: {}, resolved: [] };
        renderReviewInterp();
      }).catch(function (e) { clearTimeout(t1); clearTimeout(t2); S.step = 'data'; renderReviewData(); app.insertAdjacentHTML('afterbegin', '<p class="err">Could not build the coaching plan: ' + esc(friendly(e)) + '</p>'); });
  }

  /* ---------------- step 4b: review interpretation ---------------- */
  var binds = [];
  function mode() { return S.normalized.swimmer.swimmer_type || 'masters'; }
  function target(obj, key) { var v = obj && obj.variants && obj.variants[mode()]; return v && key in v ? v : obj; }
  function ed(label, obj, key, kind) {
    var t = target(obj, key), i = binds.push({ o: t, k: key, kind: kind }) - 1, v = t[key] == null ? '' : t[key];
    if (kind === 'line') return '<label class="f ed">' + esc(label) + '<input class="in" data-b="' + i + '" value="' + esc(v) + '"></label>';
    if (kind === 'num') return '<label class="f ed">' + esc(label) + '<input class="in" data-b="' + i + '" inputmode="decimal" value="' + esc(v) + '"></label>';
    return '<label class="f ed">' + esc(label) + '<textarea class="in" data-b="' + i + '" rows="3">' + esc(v) + '</textarea></label>';
  }
  function rec(title, o) { return '<div class="panel"><h2>' + esc(title) + '</h2>' + ed('Card label', o, 'card_label', 'line') + ed('Plain-language explanation', o, 'plain_language_explanation') + ed('Why it matters', o, 'why_it_matters') + ed('Coach cue', o, 'coach_cue', 'line') + (o.recommended_action != null ? ed('Recommended action', o, 'recommended_action') : '') + (o.evidence ? '<p class="hint">Evidence: ' + o.evidence.map(function (e) { return esc(e.text); }).join(' | ') + '</p>' : '') + '</div>'; }
  function renderReviewInterp() {
    binds = []; var i = S.interp, p = i.primary_focus;
    var warn = S.warnings.length ? '<div class="warn"><strong>Check these figures.</strong> They appear in the coaching text but not in the EO data you approved:<br>' + S.warnings.map(function (w) { return esc(w.number) + ' in ' + esc(w.path.replace('interpretation.', '')); }).join('<br>') + '</div>' : '<p class="ok">Number check passed: every figure in the coaching text comes from the EO data or the coaching rules.</p>';
    var html = '<h1>REVIEW THE COACHING</h1><p class="lede">This is the Aqua Sharks interpretation, drafted from the EO data you approved. Edit anything. The coach owns this text.</p>' + warn;
    html += rec('Your strength', i.strength);
    html += '<div class="panel"><h2>#1 focus <span class="srcbadge sb-aqua">Aqua Sharks</span></h2><div class="grid3">' + [0, 1, 2].map(function (k) { return ed('Headline line ' + (k + 1), p.headline, k, 'line'); }).join('') + '</div></div>' + rec('#1 focus: detail', p);
    i.secondary_focus.forEach(function (s, k) { html += rec('Secondary ' + (k + 1), s); });
    html += '<div class="panel"><h2>Goal and free speed</h2>' + ed('Your goal', i.goal, 'text') + ed('Free speed: explanation', i.free_speed_opportunity, 'plain_language_explanation') + ed('Free speed: why', i.free_speed_opportunity, 'why_it_matters') + '</div>';
    html += '<div class="panel"><h2>Catch, Pull, Power</h2><p class="hint">Ratings are yours to set. They are not computed from thresholds.</p>' + i.stroke_cards.map(function (c, k) {
      return '<div class="ed"><label class="f">' + esc(c.label) + ' rating<select class="in" data-c="' + k + '">' + ['strong', 'watch', 'focus'].map(function (s) { return '<option value="' + s + '"' + (c.status === s ? ' selected' : '') + '>' + s.toUpperCase() + '</option>'; }).join('') + '</select></label>' + ed(c.label + ': what we saw', c, 'saw') + ed(c.label + ': why it matters', c, 'why') + ed(c.label + ': what to feel', c, 'feel') + '</div>';
    }).join('') + '</div>';
    html += '<div class="panel"><h2>Left and right</h2>' + ed('Headline', i.left_right, 'headline_plain') + ed('Note', i.left_right, 'note') + '</div>';
    html += '<div class="panel"><h2>Coaching plan</h2>' + [['feel_it', 'Feel it'], ['build_it', 'Build it'], ['hold_it', 'Hold it']].map(function (d) { var o = i.plan[d[0]]; return '<h3 class="sub" style="margin-top:12px">' + d[1] + '</h3>' + ed('Drill', o, 'title', 'line') + ed('What to do', o, 'what') + ed('What to feel', o, 'feel') + ed('Why you are doing it', o, 'why'); }).join('') + '</div>';
    html += '<div class="panel"><h2>Next pool session</h2>' + ed('Volume note', i.next_session, 'volume_note') + i.next_session.blocks.map(function (b) { return ed(b.name, b, 'detail'); }).join('') + '</div>';
    html += '<div class="panel"><h2>Retest targets</h2><p class="hint">A target number is optional. Leave blank to show direction only.</p>' + i.retest_targets.map(function (t) { return '<div class="ed"><strong>' + esc(t.title) + '</strong>' + (t.metric ? ed('Target value', t, 'target_value', 'num') + ed('Note', t, 'reference_note') : ed('Current', t, 'current_text') + ed('Target', t, 'target_text')) + '</div>'; }).join('') + '</div>';
    if (i.progress) {
      var pv = S.prev.priorities || [];
      html += '<div class="panel"><h2>Progress since the last test</h2><p class="hint">Set the status of each current priority, and mark earlier priorities that are now resolved.</p>' +
        i.priorities.map(function (pr) { return '<label class="f ed">' + esc(pr.title) + '<select class="in" data-ps="' + esc(pr.id) + '">' + [['new', 'NEW'], ['improving', 'IMPROVING'], ['still', 'STILL WORKING ON'], ['resolved', 'RESOLVED']].map(function (s) { return '<option value="' + s[0] + '"' + ((i.progress.priority_status[pr.id] || 'new') === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></label>'; }).join('') +
        (pv.length ? '<p class="obs-l">Earlier priorities now resolved</p>' + pv.map(function (pr) { return '<label style="display:flex;gap:10px;align-items:center;padding:6px 0"><input type="checkbox" data-pr="' + esc(pr.id) + '" data-t="' + esc(pr.title) + '"> ' + esc(pr.title) + '</label>'; }).join('') : '') + '</div>';
    }
    html += '<div class="actions"><button class="btn" id="back"><i data-lucide="arrow-left"></i> Back to EO data</button><button class="btn primary" id="gen">Generate report <i data-lucide="arrow-right"></i></button></div>';
    show(html, 'interp');
    app.querySelectorAll('[data-b]').forEach(function (el) { el.addEventListener('input', function () { var b = binds[+el.dataset.b]; var v = el.value; if (b.kind === 'num') { var t = v.trim(); b.o[b.k] = t === '' ? null : (isFinite(Number(t)) ? Number(t) : b.o[b.k]); } else b.o[b.k] = v; }); });
    app.querySelectorAll('[data-c]').forEach(function (el) { el.addEventListener('change', function () { i.stroke_cards[+el.dataset.c].status = el.value; }); });
    app.querySelectorAll('[data-ps]').forEach(function (el) { el.addEventListener('change', function () { i.progress.priority_status[el.dataset.ps] = el.value; }); });
    app.querySelectorAll('[data-pr]').forEach(function (el) { el.addEventListener('change', function () { i.progress.resolved = Array.prototype.slice.call(app.querySelectorAll('[data-pr]:checked')).map(function (c) { return { id: c.dataset.pr, title: c.dataset.t }; }); }); });
    document.getElementById('back').onclick = renderReviewData;
    document.getElementById('gen').onclick = renderReport;
  }

  /* ---------------- step 5: report ---------------- */
  function ctxFor(m) {
    var i = S.interp, pr = i.progress ? { demo: false, date: i.progress.date, metrics: i.progress.metrics, priority_status: i.progress.priority_status || {}, resolved: i.progress.resolved || [] } : null;
    return { n: S.normalized, i: i, mode: m || mode(), rules: window.AS_RULES, prev: pr, pageImages: S.pageImages, evidenceBase: '' };
  }
  function renderReport(m) {
    m = typeof m === 'string' ? m : mode(); setSteps('report'); S.step = 'report';
    app.style.display = 'none'; root.style.display = '';
    var bar = '<div class="reportbar no-print"><div class="grp"><button class="btn" id="rb-back"><i data-lucide="pencil"></i> Edit</button>' +
      ['junior', 'senior', 'masters'].map(function (x) { return '<button class="btn" data-rm="' + x + '" aria-pressed="' + (x === m) + '">' + x.charAt(0).toUpperCase() + x.slice(1) + '</button>'; }).join('') + '</div>' +
      '<div class="grp"><span class="dash-note" id="savemsg"></span><button class="btn" id="rb-save">Save draft</button><button class="btn" id="rb-approve">Approve and save</button><button class="btn primary" id="rb-pdf">Save as PDF</button></div></div>';
    root.innerHTML = bar + RC.render(ctxFor(m)); document.body.className = 'builder mode-' + m; icons(); window.scrollTo(0, 0);
    document.getElementById('rb-back').onclick = function () { document.body.className = 'builder'; S.interp.progress || 0; renderReviewInterp(); };
    root.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = function () { renderReport(b.dataset.rm); }; });
    document.getElementById('rb-pdf').onclick = function () { root.querySelectorAll('details').forEach(function (d) { d.open = true; }); window.print(); };
    document.getElementById('rb-save').onclick = function () { save(false); }; document.getElementById('rb-approve').onclick = function () { save(true); };
  }
  function save(approve) {
    var msg = document.getElementById('savemsg'); msg.textContent = 'Saving...';
    if (approve) S.interp.approval = { status: 'approved', approved_by: 'coach', approved_at: new Date().toISOString() };
    var used = {}; (S.normalized.evidence.charts || []).forEach(function (c) { if (c.page != null) used[c.page] = true; });
    var pages = Object.keys(used).filter(function (p) { return S.pageImages[p] && S.pageImages[p].indexOf('data:') === 0; }).map(function (p) { return { id: 'p' + p, title: 'EO report page ' + p, data_url: S.pageImages[p] }; });
    api('save', { assessment: { id: S.savedId, previous_id: S.previousId, normalized: S.normalized, interpretation: S.interp }, evidence_pages: pages, approve: !!approve })
      .then(function (r) { S.savedId = r.id; msg.textContent = approve ? 'Approved and saved.' : 'Draft saved.'; if (approve) renderReport(mode()); })
      .catch(function (e) { msg.textContent = friendly(e); });
  }
  function openSaved(id) {
    show('<h1>OPENING REPORT</h1><p class="lede">Loading the saved assessment.</p>', 'form');
    api('get', { id: id }).then(function (r) {
      var a = r.assessment; S.savedId = a.id; S.previousId = a.previous_id; S.normalized = a.normalized; S.interp = a.interpretation; S.pageImages = {};
      (r.evidence || []).forEach(function (e) { if (e.url) S.pageImages[+String(e.id).slice(1)] = e.url; });
      S.prev = null; if (!S.interp) { S.found = {}; return renderReviewData(); } renderReport(mode());
    }).catch(function (e) { renderForm('Could not open that assessment: ' + friendly(e)); });
  }

  document.addEventListener('mousemove', function (e) { document.body.style.setProperty('--mouse-x', e.clientX + 'px'); document.body.style.setProperty('--mouse-y', e.clientY + 'px'); });
  boot();
})();
