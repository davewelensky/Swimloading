// Turns the extractor's output into the crossings backfill — writing BOTH
// the migration file (the reviewable record) and, with --apply, the update
// itself from that same source. One source, so the file and the database
// can never disagree.
//
//   node scripts/backfill-crossings.mjs              # write the .sql only
//   node scripts/backfill-crossings.mjs --apply      # ...and apply it
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const SKIP = new Set(['english-channel', 'strait-of-gibraltar']); // done / separate
const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
  january:1,february:2,march:3,april:4,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };

// "Jun – Oct" -> [6,10];  "February" -> [2,2].  Anything else -> nulls,
// because a season we cannot read is not a season we may guess.
function season(v) {
  if (!v) return [null, null];
  const m = [...String(v).toLowerCase().matchAll(/[a-z]+/g)].map(x => MONTHS[x[0]]).filter(Boolean);
  if (m.length >= 2) return [m[0], m[m.length - 1]];
  if (m.length === 1) return [m[0], m[0]];
  return [null, null];
}

// The Distance note is "A to B" on most pages. Split ONLY on a clean
// single " to ", and only when both halves look like places. Manhattan is
// a circumnavigation and North Channel's note talks about drift, so both
// correctly yield nothing rather than a mangled pair.
function startEnd(note) {
  if (!note) return [null, null];
  const first = note.split(/(?<=[a-z\)])\.\s/)[0];           // first sentence only
  const parts = first.split(/\s+to\s+/i);
  if (parts.length !== 2) return [null, null];
  // "From Laau Point, Molokai" — the note's own preposition, not part of
  // the place name.
  const [a, b] = parts.map(s => s.trim().replace(/^from\s+/i, '').replace(/[.,;]$/, ''));
  if (!a || !b || a.length > 70 || b.length > 70) return [null, null];
  if (/^(the|straight-line|actual)\b/i.test(a)) return [null, null];
  return [a, b];
}

const data = JSON.parse(readFileSync('/tmp/cc.json', 'utf8')).filter(r => !SKIP.has(r.slug) && !r.missing);
const q = (s) => s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`;
const jq = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

const rows = [], statements = [], notes = [];
for (const r of data) {
  const kf = r.keyFacts || {};
  const [s1, s2] = season(kf['Swim Season']?.val);
  const [start, end] = startEnd(kf['Distance']?.note);
  // Only where the page says so, in its own words.
  const oceansSeven = /oceans seven/i.test(JSON.stringify(kf)) || /oceans seven/i.test((r.about || []).join(' ')) ? true : null;
  let gov = kf['Governing Body']?.val || null;
  // "North Channel" as a governing body is the label bleeding into the
  // value — the note names the Infinity Channel Association. Refuse it
  // rather than store a body that does not exist.
  if (gov && r.slug.startsWith(gov.toLowerCase().replace(/\s+/g, '-'))) { notes.push(`${r.slug}: governing_body "${gov}" looks like the crossing name, left NULL`); gov = null; }

  const set = {
    hazards: jq(r.hazards), conditions: jq(r.conditions),
    about_md: q((r.about || []).join('\n\n')), preparation: jq(r.preparation), faqs: jq(r.faqs),
    duration_text: q(kf['Average Finish Time']?.val || null),
    governing_body: q(gov),
    season_start_month: s1 ?? 'NULL', season_end_month: s2 ?? 'NULL',
    start_location: q(start), end_location: q(end),
    oceans_seven: oceansSeven === null ? 'NULL' : 'true',
  };
  statements.push(`UPDATE public.crossings SET\n${Object.entries(set).map(([k, v]) => `  ${k} = ${v}`).join(',\n')},\n  updated_at = now()\nWHERE slug = '${r.slug}';`);
  rows.push({ slug: r.slug, start, end, season: `${s1 ?? '-'}–${s2 ?? '-'}`, dur: kf['Average Finish Time']?.val || '-', gov: gov || '-', o7: oceansSeven ? 'yes' : '-',
              n: `${r.hazards.length}/${r.conditions.length}/${r.about.length}/${r.preparation.length}/${r.faqs.length}` });
}

writeFileSync('/tmp/nine.sql', statements.join('\n\n') + '\n');
console.log('slug'.padEnd(20), 'h/c/a/p/f'.padEnd(11), 'season'.padEnd(7), 'dur'.padEnd(15), 'gov'.padEnd(8), 'O7', ' start → end');
for (const r of rows) console.log(r.slug.padEnd(20), r.n.padEnd(11), r.season.padEnd(7), r.dur.padEnd(15), r.gov.padEnd(8), r.o7.padEnd(3), (r.start ? `${r.start} → ${r.end}` : '(none — not an A→B route)').slice(0, 72));
notes.forEach(n => console.log('  ! ' + n));

if (process.argv.includes('--apply')) {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  for (const r of data) {
    const kf = r.keyFacts || {};
    const [s1, s2] = season(kf['Swim Season']?.val);
    const [start, end] = startEnd(kf['Distance']?.note);
    let gov = kf['Governing Body']?.val || null;
    if (gov && r.slug.startsWith(gov.toLowerCase().replace(/\s+/g, '-'))) gov = null;
    const o7 = /oceans seven/i.test(JSON.stringify(kf)) || /oceans seven/i.test((r.about || []).join(' ')) ? true : null;
    const { error } = await db.from('crossings').update({
      hazards: r.hazards, conditions: r.conditions, about_md: (r.about || []).join('\n\n'),
      preparation: r.preparation, faqs: r.faqs,
      duration_text: kf['Average Finish Time']?.val || null, governing_body: gov,
      season_start_month: s1, season_end_month: s2,
      start_location: start, end_location: end, oceans_seven: o7,
      updated_at: new Date().toISOString(),
    }).eq('slug', r.slug);
    if (error) { console.error(`FAILED ${r.slug}: ${error.message}`); process.exitCode = 1; continue; }
    // .update() on a slug with no row is a silent no-op, which would look
    // exactly like success. /crossings/jersey-to-france is routed but has
    // never had a row, so check rather than assume.
    const { count } = await db.from('crossings').select('slug', { count: 'exact', head: true })
      .eq('slug', r.slug).not('hazards', 'is', null);
    console.log(count ? `applied  ${r.slug}` : `NO ROW   ${r.slug} — nothing was written`);
  }
}
