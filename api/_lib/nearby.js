// "What else is there near this crossing?" — the helpers that stop an
// organic visitor reaching the bottom of a crossing page and leaving.
//
// RELEVANCE BEFORE PROXIMITY. Nearest is not the same as useful. A Virgin
// Active pool is often closer to a Cape Town crossing than any open water,
// and a marathon swimmer reading about False Bay is not looking for a gym
// lane. So candidates are ranked by (relevance tier, then distance) and
// pools are excluded from open-water crossings entirely. The rule is a
// short table anyone can read and argue with — deliberately not a scoring
// engine whose output nobody can explain.
//
// TWO TIERS OF LOCATION, BECAUSE THAT IS WHAT THE DATA SUPPORTS. Crossings
// mostly have no coordinates: as of 2026-08-14 every start_lat/start_lng
// is null and only two rows carry a country. Rather than invent
// coordinates — the fact-integrity rule forbids it — this works with what
// is genuinely known:
//   1. anchor_lat/anchor_lng present  -> true proximity, bounding box + haversine
//   2. country_code present           -> same-country open water
//   3. neither                        -> no nearby block at all, rather than a wrong one
// Anchors are derived from OUR OWN spot rows where a crossing endpoint
// names a spot we already hold (False Bay -> Millers Point, Rottnest ->
// Cottesloe Beach), never from a guess.
//
// QUERIES ARE DB-SIDE. The bounding box is applied by PostgREST so a
// handful of rows come back and the exact haversine ordering happens on
// those. Nothing pulls the whole spot table to sort it.

import { haversineKm } from '../seo-utils.js';

/** Water types worth showing beside an open-water crossing, best first. */
export const SPOT_RELEVANCE_TIERS = {
  OCEAN: 0,
  LAGOON: 1,
  LAKE: 2,
  DAM: 2,
  // POOL is deliberately absent: excluded, not merely ranked last.
};

export const NEARBY_LIMITS = {
  // Wider than the 50 km used on a spot page: a crossing is a regional
  // landmark, and a swimmer reading about it will travel to train for it.
  spotRadiusKm: 150,
  eventRadiusKm: 250,
  maxSpots: 6,
  maxEvents: 4,
  maxCrossings: 3,
};

/** Degrees of latitude per km — good enough to build a search box. */
const KM_PER_DEG_LAT = 110.574;

/**
 * A lat/lng box to hand to PostgREST. Longitude degrees shrink towards the
 * poles, so the box is widened by 1/cos(lat); without that a box at
 * Wellington or Dover is too narrow east-west and quietly misses spots.
 */
export function boundingBox(lat, lng, radiusKm) {
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const cos = Math.cos((lat * Math.PI) / 180);
  // Guard the poles, where 1/cos explodes.
  const dLng = radiusKm / (KM_PER_DEG_LAT * Math.max(Math.abs(cos), 0.01));
  return {
    minLat: lat - dLat, maxLat: lat + dLat,
    minLng: lng - dLng, maxLng: lng + dLng,
  };
}

/** Is this spot worth showing beside this crossing at all? */
export function isRelevantSpot(spot, crossing) {
  if (!spot || spot.active === false) return false;
  if (!Object.prototype.hasOwnProperty.call(SPOT_RELEVANCE_TIERS, spot.water_type)) return false;
  // Don't offer the crossing's own endpoint back to the reader as a
  // discovery — they are already reading about it.
  const endpoints = [crossing?.start_location, crossing?.end_location]
    .filter(Boolean).map((s) => normalise(s));
  const name = normalise(spot.name);
  if (name && endpoints.some((e) => e.includes(name))) return false;
  return true;
}

const normalise = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Rank candidates: relevance tier first, then distance when we have an
 * anchor. Returns a new array; never mutates the input.
 */
export function rankNearbySpots(spots, crossing, anchor, limit = NEARBY_LIMITS.maxSpots) {
  const usable = (spots || []).filter((s) => isRelevantSpot(s, crossing));
  const withDist = usable.map((s) => {
    const dist = anchor && s.latitude != null && s.longitude != null
      ? haversineKm(anchor.lat, anchor.lng, Number(s.latitude), Number(s.longitude))
      : null;
    return { ...s, distanceKm: dist };
  });
  const inRange = anchor
    ? withDist.filter((s) => s.distanceKm != null && s.distanceKm <= NEARBY_LIMITS.spotRadiusKm)
    : withDist;

  inRange.sort((a, b) => {
    const ta = SPOT_RELEVANCE_TIERS[a.water_type] ?? 9;
    const tb = SPOT_RELEVANCE_TIERS[b.water_type] ?? 9;
    if (ta !== tb) return ta - tb;
    if (a.distanceKm != null && b.distanceKm != null) return a.distanceKm - b.distanceKm;
    return String(a.name).localeCompare(String(b.name));
  });
  return inRange.slice(0, limit);
}

