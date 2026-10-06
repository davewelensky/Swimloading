// @ts-check
/**
 * Renders a ReportModel to HTML. Knows nothing about EO, parsing, or rules: it draws what the model contains
 * and omits any section whose status is MISSING (no placeholders, no fake values).
 */
import { f0, f1, signed, span } from './language.js';

/** Arrows are drawn, not typed: Bebas Neue and DM Sans have no arrow glyph, and a server without system fonts (Vercel's Chromium) prints a box. */
const ARR = '<svg class="rv-arr" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7"/></svg>';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const chip = (cls, text) => `<span class="rv-chip rv-${cls}">${esc(text)}</span>`;
const statusChip = (s) => chip('st-' + s.toLowerCase(), s);
const CLASS_LABEL = { MEASURED: 'Measured', OBSERVED: 'Observed', INFERRED: 'Inferred', COACH_CONFIRMATION_REQUIRED: 'Coach confirmation required' };

function head(sec, label, isCoach, title) {
  return `<header class="rv-sechead"><p class="eyebrow">${esc(label)}</p><h2 class="rv-h2">${esc(title)}</h2>${isCoach ? `<div class="rv-secstat">${statusChip(sec.status)}</div>` : ''}</header>`;
}

function hero(sec, m, isCoach) {
  const d = sec.data;
  return `<section class="pg rv-sec rv-hero" data-sec="HERO">
    <div class="brandbar"><span class="mark"><i data-lucide="waves"></i>AQUA SHARKS LAB</span><span class="pgtag">SwimBETTER analysis</span></div>
    <p class="eyebrow">Your swim</p><h1 class="rv-name">${esc(d.name)}</h1>
    <p class="rv-session">${esc(d.sessionLine)}</p>
    <p class="rv-sessionsub">${esc([d.date, d.location].filter(Boolean).join(' • '))}</p>
    <h2 class="rv-headline">${d.headline.map((l, i) => `<span class="${i === 0 ? '' : 'em'}">${esc(l)}</span>`).join('')}</h2>
    ${d.keyMetrics.length ? `<div class="rv-tiles rv-tiles-${d.keyMetrics.length}">${d.keyMetrics.map((k) => `<div class="rv-tile"><span class="lbl">${esc(k.label)}</span><strong>${esc(k.value)}<small>${esc(k.unit)}</small></strong>${k.goal ? `<span class="rv-goal">${esc(k.goal)}</span>` : ''}</div>`).join('')}</div>` : ''}
    <p class="rv-eoref">This report builds on your EO Labs SwimBETTER analysis. EO measures your stroke; Aqua Sharks turns it into what to work on.</p>
    ${isCoach ? `<div class="rv-secstat">${statusChip(sec.status)}</div>` : ''}
  </section>`;
}

function noteSec(sec) {
  const d = sec.data;
  return `<section class="pg rv-sec rv-note" data-sec="NOTE"><p class="eyebrow">A note from ${esc(d.from)}</p><blockquote class="rv-notebody">${esc(d.text).split(/\n+/).map((x) => `<p>${x}</p>`).join('')}</blockquote><p class="rv-notesig">${esc(d.from)}, ${esc(d.club)}</p></section>`;
}

function strengths(sec) {
  const d = sec.data;
  return `<section class="pg rv-sec rv-good" data-sec="STRENGTHS"><header class="rv-sechead"><p class="eyebrow">Keep doing this</p><h2 class="rv-h2">${esc(d.headline)}</h2></header><ul class="rv-goodlist">${d.items.map((i) => `<li><i data-lucide="check"></i><div><strong>${esc(i.title)}</strong>${i.detail ? `<p>${esc(i.detail)}</p>` : ''}</div></li>`).join('')}</ul></section>`;
}

