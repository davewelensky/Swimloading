// HTTP handlers for the Aquasharks Lab report workflow, built by factories so the same code runs in production
// (Supabase store + club_admins auth) and in the local harness (memory store + stub auth).
import { parseUpload, cleanForStorage, readiness, buildSnapshot, newToken, isToken, SWIMMER_PROFILES } from './workflow.js';
import { renderPublicPage, notFoundPage, pdfFileName } from './page.js';
import { renderPdf } from './pdf.js';

const CLUB_SLUG = 'aqua-sharks-atlantic';
const json = (res, code, o) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const uuid = (s) => typeof s === 'string' && /^[0-9a-f-]{36}$/.test(s);

/** Production auth: Supabase bearer token must belong to a club_admins row for the Aquasharks club. */
export function supabaseAdminAuth() {
  const url = () => process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
  const svc = async (path) => { const r = await fetch(`${url()}/rest/v1/${path}`, { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }); if (!r.ok) throw new Error('db ' + r.status); return r.json(); };
  return async function auth(req) {
    const h = req.headers['authorization'] || ''; if (!h.startsWith('Bearer ')) return null;
    const who = await fetch(`${url()}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY, Authorization: h } });
    // The token itself was refused (expired / invalid): say so, instead of reporting it as "not an admin".
    if (!who.ok) return 'session_expired'; const user = await who.json(); if (!user || !user.id) return 'session_expired';
    const [club] = await svc(`clubs?slug=eq.${CLUB_SLUG}&select=id`); if (!club) return null;
    const rows = await svc(`club_admins?user_id=eq.${user.id}&club_id=eq.${club.id}&select=user_id`);
    return rows && rows.length ? user.id : null;
  };
}

/** @param {{ store: any, auth: (req:any)=>Promise<string|null>, callModel?: Function|null, publicBase?: (req:any)=>string }} deps */
export function makeAdminHandler({ store, auth, callModel = null, publicBase }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const userId = await auth(req);
      if (userId === 'session_expired') return json(res, 401, { error: 'session_expired' });
      if (!userId) return json(res, 403, { error: 'not_an_admin' });

      if (b.action === 'parse') {
        const out = await parseUpload({ fileBase64: b.file_base64, filename: b.filename, pageImages: b.page_images, swimmerName: b.swimmer_name }, { callModel });
        return json(res, 200, out);
      }

      if (b.action === 'save') {
        const a = cleanForStorage(b.analysis);
        const profile = SWIMMER_PROFILES.includes(b.profile) ? b.profile : null;
        const date = /^\d{4}-\d{2}-\d{2}$/.test((a.session.date && a.session.date.value) || '') ? a.session.date.value : null;
        const fields = { swimmer_name: a.swimmer.name, swimmer_key: a.swimmer.name.toLowerCase(), session_date: date, communication_profile: profile, analysis: a, schema_version: 3, source_file_name: b.filename || null };
        let row;
        if (uuid(b.id)) { const cur = await store.getById(b.id); if (!cur) return json(res, 404, { error: 'not_found' }); row = await store.update(b.id, fields); }
        else row = await store.insert({ ...fields, created_by: userId });
        if (b.file_base64 && !row.source_file_path) { const path = `${row.id}/source${/\.docx$/i.test(b.filename || '') ? '.docx' : '.pdf'}`; await store.uploadSource(path, Buffer.from(b.file_base64, 'base64'), /\.docx$/i.test(path) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf'); row = await store.update(row.id, { source_file_path: path }); }
        return json(res, 200, { id: row.id, status: row.status, updated_at: row.updated_at });
      }

      if (b.action === 'get') {
        if (!uuid(b.id)) return json(res, 400, { error: 'id_invalid' });
        const row = await store.getById(b.id); if (!row) return json(res, 404, { error: 'not_found' });
        return json(res, 200, { assessment: row, public_url: row.share_token && publicBase ? `${publicBase(req)}/aquasharks-lab/report/${row.share_token}` : null });
      }

      if (b.action === 'list') return json(res, 200, { assessments: await store.list({ name: b.name }) });

      if (b.action === 'readiness') {
        const a = cleanForStorage(b.analysis); return json(res, 200, readiness(a, b.profile));
      }

      if (b.action === 'publish') {
        if (!uuid(b.id)) return json(res, 400, { error: 'id_invalid' });
        const row = await store.getById(b.id); if (!row) return json(res, 404, { error: 'not_found' });
        const a = cleanForStorage(b.analysis || row.analysis);
        const rd = readiness(a, b.profile);
        if (rd.blockers.length) return json(res, 422, { error: 'not_ready', blockers: rd.blockers });
        if (rd.warnings.length && b.acknowledge_warnings !== true) return json(res, 409, { error: 'warnings_unacknowledged', warnings: rd.warnings });
        const snap = buildSnapshot(a, b.profile);
        const token = row.share_token && isToken(row.share_token) ? row.share_token : newToken();
        const date = /^\d{4}-\d{2}-\d{2}$/.test((a.session.date && a.session.date.value) || '') ? a.session.date.value : null;
        await store.update(b.id, { analysis: a, swimmer_name: a.swimmer.name, swimmer_key: a.swimmer.name.toLowerCase(), session_date: date, communication_profile: snap.profile, status: 'published', share_token: token, published_report: snap, published_at: new Date().toISOString(), published_by: userId });
        return json(res, 200, { token, url: publicBase ? `${publicBase(req)}/aquasharks-lab/report/${token}` : null, pdf_url: publicBase ? `${publicBase(req)}/api/lab-report-pdf?t=${token}` : null, warnings: rd.warnings });
      }

      if (b.action === 'unpublish') {
        if (!uuid(b.id)) return json(res, 400, { error: 'id_invalid' });
        const row = await store.getById(b.id); if (!row) return json(res, 404, { error: 'not_found' });
        await store.update(b.id, { status: 'draft', share_token: null, published_report: null, published_at: null });
        return json(res, 200, { ok: true });
      }
      return json(res, 400, { error: 'unknown_action' });
    } catch (e) {
      console.error('lab-report', e.message);
      const missing = /swim_lab_assessments|PGRST205|42P01/.test(e.message);
      return json(res, missing ? 503 : (e.status || 500), { error: missing ? 'storage_not_ready' : (e.code || 'failed'), detail: String(e.message).slice(0, 300) });
    }
  };
}

/** Public report (HTML) by share token. No login: the token is the credential. */
export function makePublicHandler({ store }) {
  return async function handler(req, res) {
    const t = (req.query && req.query.t) || new URL(req.url, 'http://x').searchParams.get('t');
    const print = (req.query && req.query.print) === '1' || new URL(req.url, 'http://x').searchParams.get('print') === '1';
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.setHeader('Referrer-Policy', 'no-referrer');
    if (!isToken(t)) { res.statusCode = 404; return res.end(notFoundPage()); }
    try {
      const row = await store.getByToken(t);
      if (!row) { res.statusCode = 404; return res.end(notFoundPage()); }
      res.statusCode = 200; return res.end(renderPublicPage({ snapshot: row.published_report, name: row.swimmer_name, date: row.session_date, token: t, print }));
    } catch (e) { console.error('lab-report-public', e.message); res.statusCode = /swim_lab_assessments|PGRST205|42P01/.test(e.message) ? 404 : 500; return res.end(notFoundPage()); }
  };
}

/** PDF of a published report, rendered from its own public page. */
export function makePdfHandler({ store, baseUrl, render = renderPdf }) {
  return async function handler(req, res) {
    const t = (req.query && req.query.t) || new URL(req.url, 'http://x').searchParams.get('t');
    if (!isToken(t)) { res.statusCode = 404; return res.end('not found'); }
    try {
      const row = await store.getByToken(t); if (!row) { res.statusCode = 404; return res.end('not found'); }
      const pdf = await render(`${baseUrl(req)}/aquasharks-lab/report/${t}?print=1`);
      res.statusCode = 200; res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${pdfFileName(row.swimmer_name, row.session_date)}"`); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex');
      return res.end(pdf);
    } catch (e) { console.error('lab-report-pdf', e.message); res.statusCode = /swim_lab_assessments|PGRST205|42P01/.test(e.message) ? 404 : 500; return res.end(/swim_lab_assessments|PGRST205|42P01/.test(e.message) ? 'not found' : 'could not render the PDF'); }
  };
}
