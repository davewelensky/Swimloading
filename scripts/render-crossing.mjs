// Renders a crossing through the shared template (api/crossings-handler.js)
// to a FILE, and diffs it against the live hand-written page. This is the
// increment-3 gate: Dave reviews the diff BEFORE any route is switched.
//
//   node scripts/render-crossing.mjs strait-of-gibraltar out.html [heads.json]
//
// heads.json (the extractor's --json output) is optional: until the
// 2026-08-14_crossing-page-heads migration is applied, the head/chrome
// columns do not exist in the database yet, so this overlays them from the
// extraction — the SAME source the migration was generated from, so the
// preview shows exactly what the post-migration render will show.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { renderCrossingPage } from '../api/crossings-handler.js';

const [slug, out, headsPath] = process.argv.slice(2);
if (!slug || !out) { console.error('usage: node scripts/render-crossing.mjs <slug> <out.html> [heads.json]'); process.exit(1); }

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';

const res = await fetch(`${SUPABASE_URL}/rest/v1/crossings?slug=eq.${slug}&select=*&limit=1`,
  { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } });
if (!res.ok) { console.error(`db fetch failed: ${res.status}`); process.exit(1); }
const crossing = (await res.json())[0];
if (!crossing) { console.error(`no crossings row for '${slug}'`); process.exit(1); }

if (headsPath) {
  const r = JSON.parse(readFileSync(headsPath, 'utf8')).find(x => x.slug === slug);
  if (!r) { console.error(`no extraction for '${slug}' in ${headsPath}`); process.exit(1); }
  // Mirrors shape() in backfill-crossing-heads.mjs.
  Object.assign(crossing, {
    intro: r.intro, seo_description: r.seoDescription,
    key_facts: Object.entries(r.keyFacts || {}).map(([label, f]) => ({ label, val: f.val, note: f.note || '' })),
    prep_benchmarks: r.prepBenchmarks || [], preparation: r.prepProse || [],
    page_copy: {
      eyebrow: r.eyebrow, difficulty_label: r.difficultyLabel,
      challenge_title: r.challengeTitle, benchmarks_label: r.benchmarksLabel,
      readiness_title: r.readinessTitle, readiness_blurb: r.readinessBlurb,
      cta_title: r.ctaTitle, cta_blurb: r.ctaBlurb,
    },
    faqs: r.faqs?.length ? r.faqs : crossing.faqs,
  });
}

const html = renderCrossingPage(crossing);
writeFileSync(out, html);
console.log(`rendered ${out} (${html.length} bytes)`);

// Word-parity against the live page, same method as crossing-parity.mjs:
// what does the page say that the render does not, and vice versa.
const liveFile = `${slug}.html`;
if (existsSync(liveFile)) {
  const words = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9°]+/g, ' ').split(' ').filter(w => w.length > 3));
  const text = (h) => h.replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;|&#\d+;/gi, ' ').replace(/\s+/g, ' ');
  const pw = words(text(readFileSync(liveFile, 'utf8')));
  const rw = words(text(html));
  const lost = [...pw].filter(w => !rw.has(w));
  const added = [...rw].filter(w => !pw.has(w));
  const pct = Math.round(100 * (pw.size - lost.length) / pw.size);
  console.log(`\nlive page words: ${pw.size}   rendered: ${rw.size}   covered: ${pct}%`);
  console.log(`lost (${lost.length}):  ${lost.join(' ') || '—'}`);
  console.log(`added (${added.length}): ${added.join(' ') || '—'}`);
}
