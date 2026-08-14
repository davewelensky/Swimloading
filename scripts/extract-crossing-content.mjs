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
function blocks(h) {
  if (!h) return [];
  const parts = h.match(/<(?:p|li)\b[^>]*>[\s\S]*?<\/(?:p|li)>/gi) || [];
  return parts.map(strip).filter(t => t.length > 40);
}

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
  report.push({
    slug,
    pageTitle: strip(title),
    hazards:     blocks(underH3(html, /hazard/i)),
    conditions:  blocks(underH3(html, /conditions overview/i)),
    about:       blocks(find(secs, /about the crossing/i)?.html),
    preparation: blocks(find(secs, /training benchmark|preparation/i)?.html),
    faqs,
    keyFacts: keyFacts(html),
  });
}

const n = (a) => (a || []).length;
console.log('slug'.padEnd(22), 'haz cond about prep faq  title');
for (const r of report) {
  if (r.missing) { console.log(r.slug.padEnd(22), 'FILE NOT FOUND'); continue; }
  console.log(
    r.slug.padEnd(22),
    String(n(r.hazards)).padStart(3), String(n(r.conditions)).padStart(4),
    String(n(r.about)).padStart(5), String(n(r.preparation)).padStart(4),
    String(n(r.faqs)).padStart(4), ' ', (r.pageTitle || '').slice(0, 48)
  );
}
const i = process.argv.indexOf('--json');
if (i !== -1 && process.argv[i+1]) { writeFileSync(process.argv[i+1], JSON.stringify(report, null, 2)); console.log(`\nwritten ${process.argv[i+1]}`); }
