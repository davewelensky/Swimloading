// Server-rendered public report page. Renders a FROZEN swimmer-facing snapshot; nothing else about the assessment is exposed.
import { renderReport } from '../../../aquasharks-lab/analysis/report-view.js';
import { fmtDate } from '../../../aquasharks-lab/analysis/language.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function pdfFileName(name, date) {
  const slug = String(name || 'swimmer').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'swimmer';
  return `Aqua-Sharks-SwimBETTER-${slug}${date ? '-' + date : ''}.pdf`;
}

/** @param {{ snapshot: any, name: string, date: string|null, token: string, print?: boolean }} o */
export function renderPublicPage({ snapshot, name, date, token, print }) {
  const body = renderReport(snapshot.model);
  const title = `${name} | SwimBETTER analysis | Aqua Sharks Lab`;
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/aquasharks-lab/report-builder/report.css?v=3"><link rel="stylesheet" href="/aquasharks-lab/analysis/report-view.css?v=23">
<script src="https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.min.js"></script>
</head><body>
${print ? '' : `<div class="rvbar"><div class="grp"><strong>${esc(name)}</strong><span style="color:#94a3b8">${esc(fmtDate(date) || '')}</span></div>
<div class="grp"><a class="btn primary" style="text-decoration:none;display:inline-flex;align-items:center;padding:8px 18px;border-radius:50px;font-weight:700" href="/api/lab-report-pdf?t=${esc(token)}" id="dl">Download PDF</a></div></div>`}
${body}
<script>if(window.lucide)lucide.createIcons();document.documentElement.setAttribute('data-ready','1')</script>
</body></html>`;
}

export function notFoundPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Report not found</title>
<style>body{background:#080f1a;color:#f1f5f9;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px}h1{font-size:28px;margin:0 0 8px}p{color:#94a3b8}</style></head>
<body><div><h1>This report is not available</h1><p>The link may have been withdrawn or mistyped. Ask your coach for a new one.</p></div></body></html>`;
}
