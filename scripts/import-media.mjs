// Bulk-import exported photographs into the media catalogue. This is the supported route for the
// founder's Google Photos albums: Google offers no bulk API for shared-album links (see
// docs/social-engine/MEDIA_LIBRARY.md), so download each album (Google Photos: album > ... >
// Download all), unzip it to a folder, then:
//
//   node scripts/import-media.mjs ~/Downloads/SwimLoading-Photos --owner "Dave Welensky" \
//        --region "Cape Town" --country ZA --tags ocean|cape-town [--dry-run]
//
// The folder is scanned recursively. Each sub-folder is one album ("Clifton C4"); loose files use --album.
// Nothing is approved unless --approve is given (then --people none|some is required). Review with
// `node scripts/media-approve.mjs --list`, approve later with `media-approve.mjs --album ... --people none`.
//
// Per-run defaults (apply to every photo; the manifest overrides them per file):
//   --album --owner(required) --photographer --permission owned|cc-by|cc-by-sa|partner-supplied --attribution
//   --location --country --spot "<SwimLoading spot name>" --region --subject location|generic --tags a|b|c
// Optional manifest.csv columns: filename,location,country,spot,region,subject,tags,photographer,session
// (tags separated by |; filename may be "Album/file.jpg" to disambiguate). Set `spot` ONLY when the photo
// documents exactly that spot: it is what lets the selector use it for that spot's posts.
//
// Safe by construction: existing catalogue entries and files are never modified or overwritten; the catalogue is
// backed up to media-library/.backups/ and re-read just before an atomic write; exact duplicates (SHA-1, across the
// whole library) and near-duplicates (dHash, including earlier photos in the same batch) are skipped; --dry-run
// writes nothing. Thumbnails (480px) go to media-library/thumbs/ via macOS sips.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, existsSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, join, relative, dirname, basename } from 'node:path';
import { imageSize, exifDate, sessionFor, hamming } from '../api/_lib/social/media.js';
import { dhashFiles } from '../api/_lib/social/imagehash.js';
import { dbGet } from '../api/seo-utils.js';
import { SOCIAL_DEFAULTS } from '../api/_lib/social/config.js';

process.env.LAB_CHROME_PATH ||= '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const die = (m) => { console.error(m); process.exit(1); };
const dir = argv[0] && !argv[0].startsWith('--') ? resolve(argv[0]) : null;
if (!dir || !existsSync(dir)) die('usage: import-media.mjs <folder> --owner "<name>" [--album "<name>"] [--approve --people none|some [--consent confirmed]] [--permission owned|cc-by|cc-by-sa|partner-supplied] [--photographer n] [--location l] [--country ZA] [--spot s] [--region r] [--tags a|b] [--manifest f.csv] [--dry-run]');
const owner = opt('owner');
if (!owner) die('--owner is required (who holds the rights to these photos)');
const approve = flag('approve'), people = opt('people'), consent = opt('consent');
if (approve && !['none', 'some'].includes(people)) die('--approve needs --people none|some (are identifiable swimmers visible?)');
if (approve && people === 'some' && consent !== 'confirmed') console.warn('Note: identifiable people without --consent confirmed: these photos will route posts to review.');
const permission = opt('permission') || 'owned';
if (!['owned', 'cc-by', 'cc-by-sa', 'partner-supplied'].includes(permission)) die('--permission must be owned|cc-by|cc-by-sa|partner-supplied');
if (permission !== 'owned' && permission !== 'partner-supplied' && !opt('attribution')) die(`--permission ${permission} needs --attribution "<credit line>"`);
if (opt('subject') && !['location', 'generic'].includes(opt('subject'))) die('--subject must be location|generic');
const dry = flag('dry-run');

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const CATALOGUE = resolve(ROOT, 'media-library/catalogue.json');
const readCat = () => JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const cat = readCat();

// ---- manifest
const manifest = {};
if (opt('manifest')) {
  const [head, ...rows] = readFileSync(opt('manifest'), 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',').map((c) => c.trim());
  for (const r of rows) { const v = r.split(','); manifest[v[0].trim()] = Object.fromEntries(cols.map((c, i) => [c, (v[i] || '').trim()])); }
}

