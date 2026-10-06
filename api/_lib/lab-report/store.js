// Persistence for lab assessments. Two implementations behind one interface:
//   supabaseStore()  production (REST + storage, service key)
//   memoryStore()    local harness and tests
const SUPABASE_URL = () => process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
const CLUB = 'aqua-sharks-atlantic';

export function supabaseStore() {
  const rest = async (path, init) => {
    const res = await fetch(`${SUPABASE_URL()}/rest/v1/${path}`, { ...init, headers: { 'Content-Type': 'application/json', apikey: KEY(), Authorization: `Bearer ${KEY()}`, ...(init && init.headers) } });
    if (!res.ok) throw new Error(`db ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  // session and exportId are small slices of the stored analysis: enough to match an earlier swim without loading it
  const sel = 'id,club_slug,swimmer_name,swimmer_key,session_date,communication_profile,status,share_token,published_at,source_file_name,created_at,updated_at,session:analysis->session,exportId:analysis->source->exportId';
  return {
    async insert(row) { const [r] = await rest('swim_lab_assessments', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) }); return r; },
    async update(id, patch) { const [r] = await rest(`swim_lab_assessments?id=eq.${id}&club_slug=eq.${CLUB}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) }); return r; },
    async getById(id) { const [r] = await rest(`swim_lab_assessments?id=eq.${id}&club_slug=eq.${CLUB}&select=*`); return r || null; },
    async getByToken(token) { const [r] = await rest(`swim_lab_assessments?share_token=eq.${encodeURIComponent(token)}&status=eq.published&select=swimmer_name,session_date,communication_profile,published_report,published_at`); return r || null; },
    async list({ name, limit = 50 } = {}) {
      limit = Math.max(1, Math.min(200, Number(limit) || 50));
      const f = name ? `&swimmer_key=eq.${encodeURIComponent(String(name).trim().toLowerCase())}` : '';
      return rest(`swim_lab_assessments?club_slug=eq.${CLUB}${f}&select=${sel}&order=updated_at.desc&limit=${limit}`);
    },
    async uploadSource(path, bytes, contentType) {
      const r = await fetch(`${SUPABASE_URL()}/storage/v1/object/lab-evidence/${path}`, { method: 'POST', headers: { 'Content-Type': contentType, 'x-upsert': 'true', apikey: KEY(), Authorization: `Bearer ${KEY()}` }, body: bytes });
      if (!r.ok) throw new Error('storage ' + r.status);
    },
  };
}

export function memoryStore() {
  const rows = new Map(), files = new Map();
  const clone = (x) => JSON.parse(JSON.stringify(x));
  return {
    rows, files,
    async insert(row) { const r = { id: row.id || crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), status: 'draft', club_slug: CLUB, ...clone(row) }; rows.set(r.id, r); return clone(r); },
    async update(id, patch) { const r = rows.get(id); if (!r) return null; Object.assign(r, clone(patch), { updated_at: new Date().toISOString() }); return clone(r); },
    async getById(id) { const r = rows.get(id); return r ? clone(r) : null; },
    async getByToken(token) { const r = [...rows.values()].find((x) => x.share_token === token && x.status === 'published'); return r ? clone({ swimmer_name: r.swimmer_name, session_date: r.session_date, communication_profile: r.communication_profile, published_report: r.published_report, published_at: r.published_at }) : null; },
    async list({ name } = {}) { return [...rows.values()].filter((r) => !name || r.swimmer_key === String(name).trim().toLowerCase()).map((r) => { const { analysis, published_report, ...rest } = clone(r); return { ...rest, session: analysis && analysis.session ? analysis.session : null, exportId: analysis && analysis.source ? analysis.source.exportId || null : null }; }); },
    async uploadSource(path, bytes) { files.set(path, bytes); },
  };
}
