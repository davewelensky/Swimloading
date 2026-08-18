// Turn observation coverage gaps into spot_suggestions for admin review.
//
//   node scripts/propose-spots-from-gaps.mjs                  # dry run (default)
//   node scripts/propose-spots-from-gaps.mjs --limit 20
//   node scripts/propose-spots-from-gaps.mjs --sql out.sql    # emit SQL to apply
//   node scripts/propose-spots-from-gaps.mjs --write          # needs SUPABASE_SERVICE_KEY
//
// Reads the catalogue, finds usable temperature stations with no SwimLoading
// spot in range whose own metadata points at shore or bathing water, and
// files each as a PENDING suggestion. It creates no spots and publishes
// nothing: approval stays the human step that already exists.
//
// Idempotent by station (observation_station_id + a partial unique index),
// so running it twice adds nothing the second time.
//
// A note on volume. The review queue is only useful if a human can actually
// work through it, so this ranks and caps rather than filing every candidate
// it can justify. The full count is always reported.

import { writeFileSync } from 'node:fs';
import {
  classifyStation, rankCoverageGaps, swimRelevance,
} from '../api/_lib/observations/coverage.js';
import { buildGapSuggestions } from '../api/_lib/observations/gap-discovery.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';
const HEADERS = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, Accept: 'application/json' };

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 25;
const sqlIdx = args.indexOf('--sql');
const SQL_OUT = sqlIdx !== -1 ? args[sqlIdx + 1] : null;
const DO_WRITE = args.includes('--write');

async function fetchAll(path, pageSize = 1000, headers = HEADERS) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}${sep}limit=${pageSize}&offset=${offset}`, { headers });
    if (!res.ok) throw new Error(`REST ${res.status} for ${path}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}

