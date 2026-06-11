// GET /api/channel-conditions
// Proxy for English Channel live conditions (english-channel.html).
// NDBC and NOAA ERDDAP have no CORS headers and must be fetched server-side.
// Edge-cached 30 min.

// NCEI ERDDAP — OISST v2 preliminary (near-realtime, updated daily)
// Confirmed working June 2026; returns ~14-17°C for Dover Strait in season.
const NCEI_SST_URL = 'https://www.ncei.noaa.gov/erddap/griddap/ncdc_oisst_v2_avhrr_prelim_by_time_zlev_lat_lon.json?sst[(last)][(0.0)][(51.0):(51.5)][(1.0):(2.0)]';

// Coastwatch fallback (slower / less reliable but same data format)
const COASTWATCH_SST_URL = 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/ncdcOisst21Agg_LonPM180.json?sst[(last)][(0.0)][(51.0):(51.5)][(1.0):(2.0)]';

// Sandettie Lightship buoy — NDBC station 62304
const NDBC_SANDETTIE_URL = 'https://www.ndbc.noaa.gov/data/realtime2/62304.txt';

const round1 = (v) => Math.round(v * 10) / 10;

async function fetchErddapSST(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const json = await res.json();
  const cols = json?.table?.columnNames || [];
  const rows = json?.table?.rows || [];
  const sstIdx = cols.indexOf('sst') !== -1 ? cols.indexOf('sst') : cols.length - 1;
  const vals = rows.map((r) => r[sstIdx]).filter((v) => v !== null && !isNaN(v));
  if (!vals.length) return null;
  return round1(vals.reduce((a, b) => a + b, 0) / vals.length);
}

async function fetchNoaaSST() {
  try {
    // Try NCEI first (primary — near-realtime OISST preliminary)
    const ncei = await fetchErddapSST(NCEI_SST_URL);
    if (ncei !== null) return ncei;
    // Fall back to coastwatch
    return await fetchErddapSST(COASTWATCH_SST_URL);
  } catch {
    try { return await fetchErddapSST(COASTWATCH_SST_URL); } catch { return null; }
  }
}

async function fetchSandettie() {
  try {
    const res = await fetch(NDBC_SANDETTIE_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { wind_kt: null, wtmp_c: null, obs_utc: null };
    const text = await res.text();
    const rows = text.split('\n')
      .filter((l) => l.trim() && !l.startsWith('#'))
      .map((l) => l.trim().split(/\s+/));
    // Newest observation first; a field may be 'MM' (missing) — scan down for first real value
    const firstVal = (idx) => {
      for (const row of rows) {
        const v = row[idx];
        if (v !== undefined && v !== 'MM' && !isNaN(parseFloat(v))) return parseFloat(v);
      }
      return null;
    };
    const wspdMs = firstVal(6);   // WSPD m/s
    const wtmpC = firstVal(14);   // WTMP °C
    const [yy, mo, dd, hh, mn] = rows[0] || [];
    const obs = yy ? `${yy}-${mo}-${dd}T${hh}:${mn}:00Z` : null;
    return {
      wind_kt: wspdMs === null ? null : round1(wspdMs * 1.944),
      wtmp_c: wtmpC === null ? null : round1(wtmpC),
      obs_utc: obs,
    };
  } catch {
    return { wind_kt: null, wtmp_c: null, obs_utc: null };
  }
}

export default async function handler(req, res) {
  const [sst, buoy] = await Promise.all([fetchNoaaSST(), fetchSandettie()]);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  return res.status(200).json({
    sst_c: sst,
    wind_kt: buoy.wind_kt,
    wtmp_c: buoy.wtmp_c,
    buoy_obs_utc: buoy.obs_utc,
    fetched_at: new Date().toISOString(),
    sources: {
      sst: 'NOAA OISST v2.1 satellite',
      buoy: 'Sandettie Lightship (NDBC 62304)',
    },
  });
}
