// Reads the hand-written /crossings/*.html pages and pulls their content
// into the shape the `crossings` table can hold.
//
// WHY THIS EXISTS. Eleven crossing pages were written by hand and one of
// them — Gibraltar — earns 194 of the site's 447 organic clicks. The table
// behind them knows only a distance and a temperature range, so rendering
// those pages FROM the table today would replace a 1,900-word page with
// three facts. This moves the content into the database first, so the
// template can be proved to match before anything is switched over.
//
// It never invents: every value it emits is lifted verbatim from the page.
//   node scripts/extract-crossing-content.mjs            # report
//   node scripts/extract-crossing-content.mjs --json out.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SLUGS = ['catalina-channel','cook-strait','english-channel','false-bay','jersey-to-france',
  'manhattan-island','molokai-channel','north-channel','rottnest-channel','strait-of-gibraltar','tsugaru-strait'];

const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g,' ')
  .replace(/&amp;/g,'&').replace(/&#39;|&rsquo;/g,"'").replace(/&quot;/g,'"')
  .replace(/&mdash;/g,'—').replace(/&ndash;/g,'–').replace(/&deg;/g,'°')
  .replace(/&[a-z]+;/g,' ').replace(/\s+/g,' ').trim();

// Sections are marked by `<div class="section-title">Label</div>`, NOT by
// headings — an earlier version keyed on h1-h4 and found zero "About the
// crossing" and zero FAQ blocks on every page, because those labels are
// section-titles. The h3s that DO exist ("Primary Hazards") sit INSIDE a
// section, so heading-based splitting also ran one section into the next.
function sections(html) {
  const body = html.replace(/<(script|style|svg|nav|footer)\b[\s\S]*?<\/\1>/gi, ' ');
  const out = [];
  const re = /<div class="section-title"[^>]*>([\s\S]*?)<\/div>/gi;
  let m, last = null;
  while ((m = re.exec(body))) {
    if (last) last.html = body.slice(last.end, m.index);
    last = { title: strip(m[1]), end: re.lastIndex };
    out.push(last);
  }
  if (last) last.html = body.slice(last.end);
  return out;
}

// Paragraph-ish blocks under a heading, as separate strings.
// `tags` narrows to one element kind — the Preparation section holds BOTH
// benchmark <li>s and prose <p>s, and a template must know which is which
// to rebuild the green checklist box separately from the prose card.
function blocks(h, tags = 'p|li') {
  if (!h) return [];
  const re = new RegExp(`<(?:${tags})\\b[^>]*>[\\s\\S]*?<\\/(?:${tags})>`, 'gi');
  const parts = h.match(re) || [];
  return parts.map(strip).filter(t => t.length > 40);
}

// First capture group of a match, stripped; '' when absent.
const grab = (html, re) => { const m = html.match(re); return m ? strip(m[1]) : ''; };

// "Primary Hazards" and "Conditions Overview" are h3s INSIDE the
// "What Makes It Challenging" section, so they are found by heading while
// the top-level sections are found by section-title. Two different
// mechanisms because the page genuinely uses two.
function underH3(html, re) {
  const m = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3|<div class="section-title"|$)/gi)]
    .find(x => re.test(strip(x[1])));
  return m ? m[2] : null;
}

// Key Facts are clean label/value/note triples in the markup, so they are
// read structurally rather than out of prose.
function keyFacts(html) {
  const out = {};
  const re = /<div class="fact-label"[^>]*>([\s\S]*?)<\/div>\s*<div class="fact-val"[^>]*>([\s\S]*?)<\/div>(?:\s*<div class="fact-note"[^>]*>([\s\S]*?)<\/div>)?/gi;
  let m;
  while ((m = re.exec(html))) out[strip(m[1])] = { val: strip(m[2]), note: strip(m[3] || '') };
  return out;
}

const find = (secs, re) => secs.find(s => re.test(s.title));

