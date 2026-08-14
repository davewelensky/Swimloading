// Can a template rendered from the database match the page it replaces?
//
// Asked BEFORE writing the template, because the answer decides whether
// increment 3 is a refactor or a rewrite. Compares the words on each live
// /crossings/*.html against the words now stored for that crossing, and
// reports what the page says that the database does not.
//
// Word-level, not byte-level: the template will phrase things differently.
// What matters is whether any CONTENT would be lost.
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const { data: rows } = await db.from('crossings')
  .select('slug,name,distance_km,typical_temp_min_c,typical_temp_max_c,difficulty,description,about_md,hazards,conditions,preparation,faqs,start_location,end_location,governing_body,duration_text,season_start_month,season_end_month');

const words = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9°]+/g, ' ').split(' ').filter(w => w.length > 3));
const pageText = (html) => {
  let t = html.replace(/<(script|style|svg|nav|footer)\b[\s\S]*?<\/\1>/gi, ' ');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');
  return t.replace(/&[a-z]+;|&#\d+;/gi, ' ').replace(/\s+/g, ' ');
};

console.log('slug'.padEnd(20), 'page'.padStart(5), 'stored'.padStart(7), 'covered'.padStart(8), '  missing sample');
for (const r of rows.sort((a, b) => a.slug.localeCompare(b.slug))) {
  const f = `${r.slug}.html`;
  if (!existsSync(f)) continue;
  const pw = words(pageText(readFileSync(f, 'utf8')));
  const stored = [r.name, r.description, r.about_md, r.start_location, r.end_location, r.governing_body,
    r.duration_text, r.difficulty, `${r.distance_km} km`, `${r.typical_temp_min_c} ${r.typical_temp_max_c}`,
    ...(r.hazards || []), ...(r.conditions || []), ...(r.preparation || []),
    ...(r.faqs || []).flatMap(x => [x.q, x.a])].join(' ');
  const sw = words(stored);
  const missing = [...pw].filter(w => !sw.has(w));
  const pct = pw.size ? Math.round(100 * (pw.size - missing.length) / pw.size) : 0;
  console.log(r.slug.padEnd(20), String(pw.size).padStart(5), String(sw.size).padStart(7),
    `${pct}%`.padStart(8), '  ' + missing.slice(0, 9).join(' '));
}