function progress(sec) {
  const d = sec.data;
  const chipOf = (v) => (v === 'BETTER' ? '<span class="rv-pv rv-pv-better">Better</span>' : v === 'SAME' ? '<span class="rv-pv rv-pv-same">Same</span>' : '<span class="rv-pv rv-pv-not">Not yet</span>');
  return `<section class="pg rv-sec rv-progress" data-sec="PROGRESS"><header class="rv-sechead"><p class="eyebrow">${d.since ? `Compared with ${esc(d.since)}` : 'Compared with your last session'}</p><h2 class="rv-h2">${esc(d.headline)}</h2></header>
    <p class="rv-big">${esc(d.summary)}</p>
    <div class="rv-prog">${d.rows.map((r) => `<div class="rv-progrow"><span class="rv-progl">${esc(r.label)}</span><span class="rv-progn">${r.then.toFixed(r.dp)}<small>${esc(r.unit)}</small> \u2192 <strong>${r.now.toFixed(r.dp)}<small>${esc(r.unit)}</small></strong></span>${chipOf(r.verdict)}</div>`).join('')}</div>
    <p class="muted small">Two swims are a small sample, and pool, effort and rest all change the numbers. Look for a pattern over several sessions.</p></section>`;
}

function plan(sec, m) {
  const d = sec.data, simple = m.profile.showNumbers === 'MINIMAL';
  return `<section class="pg rv-sec rv-plan" data-sec="PLAN"><header class="rv-sechead"><p class="eyebrow">Until your retest</p><h2 class="rv-h2">${esc(d.headline)}</h2></header>
    <ol class="rv-steps">${d.steps.map((x) => `<li class="rv-step rv-step-${x.kind.toLowerCase()}"><span class="rv-stepwk">${esc(x.weeks)}</span><div><strong>${esc(x.title)}</strong>${x.drill ? `<p>Add <em>${esc(x.drill.name)}</em> to your warm-up (how it goes is on the focus page).</p>` : x.kind === 'TOGETHER' ? '<p>Swim your normal sets and bring the cues with you. Then come back and we measure what changed.</p>' : ''}${x.cue ? `<p class="rv-stepcue">Cue: &ldquo;${esc(x.cue)}&rdquo;</p>` : ''}</div></li>`).join('')}</ol>
    ${d.tip ? `<p class="rv-tip">${esc(d.tip)}</p>` : ''}
    ${d.check ? `<div class="rv-pull"><i data-lucide="hash"></i><div><p class="lbl">A number you can check yourself</p><p><strong>${simple ? '' : esc(d.check.perLength)}</strong>${simple ? 'Count how many times your right hand enters the water on one length.' : ` strokes per length today (one stroke is left and right arm together). ${esc(d.check.text)}`}</p></div></div>` : ''}</section>`;
}

