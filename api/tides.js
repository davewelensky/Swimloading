// Tide extremes for the crossing pages, via WorldTides.
//
//   GET /api/tides?place=big-bay
//
// Exists because the WorldTides key was hardcoded in four public HTML files
// and served to every visitor in plain text (robben.html, intel.html,
// preekstool.html, english-channel.html). A paid key on a public page gets
// scraped and spent — which is the most likely explanation for the account
// running out of credits. The key now lives in a Vercel env var and never
// leaves the server.
//
// NAMED PLACES, NOT lat/lon. This is the part that matters. A proxy taking
// arbitrary coordinates is no safer than a public key: anyone could point
// their own site at /api/tides and spend our credits just as easily. The
// allowlist below is every location our pages actually ask about, and a
// request for anything else is refused rather than forwarded.
//
// Each place also fixes its own `days`, so a caller cannot ask for 30 days at
// a location we only ever show 2 for. WorldTides charges by call, and a
// larger window is a more expensive call.

const WORLDTIDES_URL = 'https://www.worldtides.info/api/v3';

// The four locations the site asks about, with the window each page shows.
// Adding one means adding it here, deliberately.
const PLACES = {
  'big-bay':   { lat: -33.7297, lon:  18.4611, days:  2, label: 'Big Bay, Bloubergstrand' },
  'millers':   { lat: -34.2269, lon:  18.4648, days:  2, label: "Miller's Point" },
  'langebaan': { lat: -33.03,   lon:  17.97,   days:  4, label: 'Langebaan lagoon' },
  'dover':     { lat:  51.1279, lon:   1.3134, days: 14, label: 'Dover' },
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.WORLDTIDES_API_KEY;
  if (!key) {
    // Named explicitly: a missing env var here looks exactly like an API
    // outage from the browser, and the pages already have a tide-free
    // fallback. Say which it is in the logs.
    console.error('tides: WORLDTIDES_API_KEY is not set');
    return res.status(503).json({ error: 'Tide data is not configured' });
  }

  const place = PLACES[String(req.query.place || '').toLowerCase()];
  if (!place) {
    return res.status(400).json({
      error: 'Unknown "place"',
      allowed: Object.keys(PLACES),
    });
  }

  // Cached hard, and this is the second reason the route exists. Tide
  // extremes are computed from harmonics — tomorrow's high water does not
  // change during the day — so one upstream call can serve every visitor for
  // hours. Two of the pages appended `&_=${Date.now()}` to defeat caching
  // entirely, meaning every page load cost a credit.
  //
  // s-maxage 6h, stale-while-revalidate 24h: a visitor never waits for the
  // upstream, and a WorldTides outage keeps serving yesterday's answer rather
  // than showing nothing.
  res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');

  const url = `${WORLDTIDES_URL}?extremes&lat=${place.lat}&lon=${place.lon}` +
              `&days=${place.days}&datum=LAT&key=${encodeURIComponent(key)}`;

  let upstream;
  try {
    upstream = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (err) {
    console.error('tides: upstream fetch failed:', err.message);
    return res.status(502).json({ error: 'Could not reach the tide service' });
  }

  let json;
  try {
    json = await upstream.json();
  } catch {
    console.error('tides: upstream returned non-JSON, status', upstream.status);
    return res.status(502).json({ error: 'Tide service returned something unreadable' });
  }

  if (!upstream.ok || json.error) {
    // WorldTides reports "no credits" as a 200 with an error field as often
    // as a 4xx, so both are treated the same. The upstream message is logged
    // but NOT returned: it can name the account and the key.
    console.error('tides: upstream error', upstream.status, json.error || '(no message)');
    // Do not cache a failure for six hours — that would hide the recovery.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Tide data is unavailable right now' });
  }

  // Only what the pages draw. The upstream response carries the station,
  // the datum and a copyright block; forwarding the lot would leak more of
  // our account's shape than a public endpoint needs to.
  return res.status(200).json({
    place: place.label,
    days: place.days,
    extremes: Array.isArray(json.extremes)
      ? json.extremes.map((e) => ({ dt: e.dt, date: e.date, height: e.height, type: e.type }))
      : [],
  });
}