// ---- scan (recursive; hidden files and non-photos ignored)
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.name.startsWith('.') ? [] : e.isDirectory() ? walk(join(d, e.name)) : /\.(jpe?g|png)$/i.test(e.name) ? [join(d, e.name)] : []);
const found = walk(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (!found.length) die(`no .jpg/.jpeg/.png photos under ${dir}`);

// ---- what is already in the library (exact bytes, wherever it was imported from)
const sha = (buf) => createHash('sha1').update(buf).digest('hex');
const knownSha = new Map(); // sha1 -> asset id
for (const a of cat.assets) {
  if (a.sha1) { knownSha.set(a.sha1, a.id); continue; }
  try { knownSha.set(sha(readFileSync(resolve(ROOT, a.file))), a.id); } catch { /* missing file: cannot compare */ }
}

const staged = found.map((abs) => {
  const rel = relative(dir, abs), parts = rel.split('/');
  const album = parts.length > 1 ? parts[parts.length - 2].trim() : (opt('album') || basename(dir));
  const buf = readFileSync(abs);
  return { abs, rel, f: parts[parts.length - 1], album, buf, sha1: sha(buf) };
});
const hashes = await dhashFiles(staged.map((s) => s.abs));

const taken = new Set(cat.assets.map((a) => a.id));
const known = cat.assets.map((a) => ({ id: a.id, dhash: a.dhash }));
const report = { added: [], skipped: [], warnings: [] };
const newAssets = [];
const sipsOk = spawnSync('sips', ['--version']).status === 0;
if (!sipsOk) report.warnings.push('sips not found: thumbnails not generated (macOS only)');

for (const s of staged) {
  const aSlug = slug(s.album);
  const exact = knownSha.get(s.sha1);
  if (exact) { report.skipped.push(`${s.rel}: exact duplicate of ${exact}`); continue; }
  const h = hashes[s.abs];
  const near = known.find((a) => hamming(a.dhash, h) <= SOCIAL_DEFAULTS.media.dupDistance);
  if (near && !flag('keep-dups')) { report.skipped.push(`${s.rel}: near-duplicate of ${near.id}`); continue; }
  let id = `${aSlug}-${s.sha1.slice(0, 10)}`;
  if (taken.has(id)) id = `${aSlug}-${s.sha1.slice(0, 16)}`;
  const destRel = `media-library/files/${aSlug}/${slug(s.f.replace(/\.[^.]+$/, ''))}${(s.f.match(/\.[^.]+$/) || ['.jpg'])[0].toLowerCase().replace('.jpeg', '.jpg')}`;
  if (existsSync(resolve(ROOT, destRel))) { report.skipped.push(`${s.rel}: ${destRel} already exists (never overwritten)`); continue; }
  const m = manifest[s.rel] || manifest[s.f] || {};
  const pick = (k) => m[k] || opt(k) || null;
  let w, ht;
  try { ({ w, h: ht } = imageSize(s.buf)); } catch (e) { report.skipped.push(`${s.rel}: ${e.message}`); continue; }
  let spotId = null, spotName = null;
  const spotQ = pick('spot');
  if (spotQ) {
    const r = await dbGet(`spots?select=id,name&name=ilike.${encodeURIComponent(spotQ)}&active=eq.true`);
    if (r?.length > 1) report.warnings.push(`${s.rel}: spot "${spotQ}" matches ${r.length} spots; imported without a spot (use the exact name)`);
    else { spotId = r?.[0]?.id || null; spotName = r?.[0]?.name || null; }
    if (!spotId) report.warnings.push(`${s.rel}: spot "${spotQ}" not resolved; imported as region/generic`);
  }
  const iso = exifDate(s.buf);
  const location = spotName || pick('location'), region = pick('region');
  const subject = spotId || region || location ? 'location' : (pick('subject') || 'generic');
  const tags = [...new Set([...(opt('tags') ? opt('tags').split('|') : []), ...(m.tags ? m.tags.split('|') : [])].map((t) => t.trim().toLowerCase()).filter(Boolean))];
  const thumbRel = `media-library/thumbs/${aSlug}/${id}.jpg`;
  const asset = {
    id, file: destRel, thumb: sipsOk ? thumbRel : null, filename: s.f, kind: 'photo', source: 'google-photos-export', album: s.album,
    owner, photographer: pick('photographer') || owner, location, country: pick('country'), spotId, region,
    subject, tags, permission, attribution: opt('attribution'), sourceUrl: null,
    approvedForSocial: approve || /^(y|yes|true)$/i.test(m.approved || ''), provenanceConfirmed: approve,
    identifiablePeople: approve ? people === 'some' : null, consent: approve && people === 'some' ? (consent || 'unknown') : 'n/a',
    focus: { x: 50, y: 50 }, sessionId: m.session || sessionFor(aSlug, iso, id), capturedAt: iso, dhash: h, sha1: s.sha1,
    notes: `Imported ${new Date().toISOString().slice(0, 10)} from "${s.album}" (${w}x${ht}).`,
  };
  taken.add(id); knownSha.set(s.sha1, id); known.push({ id, dhash: h });
  if (!dry) {
    mkdirSync(dirname(resolve(ROOT, destRel)), { recursive: true });
    copyFileSync(s.abs, resolve(ROOT, destRel), 1 /* COPYFILE_EXCL: never overwrite */);
    if (sipsOk) {
      mkdirSync(dirname(resolve(ROOT, thumbRel)), { recursive: true });
      const t = spawnSync('sips', ['-Z', '480', '-s', 'formatOptions', '70', resolve(ROOT, destRel), '--out', resolve(ROOT, thumbRel)]);
      if (t.status !== 0) { asset.thumb = null; report.warnings.push(`${s.rel}: thumbnail failed`); }
    }
  }
  newAssets.push(asset);
  report.added.push(asset);
  console.log(`${dry ? '[dry] ' : ''}+ ${s.rel}  ${w}x${ht}  ${asset.album}  session ${asset.sessionId}  ${asset.approvedForSocial ? 'APPROVED' : 'unapproved'}${spotName ? `  spot: ${spotName}` : region || location ? `  place: ${region || location}` : '  generic'}`);
}

if (!dry && newAssets.length) {
  // Re-read just before writing so an edit made while we hashed is not lost; only ever append new ids.
  const fresh = readCat();
  const have = new Set(fresh.assets.map((a) => a.id));
  const append = newAssets.filter((a) => !have.has(a.id));
  mkdirSync(resolve(ROOT, 'media-library/.backups'), { recursive: true });
  copyFileSync(CATALOGUE, resolve(ROOT, `media-library/.backups/catalogue-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
  fresh.assets.push(...append);
  const tmp = `${CATALOGUE}.tmp`;
  writeFileSync(tmp, JSON.stringify(fresh, null, 2) + '\n');
  JSON.parse(readFileSync(tmp, 'utf8')); // must parse before it replaces the catalogue
  renameSync(tmp, CATALOGUE);
}
console.log(`${report.added.length} ${dry ? 'would be ' : ''}added, ${report.skipped.length} skipped`);
report.skipped.forEach((x) => console.log('  skipped', x));
report.warnings.forEach((x) => console.log('  warning', x));
if (report.added.length && !approve) console.log('Imported UNAPPROVED. Review, then: node scripts/media-approve.mjs --album "<name>" --people none');
