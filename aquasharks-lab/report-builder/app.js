/* Aqua Sharks Lab report builder (Britt's workflow):
   upload one EO report (PDF or Word) -> parse + read image labels -> coach review (evidence | findings | report output)
   -> publish a swimmer web report -> download as PDF.
   All interpretation is the deterministic engine in /aquasharks-lab/analysis; the browser re-runs it on every edit. */
import { analyse } from '../analysis/engine.js';
import { renderReport } from '../analysis/report-view.js';
import { PROFILES } from '../analysis/profiles.js';
import { DRILLS } from '../analysis/drills.js';
import { debugRows, summariseRows } from '../analysis/parser/debug-rows.js';
import { emptyComparison, overlay, num, rng, lapRef, missing, X } from '../analysis/model.js';
import { printedValues } from '../analysis/calc.js';
import { fmtDate } from '../analysis/language.js';
import { baselineFrom, comparability, progressRows } from '../analysis/progress.js';
import { retestWeeks, retestDate, RETEST_WEEKS } from '../analysis/plan.js';
import { setHandPathField } from '../analysis/hand-path.js';

const SUPABASE_URL = 'https://szgkzuswelntnevobnoh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';
const DEV = !!window.__LAB_DEV;
const sb = window.supabase && !DEV ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const app = document.getElementById('app');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
const SWIMMER_PROFILES = ['JUNIOR', 'PERFORMANCE', 'MASTERS_OPEN_WATER'];
const PROFILE_LABEL = { JUNIOR: 'Junior', PERFORMANCE: 'Performance', MASTERS_OPEN_WATER: 'Masters / Open water', COACH: 'Coach view' };
const STAGES = ['Uploading report', 'Reading EO analysis', 'Extracting measurements', 'Reading image labels', 'Building findings'];

const S = { token: null, id: null, analysis: null, filename: null, fileB64: null, profile: 'PERFORMANCE', diagnostics: null, vision: null, published: null, msg: null, err: null, openDetails: {} };

/* ---------------------------------------------------------------- plumbing */
function setSteps(cur) {
  const order = [['upload', 'Upload'], ['review', 'Review'], ['publish', 'Publish']]; const idx = order.findIndex((o) => o[0] === cur);
  document.getElementById('steps').innerHTML = order.map((o, k) => `<span class="${k < idx ? 'done' : k === idx ? 'on' : ''}">${k + 1} ${o[1]}</span>`).join('');
}
function show(html, step, wide) { setSteps(step); app.className = 'bwrap' + (wide ? ' wide' : ''); app.innerHTML = html; if (window.lucide) lucide.createIcons(); }
// Supabase access tokens expire (about an hour) and are refreshed in the background by supabase-js. The token must
// therefore be read fresh for every request: caching it once at page load made a long-open page report the
// expired token as "not an admin".
async function freshToken(force) {
  if (DEV) return 'dev';
  const r = force ? await sb.auth.refreshSession() : await sb.auth.getSession();
  const s = r && r.data && r.data.session;
  if (s) S.token = s.access_token;
  return S.token;
}
async function api(action, payload, retried) {
  const token = await freshToken(!!retried);
  const r = await fetch('/api/lab-report', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(Object.assign({ action }, payload || {})) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    // One retry with a forced refresh before telling the coach their sign-in has lapsed.
    if (!retried && !DEV && (r.status === 401 || j.error === 'session_expired')) return api(action, payload, true);
    const e = new Error(j.detail || j.error || 'HTTP ' + r.status); e.code = j.error; e.status = r.status; e.body = j; throw e;
  }
  return j;
}
function friendly(e) {
  if (e.code === 'session_expired') return 'Your sign-in has expired. Refresh this page and sign in again. Your work on screen is not lost until you do.';
  if (e.code === 'not_an_admin') return 'This account is not an Aquasharks club admin.';
  if (e.code === 'storage_not_ready') return 'Saving is not switched on yet (the assessments table has not been created). Your work is still on screen.';
  if (e.code === 'unsupported_format') return 'That file is not a PDF or a Word document.';
  if (e.code === 'file_too_large') return 'That file is too large (limit 25 MB).';
  return e.message || 'Something went wrong.';
}
const todayParts = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* ---------------------------------------------------------------- auth */
function boot() {
  if (DEV) { S.token = 'dev'; return route(); }
  sb.auth.getSession().then((r) => { const s = r.data && r.data.session; if (!s) return authView(); S.token = s.access_token; route(); });
}
function authView(msg) {
  show(`<h1>SIGN IN</h1><p class="lede">The report builder is for Aquasharks club admins. Enter your admin email and we will send a sign-in link.</p><div class="panel"><label class="f">Email<input class="in" id="em" type="email" autocomplete="email"></label>${msg ? `<p class="ok">${esc(msg)}</p>` : ''}<div class="actions"><button class="btn primary" id="send">Send sign-in link</button></div></div>`, 'upload');
  document.getElementById('send').onclick = () => { const email = document.getElementById('em').value.trim(); if (!email) return; sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href } }).then((r) => authView(r.error ? 'Could not send: ' + r.error.message : 'Link sent. Open it on this device.')); };
}
function route() { const id = new URLSearchParams(location.search).get('id'); id ? openDraft(id) : uploadView(); }

/* ---------------------------------------------------------------- upload */
let picked = null; const form = { name: '', profile: 'PERFORMANCE' };
function uploadView(err) {
  show(`<h1>CREATE SWIMBETTER REPORT</h1><p class="lede">Upload the EO Labs SwimBETTER report. We read it, you check it, then Aqua Sharks turns it into a swimmer report you can share and download as a PDF. EO measures. Aqua Sharks interprets.</p>
    <div class="panel"><h2>Swimmer</h2><div class="grid2"><label class="f">Swimmer name<input class="in" id="f_name" value="${esc(form.name)}" autocomplete="off"></label>
      <label class="f">Report style<select class="in" id="f_profile">${SWIMMER_PROFILES.map((p) => `<option value="${p}"${form.profile === p ? ' selected' : ''}>${PROFILE_LABEL[p]}</option>`).join('')}</select></label></div></div>
    <div class="panel"><h2>EO report</h2><div class="drop${picked ? ' has' : ''}" id="drop" tabindex="0" role="button"><i data-lucide="${picked ? 'file-check' : 'upload'}" style="font-size:30px;color:var(--cyan)"></i><strong>${picked ? esc(picked.name) : 'Drop the EO SwimBETTER report here'}</strong><span class="muted">${picked ? 'Click to choose a different file' : 'One PDF (or Word document). Or click to choose a file.'}</span><input type="file" id="file" accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden></div></div>
    ${err ? `<p class="err">${esc(err)}</p>` : ''}<div class="actions"><button class="btn primary" id="go">Read the report <i data-lucide="arrow-right"></i></button></div><div id="recent"></div>`, 'upload');
  const drop = document.getElementById('drop'), fileEl = document.getElementById('file');
  const keep = () => { form.name = document.getElementById('f_name').value.trim(); form.profile = document.getElementById('f_profile').value; };
  const take = (f) => { if (!f) return; if (!/\.(pdf|docx)$/i.test(f.name)) { keep(); return uploadView('That is not a PDF or Word document.'); } if (f.size > 25 * 1024 * 1024) { keep(); return uploadView('That file is over 25 MB.'); } keep(); picked = f; uploadView(); };
  drop.onclick = () => fileEl.click(); drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') fileEl.click(); }; fileEl.onchange = () => take(fileEl.files[0]);
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); if (ev === 'drop') take(e.dataTransfer.files[0]); }));
  document.getElementById('go').onclick = () => { keep(); if (!picked) return uploadView('Choose the EO report first.'); S.profile = form.profile; runParse(); };
  api('list', {}).then((r) => { const a = (r.assessments || []).slice(0, 8); if (!a.length) return; document.getElementById('recent').innerHTML = `<div class="panel" style="margin-top:22px"><h2>Recent reports</h2>${a.map((x) => `<p style="margin-top:8px"><a class="btn sm" href="?id=${x.id}">${esc(x.swimmer_name)} • ${esc(x.session_date || 'undated')} • ${esc(x.status)}</a></p>`).join('')}</div>`; }).catch(() => {});
}

