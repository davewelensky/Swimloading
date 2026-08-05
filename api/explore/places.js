// Places to swim — the third thing /explore has to answer.
//
// A traveller opening this page has three different questions and only two
// were answered: "what races are on" (event_editions) and "what can I book"
// (swim_routes). The third is the one they ask most often — "where can I
// just go and swim" — and SwimLoading has better data for it than for
// either of the others: 192 spots, all with coordinates, 132 with a
// temperature a swimmer actually measured.
//
// Deliberately NOT limited to the sea. Lakes, dams, rivers, lagoons and
// lidos are all open water swimming to the person doing it, and a handbook
// that omits Tooting Bec Lido because it is technically a pool is not a
// handbook. water_type is returned so the reader can tell, not so we can
// filter things out on their behalf.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';

// Slug generation must match api/seo-utils.js generateSlug, because these
// link to /spots/{slug} pages that already exist. A slug that disagrees
// produces a 404 on a page we know is there.
const slugify = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [{ data: spots, error }, { data: temps }] = await Promise.all([
    sb.from('spots')
      .select('id,name,code,area,water_type,country_code,latitude,longitude,meet_note')
      .eq('active', true)
      .not('latitude', 'is', null)
      .order('name'),
    // spot_temp_estimate already blends swimmer-reported against modelled
    // and rates its own confidence — reuse it rather than inventing a
    // second opinion that could disagree with the app's.
    sb.from('spot_temp_estimate').select('spot_id,best_c,best_source,confidence'),
  ]);

  if (error) {
    console.error('explore/places:', error.message);
    return res.status(502).json({ error: 'Could not load places right now' });
  }

  const tempBySpot = new Map((temps || []).map((t) => [t.spot_id, t]));

  const places = (spots || []).map((s) => {
    const t = tempBySpot.get(s.id);
    return {
      id: s.id,
      slug: slugify(s.name),
      name: s.name,
      area: s.area,
      country_code: s.country_code,
      // Lower-cased to match the event water_type vocabulary, so one filter
      // control can drive both without a translation table.
      water_type: (s.water_type || '').toLowerCase() || null,
      latitude: s.latitude,
      longitude: s.longitude,
      note: s.meet_note,
      temp_c: t?.best_c != null ? Math.round(Number(t.best_c) * 10) / 10 : null,
      temp_source: t?.best_source ?? null,
      temp_confidence: t?.confidence ?? null,
      url: `/spots/${slugify(s.name)}`,
    };
  });

  const byCountry = {};
  for (const p of places) {
    if (p.country_code) byCountry[p.country_code] = (byCountry[p.country_code] || 0) + 1;
  }

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
  return res.status(200).json({
    places,
    total: places.length,
    with_temperature: places.filter((p) => p.temp_c != null).length,
    by_country: byCountry,
  });
}
