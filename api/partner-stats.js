// GET /api/partner-stats?partner=jaked&days=14
// Engagement report for one partner page, built from analytics_events (partner_<slug>_* events recorded by the
// partner pages). ADMIN ONLY: the caller must send their Supabase session token and be profiles.is_admin.
// Returns aggregates only: counts per day, per source, per click target. No names, emails or IP addresses exist in
// the data; "unique visitors" counts the random anonymous id a browser stores for itself (sl_vid).

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const TZ = 'Africa/Johannesburg';   // SAST: the day a swimmer in Cape Town would call "today"

function dayKey(iso) { return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }); }
function bump(map, key, by) { map[key] = (map[key] || 0) + (by || 1); }
function top(map, n) { return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n || 10).map(([k, v]) => ({ key: k, count: v })); }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Server not configured' });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in first' });

  const partner = String(req.query.partner || 'jaked').toLowerCase();
  if (!/^[a-z0-9]{2,30}$/.test(partner)) return res.status(400).json({ error: 'Bad partner' });
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 90);

  const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' };
  try {
    // 1. who is asking? (their own session token) and are they an admin?
    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
    if (!ur.ok) return res.status(401).json({ error: 'Session expired. Sign in again.' });
    const user = await ur.json();
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=is_admin`, { headers: H });
    const prof = pr.ok ? await pr.json() : [];
    if (!prof[0] || prof[0].is_admin !== true) return res.status(403).json({ error: 'Admins only' });

    // 2. the events: last `days` days for the charts, plus an all-time total for context
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const q = `analytics_events?select=event_name,properties,created_at&event_name=like.partner_${partner}_*&created_at=gte.${since}&order=created_at.asc&limit=20000`;
    const er = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: H });
    if (!er.ok) return res.status(500).json({ error: 'Could not read events' });
    const rows = await er.json();
    const allr = await fetch(`${SUPABASE_URL}/rest/v1/analytics_events?select=id&event_name=eq.partner_${partner}_page_view`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
    const lifetimeViews = parseInt((allr.headers.get('content-range') || '').split('/')[1], 10) || 0;

    // 3. aggregate
    const suffix = `partner_${partner}_`;
    const perDay = {}, sources = {}, campaigns = {}, devices = {}, clicks = {}, targets = {}, visitors = new Set();
    let views = 0, anonViews = 0;
    const today = dayKey(new Date().toISOString());
    let viewsToday = 0;
    rows.forEach((r) => {
      const name = r.event_name.slice(suffix.length), p = r.properties || {}, d = dayKey(r.created_at);
      if (name === 'page_view') {
        views++; if (d === today) viewsToday++;
        perDay[d] = (perDay[d] || 0) + 1;
        if (p.vid) visitors.add(p.vid); else anonViews++;
        const src = p.source ? (p.medium ? `${p.source} / ${p.medium}` : p.source)
                  : p.ref ? `site: ${p.ref}`
                  : p.via === 'meta' ? 'Instagram or Facebook (untagged link)'
                  : 'Direct or unknown';
        bump(sources, src);
        if (p.campaign) bump(campaigns, p.campaign);
        bump(devices, p.dev || 'unknown');
      } else {
        bump(clicks, name);
        if (name === 'outbound_click' && p.to) bump(targets, p.to);
      }
    });
    // fill every day so quiet days show as zero
    const series = [];
    for (let i = days - 1; i >= 0; i--) { const k = dayKey(new Date(Date.now() - i * 86400000).toISOString()); series.push({ day: k, views: perDay[k] || 0 }); }

    return res.status(200).json({
      partner, days, generatedAt: new Date().toISOString(), timezone: TZ,
      totals: { views, viewsToday, uniqueVisitors: visitors.size + anonViews, lifetimeViews,
                clicks: Object.values(clicks).reduce((a, b) => a + b, 0) },
      series, sources: top(sources, 12), campaigns: top(campaigns, 8), devices: top(devices, 4),
      clicks: top(clicks, 10), outboundTargets: top(targets, 10),
      note: 'Unique visitors counts a random id each browser stores for itself; people who clear their browser data, or use another device, count again.',
    });
  } catch (e) {
    console.error('partner-stats error:', e.message);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