/* ---------------------------------------------------------------- parse */
function toBase64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); }); }
/** Bounding boxes (canvas px) of the images drawn on a page, from pdf.js's operator list (tracks the current transform matrix). */
async function imageBoxes(page, vp) {
  const OPS = pdfjsLib.OPS, ops = await page.getOperatorList(), boxes = []; let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  ops.fnArray.forEach((fn, i) => {
    if (fn === OPS.save) stack.push(ctm.slice()); else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, ops.argsArray[i]);
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => vp.convertToViewportPoint(ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]));
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]); boxes.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    }
  });
  return boxes;
}
/** Each figure on each page becomes its own high-resolution image for the vision step (like the pictures inside a Word file). Whole pages only as a fallback. */
function renderPdfPages(file) {
  if (!window.pdfjsLib) return Promise.resolve([]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  return file.arrayBuffer().then((buf) => pdfjsLib.getDocument({ data: buf }).promise).then(async (pdf) => {
    const crops = [], pagesFallback = [];
    for (let n = 1; n <= Math.min(pdf.numPages, 12); n++) {
      const page = await pdf.getPage(n), vp = page.getViewport({ scale: 3 }), c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const big = (await imageBoxes(page, vp)).filter((b) => b.w > c.width * 0.25 && b.h > c.height * 0.12);       // skips logos and icons
      for (const b of big) {
        const pad = 16, x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad), w = Math.min(c.width - x, b.w + 2 * pad), h = Math.min(c.height - y, b.h + 2 * pad);
        const cc = document.createElement('canvas'); cc.width = w; cc.height = h; cc.getContext('2d').drawImage(c, x, y, w, h, 0, 0, w, h);
        crops.push({ base64: cc.toDataURL('image/jpeg', 0.85).split(',')[1], mediaType: 'image/jpeg' });
      }
      if (!big.length && pagesFallback.length < 8) pagesFallback.push({ base64: c.toDataURL('image/jpeg', 0.8).split(',')[1], mediaType: 'image/jpeg' });
    }
    return (crops.length ? crops : pagesFallback).slice(0, 10);
  }).then((out) => out, (e) => { console.warn('PDF figure rendering failed; falling back to the PDF itself', e); return []; });
}
function processing(upto) {
  show(`<h1>READING YOUR EO REPORT</h1><ul class="stages">${STAGES.map((s, k) => `<li id="st${k}" class="${k < upto ? 'done' : k === upto ? 'on' : ''}"><span class="dot"></span>${esc(s)}</li>`).join('')}</ul><p class="mini">This usually takes under a minute.</p>`, 'upload');
  return (k) => STAGES.forEach((_, i) => { const el = document.getElementById('st' + i); if (el) el.className = i < k ? 'done' : i === k ? 'on' : ''; });
}
function runParse() {
  const mark = processing(0); let timers = [];
  S.filename = picked.name; S.id = null; S.published = null;
  toBase64(picked).then((b64) => { S.fileB64 = b64; mark(1); return (/\.pdf$/i.test(picked.name) ? Promise.race([renderPdfPages(picked), new Promise((res) => setTimeout(() => res([]), 40000))]) : Promise.resolve([])).then((pages) => { mark(2); timers.push(setTimeout(() => mark(3), 2500)); return api('parse', { file_base64: b64, filename: picked.name, page_images: pages, swimmer_name: form.name || undefined }); }); })
    .then((r) => { timers.forEach(clearTimeout); mark(4); S.analysis = r.analysis; S.diagnostics = r.diagnostics; S.vision = r.vision; if (!r.layout) { return uploadView('This report layout is not recognised yet, so nothing was extracted. Nothing has been guessed.'); } if (form.name) S.analysis.swimmer.name = form.name; S.analysis.swimmer.communicationProfile = S.profile; reviewView(); })
    .catch((e) => { timers.forEach(clearTimeout); uploadView('Could not read the report: ' + friendly(e)); });
}
function openDraft(id) {
  show('<h1>OPENING REPORT</h1><p class="lede">Loading the saved report.</p>', 'review');
  api('get', { id }).then((r) => { const a = r.assessment; S.id = a.id; S.analysis = a.analysis; S.profile = a.communication_profile || 'PERFORMANCE'; S.filename = a.source_file_name; S.fileB64 = null; S.diagnostics = null; S.vision = null; S.published = a.share_token ? { url: r.public_url, token: a.share_token } : null; S.published ? publishedView() : reviewView(); })
    .catch((e) => uploadView('Could not open that report: ' + friendly(e)));
}

/* ---------------------------------------------------------------- review model */
const review = () => (S.analysis.coachReview = S.analysis.coachReview || { findings: {} });
const fr = (id) => (review().findings[id] = review().findings[id] || { status: 'PENDING' });
function compute() { S.R = analyse(S.analysis, 'COACH'); S.RS = analyse(S.analysis, SWIMMER_PROFILES.includes(S.profile) ? S.profile : 'PERFORMANCE'); }
const chip = (cls, t) => `<span class="rv-chip rv-${cls}">${esc(t)}</span>`;
const CLASS_LABEL = { MEASURED: 'Measured', OBSERVED: 'Observed', INFERRED: 'Inferred', COACH_CONFIRMATION_REQUIRED: 'Coach confirmation required' };

const FIELDS = [
  ['Session', [['session.distanceM', 'Distance', 'm'], ['session.timeS', 'Time', 's'], ['session.laps', 'Laps', ''], ['session.poolLengthM', 'Pool length', 'm'], ['session.strokeCount', 'Strokes', '']]],
  ['Whole-swim metrics', [['metrics.strokeRate', 'Stroke rate', 'str/min'], ['metrics.distancePerStrokeM', 'Distance per stroke', 'm'], ['metrics.avgPowerW', 'Average power', 'W'], ['metrics.workKj', 'Work', 'kJ']]],
  ['Force direction, whole swim', [['forceDistribution.overall.propulsivePct', 'Forward (propulsive)', '%'], ['forceDistribution.overall.downwardPct', 'Downward', '%'], ['forceDistribution.overall.leftwardPct', 'Leftward', '%'], ['forceDistribution.overall.rightwardPct', 'Rightward', '%'], ['forceDistribution.overall.upwardPct', 'Upward', '%'], ['forceDistribution.overall.handDragPct', 'Hand drag', '%']]],
  ['Left and right', [['leftRight.avgImpulseW.left', 'Avg impulse, left', 'W'], ['leftRight.avgImpulseW.right', 'Avg impulse, right', 'W'], ['leftRight.impulse.left', 'Impulse, left (no unit)', ''], ['leftRight.impulse.right', 'Impulse, right (no unit)', '']]],
];
function setLeafValue(path, text) {
  const keys = path.split('.'), parent = getPath(S.analysis, keys.slice(0, -1).join('.')), k = keys[keys.length - 1], old = parent[k]; const t = String(text).trim();
  const prov = { origin: 'COACH_SUPPLIED', location: old.provenance && old.provenance.location, note: `Edited by coach${old.value != null ? '; was ' + old.value : ''}`, extraction: { method: 'MANUAL', confidence: 'HIGH' } };
  if (t === '') { parent[k] = { ...missing(old.unit, 'COACH_REQUIRED'), provenance: prov }; return; }
  const v = Number(t); if (!isFinite(v)) return;
  parent[k] = { value: v, unit: old.unit, status: 'COMPLETE', provenance: prov };   // alternates and ranges are dropped: the coach has decided
}
function applyConflict(path, chosen, basis) {
  const leaf = getPath(S.analysis, path), all = printedValues(leaf), pick = all.find((v) => String(v.value) === String(chosen)); if (!pick) return;
  leaf.alternates = all.filter((v) => v !== pick).map((v) => ({ value: v.value, location: v.location })); leaf.value = pick.value; leaf.selectionBasis = 'Coach decision: ' + basis;
  leaf.provenance = { ...leaf.provenance, location: pick.location || leaf.provenance.location, note: 'Printed value selected by coach' };
}