/**
 * Related crossings. Same country is the strongest signal we can stand
 * behind; after that, crossings that share the Oceans Seven framing, which
 * is exactly how the audience groups them. Never returns itself.
 */
export function rankRelatedCrossings(all, crossing, limit = NEARBY_LIMITS.maxCrossings) {
  const others = (all || []).filter((c) => c.slug !== crossing?.slug && c.intro);
  const scored = others.map((c) => {
    let score = 0;
    if (c.country_code && crossing?.country_code && c.country_code === crossing.country_code) score += 2;
    if (c.oceans_seven && crossing?.oceans_seven) score += 1;
    return { ...c, _score: score };
  });
  scored.sort((a, b) => (b._score - a._score) || String(a.name).localeCompare(String(b.name)));
  return scored.slice(0, limit);
}

/**
 * The Explore link for a crossing.
 *
 * Uses Explore's EXISTING query contract (country / region / city /
 * place_label — see readUrl() in explore.html) rather than inventing
 * parameters, so a link built here reproduces a real search. Returns bare
 * /explore when we know nothing, because a link carrying `country=null`
 * searches for a country named "null" and finds nothing — a failure this
 * codebase has already had once.
 */
export function exploreUrlForCrossing(crossing) {
  const params = new URLSearchParams();
  if (crossing?.country_code) params.set('country', crossing.country_code);
  const label = exploreLabelForCrossing(crossing);
  if (crossing?.country_code && label) params.set('place_label', label);
  const qs = params.toString();
  return qs ? `/explore?${qs}` : '/explore';
}

/** "Explore swims around Catalina" — the human half of the same link. */
export function exploreLabelForCrossing(crossing) {
  // `connects` is validated human phrasing and is the best short
  // description of where a crossing is. Fall back to the crossing name.
  return crossing?.connects || crossing?.name || null;
}

export function exploreCtaText(crossing) {
  const label = exploreLabelForCrossing(crossing);
  return label ? `Explore swims around ${label}` : 'Explore open water swims';
}

/**
 * The anchor a crossing can be measured from, or null. Kept as a function
 * so callers cannot accidentally treat 0,0 as a real position.
 */
export function crossingAnchor(crossing) {
  const lat = Number(crossing?.anchor_lat ?? crossing?.start_lat);
  const lng = Number(crossing?.anchor_lng ?? crossing?.start_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/** PostgREST query for candidate spots — bounding box, or country. */
export function nearbySpotsQuery(crossing) {
  const anchor = crossingAnchor(crossing);
  const select = 'select=id,name,domain,area,water_type,latitude,longitude,country_code&active=eq.true';
  const types = 'water_type=in.(OCEAN,LAGOON,LAKE,DAM)';
  if (anchor) {
    const b = boundingBox(anchor.lat, anchor.lng, NEARBY_LIMITS.spotRadiusKm);
    return `spots?${select}&${types}` +
      `&latitude=gte.${b.minLat.toFixed(4)}&latitude=lte.${b.maxLat.toFixed(4)}` +
      `&longitude=gte.${b.minLng.toFixed(4)}&longitude=lte.${b.maxLng.toFixed(4)}&limit=60`;
  }
  if (crossing?.country_code) {
    return `spots?${select}&${types}&country_code=eq.${encodeURIComponent(crossing.country_code)}&limit=60`;
  }
  return null;
}

/** PostgREST query for upcoming, indexable events near a crossing. */
export function nearbyEventsQuery(crossing, today) {
  const anchor = crossingAnchor(crossing);
  const day = today || new Date().toISOString().slice(0, 10);
  const base = 'event_editions?select=slug,title,start_date,status,event_venues!inner(city,region,country_code,latitude,longitude)' +
    `&is_indexable=eq.true&start_date=gte.${day}&status=in.(announced,entries_open,entries_closed)&order=start_date.asc`;
  if (anchor) {
    const b = boundingBox(anchor.lat, anchor.lng, NEARBY_LIMITS.eventRadiusKm);
    return `${base}&event_venues.latitude=gte.${b.minLat.toFixed(4)}&event_venues.latitude=lte.${b.maxLat.toFixed(4)}` +
      `&event_venues.longitude=gte.${b.minLng.toFixed(4)}&event_venues.longitude=lte.${b.maxLng.toFixed(4)}&limit=20`;
  }
  if (crossing?.country_code) {
    return `${base}&event_venues.country_code=eq.${encodeURIComponent(crossing.country_code)}&limit=20`;
  }
  return null;
}
