#!/usr/bin/env node
/**
 * Give event venues coordinates, using OpenStreetMap's Nominatim.
 *
 * WHY THIS EXISTS
 * ---------------
 * 75 of 242 venues have no coordinates, and that is not cosmetic. The
 * search RPC filters `distance_km IS NOT NULL AND distance_km <= radius`,
 * so a venue without coordinates VANISHES from any radius search — and the
 * /explore map drives a radius search on every pan. On 2026-08-05 that hid
 * 13 of Australia's 15 events and all 5 of Poland's: listed in the
 * database, invisible on the page.
 *
 * WHAT A GEOCODED COORDINATE IS AND IS NOT
 * ----------------------------------------
 * "Coogee NSW" resolves to the suburb centroid. That is a fine map pin and
 * a WRONG start line, and the difference matters — a swimmer who navigates
 * to it will be on a street, not a beach. Every point written here is
 * stamped coordinates_source='geocoded' so it is never confused with one
 * copied from a SwimLoading spot or supplied by an organiser.
 *
 * REFUSING IS THE DEFAULT
 * -----------------------
 * A wrong coordinate is worse than no coordinate: it puts a swim on the
 * wrong beach, or the wrong continent, and looks authoritative doing it.
 * So a result is only accepted when
 *   - the geocoder's country matches the venue's country_code, and
 *   - the match is a place/water feature rather than a road or a shop, and
 *   - exactly one plausible candidate came back at that confidence.
 * Everything else is skipped and REPORTED, never guessed.
 *
 * POLITENESS
 * ----------
 * Nominatim's usage policy requires an identifying User-Agent and at most
 * one request per second. Both are enforced below and are not options.
 * This is someone else's free service.
 *
 * USAGE
 *   export SUPABASE_URL=... SUPABASE_SERVICE_KEY=...
 *   node scripts/geocode-venues.mjs --dry-run     # look, write nothing
 *   node scripts/geocode-venues.mjs               # write
 *   node scripts/geocode-venues.mjs --limit 5
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CONTACT = process.env.GEOCODE_CONTACT || 'https://www.swimloading.com';
const USER_AGENT = `SwimLoading/1.0 (venue geocoding; ${CONTACT})`;

const MIN_INTERVAL_MS = 1100; // Nominatim: max 1 req/sec. 1.1s for headroom.

// Feature classes worth a swim venue's pin. A 'highway' or 'shop' match
// means the geocoder found a street or a business with the same name, which
// is precisely the wrong-beach failure this script is meant to avoid.
const ACCEPTABLE_CLASSES = new Set(['place', 'natural', 'water', 'waterway', 'leisure', 'boundary', 'landuse']);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? parseInt(args[i + 1], 10) : null;
})();

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set. This script reads both from the environment and stores neither.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function db(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(method === 'PATCH' ? { Prefer: 'return=minimal' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// The query we send. Structured where possible — Nominatim resolves
// "Coogee, NSW, Australia" far better than a bare display name, and the
// country filter removes whole continents of ambiguity (there is a Newport
// in at least six countries).
function buildQuery(v) {
  const norm = (s) => String(s || '').trim();
  const city = norm(v.city);
  const region = norm(v.region);
  const loc = norm(v.location_text);
  const display = norm(v.display_name);

  // PREFER location_text WHOLE when it already contains the city. It is the
  // source's own phrasing — "Coogee, NSW, Australia" — and composing on top
  // of it produced "Coogee, NSW, Coogee, NSW, Australia", which Nominatim
  // resolved to Coogee OVAL, a cricket ground, instead of the suburb. The
  // earlier de-duplication only checked whether an existing part contained
  // the new one, never the reverse, so the longer string always slipped
  // past. A malformed query does not fail loudly; it quietly returns the
  // wrong place, which is the failure this whole script exists to avoid.
  if (loc && city && loc.toLowerCase().includes(city.toLowerCase())) return loc;
  if (loc && !city) return loc;

  const parts = [];
  for (const p of [city || display, region]) {
    if (!p) continue;
    const lower = p.toLowerCase();
    // Skip a part already implied by one we have (city "Coogee" then
    // display_name "Coogee NSW"), in EITHER direction.
    if (parts.some((c) => {
      const cl = c.toLowerCase();
      return cl === lower || cl.includes(lower) || lower.includes(cl);
    })) continue;
    parts.push(p);
  }
  return parts.join(', ');
}

async function geocode(query, countryCode) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  url.searchParams.set('addressdetails', '1');
  if (countryCode) url.searchParams.set('countrycodes', countryCode.toLowerCase());

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' } });
  if (res.status === 429) throw new Error('rate limited by Nominatim — slow down');
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

function pick(results, venue) {
  if (!Array.isArray(results) || results.length === 0) {
    return { ok: false, why: 'no results' };
  }
  const usable = results.filter((r) => {
    if (!ACCEPTABLE_CLASSES.has(r.category || r.class)) return false;
    // The country filter is applied in the request, but verify the response
    // too: a filter silently ignored would be invisible otherwise.
    const cc = r.address?.country_code?.toUpperCase();
    if (venue.country_code && cc && cc !== venue.country_code) return false;
    return true;
  });

  if (usable.length === 0) {
    const kinds = [...new Set(results.map((r) => r.category || r.class))].join(', ');
    return { ok: false, why: `no acceptable match (found: ${kinds || 'nothing'})` };
  }

  // RANK WATER ABOVE EVERYTHING ELSE, rather than taking Nominatim's own
  // ordering. It ranks by general importance, which for "Coogee NSW"
  // returned Coogee OVAL — a cricket ground — ahead of the beach. For an
  // open water swim the water feature is always the better answer, and a
  // sports ground several hundred metres inland is a plausible-looking
  // wrong pin, which is the worst kind.
  // ORDER BY NOMINATIM'S OWN IMPORTANCE. It is derived from Wikipedia
  // prominence and admin rank, and it is right far more often than a
  // hand-written preference: Sydney's Coogee scores 0.411, the farm called
  // Coogee near Balranald 0.107.
  //
  // An earlier version reordered by feature class, putting 'place' above
  // 'boundary'. Nominatim represents Sydney suburbs as boundary/
  // administrative and the rural namesakes as place/farm — so that version
  // actively preferred a farm 800 km inland for Coogee, and did the same to
  // Newport. Class is now used ONLY to exclude unusable types above; it
  // never reorders.
  //
  // Water features get a nudge only as a TIEBREAK between candidates of
  // near-equal importance, where "the beach" really is the better answer
  // than "the suburb".
  const isWater = (r) => {
    const cls = r.category || r.class;
    return cls === 'water' || cls === 'waterway' ||
      (cls === 'natural' && /beach|bay|water|reef|cape|strait/.test(r.type || ''));
  };
  usable.sort((a, b) => {
    const d = (b.importance ?? 0) - (a.importance ?? 0);
    if (Math.abs(d) > 0.05) return d;
    return (isWater(b) ? 1 : 0) - (isWater(a) ? 1 : 0);
  });

  // Refuse when the top two are far apart AND similarly important — that is
  // genuine ambiguity (two equally notable Newports), and picking one would
  // be a coin toss presented as a fact. A clear importance gap is not
  // ambiguity, it is the geocoder doing its job.
  const best = usable[0];
  const second = usable[1];
  if (second) {
    const dKm = haversine(+best.lat, +best.lon, +second.lat, +second.lon);
    const closeRank = Math.abs((best.importance ?? 0) - (second.importance ?? 0)) < 0.05;
    if (dKm > 50 && closeRank) {
      return { ok: false, why: `ambiguous — two similar matches ${Math.round(dKm)} km apart` };
    }
  }
  return { ok: true, lat: +best.lat, lon: +best.lon, matched: best.display_name };
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function main() {
  let venues = await db(
    'event_venues?latitude=is.null&select=id,display_name,city,region,country_code,location_text' +
    '&order=country_code.asc,display_name.asc'
  );
  if (LIMIT) venues = venues.slice(0, LIMIT);

  console.log(`${venues.length} venue(s) without coordinates.` + (DRY_RUN ? '  DRY RUN — nothing will be written.' : ''));
  console.log(`Nominatim, 1 request per ${MIN_INTERVAL_MS}ms — about ${Math.ceil((venues.length * MIN_INTERVAL_MS) / 1000)}s.\n`);

  let written = 0;
  const skipped = [];

  for (const [i, v] of venues.entries()) {
    const query = buildQuery(v);
    if (!query) {
      skipped.push([v.display_name, 'no usable place text']);
      continue;
    }

    let results;
    try {
      results = await geocode(query, v.country_code);
    } catch (err) {
      skipped.push([v.display_name, `lookup failed: ${err.message}`]);
      await sleep(MIN_INTERVAL_MS);
      continue;
    }

    const choice = pick(results, v);
    if (!choice.ok) {
      skipped.push([v.display_name, choice.why]);
    } else {
      console.log(`  [${i + 1}/${venues.length}] ${v.display_name} -> ${choice.lat.toFixed(4)}, ${choice.lon.toFixed(4)}`);
      console.log(`      matched: ${choice.matched}`);
      if (!DRY_RUN) {
        await db(`event_venues?id=eq.${v.id}`, {
          method: 'PATCH',
          body: {
            latitude: choice.lat,
            longitude: choice.lon,
            coordinates_source: 'geocoded',
            geocoded_at: new Date().toISOString(),
            geocode_matched_name: choice.matched,
          },
        });
      }
      written += 1;
    }
    await sleep(MIN_INTERVAL_MS);
  }

  console.log(`\n${written} venue(s) ${DRY_RUN ? 'would be' : ''} geocoded.`);
  if (skipped.length) {
    // Named individually, never counted. A silent skip is how a venue stays
    // invisible for months without anyone knowing which one.
    console.log(`\n${skipped.length} skipped — these keep NO coordinates rather than a guessed one:`);
    for (const [name, why] of skipped) console.log(`  - ${name}: ${why}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
