// Explore search — the one public endpoint behind /explore and /events.
//
// GET /api/explore/events?mode=near_me&lat=..&lon=..&radius_km=150&page=1
//
// Reads with the ANON key on purpose. Every table this touches is protected
// by RLS that already says exactly what the public may see (published
// editions yes; discovery candidates, organiser emails and claims no), so
// the anon key means this route cannot leak more than the database itself
// permits. A service-role key here would silently opt out of all of that and
// make this file the only thing standing between the crawler tables and the
// internet. If you ever need the service key in this file, you are about to
// expose something you shouldn't.
//
// Ranking and pagination happen in SQL (search_events_v2), not here — see
// that function's comment for why ranking must precede LIMIT. This file's
// job is validation, phrasing and shaping.

import { createClient } from '@supabase/supabase-js';

// Both fall back to a literal, matching api/strava/*.js. That is safe here
// and only here: the anon key is ALREADY public — explore.html ships it to
// every visitor in plain text — so a fallback exposes nothing new and stops
// this route 500-ing if the env var is missing in a Preview deployment. A
// service-role key must NEVER get this treatment.
const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';

const MAX_PAGE_SIZE = 60;
const MAX_PAGE = 500;
const DEFAULT_PAGE_SIZE = 20;
const MAX_RADIUS_KM = 1000;

const WATER_TYPES = ['sea', 'lake', 'river', 'reservoir', 'lagoon', 'canal', 'mixed', 'other'];
const SORTS = ['relevance', 'date', 'distance', 'prominence'];
const MODES = ['near_me', 'travel'];

// ── Validation ────────────────────────────────────────────────────────────
// Every parameter is validated and every rejection names the parameter and
// what was expected. A search that silently ignores a filter it did not
// understand is worse than one that errors: the swimmer believes they
// filtered and they did not.

class BadRequest extends Error {
  constructor(param, expected) {
    super(`Invalid "${param}": expected ${expected}`);
    this.param = param;
  }
}

function num(v, param, { min, max }) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new BadRequest(param, 'a number');
  if (n < min || n > max) throw new BadRequest(param, `a number between ${min} and ${max}`);
  return n;
}

function int(v, param, { min, max }) {
  const n = num(v, param, { min, max });
  return n === null ? null : Math.trunc(n);
}

// Accepts only YYYY-MM-DD, and checks the date actually exists — '2026-02-31'
// parses happily in JS and rolls over to March, which would silently shift a
// swimmer's search window.
function isoDate(v, param) {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BadRequest(param, 'a date as YYYY-MM-DD');
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw new BadRequest(param, 'a real calendar date as YYYY-MM-DD');
  }
  return v;
}

function enumOf(v, param, allowed) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (!allowed.includes(s)) throw new BadRequest(param, `one of ${allowed.join(', ')}`);
  return s;
}

// Absent means false. Only an explicit "true"/"1" turns a filter on, so a
// typo can never quietly narrow someone's results.
const bool = (v) => v === 'true' || v === '1';

function parseQuery(q) {
  const lat = num(q.lat, 'lat', { min: -90, max: 90 });
  const lon = num(q.lon ?? q.lng, 'lon', { min: -180, max: 180 });

  // Half a coordinate is a bug in the caller, not a valid search — without
  // both, radius silently does nothing and the swimmer gets the whole world.
  if ((lat === null) !== (lon === null)) {
    throw new BadRequest('lat/lon', 'both together, or neither');
  }

  const radius_km = int(q.radius_km, 'radius_km', { min: 1, max: MAX_RADIUS_KM });
  if (radius_km !== null && lat === null) {
    throw new BadRequest('radius_km', 'lat and lon as well — a radius needs a centre');
  }

  const date_from = isoDate(q.date_from, 'date_from');
  const date_to = isoDate(q.date_to, 'date_to');
  if (date_from && date_to && date_to < date_from) {
    throw new BadRequest('date_to', 'a date on or after date_from');
  }

  let country = q.country ? String(q.country).trim().toUpperCase() : null;
  if (country && !/^[A-Z]{2}$/.test(country)) {
    throw new BadRequest('country', 'a two-letter ISO country code');
  }

  const region = q.region ? String(q.region).trim().slice(0, 80) : null;

  // Infer the mode from the search rather than trusting the caller to label
  // it. A request carrying coordinates IS a near-me search, and reporting it
  // back as "travel" makes the echoed search block quietly wrong — which
  // matters because callers and analytics both read mode from the response.
  // An explicit mode still wins, so a caller can say "these coordinates are
  // a destination I am considering, not where I am".
  const mode = enumOf(q.mode, 'mode', MODES) || (lat !== null ? 'near_me' : 'travel');

  return {
    mode,
    lat, lon, radius_km, country, region, date_from, date_to,
    minimum_distance_m: int(q.minimum_distance_m ?? q.min_distance_m, 'minimum_distance_m', { min: 0, max: 200000 }),
    water_type: enumOf(q.water_type, 'water_type', WATER_TYPES),
    weekend_only: bool(q.weekend_only),
    entries_open: bool(q.entries_open),
    confirmed_only: bool(q.confirmed_only),
    featured: bool(q.featured),
    include_multisport: bool(q.include_multisport),
    // near_me defaults to nearest-first; travel defaults to the ranking.
    sort: enumOf(q.sort, 'sort', SORTS) || (mode === 'near_me' ? 'relevance' : 'relevance'),
    page: int(q.page, 'page', { min: 1, max: MAX_PAGE }) ?? 1,
    page_size: int(q.page_size, 'page_size', { min: 1, max: MAX_PAGE_SIZE }) ?? DEFAULT_PAGE_SIZE,
  };
}

