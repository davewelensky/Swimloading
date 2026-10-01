// Local harness for the Aquasharks Lab report builder. Static files + /api/lab-report with REAL Claude calls
// (extract/interpret via the shared service) but in-memory list/get/save and NO auth. Dev only.
//   ANTHROPIC_API_KEY=... node scripts/lab-report-dev.mjs   -> http://localhost:3011/aquasharks-lab/report-builder
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { extractReport, interpretReport } from '../api/_lib/lab-report/service.js';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); const PORT = process.env.PORT || 3011;
const ROUTES = { '/aquasharks-lab/report-builder': 'aquasharks-lab-report-builder.html', '/aquasharks-lab/report-preview': 'aquasharks-report-preview.html' };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const db = new Map();
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/lab-report' && req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c); const b = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    try {
      if (b.action === 'extract') return send(200, await extractReport(b.pdf_base64));
      if (b.action === 'interpret') return send(200, await interpretReport(b));
      if (b.action === 'list') return send(200, { assessments: [...db.values()].filter(r => !b.name || r.swimmer_key === b.name.toLowerCase()).map(r => ({ id: r.id, swimmer_name: r.swimmer_name, session_date: r.session_date, status: r.status })) });
      if (b.action === 'get') { const r = db.get(b.id); return r ? send(200, { assessment: r, evidence: (r._pages || []).map(p => ({ id: p.id, url: p.data_url })) }) : send(404, { error: 'not_found' }); }
      if (b.action === 'save') {
        const a = b.assessment, id = a.id || crypto.randomUUID(), sw = a.normalized.swimmer;
        db.set(id, { id, swimmer_name: sw.name, swimmer_key: sw.name.toLowerCase(), session_date: sw.session_date, status: b.approve ? 'approved' : 'draft', previous_id: a.previous_id, normalized: a.normalized, interpretation: a.interpretation, _pages: b.evidence_pages || [] });
        return send(200, { id, status: b.approve ? 'approved' : 'draft', evidence: (b.evidence_pages || []).length });
      }
      return send(400, { error: 'unknown_action' });
    } catch (e) { console.error(e.message); return send(e.status || 500, { error: 'failed', detail: e.message }); }
  }
  let p = ROUTES[u.pathname] || u.pathname; const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  let body = fs.readFileSync(file);
  if (file.endsWith('aquasharks-lab-report-builder.html')) body = Buffer.from(body.toString().replace('<head>', '<head><script>window.__LAB_DEV=true</script>'));
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body);
}).listen(PORT, () => console.log(`lab report dev harness: http://localhost:${PORT}/aquasharks-lab/report-builder`));
