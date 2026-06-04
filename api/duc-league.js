// GET /api/duc-league?endpoint=events
// GET /api/duc-league?endpoint=standings
// GET /api/duc-league?endpoint=results&id=14
// GET /api/duc-league?endpoint=swimmer&id=273
// Proxy to ducs.co.za API — keeps the key off the client.

const DUCS_BASE = 'https://ducs.co.za/api/v1';

export default async function handler(req, res) {
  const { endpoint, id } = req.query;
  let path;
  if (endpoint === 'events')                    path = '/events';
  else if (endpoint === 'standings')            path = '/standings';
  else if (endpoint === 'results' && id)        path = `/events/${id}/results`;
  else if (endpoint === 'swimmer' && id)        path = `/swimmers/${id}`;
  else return res.status(400).json({ error: 'Invalid endpoint' });

  const key = process.env.DUCS_API_KEY;
  if (!key) return res.status(500).json({ error: 'DUCS_API_KEY not configured' });

  const upstream = await fetch(DUCS_BASE + path, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    redirect: 'follow',
  });

  if (!upstream.ok) {
    return res.status(upstream.status).json({ error: `Upstream error ${upstream.status}` });
  }

  const data = await upstream.json();
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
  res.json(data);
}
