// GET /api/spots/:spot/history?period=24h|7d|30d
// (routed via vercel.json → /api/spot-history?spot=$1)
//
// Observation history for a spot's approved PRIMARY station, shaped for
// graphing and nothing else. Reads only SwimLoading's own tables via the
// anon key — never an external provider. Failure shape mirrors the rest of
// the public API surface: unknown spot/period is a 4xx, an upstream data
// problem degrades to an empty series, never a 500.

import { dbGet, generateSlug } from './seo-utils.js';

const PERIODS = {
  '24h': { hours: 24, maxPoints: 400 },
  '7d': { hours: 7 * 24, maxPoints: 400 },
  '30d': { hours: 30 * 24, maxPoints: 400 },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  const url = new URL(req.url || '/', 'https://www.swimloading.com');
  const spotParam = (url.searchParams.get('spot') || '').trim();
  const periodKey = (url.searchParams.get('period') || '24h').trim();

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const period = PERIODS[periodKey];
  if (!period) {
    return res.status(400).send(JSON.stringify({ error: 'period must be one of 24h, 7d, 30d' }));
  }
  if (!spotParam) {
    return res.status(400).send(JSON.stringify({ error: 'spot required' }));
  }

  // Accept a spot uuid or a public slug (the /spots/* URL form).
  let spotId = null;
  if (UUID_RE.test(spotParam)) {
    spotId = spotParam;
  } else {
    const allSpots = await dbGet('spots?active=eq.true&select=id,name');
    const spot = (allSpots || []).find((s) => generateSlug(s.name) === spotParam);
    if (!spot) return res.status(404).send(JSON.stringify({ error: 'spot not found' }));
    spotId = spot.id;
  }

  // The approved primary station is the only series a spot page graphs.
  const links = await dbGet(
    `spot_observation_stations?spot_id=eq.${spotId}&status=eq.approved&is_primary=eq.true&select=station_id&limit=1`
  );
  const stationId = links?.[0]?.station_id || null;

  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');

  if (!stationId) {
    return res.status(200).send(JSON.stringify({ period: periodKey, points: [] }));
  }

  const since = new Date(Date.now() - period.hours * 3_600_000).toISOString();
  const rows = await dbGet(
    `observations?station_id=eq.${stationId}` +
    `&observed_at=gte.${encodeURIComponent(since)}` +
    '&water_temperature_c=not.is.null' +
    '&select=observed_at,water_temperature_c,wave_height_m' +
    '&order=observed_at.asc&limit=3000'
  ) || [];

  // Downsample evenly — a graph does not need 3,000 points.
  const stride = Math.max(1, Math.ceil(rows.length / period.maxPoints));
  const points = rows
    .filter((_, i) => i % stride === 0 || i === rows.length - 1)
    .map((r) => ({
      t: r.observed_at,
      temp_c: r.water_temperature_c != null ? Number(r.water_temperature_c) : null,
      ...(r.wave_height_m != null ? { wave_m: Number(r.wave_height_m) } : {}),
    }));

  return res.status(200).send(JSON.stringify({ period: periodKey, points }));
}
