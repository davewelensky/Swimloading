// Map markers for /explore — every plottable swim, as small as possible.
//
// Separate from /api/explore/events on purpose. The result LIST is ranked
// and paginated (20 at a time); the MAP needs every point at once or the
// world view is a lie. Serving both from one endpoint would mean either
// paginating the map (impossible) or letting the list return 250 rows of
// full detail (the thing the brief's performance section asks us not to do).
//
// So this returns one thin row per swim — no descriptions, no distances
// array, no organiser, no temperature. Roughly 120 bytes each rather than
// ~900, and it is identical for every visitor, so the edge can cache it.

import { createClient } from '@supabase/supabase-js';

// Same reasoning as events.js: the anon key is already public in
// explore.html, so a fallback exposes nothing and keeps Preview working.
const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';

// The whole forward catalogue. Deliberately above the real size (259 on
// 2026-08-05) so this never silently truncates — a cut here does not just
// drop pins, it drops COUNTRIES from the header tally, which reports a
// wrong number rather than a smaller one. Revisit past a few thousand
// events, when the map needs bounding-box queries instead.
const MAX_POINTS = 2000;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const includeMultisport = req.query.include_multisport === 'true';

  const { data, error } = await sb.rpc('search_events_v2', {
    p_sort: 'date',
    p_page: 1,
    p_page_size: 60,
    p_include_multisport: includeMultisport,
  });

  if (error) {
    console.error('explore/map-points: search_events_v2 failed:', error.message);
    return res.status(502).json({ error: 'Could not load the map right now' });
  }

  // search_events_v2 caps a page at 60 by design (it is a search endpoint,
  // and an unbounded page size is how a search endpoint becomes a denial of
  // service). The map genuinely needs everything, so walk the pages rather
  // than widening that cap for everyone.
  const points = [...(data || [])];
  const total = points.length ? Number(points[0].total_count) : 0;
  const pages = Math.min(Math.ceil(total / 60), Math.ceil(MAX_POINTS / 60));

  for (let page = 2; page <= pages; page++) {
    const { data: more, error: err } = await sb.rpc('search_events_v2', {
      p_sort: 'date',
      p_page: page,
      p_page_size: 60,
      p_include_multisport: includeMultisport,
    });
    // A failed later page degrades the map rather than emptying it: better
    // to plot 180 of 250 swims than to show a blank world.
    if (err) {
      console.error(`explore/map-points: page ${page} failed:`, err.message);
      break;
    }
    points.push(...(more || []));
  }

  const truncated = total > points.length;
  if (truncated) {
    console.warn(`explore/map-points: returned ${points.length} of ${total} — raise MAX_POINTS`);
  }

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');

  return res.status(200).json({
    // Short keys: this payload is ~250 objects and the names are repeated
    // in every one of them.
    points: points
      .filter((p) => p.latitude !== null && p.longitude !== null)
      .map((p) => ({
        id: p.edition_id,
        s: p.slug,
        n: p.title || p.series_name,
        lat: p.latitude,
        lng: p.longitude,
        d: p.start_date,
        dc: p.date_confirmed,
        dp: p.date_precision,
        t: p.verification_tier,
        c: p.country_code,
        r: p.region,
        ct: p.city,
        w: p.water_temp_c,
      })),
    total,
    plotted_of_total: `${points.length}/${total}`,
    truncated,
  });
}