/* ---------------------------------------------------------------- review view */
function evidenceCol() {
  const a = S.analysis, q = S.R.quality, rows = debugRows(a), sum = summariseRows(rows);
  const fields = FIELDS.map(([title, list]) => `<details class="d" ${S.openDetails['f-' + title] !== false ? 'open' : ''} data-d="f-${esc(title)}"><summary>${esc(title)}<span class="mini">edit</span></summary><div class="dbody">${list.map(([p, label, unit]) => {
    const l = getPath(a, p); if (!l) return '';
    const m = l.provenance && l.provenance.extraction, edited = l.provenance && l.provenance.origin === 'COACH_SUPPLIED';
    return `<div class="row"><div class="nm">${esc(label)}<small>${esc(unit)} ${l.provenance && l.provenance.location ? '• ' + esc(l.provenance.location) : ''}${l.absence ? ' • ' + esc(l.absence.replace(/_/g, ' ').toLowerCase()) : ''}</small></div><input class="in ${edited ? 'edited' : ''} ${l.value == null ? 'missing' : ''}" data-field="${p}" inputmode="decimal" value="${l.value == null ? '' : l.value}" placeholder="none">${l.value == null ? chip('st-missing', 'none') : edited ? chip('class-observed', 'edited') : chip(m && m.confidence === 'HIGH' ? 'st-complete' : 'st-partial', (m ? m.method : l.provenance.origin || '').toString().toLowerCase())}</div>`;
  }).join('')}</div></details>`).join('');
  const conflicts = q.conflicts.map((c) => `<div class="conf"><strong><code>${esc(c.path)}</code></strong> ${chip(c.realConflict ? 'st-ambiguous' : 'st-partial', c.realConflict ? 'values disagree' : 'precision variants')}
    ${c.values.map((v, i) => `<label><input type="radio" name="cv-${esc(c.path)}" value="${esc(v.value)}" ${v.used ? 'checked' : ''}> ${esc(v.value)}${esc(c.unit)} <span class="mini">${esc(v.location || '')}${v.used ? ' (in use)' : ''}</span></label>`).join('')}
    <label class="f" style="margin-top:6px">Why this value?<input class="in" data-basis="${esc(c.path)}" value="${esc((c.selectionBasis || '').replace(/^Coach decision: /, ''))}" placeholder="e.g. matches the table that sums to 100%"></label>
    <div class="ctl"><button class="btn sm" data-act="apply-conflict" data-path="${esc(c.path)}">Record decision</button>${c.selectionBasis ? chip('st-complete', 'decided') : chip('st-ambiguous', 'no decision')}</div></div>`).join('');
  const obs = a.eoObservations.map((o) => `<li>${chip(o.claimType === 'MEASUREMENT_STATEMENT' ? 'class-measured' : 'st-ambiguous', o.claimType === 'MEASUREMENT_STATEMENT' ? 'EO statement' : 'EO inference')} <span class="mini">${esc(o.area)}</span> ${esc(o.text)}</li>`).join('');
  const recs = a.eoRecommendations.map((r) => `<li>${chip(r.audience === 'COACH_ONLY' ? 'st-ambiguous' : 'coach', r.audience === 'COACH_ONLY' ? 'coach only' : 'swimmer')}${r.truncated ? chip('st-partial', 'cut off in source') : ''} ${esc(r.text)}</li>`).join('');
  const issues = q.issues.map((i) => `<li>${chip(i.severity === 'WARN' ? 'st-ambiguous' : 'coach', i.kind || i.severity)} ${esc(i.message)}</li>`).join('');
  const need = S.diagnostics ? S.diagnostics.coachRequired : [];
  return `<div class="col"><div class="col-h">EO evidence <small>what the report said</small></div>
    <div class="panel"><div class="chips">${chip('st-complete', sum.COMPLETE + ' complete')}${chip('st-partial', sum.PARTIAL + ' partial')}${chip('st-ambiguous', sum.AMBIGUOUS + ' ambiguous')}${chip('st-missing', sum.MISSING + ' missing')}</div>
      <p class="mini">Layout ${esc(a.source.layout || 'unknown')}. Image labels: ${S.vision ? (S.vision.ok ? esc(S.vision.forceField) + ' force-field panel(s) read' : 'not read') : 'not run this session'}.</p>
      ${need.length ? `<p class="mini">The report cannot supply: ${need.map(esc).join('; ')}.</p>` : ''}</div>
    ${fields}${q.conflicts.length ? `<details class="d" open><summary>Source conflicts<span class="mini">${q.conflicts.length}</span></summary><div class="dbody"><p class="mini">Several printed values for one quantity. The one in use is a decision, not ground truth: record why.</p>${conflicts}</div></details>` : ''}
    <details class="d"><summary>Source quality flags<span class="mini">${q.issues.length}</span></summary><div class="dbody"><ul class="rv-issues">${issues || '<li>None</li>'}</ul></div></details>
    <details class="d"><summary>EO statements and inferences<span class="mini">${a.eoObservations.length}</span></summary><div class="dbody"><ul class="rv-obs">${obs}</ul><p class="mini">EO's own diagnoses are kept here and never shown to a swimmer.</p></div></details>
    <details class="d"><summary>EO recommendations<span class="mini">${a.eoRecommendations.length}</span></summary><div class="dbody"><ul class="rv-obs">${recs}</ul></div></details>
    <details class="d"><summary>Parser debug<span class="mini">source | value | location | status</span></summary><div class="dbody"><table class="dbg"><tr><th>Field</th><th>Source</th><th>Value</th><th>How</th><th>Status</th></tr>${rows.map((r) => `<tr><td>${esc(r.path)}</td><td>${esc(r.sourceValue)}</td><td>${esc(r.normalised)}</td><td>${esc(r.method)}${r.confidence ? ':' + esc(r.confidence[0]) : ''}<br><span class="mini">${esc(r.location)}</span></td><td>${esc(r.status)}${r.absence ? '<br><span class="mini">' + esc(r.absence) + '</span>' : ''}</td></tr>`).join('')}</table></div></details></div>`;
}