const report = [];
for (const slug of SLUGS) {
  const file = `${slug}.html`;
  if (!existsSync(file)) { report.push({ slug, missing: true }); continue; }
  const html = readFileSync(file, 'utf8');
  const secs = sections(html);
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [,''])[1];

  const faqSec = find(secs, /frequently asked|faq/i);
  const faqs = [];
  if (faqSec) {
    // Q&A pairs are h3/h4 inside the FAQ block on these pages.
    const qa = [...faqSec.html.matchAll(/<div class="faq-q"[^>]*>([\s\S]*?)<\/div>\s*<div class="faq-a"[^>]*>([\s\S]*?)<\/div>/gi)];
    for (const [, q, a] of qa) {
      const question = strip(q), answer = strip(a);
      if (question && answer) faqs.push({ q: question, a: answer });
    }
  }
  // Head, hero and chrome copy. All of it is bespoke per page — meta
  // descriptions, eyebrows, difficulty labels and the readiness/CTA blurbs
  // were each written by hand, and the difficulty chip does NOT track the
  // difficulty column (Catalina is "extreme" in the table, "Very Hard" on
  // the page). Lifted verbatim so the template can reproduce them.
  const prepSec = find(secs, /training benchmark|preparation/i)?.html;
  const benchHtml = underH3(prepSec || '', /training benchmark/i);
  const readiness = html.match(/<div class="readiness-section">[\s\S]*?<h2>([\s\S]*?)<\/h2>\s*<p>([\s\S]*?)<\/p>/i);
  const cta = html.match(/<div class="bottom-cta">\s*<h2>([\s\S]*?)<\/h2>\s*<p>([\s\S]*?)<\/p>/i);

  report.push({
    slug,
    pageTitle: strip(title),
    seoDescription: grab(html, /name="description" content="([^"]*)"/i),
    intro:          grab(html, /<p class="hero-sub"[^>]*>([\s\S]*?)<\/p>/i),
    eyebrow:        grab(html, /class="hero-eyebrow"[^>]*>([\s\S]*?)<\/div>/i),
    difficultyLabel: grab(html, /class="stat-chip diff[^"]*"\s*>([^<]+)</i),
    challengeTitle:  strip(find(secs, /what makes it/i)?.title || ''),
    benchmarksLabel: grab(benchHtml === null ? '' : (prepSec || ''), /<h3[^>]*>([\s\S]*?)<\/h3>/i),
    readinessTitle:  readiness ? strip(readiness[1]) : '',
    readinessBlurb:  readiness ? strip(readiness[2]) : '',
    ctaTitle:        cta ? strip(cta[1]) : '',
    ctaBlurb:        cta ? strip(cta[2]) : '',
    hazards:     blocks(underH3(html, /hazard/i)),
    conditions:  blocks(underH3(html, /conditions overview/i)),
    about:       blocks(find(secs, /about the crossing/i)?.html),
    preparation: blocks(prepSec),
    prepBenchmarks: blocks(benchHtml, 'li'),
    prepProse:      blocks(prepSec, 'p'),
    faqs,
    keyFacts: keyFacts(html),
  });
}

const n = (a) => (a || []).length;
console.log('slug'.padEnd(22), 'haz cond about bench prose faq intro meta  chip / eyebrow');
for (const r of report) {
  if (r.missing) { console.log(r.slug.padEnd(22), 'FILE NOT FOUND'); continue; }
  console.log(
    r.slug.padEnd(22),
    String(n(r.hazards)).padStart(3), String(n(r.conditions)).padStart(4),
    String(n(r.about)).padStart(5), String(n(r.prepBenchmarks)).padStart(5),
    String(n(r.prepProse)).padStart(5), String(n(r.faqs)).padStart(3),
    String(r.intro.length).padStart(5), String(r.seoDescription.length).padStart(4),
    ' ', `${r.difficultyLabel} / ${r.eyebrow}`.slice(0, 44)
  );
}
const i = process.argv.indexOf('--json');
if (i !== -1 && process.argv[i+1]) { writeFileSync(process.argv[i+1], JSON.stringify(report, null, 2)); console.log(`\nwritten ${process.argv[i+1]}`); }
