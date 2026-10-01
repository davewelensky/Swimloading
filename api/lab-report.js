// POST /api/lab-report   (Aquasharks Lab SwimBETTER report generator)
//
//   { action:'extract',   pdf_base64, filename }        EO PDF -> normalized data (no coaching)
//   { action:'interpret', normalized, mode, rules, previous? }  approved data -> Aqua Sharks coaching
//   { action:'save',      assessment, evidence_pages, approve }  store the assessment (needs the
//                                                                2026-10-01 swim-lab-assessments migration)
//   { action:'list',      name? }  / { action:'get', id }
//
// Auth: caller's Supabase access token, checked against club_admins for the Aquasharks club.
// Club: Aquasharks only. Not feature-flagged because it is a standalone admin endpoint, not shared UI.
//
// EO is the measurement layer, Aqua Sharks the interpretation layer. extract never coaches,
// interpret never measures, and a guard flags any number in the coaching text that is not in the data.

import { extractReport, interpretReport } from './_lib/lab-report/service.js';

export const config = { maxDuration: 240 };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY     = process.env.SUPABASE_ANON_KEY;
const CLUB_SLUG    = 'aqua-sharks-atlantic';

async function svc(path, init) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...(init && init.headers) },
  });
  if (!res.ok) throw new Error(`db ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function adminUser(req) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return null;
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: auth } });
  if (!who.ok) return null;
  const user = await who.json();
  if (!user || !user.id) return null;
  const [club] = await svc(`clubs?slug=eq.${CLUB_SLUG}&select=id`);
  if (!club) return null;
  const rows = await svc(`club_admins?user_id=eq.${user.id}&club_id=eq.${club.id}&select=user_id`);
  return rows && rows.length ? user.id : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'not_configured' });
  const b = req.body && typeof req.body === 'object' ? req.body : {};

  try {
    const userId = await adminUser(req);
    if (!userId) return res.status(403).json({ error: 'not_an_admin' });

    if (b.action === 'extract')   return res.status(200).json(await extractReport(typeof b.pdf_base64 === 'string' ? b.pdf_base64 : ''));
    if (b.action === 'interpret') return res.status(200).json(await interpretReport({ normalized: b.normalized, mode: b.mode, rules: b.rules, previous: b.previous }));

    if (b.action === 'list') {
      const name = typeof b.name === 'string' && b.name.trim() ? `&swimmer_key=eq.${encodeURIComponent(b.name.trim().toLowerCase())}` : '';
      const rows = await svc(`swim_lab_assessments?club_slug=eq.${CLUB_SLUG}${name}&select=id,swimmer_name,session_date,status,stroke,primary_focus&order=session_date.desc.nullslast,created_at.desc&limit=50`);
      return res.status(200).json({ assessments: rows });
    }

    if (b.action === 'get') {
      if (!/^[0-9a-f-]{36}$/.test(b.id || '')) return res.status(400).json({ error: 'id_invalid' });
      const [row] = await svc(`swim_lab_assessments?id=eq.${b.id}&club_slug=eq.${CLUB_SLUG}&select=*`);
      if (!row) return res.status(404).json({ error: 'not_found' });
      const ev = Array.isArray(row.evidence) ? row.evidence : [];
      const signed = await Promise.all(ev.map(async e => {
        const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/lab-evidence/${e.path}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }, body: JSON.stringify({ expiresIn: 3600 }),
        });
        const j = r.ok ? await r.json() : null;
        return { ...e, url: j && j.signedURL ? `${SUPABASE_URL}/storage/v1${j.signedURL}` : null };
      }));
      return res.status(200).json({ assessment: row, evidence: signed });
    }

    if (b.action === 'save') {
      const a = b.assessment || {};
      const sw = (a.normalized && a.normalized.swimmer) || {};
      const name = typeof sw.name === 'string' ? sw.name.trim().slice(0, 120) : '';
      if (!name || !a.normalized) return res.status(400).json({ error: 'swimmer_name_and_data_required' });
      const id = /^[0-9a-f-]{36}$/.test(a.id || '') ? a.id : crypto.randomUUID();
      const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(sw.session_date || '') ? sw.session_date : null;

      const evidence = [];
      for (const p of (Array.isArray(b.evidence_pages) ? b.evidence_pages.slice(0, 12) : [])) {
        const m = /^data:image\/jpeg;base64,(.+)$/.exec(p.data_url || '');
        if (!m || !/^[a-z0-9_]{1,40}$/.test(p.id || '')) continue;
        const path = `${id}/${p.id}.jpg`;
        const up = await fetch(`${SUPABASE_URL}/storage/v1/object/lab-evidence/${path}`, {
          method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }, body: Buffer.from(m[1], 'base64'),
        });
        if (up.ok) evidence.push({ id: p.id, title: String(p.title || '').slice(0, 80), path });
      }

      const approved = b.approve === true;
      const row = {
        id, club_slug: CLUB_SLUG, swimmer_name: name, swimmer_key: name.toLowerCase(), session_date: dateOk,
        swimmer_type: ['junior', 'senior', 'masters'].includes(sw.swimmer_type) ? sw.swimmer_type : null,
        primary_focus: sw.primary_focus || null, stroke: sw.stroke || null, pool_length: sw.pool_length || null, coach: sw.coach || null,
        previous_id: /^[0-9a-f-]{36}$/.test(a.previous_id || '') ? a.previous_id : null,
        source_filename: (a.normalized.source && a.normalized.source.original_filename) || null,
        normalized: a.normalized, interpretation: a.interpretation || null,
        status: approved ? 'approved' : 'draft',
        approved_by: approved ? userId : null, approved_at: approved ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      };
      if (evidence.length) row.evidence = evidence;
      const exists = a.id ? await svc(`swim_lab_assessments?id=eq.${id}&select=id`) : [];
      if (exists && exists.length) {
        await svc(`swim_lab_assessments?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(row) });
      } else {
        row.created_by = userId;
        await svc('swim_lab_assessments', { method: 'POST', body: JSON.stringify(row) });
      }
      return res.status(200).json({ id, status: row.status, evidence: evidence.length });
    }

    return res.status(400).json({ error: 'unknown_action' });
  } catch (e) {
    console.error('lab-report', e.message);
    const missing = /swim_lab_assessments|PGRST205|42P01/.test(e.message);
    return res.status(missing ? 503 : (e.status || 500)).json({ error: missing ? 'storage_not_ready' : 'failed', detail: String(e.message).slice(0, 300) });
  }
}
