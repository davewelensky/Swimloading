// Temperature history for a spot's approved primary station.
//
// The platform has been storing hourly observations since the first
// provider went live, and until now nothing showed them: a swimmer could
// see that the water is 16.4°C but not whether it has been climbing all
// week or dropped four degrees overnight — which is the question a cold
// water swimmer actually asks before deciding what to wear.
//
// Rendered server-side as inline SVG. No chart library (the repo has none
// on public pages, and one would cost more than this feature is worth), no
// client fetch, no layout shift, and it still reads correctly with
// JavaScript disabled. Same contract as the rest of this module: any
// failure returns null and the section simply does not appear.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A line needs enough points to describe a shape. Two readings joined by a
// straight line look like a trend and are not one.
export const MIN_POINTS = 6;
export const HISTORY_HOURS = 48;

/**
 * @returns {Promise<Array<{t:Date, c:number}>>} oldest → newest, [] on any failure
 */
export async function getStationHistory(stationId, opts = {}) {
  if (typeof stationId !== 'string' || !UUID_RE.test(stationId)) return [];
  const fetchImpl = opts.fetchImpl || fetch;
  const hours = opts.hours ?? HISTORY_HOURS;
  const since = new Date((opts.now?.getTime() ?? Date.now()) - hours * 3_600_000).toISOString();

  try {
    const res = await fetchImpl(
      `${SUPABASE_URL}/rest/v1/observations?station_id=eq.${stationId}`
      + `&observed_at=gte.${encodeURIComponent(since)}`
      + '&water_temperature_c=not.is.null'
      + '&select=observed_at,water_temperature_c&order=observed_at.asc&limit=500',
      {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!res.ok) return [];
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows
      // Number(null) is 0. The query already excludes null temperatures, but
      // a 0 °C point invented from a null would be indistinguishable from a
      // real ice reading, so the guard is explicit rather than implied.
      .filter((r) => r && r.water_temperature_c != null && r.water_temperature_c !== '')
      .map((r) => ({ t: new Date(r.observed_at), c: Number(r.water_temperature_c) }))
      .filter((p) => !Number.isNaN(p.t.getTime()) && Number.isFinite(p.c));
  } catch {
    return [];
  }
}

/**
 * Summarise a series. Exported for tests and for the sentence under the
 * chart, which carries the actual information for anyone who cannot see or
 * does not read the picture.
 */
export function summariseHistory(points) {
  if (!points || points.length < MIN_POINTS) return null;
  const temps = points.map((p) => p.c);
  const first = points[0];
  const last = points[points.length - 1];
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const changeC = Math.round((last.c - first.c) * 10) / 10;
  return {
    points: points.length,
    minC: Math.round(min * 10) / 10,
    maxC: Math.round(max * 10) / 10,
    firstC: Math.round(first.c * 10) / 10,
    latestC: Math.round(last.c * 10) / 10,
    changeC,
    // A tenth of a degree either way is measurement noise, not a trend.
    direction: changeC > 0.3 ? 'warming' : changeC < -0.3 ? 'cooling' : 'steady',
    spanHours: Math.round((last.t - first.t) / 3_600_000),
    from: first.t,
    to: last.t,
  };
}

/**
 * Inline SVG sparkline + a plain-language sentence.
 * @returns {string} HTML, or '' when there is not enough to show honestly
 */
export function renderHistoryChart(points, opts = {}) {
  const summary = summariseHistory(points);
  if (!summary) return '';

  const W = 640, H = 140, PAD_X = 8, PAD_Y = 16;
  const temps = points.map((p) => p.c);
  const lo = Math.min(...temps);
  const hi = Math.max(...temps);
  // A flat series must not render as a jagged line through floating-point
  // noise, so give a degenerate range a sensible band.
  const span = hi - lo < 0.5 ? 0.5 : hi - lo;
  const mid = (hi + lo) / 2;
  const yLo = hi - lo < 0.5 ? mid - 0.25 : lo;

  const t0 = points[0].t.getTime();
  const tSpan = Math.max(1, points[points.length - 1].t.getTime() - t0);
  const x = (p) => PAD_X + ((p.t.getTime() - t0) / tSpan) * (W - PAD_X * 2);
  const y = (p) => PAD_Y + (1 - (p.c - yLo) / span) * (H - PAD_Y * 2);

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p).toFixed(1)}`).join('');
  const area = `${line}L${x(points[points.length - 1]).toFixed(1)},${H - PAD_Y}L${x(points[0]).toFixed(1)},${H - PAD_Y}Z`;

  const TREND = { warming: 'warmer', cooling: 'colder', steady: 'about the same' };
  const changeText = summary.direction === 'steady'
    ? `holding around ${summary.latestC}°C`
    : `${Math.abs(summary.changeC)}°C ${TREND[summary.direction]} than ${summary.spanHours} hours ago`;

  const label = `Water temperature over the last ${summary.spanHours} hours: `
    + `low ${summary.minC}°C, high ${summary.maxC}°C, now ${summary.latestC}°C.`;

  return `
      <section class="observed-history" style="margin:22px 0;">
        <h2>Last ${summary.spanHours} Hours</h2>
        <div style="background:rgba(56,189,248,0.04);border:1px solid rgba(56,189,248,0.15);border-radius:14px;padding:16px 18px;">
          <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeAttr(label)}"
               style="width:100%;height:auto;display:block;overflow:visible;">
            <defs>
              <linearGradient id="histFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.28"/>
                <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <path d="${area}" fill="url(#histFill)"/>
            <path d="${line}" fill="none" stroke="#38bdf8" stroke-width="2"
                  stroke-linejoin="round" stroke-linecap="round"/>
            <circle cx="${x(points[points.length - 1]).toFixed(1)}" cy="${y(points[points.length - 1]).toFixed(1)}"
                    r="3.5" fill="#38bdf8"/>
            <text x="${PAD_X}" y="11" fill="#64748b" font-size="11" font-family="DM Sans, sans-serif">${summary.maxC}&deg;C high</text>
            <text x="${PAD_X}" y="${H - 3}" fill="#64748b" font-size="11" font-family="DM Sans, sans-serif">${summary.minC}&deg;C low</text>
          </svg>
          <div style="font-size:13px;color:#94a3b8;margin-top:10px;">
            ${summary.points} measurements &middot; ${escapeAttr(changeText)}
          </div>
        </div>
      </section>`;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