const NOW = new Date();
console.log('Loading catalogue…');
// spot_suggestions is NOT anon-readable (RLS: users see only their own rows),
// so this read comes back empty without a service key. The real duplicate
// guarantee is the partial unique index on observation_station_id plus
// ON CONFLICT DO NOTHING — this lookup only makes the dry-run REPORT
// accurate. Being unable to see them is reported, never silently treated as
// "none exist".
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUGGESTION_HEADERS = SERVICE_KEY
  ? { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' }
  : HEADERS;

const [spotsRaw, stationsRaw, linksRaw, obsRaw, providers, existing] = await Promise.all([
  fetchAll('spots?active=eq.true&select=id,name,water_type,latitude,longitude,country_code'),
  fetchAll('observation_stations?select=id,external_id,name,latitude,longitude,station_type,water_body,sensor_depth_m,temperature_available,active,metadata,last_observation_at,provider_id'),
  fetchAll('spot_observation_stations?select=spot_id,station_id,status,is_primary'),
  fetchAll('observations?water_temperature_c=not.is.null&select=station_id,observed_at,water_temperature_c&order=observed_at.desc'),
  fetchAll('observation_providers?select=id,code'),
  fetchAll('spot_suggestions?observation_station_id=not.is.null&select=observation_station_id', 1000, SUGGESTION_HEADERS),
]);

const providerById = new Map(providers.map((p) => [p.id, p]));
const spots = spotsRaw.map((s) => ({ ...s, latitude: Number(s.latitude), longitude: Number(s.longitude) }));
const stationById = new Map(stationsRaw.map((s) => [s.id, s]));

const latestTemp = new Map();
for (const o of obsRaw) {
  if (!latestTemp.has(o.station_id)) {
    latestTemp.set(o.station_id, { at: new Date(o.observed_at), tempC: Number(o.water_temperature_c) });
  }
}

const stations = stationsRaw.map((s) => {
  const lt = latestTemp.get(s.id);
  return {
    id: s.id, externalId: s.external_id,
    providerCode: providerById.get(s.provider_id)?.code || 'unknown',
    name: s.name, latitude: Number(s.latitude), longitude: Number(s.longitude),
    stationType: s.station_type, waterBody: s.water_body,
    sensorDepthM: s.sensor_depth_m == null ? null : Number(s.sensor_depth_m),
    temperatureAvailable: s.temperature_available, active: s.active,
    metadata: s.metadata || {}, lastObservationAt: s.last_observation_at,
    latestTempAt: lt?.at || null, latestTempC: lt?.tempC ?? null,
  };
});

const linksByStation = new Map();
for (const l of linksRaw) {
  const ext = stationById.get(l.station_id)?.external_id;
  if (!ext) continue;
  if (!linksByStation.has(ext)) linksByStation.set(ext, []);
  linksByStation.get(ext).push(l);
}
const spotsWithApprovedPrimary = new Set(
  linksRaw.filter((l) => l.status === 'approved' && l.is_primary).map((l) => l.spot_id));

const classified = stations.map((station) => ({
  station, ...classifyStation(station, { spots, linksByStation, spotsWithApprovedPrimary }, { now: NOW }),
}));
const rankedGaps = rankCoverageGaps(classified);

const alreadySuggested = new Set(existing.map((e) => e.observation_station_id));
const { rows, skipped } = buildGapSuggestions(rankedGaps, alreadySuggested);

console.log(`\n${rankedGaps.length} coverage gaps · ${rows.length} qualify as swim-location candidates`);
console.log(`skipped: ${skipped.alreadySuggested} already suggested, ${skipped.noSwimSignal} no swim signal, `
  + `${skipped.tooCloseToSpot} too close to an existing spot, ${skipped.unusable} unusable`);

if (!SERVICE_KEY) {
  // Without this warning "0 already suggested" reads as "the queue is empty",
  // when it actually means "this script cannot see the queue".
  console.log('\n  NOTE: SUPABASE_SERVICE_KEY is not set, and spot_suggestions is not readable');
  console.log('  with the anon key (RLS). The "already suggested" count above is therefore');
  console.log('  NOT trustworthy — duplicates are prevented by the unique index on');
  console.log('  observation_station_id, not by this check.');
}

const selected = rows.slice(0, LIMIT);
if (rows.length > LIMIT) {
  console.log(`\nFiling the top ${LIMIT} of ${rows.length} — a review queue longer than that stops getting reviewed.`);
  console.log(`Run with --limit ${rows.length} to file them all.`);
}

console.log('\nWould create:');
selected.forEach((r, i) => console.log(
  `  ${String(i + 1).padStart(2)}. ${r.spot_name}  (${r.latitude.toFixed(3)}, ${r.longitude.toFixed(3)})`));

function q(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

if (SQL_OUT) {
  const lines = selected.map((r) =>
    'INSERT INTO spot_suggestions (spot_name, water_type, region, description, latitude, longitude, '
    + 'admin_area, source, observation_station_id, status)\nVALUES ('
    + [r.spot_name, r.water_type, r.region, r.description, r.latitude, r.longitude,
      r.admin_area, r.source, r.observation_station_id, r.status].map(q).join(', ')
    + ')\nON CONFLICT (observation_station_id) WHERE observation_station_id IS NOT NULL DO NOTHING;');
  writeFileSync(SQL_OUT, lines.join('\n\n') + '\n');
  console.log(`\nSQL written to ${SQL_OUT} (${selected.length} statements)`);
}

if (DO_WRITE) {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) { console.error('\nSUPABASE_SERVICE_KEY not set — cannot --write.'); process.exit(1); }
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(SUPABASE_URL, serviceKey);
  const { error, count } = await sb.from('spot_suggestions')
    .upsert(selected, { onConflict: 'observation_station_id', ignoreDuplicates: true, count: 'exact' });
  if (error) { console.error('write failed:', error.message); process.exit(1); }
  console.log(`\nFiled ${count ?? selected.length} suggestions for review at /admin.`);
} else if (!SQL_OUT) {
  console.log('\nDry run — nothing written. Use --sql <file> or --write to file these.');
}
