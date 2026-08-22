// Find regular group swims hiding in our own temperature logs.
//
//   node scripts/detect-group-swims.mjs                  # last 365 days
//   node scripts/detect-group-swims.mjs --days 180
//   node scripts/detect-group-swims.mjs --min-people 4
//   node scripts/detect-group-swims.mjs --include-pools  # squad sessions too
//   node scripts/detect-group-swims.mjs --json out.json
//
// A group that swims together every Sunday at nine leaves a fingerprint in the
// logs: same spot, same weekday, same hour, several people, week after week.
// This reads that fingerprint and prints a shortlist.
//
// IT WRITES NOTHING. There is no --write flag and there should not be. A
// cluster means several people swim at the same time; it does not mean the
// swim is public, welcomes strangers, or has a name. Only someone who was
// there can say that. The output is a list of questions to ask, and which
// swimmers to ask — which is the point: "is Glencairn Saturday 10am a group?"
// is answerable, "know any group swims?" is not.
//
// Recurring swims already in the catalogue are marked [known], because
// rediscovering them is the evidence the method works, not a result.

import { writeFileSync } from 'node:fs';
import { detectGroupSwims, witnessesFor } from '../api/_lib/group-swim-signal.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';
const HEADERS = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, Accept: 'application/json' };

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const DAYS = parseInt(arg('--days', '365'), 10);
const MIN_PEOPLE = parseInt(arg('--min-people', '3'), 10);
const INCLUDE_POOLS = args.includes('--include-pools');
const JSON_OUT = arg('--json', null);

async function fetchAll(path, pageSize = 1000) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}${sep}limit=${pageSize}&offset=${offset}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`REST ${res.status} for ${path}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}

const since = new Date(Date.now() - DAYS * 86400_000).toISOString().slice(0, 10);
console.log(`Reading temperature logs since ${since}…`);

const [rawSpots, logs, known] = await Promise.all([
  fetchAll('spots?active=eq.true&select=id,name,country_code,timezone,longitude,water_type'),
  fetchAll(`temp_logs?created_at=gte.${since}&select=spot_id,user_id,created_at&order=created_at.asc`),
  fetchAll('recurring_swims?is_public=eq.true&select=slug,name,spot_id,days_of_week,start_time'),
]);

const spots = new Map(
  rawSpots
    .filter((s) => INCLUDE_POOLS || s.water_type !== 'POOL')
    .map((s) => [s.id, s]),
);

const usable = logs.filter((l) => l.spot_id && l.user_id && spots.has(l.spot_id));
console.log(`  ${logs.length} logs, ${usable.length} at ${spots.size} eligible spots` +
            `${INCLUDE_POOLS ? '' : ' (pools excluded — pass --include-pools for squad sessions)'}\n`);

const candidates = detectGroupSwims(usable, spots, { minPeople: MIN_PEOPLE });

// A recurring swim we already hold at this spot, on this weekday, is a
// rediscovery rather than a find. Matching on the DAY only: the logged hour
// is when people report, which trails the swim itself — Hot Chocolate starts
// at 09:00 and shows up at 10:00.
const knownBySpot = new Map();
for (const k of known) {
  if (!k.spot_id) continue;
  if (!knownBySpot.has(k.spot_id)) knownBySpot.set(k.spot_id, []);
  knownBySpot.get(k.spot_id).push(k);
}
const matchKnown = (c) => (knownBySpot.get(c.spot_id) || []).find(
  (k) => !Array.isArray(k.days_of_week) || !k.days_of_week.length || k.days_of_week.includes(c.dow),
);

if (!candidates.length) {
  console.log('No slots cleared the thresholds. Try --days 730 or --min-people 2.');
  process.exit(0);
}

const rows = candidates.map((c) => {
  const hit = matchKnown(c);
  return { ...c, known: hit ? hit.name : null, witnesses: witnessesFor(c, usable, spots) };
});

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(pad('SPOT', 30), pad('WHEN', 16), pad('PEOPLE', 7), pad('WEEKS', 6), pad('SHARE', 7), 'NOTE');
console.log('-'.repeat(88));
for (const r of rows) {
  const when = `${r.weekday.slice(0, 3)} ${String(r.hour).padStart(2, '0')}:00${r.local_time_exact ? '' : '~'}`;
  const note = r.known ? `[known] ${r.known}` : `ask ${r.witnesses.length} swimmer${r.witnesses.length === 1 ? '' : 's'}`;
  console.log(pad(r.spot_name, 30), pad(when, 16), pad(r.people, 7), pad(r.weeks, 6),
              pad(`${Math.round(r.share * 100)}%`, 7), note);
}

const fresh = rows.filter((r) => !r.known);
console.log(`\n${rows.length} candidate${rows.length === 1 ? '' : 's'}, ` +
            `${rows.length - fresh.length} already in the catalogue, ${fresh.length} to ask about.`);
console.log('~ after a time means the hour is estimated from longitude — that spot has no timezone.');
console.log('\nNothing was written. Each of these is a question for someone who swam there,');
console.log('not a row: a cluster shows people swimming together, not a swim anyone can join.');

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ generated_at: new Date().toISOString(), since, rows }, null, 2));
  console.log(`\nWrote ${JSON_OUT}`);
}