function findingsCol() {
  const R = S.R, rv = review().findings;
  const prios = R.priorities.map((p, i) => `<div class="prio ${p.included ? '' : 'off'}"><div class="n">${p.included ? R.priorities.filter((x) => x.included).indexOf(p) + 1 : '–'}</div><div><strong>${esc(p.title)}</strong><div class="chips">${chip('class-' + p.classification.toLowerCase(), CLASS_LABEL[p.classification])}${chip('conf-' + p.confidence.toLowerCase(), p.confidence)}${p.suppressed ? chip('st-ambiguous', 'suppressed') : p.included ? chip('st-complete', 'in swimmer report') : chip('coach', p.coachOnlyReason || 'not in report')}</div>
    ${p.drill !== undefined ? `<label class="f" style="margin-top:6px">Drill<select class="in" data-drill="${esc(p.findingIds[0])}"><option value="">None</option>${DRILLS.map((d) => `<option value="${d.id}"${p.drillId === d.id ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>` : ''}</div>
    <div class="ctl" style="margin:0"><button class="btn sm" data-act="up" data-id="${esc(p.findingIds[0])}" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn sm" data-act="down" data-id="${esc(p.findingIds[0])}" ${i === R.priorities.length - 1 ? 'disabled' : ''}>↓</button></div></div>`).join('');
  const cards = R.findings.map((f) => {
    const r = rv[f.id] || { status: 'PENDING' }, sup = r.status === 'SUPPRESSED';
    return `<div class="fcard ${sup ? 'sup' : ''} ${f.classification === 'COACH_CONFIRMATION_REQUIRED' ? 'ccr' : ''}"><h3>${esc(f.title)}</h3>
      <div class="chips">${chip('class-' + f.classification.toLowerCase(), CLASS_LABEL[f.classification])}${chip('conf-' + f.confidence.toLowerCase(), f.confidence)}${chip('coach', f.kind)}${r.status !== 'PENDING' ? chip(sup ? 'st-ambiguous' : 'st-complete', r.status.toLowerCase()) : chip('st-missing', 'pending')}${r.technicalConfirmed ? chip('class-inferred', 'confirmed by coach') : ''}</div>
      ${f.measurement.length ? `<span class="lbl">Measurement</span><ul>${f.measurement.slice(0, 8).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${f.interpretation ? `<span class="lbl">Interpretation (${esc(f.interpretation.classification.toLowerCase())})</span><p class="mini">${esc(f.interpretation.text)}</p>` : ''}
      ${f.caveats.length ? `<span class="lbl">Caveats</span><ul>${f.caveats.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${f.corroboration ? `<p class="mini"><strong>${esc(f.corroboration.status)}.</strong> ${esc(f.corroboration.detail)}</p>` : ''}
      ${f.coachConfirmation.required ? `<div class="warn">Coach confirmation required. ${esc(f.coachConfirmation.reason || '')}${(f.coachConfirmation.evidenceNeeded || []).length ? '<ul>' + f.coachConfirmation.evidenceNeeded.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>' : ''}</div>` : ''}
      ${f.text.PERFORMANCE ? `<label class="f">Swimmer wording<textarea class="in" data-edit="${esc(f.id)}" rows="2">${esc(r.editedText != null ? r.editedText : f.text.PERFORMANCE)}</textarea></label>` : ''}
      <div class="ctl"><button class="btn sm ${r.status === 'APPROVED' ? 'on' : ''}" data-act="approve" data-id="${esc(f.id)}">Approve</button>${sup ? `<button class="btn sm" data-act="restore" data-id="${esc(f.id)}">Restore</button>` : `<button class="btn sm warnb" data-act="suppress" data-id="${esc(f.id)}">Suppress</button>`}
      ${f.classification === 'COACH_CONFIRMATION_REQUIRED' || (f.classification === 'INFERRED') ? `<button class="btn sm ${r.technicalConfirmed ? 'on' : ''}" data-act="confirm" data-id="${esc(f.id)}">${r.technicalConfirmed ? 'Technical interpretation confirmed' : 'Confirm technical interpretation'}</button>` : ''}</div>
      <label class="f" style="margin-top:8px">Coach note<input class="in" data-note="${esc(f.id)}" value="${esc(r.note || '')}" placeholder="optional"></label></div>`;
  }).join('');
  return `<div class="col"><div class="col-h">Aqua Sharks findings <small>what we make of it</small></div>
    <div class="panel"><h2>Priorities</h2><p class="hint">Ranked by evidence strength. The swimmer sees at most ${PROFILES[S.profile] ? PROFILES[S.profile].maxPriorities : 3}.</p>${prios || '<p class="mini">No priorities yet: the evidence does not support one.</p>'}</div>
    ${explainPanel()}${handPathPanel()}${cards}${lapPanel()}</div>`;
}

/** EO's headline sentences for the force-field section. Hidden from swimmers until the coach lets one through (or rewrites it). */
function explainPanel() {
  const pe = S.R.findings.find((f) => f.ruleId === 'POWER_EFFECTIVENESS'); const cands = pe && pe.meta.explanationCandidates ? pe.meta.explanationCandidates : [];
  if (!cands.length) return '';
  const cl = review().eoClaims || {};
  const rows = cands.map((c) => {
    const r = cl[c.id] || {}, on = r.status === 'APPROVED' || r.status === 'EDITED';
    return `<div class="fcard ${on ? '' : 'sup'}"><div class="chips">${chip(c.strength ? 'class-measured' : 'st-partial', c.strength ? 'a positive' : 'a point to work on')}${on ? chip('st-complete', 'swimmer sees this') : chip('st-missing', 'hidden')}</div>
      <label class="f">EO says, and the swimmer would read<textarea class="in" data-claim="${esc(c.id)}" rows="3">${esc(r.status === 'EDITED' ? r.editedText : c.text)}</textarea></label>
      <div class="ctl"><button class="btn sm ${on ? 'on' : ''}" data-act="claim-show" data-id="${esc(c.id)}">${on ? 'Showing' : 'Show to swimmer'}</button>${on ? `<button class="btn sm warnb" data-act="claim-hide" data-id="${esc(c.id)}">Hide</button>` : ''}</div></div>`;
  }).join('');
  return `<details class="d" open data-d="claims"><summary>EO's explanation<span class="mini">${cands.length} to decide</span></summary><div class="dbody"><p class="mini">Nothing from EO's wording reaches the swimmer unless you show it. Keep it short, kind and in your own words: edit the text before showing it. Hand drag and elbow points are EO's reading, so only show what you agree with.</p>${rows}</div></details>`;
}
/**
 * Hand path, from EO's stroke-path / consistency / hand-path-and-power charts. Those charts print no numbers, so nothing here is automatic:
 * the coach reads or confirms every value next to the chart. Uploading screenshots only SUGGESTS values (read twice, kept only where both reads agree).
 */
const SPREAD = ['TIGHT', 'MODERATE', 'WIDE', 'UNSURE'], WRIST = ['BROKEN', 'OK', 'UNSURE'], YNU = ['YES', 'NO', 'UNSURE'];
function handPathPanel() {
  const h = S.analysis.handPathReading, sg = (S.hpSug && S.hpSug.suggestions) || {};
  const cur = (m) => (m && m.value != null ? m.value : '');
  const rg = (m) => (m && m.range ? m.range : m && m.value != null ? [m.value, m.value] : ['', '']);
  const sel = (field, opts, v) => `<select class="in" data-hp="${field}"><option value="">Not entered</option>${opts.map((o) => `<option value="${o}"${v === o ? ' selected' : ''}>${o[0] + o.slice(1).toLowerCase()}</option>`).join('')}</select>`;
  const sug = (field) => { const x = sg[field]; if (!x) return ''; const txt = x.range ? (x.range[0] === x.range[1] ? x.range[0] : x.range[0] + ' to ' + x.range[1]) + ' cm' : String(x.value).toLowerCase(); return `<div class="mini">Suggested from the chart: <strong>${esc(txt)}</strong> (both reads agree)${x.basis && x.range ? ' <span title="' + esc(x.basis) + '">basis</span>' : ''} <button class="btn sm" data-act="hp-use" data-field="${esc(field)}">Use</button></div>`; };
  const arm = (k, label) => {
    const a = h[k], d = rg(a.maxDepthCm), w = rg(a.maxWidthCm);
    return `<h3>${label} hand</h3><div class="grid2">
      <label class="f">Deepest point, cm (low to high)<span style="display:flex;gap:6px"><input class="in" data-hp-lo="${k}.maxDepthCm" inputmode="decimal" value="${d[0]}" placeholder="low"><input class="in" data-hp-hi="${k}.maxDepthCm" inputmode="decimal" value="${d[1]}" placeholder="high"></span></label>
      <label class="f">Furthest from centreline, cm<span style="display:flex;gap:6px"><input class="in" data-hp-lo="${k}.maxWidthCm" inputmode="decimal" value="${w[0]}" placeholder="low"><input class="in" data-hp-hi="${k}.maxWidthCm" inputmode="decimal" value="${w[1]}" placeholder="high"></span></label>
      <label class="f">Stroke-to-stroke spread${sel(k + '.spread', SPREAD, cur(a.spread))}</label>
      <label class="f">Hand angled down at the catch?${sel(k + '.wristPitch', WRIST, cur(a.wristPitch))}</label></div>
      ${sug(k + '.maxDepthCm')}${sug(k + '.maxWidthCm')}${sug(k + '.spread')}${sug(k + '.wristPitch')}`;
  };
  const thumbs = (S.hpImages || []).map((u) => `<a href="${u}" target="_blank"><img src="${u}" alt="EO chart" style="height:90px;border-radius:8px;border:1px solid var(--border)"></a>`).join(' ');
  const und = S.hpSug && S.hpSug.undecided ? S.hpSug.undecided.map((x) => `<li>${esc(x.field)}: ${esc(x.why)}</li>`).join('') : '';
  return `<details class="d" data-d="handpath" ${S.openDetails.handpath ? 'open' : ''}><summary>Hand path (from EO's stroke-path charts)<span class="mini">${h && (present2(h.crossesMidline) || present2(h.left.spread) || present2(h.left.maxDepthCm)) ? 'entered' : 'optional'}</span></summary><div class="dbody">
    <p class="mini">These charts print no numbers, so nothing is filled automatically. Read each value off the chart yourself, or upload screenshots and check the suggestions against the chart: a suggestion is only offered when two independent reads agree. Nothing is used until you confirm it.</p>
    <label class="f">EO chart screenshots (optional, up to 6)<input class="in" type="file" id="hp-files" accept="image/png,image/jpeg,image/webp" multiple></label>
    <div class="ctl"><button class="btn sm" data-act="hp-suggest" ${S.hpBusy ? 'disabled' : ''}>${S.hpBusy ? 'Reading the charts...' : 'Suggest values from the charts'}</button></div>
    ${thumbs ? `<div style="margin:8px 0">${thumbs}</div>` : ''}${S.hpErr ? `<p class="err">${esc(S.hpErr)}</p>` : ''}
    ${und ? `<p class="mini">Not suggested, enter by hand if you can read it:</p><ul class="rv-issues">${und}</ul>` : ''}
    <label class="f">Do the hands cross the centreline (head-on view)?${sel('crossesMidline', YNU, cur(h.crossesMidline))}</label>${sug('crossesMidline')}
    ${arm('left', 'Left')}${arm('right', 'Right')}
    <p class="mini">Entered values are recorded as chart reads confirmed by you. They feed the report only through EO's own mappings (crossing the middle with sideways force, a hand angled down at the catch, hand-path consistency). Depth and width are shown to you only: EO prints no target for them.</p></div></details>`;
}
const present2 = (m) => !!m && m.status !== 'MISSING' && (m.value != null || !!m.range);

/** Link an earlier session of the same swimmer, so the report can show progress. */
function progressPanel() {
  const a = S.analysis, b = a.baseline && a.baseline.context ? a.baseline : null, name = a.swimmer.name === 'Unnamed swimmer' ? '' : a.swimmer.name;
  const rows = b ? progressRows(a) : [], warn = b ? comparability(a) : [];
  const list = (S.prevList || []).filter((r) => r.id !== S.id);
  return `<div class="panel"><h2>Progress</h2><p class="hint">Compare with an earlier session of ${name ? esc(name) : 'this swimmer'}. The report then shows what moved since last time.</p>
    ${b ? `<p class="ok">Comparing with the session of ${b.capturedOn ? esc(fmtDate(b.capturedOn)) : 'an earlier date'} (${rows.length} number${rows.length === 1 ? '' : 's'} to compare).</p>${warn.map((x) => `<p class="warn">${esc(x)}</p>`).join('')}<div class="ctl"><button class="btn sm warnb" data-act="prog-clear">Remove comparison</button></div>`
      : list.length ? `<label class="f">Earlier session<select class="in" id="o-prev">${list.map((r) => `<option value="${esc(r.id)}">${esc(r.session_date ? fmtDate(r.session_date) : 'undated')} ${r.status === 'published' ? '(published)' : '(draft)'}</option>`).join('')}</select></label><div class="ctl"><button class="btn sm primary" data-act="prog-use">Use as last time</button></div>`
      : `<div class="ctl"><button class="btn sm" data-act="prog-find" ${name ? '' : 'disabled'}>${S.prevList ? 'No earlier sessions found. Look again' : 'Find earlier sessions'}</button></div>${name ? '' : '<p class="mini">Enter the swimmer’s name first.</p>'}`}</div>`;
}
/** When the swimmer is invited back. The practice plan is built from the report's own focuses and drills over these weeks. */
function retestPanel() {
  const a = S.analysis, w = retestWeeks(a.coachReview && a.coachReview.retestWeeks), d = a.session.date && a.session.date.value ? retestDate(a.session.date.value, w) : null;
  const n = S.RS.priorities.filter((p) => p.included).length;
  return `<div class="panel"><h2>Retest and practice plan</h2><p class="hint">The report invites the swimmer back and gives a week-by-week plan built from the ${n} focus${n === 1 ? '' : 'es'} above and the drill chosen for each. Six weeks is a starting suggestion: change it to what you would tell this swimmer.</p>
    <label class="f">Retest in<select class="in" id="o-weeks">${RETEST_WEEKS.map((x) => `<option value="${x}"${w === x ? ' selected' : ''}>${x} weeks</option>`).join('')}</select></label>
    <p class="mini">${d ? `Retest around ${esc(d)}.` : 'No session date, so the report says "in about ' + w + ' weeks".'}</p></div>`;
}
function notePanel() {
  const a = S.analysis, note = (a.coachReview && a.coachReview.coachNote) || '';
  const ov = a.eoObservations.filter((o) => o.area === 'OVERVIEW').map((o) => o.text).slice(0, 3);
  return `<div class="panel"><h2>Your note</h2><p class="hint">Two or three lines from you, at the top of the report. This is what makes it yours.</p>
    <textarea class="in" id="o-note" rows="5" maxlength="1200" placeholder="e.g. Great swim, Johann. Your left arm is smooth and balanced. This week let's just work on one thing...">${esc(note)}</textarea>
    ${ov.length ? `<details class="d" style="margin-top:8px"><summary>EO's overview, for reference<span class="mini">not shown to the swimmer</span></summary><div class="dbody"><p class="mini">${ov.map(esc).join(' ')}</p></div></details>` : ''}</div>`;
}

function lapPanel() {
  const a = S.analysis, c = a.lapComparisons[0], ff = a.forceFieldReadings[0], v = (x) => (x && x.value != null ? x.value : '');
  const rg = (m) => (m && m.range ? m.range : ['', '']);
  return `<details class="d" ${c ? 'open' : ''}><summary>Add a lap comparison (optional)<span class="mini">${c ? 'in use' : 'advanced'}</span></summary><div class="dbody">
    <p class="mini">The lap-by-lap chart has no printed values, so a comparison is entered by you. It is an endpoint comparison between two laps, never called a trend.</p>
    <div class="grid2"><label class="f">From lap<input class="in" id="lc-from" inputmode="numeric" value="${c ? c.from.laps[0] || '' : 1}"></label><label class="f">To lap<input class="in" id="lc-to" inputmode="numeric" value="${c ? c.to.laps[0] || '' : v(a.session.laps) || ''}"></label>
      <label class="f">Stroke rate, from lap<input class="in" id="lc-sr0" inputmode="decimal" value="${c ? v(c.strokeRate.from) : ''}"></label><label class="f">Stroke rate, to lap<input class="in" id="lc-sr1" inputmode="decimal" value="${c ? v(c.strokeRate.to) : ''}"></label>
      <label class="f">Pull power change % (low)<input class="in" id="lc-pp0" inputmode="decimal" value="${c ? rg(c.pullPower.change)[0] : ''}" placeholder="-25"></label><label class="f">Pull power change % (high)<input class="in" id="lc-pp1" inputmode="decimal" value="${c ? rg(c.pullPower.change)[1] : ''}" placeholder="-23"></label>
      <label class="f">Propulsive power change % (low)<input class="in" id="lc-pr0" inputmode="decimal" value="${c ? rg(c.propulsivePower.change)[0] : ''}" placeholder="-39"></label><label class="f">Propulsive power change % (high)<input class="in" id="lc-pr1" inputmode="decimal" value="${c ? rg(c.propulsivePower.change)[1] : ''}" placeholder="-33"></label>
      <label class="f">Forward share, to lap %<input class="in" id="lc-fs1" inputmode="decimal" value="${c ? v(c.forceShares.to.propulsivePct) : ''}"></label><label class="f">Downward share, to lap %<input class="in" id="lc-ds1" inputmode="decimal" value="${c ? v(c.forceShares.to.downwardPct) : ''}"></label></div>
    ${ff ? `<label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:13px"><input type="checkbox" id="lc-useff" ${c && c.forceShares.from.propulsivePct.value != null ? 'checked' : ''}> The force-field image shows the <em>from</em> lap (use its shares)</label>` : ''}
    <p class="mini">Ranges and approximate values are kept exactly as entered; none is turned into a midpoint.</p>
    <div class="ctl"><button class="btn sm primary" data-act="lap-apply">${c ? 'Update comparison' : 'Add comparison'}</button>${c ? '<button class="btn sm warnb" data-act="lap-remove">Remove</button>' : ''}</div></div></details>`;
}
function applyLap() {
  const g = (id) => { const el = document.getElementById(id); const t = el ? el.value.trim() : ''; return t === '' || !isFinite(Number(t)) ? null : Number(t); };
  const f = g('lc-from'), t = g('lc-to'); if (!f || !t) { S.err = 'Enter both lap numbers.'; return; }
  const pool = S.analysis.session.poolLengthM.value, dist = (n) => (pool ? { from: (n - 1) * pool, to: n * pool } : null);
  const prov = X.from('MANUAL', 'HIGH', { section: 'coach entry' }, undefined, 'COACH_SUPPLIED');
  const patch = { from: lapRef([f], dist(f), prov), to: lapRef([t], dist(t), prov), strokeRate: {}, forceShares: { from: {}, to: {} } };
  const sr0 = g('lc-sr0'), sr1 = g('lc-sr1'), pp0 = g('lc-pp0'), pp1 = g('lc-pp1'), pr0 = g('lc-pr0'), pr1 = g('lc-pr1'), fs1 = g('lc-fs1'), ds1 = g('lc-ds1');
  if (sr0 != null) patch.strokeRate.from = num(sr0, 'str/min', prov, { approximate: true }); if (sr1 != null) patch.strokeRate.to = num(sr1, 'str/min', prov, { approximate: true });
  if (pp0 != null && pp1 != null) patch.pullPower = { change: rng([pp0, pp1], '%', prov) };
  if (pr0 != null && pr1 != null) patch.propulsivePower = { change: rng([pr0, pr1], '%', prov) };
  if (fs1 != null) patch.forceShares.to.propulsivePct = num(fs1, '%', prov, { approximate: true }); if (ds1 != null) patch.forceShares.to.downwardPct = num(ds1, '%', prov, { approximate: true });
  const ff = S.analysis.forceFieldReadings[0], use = document.getElementById('lc-useff');
  if (ff && use && use.checked) { for (const k of Object.keys(ff.shares)) if (ff.shares[k].value != null) patch.forceShares.from[k] = { ...ff.shares[k], status: 'COMPLETE', provenance: { ...ff.shares[k].provenance, note: `Lap ${f} confirmed by coach` } }; ff.lap = lapRef([f], dist(f), prov); }
  S.analysis.lapComparisons = [overlay(emptyComparison(`lap${f}-vs-lap${t}`, 'ENDPOINT_CHANGE'), patch)];
}

function outputCol() {
  const a = S.analysis, RS = S.RS, hero = RS.report.sections.find((s) => s.id === 'HERO'), inc = RS.priorities.filter((p) => p.included);
  const rd = clientReadiness();
  return `<div class="col"><div class="col-h">Report output <small>what the swimmer gets</small></div>
    <div class="panel"><h2>Swimmer</h2><div class="grid2"><label class="f">Name<input class="in" id="o-name" value="${esc(a.swimmer.name === 'Unnamed swimmer' ? '' : a.swimmer.name)}" placeholder="required"></label><label class="f">Age<input class="in" id="o-age" inputmode="numeric" value="${a.swimmer.age && a.swimmer.age.value != null ? a.swimmer.age.value : ''}" placeholder="optional"></label></div>
      <label class="f" style="margin-top:10px">Report style<select class="in" id="o-profile">${SWIMMER_PROFILES.map((p) => `<option value="${p}"${S.profile === p ? ' selected' : ''}>${PROFILE_LABEL[p]}</option>`).join('')}</select></label></div>
    ${notePanel()}${retestPanel()}${progressPanel()}<div class="panel"><h2>Headline</h2>${hero ? `<p class="rv-big" style="margin:6px 0">${hero.data.headline.map(esc).join(' ')}</p>` : ''}<h3>Priorities the swimmer will see</h3>${inc.map((p, i) => `<p style="margin:6px 0"><strong>${i + 1}. ${esc(p.title)}</strong><br><span class="mini">${esc(p.cue)}${p.drill ? ' • ' + esc(p.drill.name) : ''}</span></p>`).join('') || '<p class="mini">None yet.</p>'}
      <h3>Sections</h3><div class="chips">${RS.report.sections.filter((s) => !['EVIDENCE', 'DATA_QUALITY', 'SOURCE'].includes(s.id)).map((s) => chip('st-' + s.status.toLowerCase(), s.id.toLowerCase() + ': ' + s.status.toLowerCase())).join('')}</div><p class="mini">A section with no evidence is left out of the report, never filled.</p></div>
    <div class="panel"><h2>Ready to publish?</h2>${rd.blockers.map((x) => `<p class="err">${esc(x)}</p>`).join('')}${rd.warnings.map((x) => `<p class="warn">${esc(x)}</p>`).join('')}${!rd.blockers.length && !rd.warnings.length ? '<p class="ok">Nothing outstanding.</p>' : ''}
      ${S.err ? `<p class="err">${esc(S.err)}</p>` : ''}${S.msg ? `<p class="ok">${esc(S.msg)}</p>` : ''}
      <div class="actions"><button class="btn" data-act="save">Save draft</button><button class="btn" data-act="preview">Preview report</button><button class="btn primary" data-act="publish" ${rd.blockers.length ? 'disabled' : ''}>Publish <i data-lucide="send"></i></button></div></div></div>`;
}
function clientReadiness() {
  const blockers = [], warnings = [], a = S.analysis, R = S.R, RS = S.RS;
  if (!a.swimmer.name || a.swimmer.name === 'Unnamed swimmer') blockers.push('Enter the swimmer’s name.');
  if (!RS.report.sections.some((s) => ['POWER', 'COMPARISON', 'ARMS', 'FOCUS'].includes(s.id) && s.status !== 'MISSING')) blockers.push('There is not enough evidence to build a swimmer report yet.');
  const peF = R.findings.find((f) => f.ruleId === 'POWER_EFFECTIVENESS'), cn = peF && peF.meta.explanationCandidates ? peF.meta.explanationCandidates : [], cl = (a.coachReview && a.coachReview.eoClaims) || {};
  if (cn.length && !cn.some((c) => cl[c.id])) warnings.push('You have not looked at EO’s explanation yet. Show the points you agree with, or the report will give numbers and targets without the reason.');
  if (!(a.coachReview && a.coachReview.coachNote && a.coachReview.coachNote.trim())) warnings.push('No note from you yet. A short personal note is what the swimmer remembers.');
  const un = R.quality.conflicts.filter((c) => c.realConflict && !c.selectionBasis); if (un.length) warnings.push(`Record a decision for conflicting values: ${un.map((c) => c.path).join(', ')}.`);
  const pend = R.findings.filter((f) => f.review.status === 'PENDING' && f.kind === 'OPPORTUNITY' && f.classification !== 'COACH_CONFIRMATION_REQUIRED').length; if (pend) warnings.push(`${pend} finding(s) not yet approved.`);
  return { blockers, warnings };
}

function reviewView() {
  compute();
  show(`<div class="rb">${evidenceCol()}${findingsCol()}${outputCol()}</div>`, 'review', true);
  bindReview();
}
function rerender() { const y = window.scrollY, cols = [...document.querySelectorAll('.rb > .col')].map((c) => c.scrollTop); compute(); const rb = document.querySelector('.rb'); rb.innerHTML = evidenceCol() + findingsCol() + outputCol(); if (window.lucide) lucide.createIcons(); [...rb.children].forEach((c, i) => { c.scrollTop = cols[i] || 0; }); window.scrollTo(0, y); }

function bindReview() {
  const root = app;
  root.onchange = (e) => {
    const t = e.target;
    if (t.dataset.field) { setLeafValue(t.dataset.field, t.value); return rerender(); }
    if (t.dataset.edit) { const f = S.R.findings.find((x) => x.id === t.dataset.edit), r = fr(t.dataset.edit), v = t.value.trim(); if (v && v !== f.text.PERFORMANCE) { r.editedText = v; r.status = 'EDITED'; } else { delete r.editedText; if (r.status === 'EDITED') r.status = 'PENDING'; } return rerender(); }
    if (t.dataset.claim) { const cl = (review().eoClaims = review().eoClaims || {}), v = t.value.trim(), c = (S.R.findings.find((f) => f.ruleId === 'POWER_EFFECTIVENESS').meta.explanationCandidates || []).find((x) => x.id === t.dataset.claim); if (c && v && v !== c.text) cl[t.dataset.claim] = { status: 'EDITED', editedText: v }; else if (cl[t.dataset.claim] && cl[t.dataset.claim].status === 'EDITED') cl[t.dataset.claim] = { status: 'APPROVED' }; return rerender(); }
    if (t.dataset.hp) { setHandPathField(S.analysis, t.dataset.hp, t.value || null); return rerender(); }
    if (t.dataset.hpLo || t.dataset.hpHi) {
      const f = t.dataset.hpLo || t.dataset.hpHi, lo = root.querySelector(`[data-hp-lo="${f}"]`).value.trim(), hi = root.querySelector(`[data-hp-hi="${f}"]`).value.trim();
      if (lo === '' && hi === '') setHandPathField(S.analysis, f, null);
      else { const a = Number(lo === '' ? hi : lo), b = Number(hi === '' ? lo : hi); if (!setHandPathField(S.analysis, f, [Math.min(a, b), Math.max(a, b)])) S.err = 'Enter distances in cm, between 0 and 300.'; }
      return rerender();
    }
    if (t.id === 'o-weeks') { review().retestWeeks = Number(t.value); return rerender(); }
    if (t.id === 'o-note') { review().coachNote = t.value; return rerender(); }
    if (t.dataset.note !== undefined) { fr(t.dataset.note).note = t.value; return; }
    if (t.dataset.drill !== undefined) { const r = review(); r.drillChoice = r.drillChoice || {}; t.value ? (r.drillChoice[t.dataset.drill] = t.value) : delete r.drillChoice[t.dataset.drill]; return rerender(); }
    if (t.id === 'o-name') { S.analysis.swimmer.name = t.value.trim() || 'Unnamed swimmer'; return rerender(); }
    if (t.id === 'o-age') { const v = Number(t.value); S.analysis.swimmer.age = t.value.trim() && isFinite(v) ? num(v, 'years', X.from('MANUAL', 'HIGH', { section: 'coach entry' }, undefined, 'COACH_SUPPLIED')) : missing('years', 'COACH_REQUIRED'); return; }
    if (t.id === 'o-profile') { S.profile = t.value; S.analysis.swimmer.communicationProfile = t.value; return rerender(); }
  };
  root.onclick = (e) => {
    const d = e.target.closest('details.d[data-d]'); if (d && e.target.closest('summary')) setTimeout(() => { S.openDetails[d.dataset.d] = d.open; }, 0);
    const b = e.target.closest('[data-act]'); if (!b) return; const act = b.dataset.act, id = b.dataset.id; S.err = null; S.msg = null;
    if (act === 'approve') { const r = fr(id); r.status = r.editedText ? 'EDITED' : 'APPROVED'; }
    else if (act === 'suppress') fr(id).status = 'SUPPRESSED';
    else if (act === 'restore') fr(id).status = 'PENDING';
    else if (act === 'confirm') { const r = fr(id); r.technicalConfirmed = !r.technicalConfirmed; }
    else if (act === 'up' || act === 'down') { const order = S.R.priorities.map((p) => p.findingIds[0]), i = order.indexOf(id), j = act === 'up' ? i - 1 : i + 1; if (j >= 0 && j < order.length) { [order[i], order[j]] = [order[j], order[i]]; review().priorityOrder = order; } }
    else if (act === 'apply-conflict') { const path = b.dataset.path, sel = root.querySelector(`input[name="cv-${CSS.escape(path)}"]:checked`), basis = (root.querySelector(`[data-basis="${CSS.escape(path)}"]`) || {}).value || ''; if (!basis.trim()) { S.err = 'Say why that value, so the decision is on record.'; return rerender(); } if (sel) applyConflict(path, sel.value, basis.trim()); }
    else if (act === 'hp-use') { const x = (S.hpSug && S.hpSug.suggestions || {})[b.dataset.field]; if (x) setHandPathField(S.analysis, b.dataset.field, x.range ? x.range : x.value, 'Suggested by two independent reads of the chart; checked by the coach.'); }
    else if (act === 'hp-suggest') {
      const files = [...(document.getElementById('hp-files') || { files: [] }).files].slice(0, 6);
      if (!files.length) { S.hpErr = 'Choose one or more chart screenshots first.'; return rerender(); }
      S.hpBusy = true; S.hpErr = null; S.openDetails.handpath = true; rerender();
      return Promise.all(files.map(async (f) => ({ base64: await toBase64(f), mediaType: f.type || 'image/png', url: URL.createObjectURL(f) })))
        .then((ims) => { S.hpImages = ims.map((i) => i.url); return api('hand_path', { page_images: ims.map((i) => ({ base64: i.base64, mediaType: i.mediaType })) }); })
        .then((r) => { S.hpSug = r; if (!r.ok) S.hpErr = 'The chart read did not work. Enter the values by hand.'; })
        .catch((er) => { S.hpErr = friendly(er); }).then(() => { S.hpBusy = false; rerender(); });
    }
    else if (act === 'claim-show') { const cl = (review().eoClaims = review().eoClaims || {}), ta = root.querySelector(`[data-claim="${CSS.escape(id)}"]`), c = (S.R.findings.find((f) => f.ruleId === 'POWER_EFFECTIVENESS').meta.explanationCandidates || []).find((x) => x.id === id), v = ta ? ta.value.trim() : ''; cl[id] = c && v && v !== c.text ? { status: 'EDITED', editedText: v } : { status: 'APPROVED' }; }
    else if (act === 'claim-hide') { (review().eoClaims = review().eoClaims || {})[id] = { status: 'HIDDEN' }; }
    else if (act === 'prog-find') { const nm = S.analysis.swimmer.name; return api('list', { name: nm }).then((r) => { S.prevList = r.assessments || []; }).catch((er) => { S.err = friendly(er); }).then(rerender); }
    else if (act === 'prog-use') { const sel = root.querySelector('#o-prev'); if (!sel) return; return api('get', { id: sel.value }).then((r) => { S.analysis.baseline = baselineFrom(r.assessment.analysis); }).catch((er) => { S.err = friendly(er); }).then(rerender); }
    else if (act === 'prog-clear') { S.analysis.baseline = { capturedOn: null, metrics: {} }; S.prevList = null; }
    else if (act === 'lap-apply') applyLap();
    else if (act === 'lap-remove') S.analysis.lapComparisons = [];
    else if (act === 'save') return save().then((ok) => { if (ok) S.msg = 'Draft saved.'; rerender(); });
    else if (act === 'preview') return openPreview();
    else if (act === 'publish') return publish();
    rerender();
  };
}

/* ---------------------------------------------------------------- save / preview / publish */
function save() {
  return api('save', { id: S.id || undefined, analysis: S.analysis, profile: SWIMMER_PROFILES.includes(S.profile) ? S.profile : 'PERFORMANCE', filename: S.filename, file_base64: S.id ? undefined : S.fileB64 || undefined })
    .then((r) => { S.id = r.id; return true; }).catch((e) => { S.err = friendly(e); return false; });
}
function openPreview(mode) {
  const dlg = document.getElementById('preview'), m = mode || (SWIMMER_PROFILES.includes(S.profile) ? S.profile : 'PERFORMANCE');
  compute(); document.getElementById('pv-body').innerHTML = renderReport(analyse(S.analysis, m).report);
  document.getElementById('pv-modes').innerHTML = [...SWIMMER_PROFILES, 'COACH'].map((p) => `<button class="btn sm ${p === m ? 'on' : ''}" data-pv="${p}">${PROFILE_LABEL[p]}</button>`).join('');
  document.getElementById('pv-modes').onclick = (e) => { const x = e.target.closest('[data-pv]'); if (x) openPreview(x.dataset.pv); };
  document.getElementById('pv-close').onclick = () => dlg.close(); if (!dlg.open) dlg.showModal(); if (window.lucide) lucide.createIcons();
}
async function publish() {
  S.err = null; S.msg = null; const ok = await save(); if (!ok) return rerender();
  const profile = SWIMMER_PROFILES.includes(S.profile) ? S.profile : 'PERFORMANCE';
  try {
    let out;
    try { out = await api('publish', { id: S.id, analysis: S.analysis, profile }); }
    catch (e) {
      if (e.code === 'warnings_unacknowledged' && e.body && e.body.warnings) { if (!window.confirm('Publish with these open items?\n\n' + e.body.warnings.map((w) => '• ' + w).join('\n'))) return rerender(); out = await api('publish', { id: S.id, analysis: S.analysis, profile, acknowledge_warnings: true }); }
      else throw e;
    }
    S.published = { url: out.url, token: out.token, pdf: out.pdf_url }; publishedView();
  } catch (e) { S.err = e.code === 'not_ready' && e.body ? e.body.blockers.join(' ') : friendly(e); rerender(); }
}
function publishedView() {
  const p = S.published, a = S.analysis;
  show(`<h1>PUBLISHED</h1><p class="lede">${esc(a.swimmer.name)}'s report is live. Anyone with the link can read it; nobody else can find it. You can withdraw it at any time.</p>
    <div class="panel"><h2>Web report</h2><div class="pubbox"><input class="in" id="pub-url" readonly value="${esc(p.url)}"><button class="btn" id="copy">Copy link</button><a class="btn primary" href="${esc(p.url)}" target="_blank" rel="noopener">Open report <i data-lucide="external-link"></i></a></div></div>
    <div class="panel"><h2>PDF</h2><p class="hint">Rendered from the published report, A4, ready to send or print.</p><a class="btn primary" id="pdf" href="${esc(p.pdf || '/api/lab-report-pdf?t=' + p.token)}" download>Download PDF <i data-lucide="download"></i></a></div>
    <div class="actions"><button class="btn" id="edit">Edit again</button><button class="btn warnb" id="unpub">Withdraw report</button><a class="btn" href="/aquasharks-lab/report-builder">New report</a></div>${S.err ? `<p class="err">${esc(S.err)}</p>` : ''}`, 'publish');
  document.getElementById('copy').onclick = () => { const el = document.getElementById('pub-url'); el.select(); navigator.clipboard ? navigator.clipboard.writeText(el.value) : document.execCommand('copy'); document.getElementById('copy').textContent = 'Copied'; };
  document.getElementById('edit').onclick = () => { reviewView(); };
  document.getElementById('unpub').onclick = () => api('unpublish', { id: S.id }).then(() => { S.published = null; S.msg = 'Report withdrawn. The link no longer works.'; reviewView(); }).catch((e) => { S.err = friendly(e); publishedView(); });
}

document.addEventListener('mousemove', (e) => { document.body.style.setProperty('--mouse-x', e.clientX + 'px'); document.body.style.setProperty('--mouse-y', e.clientY + 'px'); });
window.__lab = { S, compute, renderPdfPages };   // for tests
boot();
