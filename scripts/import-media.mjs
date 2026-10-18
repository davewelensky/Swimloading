// Bulk-import exported photographs into the media catalogue. This is the supported route for the
// founder's Google Photos albums: Google offers no bulk API for shared-album links (see
// docs/social-engine/MEDIA_LIBRARY.md), so download each album (Google Photos: album > ... >
// Download all), unzip it to a folder, then:
//
//   node scripts/import-media.mjs ~/Downloads/Bakoven --album "K8 Bakoven" --owner "Dave Welensky" \
//        --approve --people none [--manifest bakoven.csv] [--dry-run]
//
// Without --approve every photo is imported UNAPPROVED and is never selected for social.
// Optional manifest.csv columns: filename,location,country,spot,region,subject,tags,photographer,session
// (tags separated by |). Photos in the same album taken within the same 3-hour block share a
// session, so consecutive posts do not reuse one swim. Near-duplicates of existing photos are skipped.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, extname, basename } from 'node:path';
import { imageSize, exifDate, sessionFor, hamming } from '../api/_lib/social/media.js';
import { dhashFiles } from '../api/_lib/social/imagehash.js';
import { dbGet } from '../api/seo-utils.js';
import { SOCIAL_DEFAULTS } from '../api/_lib/social/config.js';

process.env.LAB_CHROME_PATH ||= '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const dir = argv[0] && !argv[0].startsWith('--') ? resolve(argv[0]) : null;
if (!dir || !existsSync(dir)) { console.error('usage: import-media.mjs <folder> --album "<name>" --owner "<name>" [--approve --people none|some [--consent confirmed]] [--manifest f.csv] [--dry-run]'); process.exit(1); }
const album = opt('album'), owner = opt('owner');
if (!album || !owner) { console.error('--album and --owner are required'); process.exit(1); }
const approve = flag('approve'), people = opt('people'), consent = opt('consent');
if (approve && !['none', 'some'].includes(people)) { console.error('--approve needs --people none|some (are identifiable swimmers visible?)'); process.exit(1); }
if (approve && people === 'some' && consent !== 'confirmed') console.warn('Note: identifiable people without --consent confirmed: these photos will route posts to review.');

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const CATALOGUE = resolve('media-library/catalogue.json');
const cat = JSON.parse(readFileSync(CATALOGUE, 'utf8'));

const manifest = {};
if (opt('manifest')) {
  const [head, ...rows] = readFileSync(opt('manifest'), 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',').map((c) => c.trim());
  for (const r of rows) { const v = r.split(','); manifest[v[0].trim()] = Object.fromEntries(cols.map((c, i) => [c, (v[i] || '').trim()])); }
}

const files = readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
const aSlug = slug(album);
const dest = resolve('media-library/files', aSlug);
const staged = files.map((f) => {
  const buf = readFileSync(join(dir, f));
  return { f, buf, sha: createHash('sha1').update(buf).digest('hex').slice(0, 10) };
});
const hashes = await dhashFiles(staged.map((s) => join(dir, s.f)));
const report = { added: 0, skipped: [] };
for (const s of staged) {
  const id = `${aSlug}-${s.sha}`;
  if (cat.assets.some((a) => a.id === id)) { report.skipped.push(`${s.f}: already imported`); continue; }
  const h = hashes[join(dir, s.f)];
  const near = cat.assets.find((a) => hamming(a.dhash, h) <= SOCIAL_DEFAULTS.media.dupDistance);
  if (near && !flag('keep-dups')) { report.skipped.push(`${s.f}: near-duplicate of ${near.id}`); continue; }
  const m = manifest[s.f] || {};
  const { w, h: ht } = imageSize(s.buf);
  let spotId = null, spotName = null;
  if (m.spot) { const r = await dbGet(`spots?select=id,name&name=ilike.${encodeURIComponent(m.spot)}&active=eq.true`); spotId = r?.[0]?.id || null; spotName = r?.[0]?.name || null; if (!spotId) report.skipped.push(`${s.f}: spot "${m.spot}" not found, imported as region/generic`); }
  const iso = exifDate(s.buf);
  const subject = spotId || m.region || m.location ? 'location' : (m.subject || 'generic');
  const asset = {
    id, file: `media-library/files/${aSlug}/${s.f}`, filename: s.f, kind: 'photo', source: 'google-photos-export', album,
    owner, photographer: m.photographer || owner, location: spotName || m.location || null, country: m.country || null, spotId, region: m.region || null,
    subject, tags: m.tags ? m.tags.split('|') : [], permission: 'owned', attribution: null,
    approvedForSocial: approve || /^(y|yes|true)$/i.test(m.approved || ''), provenanceConfirmed: approve,
    identifiablePeople: approve ? people === 'some' : null, consent: approve && people === 'some' ? (consent || 'unknown') : 'n/a',
    focus: { x: 50, y: 50 }, sessionId: m.session || sessionFor(aSlug, iso, id), capturedAt: iso, dhash: h,
    notes: `Imported ${new Date().toISOString().slice(0, 10)} from "${album}" (${w}x${ht}).`,
  };
  if (!flag('dry-run')) { mkdirSync(dest, { recursive: true }); copyFileSync(join(dir, s.f), join(dest, s.f)); cat.assets.push(asset); }
  report.added++;
  console.log(`${flag('dry-run') ? '[dry] ' : ''}+ ${s.f}  ${w}x${ht}  session ${asset.sessionId}  ${asset.approvedForSocial ? 'APPROVED' : 'unapproved'}`);
}
if (!flag('dry-run')) writeFileSync(CATALOGUE, JSON.stringify(cat, null, 2));
console.log(`${report.added} added, ${report.skipped.length} skipped`); report.skipped.forEach((x) => console.log('  skipped', x));
