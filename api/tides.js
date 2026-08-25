// Tide extremes for the crossing pages.
//
//   GET /api/tides?place=big-bay
//
// Reads from tide_predictions, which /api/cron/tides refreshes once a day.
// The whole point is that a visitor never costs a WorldTides credit: August
// burned 661 against July's 115 because every page load on /robben, /intel and
// /preekstool was its own upstream call, and two of those pages appended
// &_=${Date.now()} which defeated caching deliberately.
//
// Edge caching alone would not have fixed it. Vercel's cache is per region, so
// Cape Town, London and US visitors each warm a separate copy; the bill still
// scales with traffic, just more slowly. Serving from Postgres makes it flat.
//
// The key also used to be hardcoded in four public HTML files and shipped to
// every visitor in plain text. It now lives in WORLDTIDES_API_KEY and is only
// reachable from the fallback below.
//
// NAMED PLACES, NOT lat/lon — see api/_lib/tide-places.js for why.

import { createClient } from '@supabase/supabase-js';
import { TIDE_PLACES, tidePlace, TIDE_PLACE_KEYS } from './_lib/tide-places.js';

const WORLDTIDES_URL = 'https://www.worldtides.info/api/v3';

// Same reasoning as api/explore/events.js: the anon key is already public, so
// a literal fallback exposes nothing and stops this 500-ing in a Preview
// deployment with no env vars. A service key must never get this treatment.
const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';

/** The upstream, used only when the table has nothing usable. */
async function fetchUpstream(place) {
  const key = process.env.WORLDTIDES_API_KEY;
  if (!key) return null;

  const url = `${WORLDTIDES_URL}?extremes&lat=${place.lat}&lon=${place.lon}` +
              `&days=${place.days}&datum=LAT&key=${encodeURIComponent(key)}`;
  try {
    const upstream = await fetch(url, { headers: { accept: 'application/json' } });
    const json = await upstream.json();
    // A credit shortage arrives as a 200 with an error field as often as a 4xx.
    if (!upstream.ok || json.error) {
      // Logged, never returned: the message can name the account and the key.
      console.error('tides: upstream error', upstream.status, json.error || '(no message)');
      return null;
    }
    return (Array.isArray(json.extremes) ? json.extremes : []).map((e) => ({
      dt: e.dt,
      date: e.date,
      height: e.height == null ? null : Number(e.height),
      type: e.type,
    }));
  } catch (err) {
    console.error('tides: upstream fetch failed:', err.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const name = String(req.query.place || '').toLowerCase();
  const place = tidePlace(name);
  if (!place) {
    return res.status(400).json({ error: 'Unknown "place"', allowed: TIDE_PLACE_KEYS });
  }

  let extremes = null;
  let source = 'stored';

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Only the future — every page filters to upcoming extremes anyway, and
    // asking for the past would just make them do it again.
    const { data, error } = await sb
      .from('tide_predictions')
      .select('extreme_at, height_m, extreme_type')
      .eq('place', name)
      .gte('extreme_at', new Date().toISOString())
      .order('extreme_at', { ascending: true })
      .limit(120);

    if (error) throw new Error(error.message);
    if (data && data.length) {
      extremes = data.map((r) => ({
        // The pages read `dt` (unix seconds) and `date`. Kept identical to
        // WorldTides' own shape so nothing downstream had to change when this
        // stopped being a passthrough.
        dt: Math.floor(new Date(r.extreme_at).getTime() / 1000),
        date: r.extreme_at,
        height: r.height_m == null ? null : Number(r.height_m),
        type: r.extreme_type,
      }));
    }
  } catch (err) {
    console.warn('tides: stored lookup failed, will try upstream:', err.message);
  }

  // Nothing stored — before the first cron run, or if a place has run out of
  // future extremes because the cron has been failing. Fetch once so the page
  // still works, and say so in the response.
  if (!extremes || !extremes.length) {
    extremes = await fetchUpstream(place);
    source = 'upstream';
  }

  if (!extremes || !extremes.length) {
    // Do NOT cache a failure for hours — that would hide the recovery.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Tide data is unavailable right now' });
  }

  // An hour at the edge is plenty now the data is local: the underlying rows
  // only change once a day, and this exists to spare the database a little
  // work, not to spare an API bill.
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  return res.status(200).json({
    place: place.label,
    days: place.days,
    source,
    extremes,
  });
}

export { TIDE_PLACES };
