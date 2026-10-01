// Local harness for the Aquasharks Lab workflow: static files + the REAL handlers with an in-memory store and a stub admin login.
// Vision uses the real model (ANTHROPIC_API_KEY); the PDF uses a local Chrome (LAB_CHROME_PATH, default: macOS Google Chrome).
//   node scripts/lab-report-dev.mjs   ->  http://localhost:3011/aquasharks-lab/report-builder
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { makeAdminHandler, makePublicHandler, makePdfHandler } from '../api/_lib/lab-report/handlers.js';
import { memoryStore } from '../api/_lib/lab-report/store.js';
import { claude } from '../api/_lib/lab-report/service.js';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); const PORT = process.env.PORT || 3011;
process.env.LAB_CHROME_PATH = process.env.LAB_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const store = memoryStore(); const base = (req) => `http://${req.headers.host}`;
const admin = makeAdminHandler({ store, auth: async () => 'dev-admin', callModel: process.env.ANTHROPIC_API_KEY ? ({ system, tool, content }) => claude({ system, tool, content, maxTokens: 3000 }) : null, publicBase: base });
const pub = makePublicHandler({ store }), pdf = makePdfHandler({ store, baseUrl: base });
const ROUTES = { '/aquasharks-lab/report-builder': 'aquasharks-lab-report-builder.html', '/aquasharks-lab/report-preview': 'aquasharks-report-preview.html' };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); req.query = Object.fromEntries(u.searchParams);
  if (req.method === 'POST' && u.pathname === '/api/lab-report') { const c = []; for await (const x of req) c.push(x); try { req.body = JSON.parse(Buffer.concat(c).toString() || '{}'); } catch { req.body = {}; } return admin(req, res); }
  if (u.pathname === '/api/lab-report-pdf') return pdf(req, res);
  const m = /^\/aquasharks-lab\/report\/([A-Za-z0-9_-]{32,64})$/.exec(u.pathname); if (m) { req.query.t = m[1]; return pub(req, res); }
  const file = path.join(ROOT, ROUTES[u.pathname] || u.pathname);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  let body = fs.readFileSync(file); if (file.endsWith('aquasharks-lab-report-builder.html')) body = Buffer.from(body.toString().replace('<head>', '<head><script>window.__LAB_DEV=true</script>'));
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body);
}).listen(PORT, () => console.log(`lab harness: http://localhost:${PORT}/aquasharks-lab/report-builder  (vision ${process.env.ANTHROPIC_API_KEY ? 'ON' : 'OFF'})`));