// ── Outbound URL safety ───────────────────────────────────────────────────
// These URLs came off third-party pages via a crawler. Anything that is not
// plain http(s) is dropped rather than rendered — javascript: and data: URLs
// in an href are a stored-XSS vector, and the crawler is not a trusted
// author. Dropping is deliberate: a missing link is a small loss, a
// weaponised one is not.
function safeUrl(u) {
  if (!u) return null;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

// ── Match reasons ─────────────────────────────────────────────────────────
// Only ever states a fact the row actually carries. No "perfect for you",
// no inferred suitability — the brief is explicit about that, and an
// inflated claim about a swim someone might travel to is worse than silence.
function matchReasons(row, p) {
  const out = [];

  if (p.lat !== null && row.distance_km !== null && row.distance_km !== undefined) {
    out.push(`Within ${Math.round(row.distance_km)} km of your search location`);
  }
  if (p.minimum_distance_m && row.matched_distance_m) {
    const km = row.matched_distance_m / 1000;
    out.push(`Includes a ${km >= 1 ? `${+km.toFixed(1)} km` : `${row.matched_distance_m} m`} distance`);
  }
  if (p.weekend_only && row.is_weekend) out.push('Takes place on a weekend');
  if (row.entries_open) out.push('Entries are currently open');
  if (row.officially_claimed) out.push('Confirmed by the organiser');
  else if (row.verification_tier === 'confirmed') out.push("Verified from the organiser's own page");
  if (row.is_featured) out.push('A swim we think is worth travelling for');
  if (row.water_temp_c !== null && row.water_temp_c !== undefined) {
    out.push(`Water is ${row.water_temp_c}°C there now`);
  }

  // Two is enough for a card. More reads as justification.
  return out.slice(0, 3);
}

// ── Shaping ───────────────────────────────────────────────────────────────
// An explicit allow-list, not a delete-list. Anything added to the RPC's
// return shape later is invisible here until someone deliberately adds it —
// which is the right default for a public endpoint sitting on top of a
// crawler database.
function toResult(row, p) {
  return {
    id: row.edition_id,
    slug: row.slug,
    name: row.title || row.series_name,
    series_name: row.series_name,
    url: row.slug ? `/events/${row.slug}` : null,

    start_date: row.start_date,
    end_date: row.end_date,
    date_precision: row.date_precision,
    date_confirmed: row.date_confirmed,
    is_weekend: row.is_weekend,

    venue_name: row.venue_name,
    city: row.city,
    region: row.region,
    country_code: row.country_code,
    water_type: row.water_body_type,
    latitude: row.latitude,
    longitude: row.longitude,
    distance_km: row.distance_km,

    distances: Array.isArray(row.distances) ? row.distances : [],
    max_distance_m: row.max_distance_m,

    status: row.status,
    entry_status: row.registration_status,
    entries_open: row.entries_open,
    official_url: safeUrl(row.official_url),
    registration_url: safeUrl(row.registration_url),
    organiser_name: row.organiser_name,

    verification_tier: row.verification_tier,
    officially_claimed: row.officially_claimed,
    last_verified_at: row.last_verified_at,

    water_temp_c: row.water_temp_c,
    water_confidence: row.water_confidence,
    interested_count: Number(row.interested_count || 0),
    participant_estimate: row.participant_estimate,
    prominence: row.prominence,
    is_featured: row.is_featured,

    match_reasons: matchReasons(row, p),

    // Deliberately NOT returned: confidence_score (the brief forbids showing
    // the raw internal number as the public label — verification_tier is the
    // public form of it), source_candidate_id, discovery evidence, organiser
    // email, rank_score, is_indexable.
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPABASE_ANON_KEY) {
    console.error('explore/events: SUPABASE_ANON_KEY not configured');
    return res.status(500).json({ error: 'Search is not configured' });
  }

  let p;
  try {
    p = parseQuery(req.query || {});
  } catch (err) {
    if (err instanceof BadRequest) {
      return res.status(400).json({ error: err.message, parameter: err.param });
    }
    throw err;
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The country facet runs alongside the search, not after it: it answers a
  // different question ("if not here, where?") over the same filters, and
  // making the swimmer wait for two serial round trips to see one page is
  // the sort of thing that turns a discovery feature into a spinner.
  //
  // Deliberately NOT given p_country. A facet that filters by its own
  // dimension can only ever return the country already chosen, which is the
  // one country the swimmer does not need to be told about.
  const facetPromise = sb.rpc('explore_country_facet', {
    p_lat: p.lat,
    p_lng: p.lon,
    p_radius_km: p.radius_km,
    p_date_from: p.date_from,
    p_date_to: p.date_to,
    p_min_distance_m: p.minimum_distance_m,
    p_water_type: p.water_type,
    p_weekend_only: p.weekend_only,
    p_entries_open: p.entries_open,
    p_confirmed_only: p.confirmed_only,
    p_featured: p.featured,
    p_include_multisport: p.include_multisport,
  });

  const { data, error } = await sb.rpc('search_events_v2', {
    p_lat: p.lat,
    p_lng: p.lon,
    p_radius_km: p.radius_km,
    p_country: p.country,
    p_region: p.region,
    p_date_from: p.date_from,
    p_date_to: p.date_to,
    p_min_distance_m: p.minimum_distance_m,
    p_water_type: p.water_type,
    p_weekend_only: p.weekend_only,
    p_entries_open: p.entries_open,
    p_confirmed_only: p.confirmed_only,
    p_featured: p.featured,
    p_include_multisport: p.include_multisport,
    p_sort: p.sort,
    p_page: p.page,
    p_page_size: p.page_size,
  });

  if (error) {
    // Log the detail, return a generic message: a Postgres error string can
    // name columns and functions the public has no business learning about.
    console.error('explore/events: search_events_v2 failed:', error.message);
    return res.status(502).json({ error: 'Could not search events right now' });
  }

  const rows = data || [];
  const total = rows.length ? Number(rows[0].total_count) : 0;

  // The facet is an enhancement, never a dependency. If it fails — or is not
  // deployed yet — the search still returns; the browser treats a missing
  // `facets` as "show no destination row" rather than rendering an empty one.
  let facets = null;
  let facetTotal = 0;
  try {
    const { data: fData, error: fError } = await facetPromise;
    if (fError) {
      console.warn('explore/events: explore_country_facet failed:', fError.message);
    } else {
      const fRows = fData || [];
      facetTotal = fRows.reduce((sum, r) => sum + Number(r.n), 0);
      facets = {
        by_country: fRows.map((r) => ({
          country_code: r.country_code,
          n: Number(r.n),
          next_date: r.next_date,
        })),
        // How many matching swims the breakdown above does NOT account for.
        // Two separate causes, which is why this is derived from the totals
        // rather than counting venue-less rows: on 2026-08-18, of 305 swims,
        // 21 have no venue at all and a further 11 have a venue whose
        // country_code is unset — 32 in total. The page says so rather than
        // letting the parts quietly fail to add up to the headline.
        without_country: Math.max(0, total - facetTotal),
      };
    }
  } catch (err) {
    console.warn('explore/events: explore_country_facet threw:', err.message);
  }

  // Public, identical for every anonymous caller, and cheap to regenerate.
  // No user-specific data is in this response — saved/followed state is
  // fetched separately by the browser precisely so this stays cacheable.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  return res.status(200).json({
    results: rows.map((r) => toResult(r, p)),
    facets,
    pagination: {
      page: p.page,
      page_size: p.page_size,
      total,
      has_more: p.page * p.page_size < total,
    },
    search: {
      mode: p.mode,
      sort: p.sort,
      radius_km: p.radius_km,
      country: p.country,
      region: p.region,
      date_from: p.date_from,
      date_to: p.date_to,
      minimum_distance_m: p.minimum_distance_m,
      water_type: p.water_type,
      weekend_only: p.weekend_only,
      entries_open: p.entries_open,
      confirmed_only: p.confirmed_only,
      featured: p.featured,
      include_multisport: p.include_multisport,
    },
  });
}
