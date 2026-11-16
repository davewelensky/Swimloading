// Local harness for the JAKED "Register your interest" flow: static files + the REAL handlers from
// api/_lib/partner-enquiries/core.js, with an in-memory store, a logging mailer and a stub login.
// Nothing touches Supabase or Resend.
//   node scripts/partner-enquiry-dev.mjs          ->  http://localhost:3013/partners/jaked
//   http://localhost:3013/partners/jaked?as=member   (signed-in member: name/email prefilled)
//   http://localhost:3013/partner-enquiries?as=admin (admin view)   ?as=member (shows "Admins only")
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { makePublicHandler, makeAdminHandler, memoryStore } from '../api/_lib/partner-enquiries/core.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = process.env.PORT || 3013;
const store = memoryStore();
const USERS = { admin: { id: '00000000-0000-0000-0000-0000000000a1', admin: true }, member: { id: '00000000-0000-0000-0000-0000000000b2', admin: false } };
const tokenOf = (req) => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');

const pub = makePublicHandler({
  store,
  sendMail: async (row) => { console.log(`[mail] notify Dave + confirm to ${row.email}: ${row.reference}`); return { notified: true, customerEmailed: true }; },
  whoIs: async (req) => (USERS[tokenOf(req)] || {}).id || null,
});
const admin = makeAdminHandler({
  store,
  auth: async (req) => { const t = tokenOf(req); if (!t) return { status: 401, error: 'Sign in first' }; const u = USERS[t]; if (!u) return { status: 401, error: 'Session expired. Sign in again.' }; return u.admin ? { userId: u.id } : { status: 403, error: 'Admins only' }; },
});

// A fake supabase-js session in localStorage, so the pages behave as if someone is signed in.
const fakeSession = (who) => `<script>try{localStorage.setItem('sb-szgkzuswelntnevobnoh-auth-token',JSON.stringify({access_token:'${who}',refresh_token:'dev',token_type:'bearer',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,user:{id:'${USERS[who].id}',email:'${who}@example.com',user_metadata:{full_name:'Dev ${who[0].toUpperCase() + who.slice(1)}'}}}))}catch(e){}</script>`;
const clearSession = `<script>try{localStorage.removeItem('sb-szgkzuswelntnevobnoh-auth-token')}catch(e){}</script>`;

const ROUTES = { '/partner-enquiries': 'partner-enquiries.html', '/jaked': 'partners/jaked.html', '/privacy': 'privacy.html' };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  req.query = Object.fromEntries(u.searchParams);
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); return res; };
  res.send = (b) => { res.end(b); return res; };
  if (u.pathname.startsWith('/api/')) {
    const c = []; for await (const x of req) c.push(x);
    try { req.body = JSON.parse(Buffer.concat(c).toString() || '{}'); } catch { req.body = {}; }
    if (u.pathname === '/api/partner-enquiry') return pub(req, res);
    if (u.pathname === '/api/partner-enquiries') return admin(req, res);
    res.statusCode = 404; return res.end('{}');
  }
  let rel = ROUTES[u.pathname] || u.pathname.replace(/^\//, '');
  if (rel === 'partners/jaked') rel = 'partners/jaked.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  let body = fs.readFileSync(file);
  if (file.endsWith('.html')) {
    const who = USERS[u.searchParams.get('as')] ? u.searchParams.get('as') : null;
    body = Buffer.from(body.toString().replace('<head>', '<head>' + (who ? fakeSession(who) : clearSession)));
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(body);
}).listen(PORT, () => console.log(`partner enquiry harness: http://localhost:${PORT}/partners/jaked  (in-memory store, no email sent)`));
