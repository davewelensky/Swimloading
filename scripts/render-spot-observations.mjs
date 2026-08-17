// Observation-platform render proof, through the REAL spot handler.
//
//   node scripts/render-spot-observations.mjs
//
// Starts a local REST proxy: every Supabase query the handler makes passes
// through to the real database EXCEPT spot_conditions_live, which serves a
// controlled fixture per scenario. So each render below is the actual
// api/spots-handler.js executing its actual queries — only the observation
// view is staged, because the four freshness scenarios cannot all be true
// in production at once.
//
// Scenarios (the increment's required proofs):
//   live      → 200, card says "Live measurement"
//   recent    → 200, card present, NEVER says live/current/today
//   stale     → 200, NO card, nothing stale described as live
//   outage    → view returns 500 → 200, NO card (provider outage ≠ page 500)
import http from 'node:http';

const REAL_SUPABASE = 'https://szgkzuswelntnevobnoh.supabase.co';
const SLUG = 'la-jolla-shores';

const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

const viewRow = (observedAt) => [{
  spot_id: null, // filled per request — handler queries by eq.<uuid>
  station_id: 'seed', is_primary: true, distance_km: 1.1,
  station_name: '9410230 - La Jolla, CA', station_type: 'fixed', sensor_depth_m: null,
  water_body: null, provider_code: 'ndbc', provider_name: 'NOAA National Data Buoy Center',
  attribution: 'Data: NOAA National Data Buoy Center',
  observed_at: observedAt, water_temperature_c: 21.0, wave_height_m: 0.8,
  wave_period_s: 15, wind_speed_ms: null, wind_direction_deg: null,
  tide_height_m: null, quality_code: 'ndbc_realtime',
}];

let mode = 'live';
const MODES = {
  live: () => ({ status: 200, body: viewRow(hoursAgo(0.5)) }),
  recent: () => ({ status: 200, body: viewRow(hoursAgo(12)) }),
  stale: () => ({ status: 200, body: viewRow(hoursAgo(10 * 24)) }),
  outage: () => ({ status: 500, body: { error: 'provider infrastructure down' } }),
};

const server = http.createServer(async (req, res) => {
  if (req.url.includes('/rest/v1/spot_conditions_live')) {
    const { status, body } = MODES[mode]();
    res.writeHead(status, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(body));
  }
  // Everything else: pass through to the real database untouched.
  try {
    const upstream = await fetch(`${REAL_SUPABASE}${req.url}`, { headers: req.headers });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
    res.end(text);
  } catch (err) {
    res.writeHead(502).end(JSON.stringify({ error: err.message }));
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;

// Import AFTER env is set — the handler chain captures SUPABASE_URL at load.
const { default: handler } = await import('../api/spots-handler.js');

function mockRes() {
  return {
    statusCode: 200, body: '', headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    send(b) { this.body = String(b ?? ''); return this; },
    writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); },
    end() {},
  };
}

async function render() {
  const res = mockRes();
  const errors = [];
  const realError = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  try { await handler({ url: `/spots/${SLUG}` }, res); }
  finally { console.error = realError; }
  return { res, errors };
}

// The card's own markup, isolated so page copy (e.g. the hero badge fed by
// community logs) never pollutes the observation-language assertions.
function cardHtml(html) {
  const m = html.match(/<section class="observed-conditions"[\s\S]*?<\/section>/);
  return m ? m[0] : '';
}

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

for (const scenario of ['live', 'recent', 'stale', 'outage']) {
  mode = scenario;
  const { res, errors } = await render();
  const card = cardHtml(res.body);
  console.log(`\n── scenario: ${scenario} (${res.body.length}b, status ${res.statusCode})`);
  check('renders 200', res.statusCode === 200 && res.body.length > 5000);
  check('no handler errors', errors.length === 0, errors[0] || '');

  if (scenario === 'live') {
    check('card present', card.length > 0);
    check('says Live measurement', /Live measurement/.test(card));
    check('shows 21.0°C', /21\.0/.test(card));
    check('names station + distance + NOAA', /La Jolla, CA/.test(card) && /1\.1 km away/.test(card) && /NOAA/.test(card));
    check('nearby wording', /Nearby measured water temperature/.test(card));
  }
  if (scenario === 'recent') {
    check('card present', card.length > 0);
    check('says Recent measurement', /Recent measurement/.test(card));
    check('never says live/current/today', !/\blive\b|\bcurrent\b|\btoday\b/i.test(card));
  }
  if (scenario === 'stale') {
    check('card ABSENT (stale is not shown)', card === '');
  }
  if (scenario === 'outage') {
    check('card ABSENT', card === '');
    check('page unharmed by provider outage', res.statusCode === 200);
  }
  check('no spurious 0.0°C anywhere', !/>0\.0&deg;C</.test(res.body));
}

server.close();
if (failed) {
  console.error(`\n${failed} check(s) failed — do NOT deploy.`);
  process.exitCode = 1;
} else {
  console.log('\nAll observation render scenarios passed through the real handler.');
}