function power(sec, m, isCoach) {
  const d = sec.data, minimal = m.profile.showNumbers === 'MINIMAL', fmt = minimal ? f0 : f1;
  const total = d.categories.reduce((s, c) => s + c.pct, 0) || 1;
  const bar = d.categories.map((c) => `<i class="rv-seg rv-seg-${c.id}" style="width:${(c.pct / Math.max(total, 100)) * 100}%" title="${esc(c.label)}"></i>`).join('');
  const legend = d.categories.map((c) => `<div class="rv-cat rv-cat-${c.id}"><strong>${fmt(c.pct)}<small>%</small></strong><span class="rv-catlbl">${esc(c.label)}</span>${c.detail ? `<span class="rv-catdet">${esc(c.detail)}</span>` : ''}</div>`).join('');
  return `<section class="pg rv-sec rv-power-join" data-sec="POWER">${head(sec, 'Force direction', isCoach, d.headline)}
    <div class="rv-bar" role="img" aria-label="Share of force by direction">${bar}</div>
    <div class="rv-cats">${legend}</div>
    ${targets(d, m)}
    <div class="rv-means"><p class="lbl">What this means</p><p class="rv-big">${esc(d.whatThisMeans)}</p>${d.explanations && d.explanations.length ? `<ul class="rv-why">${d.explanations.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="muted small">From the EO analysis, checked by your coach.</p>` : ''}</div>
  </section>`;
}
/** Only the numbers that are off target, as: you, then the target. Juniors get words, not figures. */
function targets(d, m) {
  const t = d.targets; if (!t) return '';
  const word = (r) => (r.status === 'BELOW' ? 'a bit low' : 'a bit high');
  return `<div class="rv-targets"><p class="lbl">${esc(t.context)}</p>${t.rows.map((r) => `<div class="rv-trow rv-t-${r.status.toLowerCase()}"><span class="rv-tlabel">${esc(r.label)}</span>${t.simple ? `<span class="rv-tword">${word(r)}</span>` : `<span class="rv-tyou"><small>You</small><strong>${f1(r.value)}%</strong></span><svg class="rv-arr" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7"/></svg><span class="rv-ttarget"><small>Target</small><strong>${esc(r.target)}</strong></span>`}</div>`).join('')}</div>`;
}

function comparison(sec, m, isCoach) {
  const d = sec.data, minimal = m.profile.showNumbers === 'MINIMAL';
  const pctRows = d.rows.filter((r) => r.kind === 'pct');
  const maxMag = Math.max(1, ...pctRows.map((r) => Math.max(Math.abs(r.lo), Math.abs(r.hi))));
  const rows = d.rows.map((r) => {
    const tone = r.hi < 0 ? 'down' : r.lo > 0 ? 'up' : 'flat';
    if (r.kind === 'pct') {
      const lo = Math.min(Math.abs(r.lo), Math.abs(r.hi)), hi = Math.max(Math.abs(r.lo), Math.abs(r.hi));
      const chg = r.lo === r.hi ? `${signed(r.lo, 1)}%` : `${span(r.lo, r.hi).replace(' to ', '<small> to </small>')}%`;
      const ft = r.from != null && r.to != null ? `${r.from} \u2192 ${r.to} <small>${esc(r.unit)}</small>` : '';
      return `<div class="rv-frow rv-tone-${tone}"><div class="rv-flabel">${esc(r.label)}</div>${minimal ? '' : `<div class="rv-ffromto">${ft}</div>`}
        <div class="rv-fbar"><i class="a" style="width:${(lo / maxMag) * 100}%"></i><i class="b" style="width:${((hi - lo) / maxMag) * 100}%"></i></div>
        <div class="rv-fchg">${minimal ? (tone === 'down' ? 'LOWER' : tone === 'up' ? 'HIGHER' : 'SIMILAR') : chg}${!minimal && r.approximate ? '<small> approx.</small>' : ''}</div></div>`;
    }
    return `<div class="rv-frow rv-frow-pts rv-tone-${tone}"><div class="rv-flabel">${esc(r.label)}</div>
      <div class="rv-ffromto">${f1(r.from)}% \u2192 ${f1(r.to)}%</div><div class="rv-fbar rv-fbar-none"></div><div class="rv-fchg">${signed(r.lo, 1)} <small>pts</small></div></div>`;
  }).join('');
  const co = d.corroboration ? `<div class="rv-note"><p class="lbl">Corroboration <span class="rv-chip rv-st-${d.corroboration.status === 'CORROBORATED' ? 'complete' : d.corroboration.status === 'CONFLICTING' ? 'ambiguous' : 'partial'}">${esc(d.corroboration.status)}</span></p><p>${esc(d.corroboration.detail)}</p></div>` : '';
  const rem = d.remainder ? `<p class="muted small">Everything else (sideways, upward, drag): ${f1(d.remainder.from)}% \u2192 ${f1(d.remainder.to)}% (derived as the remainder).</p>` : '';
  const kindNote = isCoach ? `<p class="muted small">${chip('coach', d.kind)} ${d.kind === 'ENDPOINT_CHANGE' ? 'Two laps compared (' + esc(d.laps) + '). Not a trend across the swim.' : ''}</p>` : '';
  return `<section class="pg rv-sec" data-sec="COMPARISON">${head(sec, d.eyebrow, isCoach, d.headline)}
    <p class="rv-finding">${esc(d.finding)}</p><div class="rv-frows">${rows}</div>
    <div class="rv-means"><p class="lbl">What this means</p><p class="rv-big">${esc(d.interpretation)}</p></div>
    ${d.refNote ? `<p class="muted small">${esc(d.refNote)}</p>` : ''}${kindNote}${rem}${co}
  </section>`;
}

const GLYPH = {
  SINGLE_PEAK: '<path d="M2,52 C20,52 28,8 45,8 C62,8 70,52 88,52" />',
  MULTI_PEAK: '<path d="M2,52 C12,52 18,16 28,16 C36,16 36,34 44,32 C52,30 54,8 64,8 C74,8 78,52 88,52" />',
  SHOULDER: '<path d="M2,52 C16,52 22,12 36,12 C50,12 50,30 62,30 C74,30 78,52 90,52" />',
};
function armCol(side, d, doubles, isCoach) {
  const g = isCoach && d.shape && GLYPH[d.shape] ? `<figure class="rv-glyph"><svg viewBox="0 0 92 60" aria-hidden="true">${GLYPH[d.shape]}</svg><figcaption>${d.shape === 'MULTI_PEAK' ? 'Multiple peaks' : d.shape === 'SINGLE_PEAK' ? 'Single peak' : 'Shoulder'} <small>(illustration of the pattern type)</small></figcaption></figure>` : '';
  const dp = isCoach && doubles && doubles.length ? `<div class="rv-dp"><p class="lbl">Double peaks by lap, % of strokes</p><div class="rv-dpbars">${doubles.map((v, i) => `<span title="Lap ${i + 1}: ${f1(v)}%"><i style="height:${Math.max(2, (v / 50) * 100)}%"></i><em>${i + 1}</em></span>`).join('')}</div></div>` : '';
  const tm = d.timing && d.timing.length ? `<ul class="rv-timing">${d.timing.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '';
  return `<article class="rv-arm rv-arm-${side}"><h3>${side === 'left' ? 'LEFT' : 'RIGHT'}</h3>${g}<ul>${d.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>${tm}${dp}${isCoach && d.coachOnly.length ? `<ul class="rv-coachonly">${d.coachOnly.map((p) => `<li>${chip('coach', 'Coach only')} ${esc(p)}</li>`).join('')}</ul>` : ''}</article>`;
}
function phaseBars(ph) {
  const bar = (x, label) => `<div class="rv-pbar"><span class="rv-plabel">${esc(label)}</span><div class="rv-pseg"><i class="g" style="width:${x.glide}%">${ph.showNumbers ? x.glide : ''}</i><i class="p" style="width:${x.pull}%">${ph.showNumbers ? x.pull : ''}</i><i class="r" style="width:${x.recovery}%">${ph.showNumbers ? x.recovery : ''}</i></div></div>`;
  const side = (k, name) => `<div class="rv-pside rv-pside-${k}"><p class="lbl">${name}</p>${ph[k].map((x) => bar(x, 'LAP ' + x.lap)).join('')}</div>`;
  return `<div class="rv-phases"><p class="lbl">Stroke timing, lap averages (glide / pull / recovery, % of the stroke)</p><div class="rv-pgrid">${side('left', 'LEFT')}${side('right', 'RIGHT')}</div></div>`;
}
function arms(sec, m, isCoach) {
  const d = sec.data;
  return `<section class="pg rv-sec" data-sec="ARMS">${head(sec, 'Left and right', isCoach, d.headline)}
    ${d.lapLeads && d.lapLeads.length ? `<div class="rv-lapleads"><p class="lbl">Stronger arm, lap by lap</p><div>${d.lapLeads.map((x) => `<span class="rv-lapchip rv-lap-${x.higher.toLowerCase()}"><small>LAP ${x.lap}</small><strong>${x.higher === 'LEFT' ? 'LEFT' : 'RIGHT'}</strong></span>`).join('')}</div></div>` : ''}
    ${d.lr && !isCoach ? `<div class="rv-lr"><p class="lbl">Average power, whole swim</p>${d.lr.simple ? `<p class="rv-big">${d.lr.higher === 'LEFT' ? 'Your left hand' : 'Your right hand'} does a bit more of the work.</p>` : `<div class="rv-lrnums"><div class="rv-lrcell rv-lrcell-left${d.lr.higher === 'LEFT' ? ' lead' : ''}"><small>LEFT</small><strong>${f0(d.lr.left)}<span>W</span></strong></div><div class="rv-lrcell rv-lrcell-right${d.lr.higher === 'RIGHT' ? ' lead' : ''}"><small>RIGHT</small><strong>${f0(d.lr.right)}<span>W</span></strong></div></div><p class="muted small">${d.lr.higher === 'LEFT' ? 'Left' : 'Right'} is ${f0(d.lr.gapW)} W higher over the swim.</p>`}</div>` : ''}
    ${!isCoach && ((d.lapLeads && d.lapLeads.length) || d.lr) ? '' : `<div class="rv-armgrid">${armCol('left', d.left, d.doublePeaks.left, isCoach)}${armCol('right', d.right, d.doublePeaks.right, isCoach)}</div>`}
    ${d.phases ? phaseBars(d.phases) : ''}
    <div class="rv-means"><p class="lbl">Coaching opportunity</p><p class="rv-big">${esc(d.opportunity)}</p></div>
  </section>`;
}

function focus(sec, m, isCoach) {
  const d = sec.data;
  const cards = d.priorities.map((p, i) => `<article class="rv-prio${p.included ? '' : ' rv-prio-off'}">
      <span class="rv-prionum">${p.included ? (d.priorities.filter((x) => x.included).indexOf(p) + 1) : '–'}</span>
      <h3>${esc(p.title.toUpperCase())}</h3>
      <p class="rv-why">${esc(p.why)}</p>
      ${p.feel ? `<p class="lbl">Feel</p><p class="rv-feel">${esc(p.feel)}</p>` : ''}
      ${p.cue ? `<blockquote class="cue cue-sm"><span class="lbl">Cue</span>“${esc(p.cue)}”</blockquote>` : ''}
      ${p.drill ? `<div class="rv-drill"><p class="lbl">Optional drill${isCoach ? ' (draft, coach selects)' : ''}</p><strong>${esc(p.drill.name)}</strong><p>${esc(p.drill.what)}</p><p class="muted small">${esc(p.drill.why)}</p></div>` : ''}
      ${isCoach ? `<div class="rv-evrow">${chip('class-' + p.classification.toLowerCase(), CLASS_LABEL[p.classification])}${chip('conf-' + p.confidence.toLowerCase(), p.confidence)}${p.suppressed ? chip('st-ambiguous', 'Suppressed') : p.included ? chip('st-complete', 'In swimmer report') : chip('coach', p.coachOnlyReason || 'Not in swimmer report')}</div>
        <ul class="rv-refs">${p.evidence.map((e) => `<li><code>${esc(e.ref)}</code> ${esc(e.text)} ${e.status ? `<small>${esc(e.status)}</small>` : ''}</li>`).join('')}</ul>` : ''}
    </article>`).join('');
  return `<section class="pg rv-sec rv-focus-join" data-sec="FOCUS">${head(sec, 'What to change', isCoach, d.headline)}<div class="rv-prios">${cards}</div></section>`;
}

function next(sec, m, isCoach) {
  const d = sec.data;
  return `<section class="pg rv-sec" data-sec="NEXT">${head(sec, 'Retest', isCoach, d.headline)}
    ${d.baseline.length ? `<p class="lbl">Your baseline${d.baselineDate ? ` (${esc(d.baselineDate)})` : ''}</p><div class="rv-tiles rv-tiles-base">${d.baseline.map((b) => `<div class="rv-tile"><span class="lbl">${esc(b.label)}</span><strong>${esc(b.value)}<small>${esc(b.unit)}</small></strong></div>`).join('')}</div>` : ''}
    ${d.remeasure.length ? `<div class="rv-means"><p class="lbl">What we will re-measure</p><ul class="rv-remeasure">${d.remeasure.map((r) => `<li><span>${esc(r.label)}</span><strong>${esc(r.current)}${r.target ? ` <em>\u2192 ${esc(r.target)}</em>` : ''}</strong></li>`).join('')}</ul></div>` : ''}
    ${d.retest ? `<div class="rv-retest"><p class="lbl">Your retest</p><p class="rv-big">In about ${d.retest.weeks} weeks${d.retest.date ? `, around <strong>${esc(d.retest.date)}</strong>` : ''}. Same swim, same sensors, so we can see what changed.</p></div>` : ''}
    ${d.book ? '' : '<div class="cta">RETEST <i data-lucide="arrow-right"></i> MEASURE <i data-lucide="arrow-right"></i> SEE WHAT CHANGED</div>'}
    ${d.book ? `<a class="rv-book" href="${esc(d.book.url)}">${esc(d.book.label)}</a>` : ''}
  </section>`;
}

function evidence(sec, m) {
  return `<section class="pg rv-sec rv-coachsec" data-sec="EVIDENCE"><header class="rv-sechead"><p class="eyebrow">Coach view</p><h2 class="rv-h2">EVIDENCE AND CLASSIFICATION</h2></header>
  ${sec.data.findings.map((f) => `<article class="rv-finding-card">
    <header><h3>${esc(f.title)}</h3><div>${chip('class-' + f.classification.toLowerCase(), CLASS_LABEL[f.classification])} ${chip('conf-' + f.confidence.toLowerCase(), f.confidence)} ${chip('coach', f.kind)} ${f.review.status === 'SUPPRESSED' ? chip('st-ambiguous', 'Suppressed') : ''}</div></header>
    ${f.measurement.length ? `<p class="lbl">Measurement</p><ul>${f.measurement.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${f.observation ? `<p class="lbl">Observation</p><p>${esc(f.observation)}</p>` : ''}
    ${f.interpretation ? `<p class="lbl">Interpretation ${chip('class-' + f.interpretation.classification.toLowerCase(), CLASS_LABEL[f.interpretation.classification])}</p><p>${esc(f.interpretation.text)}</p>` : ''}
    ${f.recommendation ? `<p class="lbl">Recommendation</p><p>${esc(f.recommendation)}</p>` : ''}
    ${f.coachConfirmation.required ? `<div class="rv-flag"><strong>Coach confirmation required.</strong> ${esc(f.coachConfirmation.reason || '')}${f.coachConfirmation.evidenceNeeded && f.coachConfirmation.evidenceNeeded.length ? `<ul>${f.coachConfirmation.evidenceNeeded.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>` : ''}
    ${f.corroboration ? `<p class="lbl">Corroboration: ${esc(f.corroboration.status)}</p><p class="small">${esc(f.corroboration.detail)}</p>` : ''}
    ${f.caveats.length ? `<p class="lbl">Caveats</p><ul>${f.caveats.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <p class="lbl">Relationship</p><p class="small">${esc(f.relationships.join('; ') || 'none')}</p>
    <p class="lbl">Evidence</p><ul class="rv-refs">${f.resolved.map((e) => `<li><code>${esc(e.ref)}</code> ${esc(e.text)} ${e.status ? `<small>${esc(e.status)}${e.origin ? ' • ' + esc(e.origin) : ''}</small>` : ''}</li>`).join('')}</ul>
    <p class="muted small">Score ${f.score} = classification x confidence x impact ${f.impact}. Used only to order priorities.</p>
  </article>`).join('')}</section>`;
}

function quality(sec) {
  const q = sec.data;
  return `<section class="pg rv-sec rv-coachsec" data-sec="DATA_QUALITY"><header class="rv-sechead"><p class="eyebrow">Coach view</p><h2 class="rv-h2">DATA QUALITY</h2></header>
    <div class="rv-qgrid">${Object.keys(q.sections).map((k) => `<div class="rv-q"><span>${esc(k)}</span>${statusChip(q.sections[k])}</div>`).join('')}</div>
    <p class="lbl">Field counts</p><p>${Object.keys(q.counts).map((k) => `${esc(k)} ${q.counts[k]}`).join(' • ')}</p>
    ${q.conflicts.length ? `<p class="lbl">Source conflicts: several printed values for one quantity</p>${q.conflicts.map((c) => `<div class="rv-flag"><strong><code>${esc(c.path)}</code></strong> ${chip(c.realConflict ? 'st-ambiguous' : 'st-partial', c.realConflict ? 'Values disagree' : 'Precision variants')}<ul>${c.values.map((v) => `<li>${esc(v.value)}${esc(c.unit)} <small>${esc(v.location)}${v.used ? ' \u2022 USED' : ''}</small></li>`).join('')}</ul><p class="small">${c.selectionBasis ? 'Selection basis: ' + esc(c.selectionBasis) + '. ' : '<strong>No selection basis recorded.</strong> '}This is a source-selection decision, not established ground truth.</p></div>`).join('')}` : ''}
    <p class="lbl">Issues the coach should know about</p>
    <ul class="rv-issues">${q.issues.map((i) => `<li class="rv-issue-${i.severity.toLowerCase()}">${chip(i.severity === 'WARN' ? 'st-ambiguous' : 'coach', i.severity)} ${i.kind ? chip('coach', i.kind) : ''} ${esc(i.message)} <small>${esc(i.origin)}</small></li>`).join('') || '<li>None</li>'}</ul>
    <p class="lbl">Fields not COMPLETE</p><ul class="rv-refs">${q.fieldStatuses.map((f) => `<li><code>${esc(f.path)}</code> <small>${esc(f.status)}</small></li>`).join('')}</ul>
  </section>`;
}

function source(sec) {
  const d = sec.data, by = (t) => d.observations.filter((o) => o.claimType === t);
  const list = (arr, cls) => arr.map((o) => `<li>${chip(cls, o.claimType === 'DIAGNOSTIC_INTERPRETATION' ? 'EO inference, not adopted' : o.claimType === 'MEASUREMENT_STATEMENT' ? 'EO statement' : 'EO recommendation')} ${esc(o.text)} <small>${esc(o.provenance.location || '')}</small></li>`).join('');
  return `<section class="pg rv-sec rv-coachsec" data-sec="SOURCE"><header class="rv-sechead"><p class="eyebrow">Coach view</p><h2 class="rv-h2">EO SOURCE, PRESERVED</h2></header>
    <p class="muted small">Source: ${esc(d.source.provider)} ${esc(d.source.product)}, ${esc(d.source.format)}${d.source.filename ? ', ' + esc(d.source.filename) : ''}. Kept exactly as printed; Aqua Sharks findings are separate.</p>
    <p class="lbl">EO measurement statements</p><ul class="rv-obs">${list(by('MEASUREMENT_STATEMENT'), 'coach')}</ul>
    <p class="lbl">EO diagnostic claims (kept, never shown to a swimmer unreviewed)</p><ul class="rv-obs">${list(by('DIAGNOSTIC_INTERPRETATION'), 'st-ambiguous')}</ul>
    <p class="lbl">EO recommendations</p><ul class="rv-obs">${d.recommendations.map((r) => `<li>${chip(r.audience === 'COACH_ONLY' ? 'st-ambiguous' : 'coach', r.audience === 'COACH_ONLY' ? 'Coach only' : 'Swimmer')}${r.truncated ? chip('st-partial', 'Truncated in source') : ''} ${esc(r.text)} <small>${esc(r.provenance.location || '')}</small></li>`).join('')}</ul>
    ${Object.keys(d.reference).length ? `<p class="lbl">EO reference ranges (EO's, not adopted as Aqua Sharks thresholds)</p><div class="rv-qgrid">${Object.keys(d.reference).map((k) => `<div class="rv-q"><span>${esc(k)}</span><strong>${esc(d.reference[k].text)}</strong></div>`).join('')}</div>` : ''}
  </section>`;
}

const RENDER = { HERO: hero, NOTE: noteSec, STRENGTHS: strengths, PROGRESS: progress, PLAN: plan, POWER: power, COMPARISON: comparison, ARMS: arms, FOCUS: focus, NEXT: next, EVIDENCE: evidence, DATA_QUALITY: quality, SOURCE: source };

/** @param {import('./types').ReportModel} model */
export function renderReport(model) {
  const isCoach = model.profile.id === 'COACH';
  const omitted = [];
  const html = model.sections.map((s) => {
    if (s.status === 'MISSING' && !['EVIDENCE', 'DATA_QUALITY', 'SOURCE'].includes(s.id)) { omitted.push(s.id); return ''; }
    return RENDER[s.id](s, model, isCoach);
  }).join('');
  const note = isCoach && omitted.length ? `<p class="rv-omitted">Sections omitted for lack of evidence: ${omitted.map(esc).join(', ')}.</p>` : '';
  return `<main class="report rv rv-profile-${model.profile.id.toLowerCase()}">${html}${note}<p class="footer">Aqua Sharks Lab • Measurements by EO Labs SwimBETTER • Interpretation by Aqua Sharks</p></main>`.replace(/\u2192/g, ARR);
}
