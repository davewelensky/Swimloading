// ── my-water.live proxy endpoint ──────────────────────────────────────────────
// GET /api/mywaterlive?slug=tooting-bec-lido
//
// SECURITY: The API key lives ONLY in process.env.MYWATERLIVE_API_KEY.
// It is loaded server-side, used in the upstream fetch header, and is NEVER
// included in the response to the client. Inspect the network tab — the
// response contains only { temperature, timestamp, venue_label, venue_url }.
//
// CACHING: Two-layer:
//   1. Vercel edge cache via Cache-Control s-maxage (primary — spans instances)
//   2. Module-level in-memory Map (secondary — within a single warm instance)
// TTL = min(refresh_hint_seconds from API, CACHE_TTL_SECONDS). Default 10 min.
//
// GRACEFUL DEGRADATION:
//   - API slow/down + stale cache available → serve stale with { stale: true }
//   - API slow/down + no cache             → { unavailable: true }
//   - Unknown slug                          → 404

import { VENUE_MAP, CACHE_TTL_SECONDS, MW_API_BASE } from './mywaterlive-config.js';

// Module-level in-memory cache: venueId → { data: {...}, cachedAt: ms }
const _cache = new Map();

export default async function handler(req, res) {
  const slug  = (typeof req.query?.slug === 'string' ? req.query.slug : '').trim();
  const venue = VENUE_MAP[slug];

  if (!venue) {
    return res.status(404).json({ error: 'Unknown venue slug' });
  }

  const apiKey = process.env.MYWATERLIVE_API_KEY;
  if (!apiKey) {
    // Config error — log without printing the key
    console.error('[mywaterlive] MYWATERLIVE_API_KEY environment variable is not set');
    return res.status(503).json({ unavailable: true });
  }

  const now    = Date.now();
  const cached = _cache.get(venue.id);
  const cacheAge = cached ? (now - cached.cachedAt) : Infinity;

  // ── In-memory cache hit ───────────────────────────────────────────────────
  if (cached && cacheAge < CACHE_TTL_SECONDS * 1000) {
    res.setHeader('Cache-Control',
      `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=${Math.round(CACHE_TTL_SECONDS * 1.5)}`);
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cached.data);
  }

  // ── Fetch from my-water.live ──────────────────────────────────────────────
  try {
    const upstream = await fetch(`${MW_API_BASE}/${venue.id}`, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(5000), // 5 s hard timeout
    });

    if (!upstream.ok) {
      // Log status only — never the key
      console.error(`[mywaterlive] upstream returned ${upstream.status} for venue ${venue.id}`);
      return _serveStaleOrUnavailable(res, cached);
    }

    const raw = await upstream.json();

    // Respect the API's own refresh hint, capped at our ceiling
    const ttl = Math.min(
      typeof raw.refresh_hint_seconds === 'number' ? raw.refresh_hint_seconds : CACHE_TTL_SECONDS,
      CACHE_TTL_SECONDS,
    );

    const payload = {
      temperature: raw.water?.temperature ?? null,
      timestamp:   raw.water?.timestamp   ?? null,   // ISO8601
      venue_label: venue.label,
      venue_url:   'https://my-water.live',
    };

    // Store in in-memory cache
    _cache.set(venue.id, { data: payload, cachedAt: now });

    res.setHeader('Cache-Control',
      `public, s-maxage=${ttl}, stale-while-revalidate=${Math.round(ttl * 1.5)}`);
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(payload);

  } catch (err) {
    // Timeout or network error — log message only, not the key
    console.error('[mywaterlive] fetch error:', err.message);
    return _serveStaleOrUnavailable(res, cached);
  }
}

// Serve last stale value if available, otherwise signal unavailability.
// Never throws — always returns a response.
function _serveStaleOrUnavailable(res, cached) {
  if (cached) {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.setHeader('X-Cache', 'STALE');
    return res.status(200).json({ ...cached.data, stale: true });
  }
  return res.status(503).json({ unavailable: true });
}
