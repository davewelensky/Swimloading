// One-way sync: media-library/catalogue.json (+ local originals/thumbnails) -> Supabase `media_assets` table and the
// PRIVATE `social-media` bucket. Idempotent: rows are upserted by id, files already in the bucket are left alone, and
// nothing is ever deleted. Needs the service key in the environment (never pass it on the command line or in chat):
//
//   SUPABASE_SERVICE_KEY=... node scripts/sync-media-to-supabase.mjs --dry-run
//   SUPABASE_SERVICE_KEY=... node scripts/sync-media-to-supabase.mjs
//
// Only photographs imported from Google Photos are uploaded (storage path originals/<id>.jpg, thumbs/<id>.jpg).
// Assets whose file already ships in the repo (Wikimedia, partner-kit) keep their repo path and are not uploaded.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { imageSize, assetToRow, BUCKET } from '../api/_lib/social/media.js';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const URL_ = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY;
const dry = process.argv.includes('--dry-run');
if (!KEY) { console.error('Set SUPABASE_SERVICE_KEY in the environment (service role key from the Supabase dashboard).'); process.exit(1); }
const H = { Authorization: `Bearer ${KEY}`, apikey: KEY };
const cat = JSON.parse(readFileSync(resolve(ROOT, 'media-library/catalogue.json'), 'utf8'));

async function upload(path, file, contentType) {
  const res = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers: { ...H, 'Content-Type': contentType, 'x-upsert': 'false' }, body: readFileSync(file) });
  if (res.ok) return 'uploaded';
  const t = await res.text();
  if (res.status === 400 && /already exists|Duplicate/i.test(t) || res.status === 409) return 'exists';
  throw new Error(`upload ${path}: HTTP ${res.status} ${t.slice(0, 120)}`);
}

const rows = [], stats = { uploaded: 0, exists: 0, skipped: 0 };
for (const a of cat.assets) {
  const abs = resolve(ROOT, a.file);
  let size = {};
  if (existsSync(abs)) size = (({ w, h }) => ({ w, h }))(imageSize(readFileSync(abs)));
  else console.warn(`  ${a.id}: original not on this machine`);
  const fromGoogle = a.source === 'google-photos-export';
  const ext = /\.png$/i.test(a.file) ? 'png' : 'jpg';
  const out = { ...a };
  if (fromGoogle && existsSync(abs)) {
    out.storagePath = `originals/${a.id}.${ext}`;
    out.thumbStoragePath = a.thumb && existsSync(resolve(ROOT, a.thumb)) ? `thumbs/${a.id}.jpg` : null;
    if (!dry) {
      stats[await upload(out.storagePath, abs, ext === 'png' ? 'image/png' : 'image/jpeg')]++;
      if (out.thumbStoragePath) await upload(out.thumbStoragePath, resolve(ROOT, a.thumb), 'image/jpeg');
    }
  } else if (fromGoogle) { stats.skipped++; continue; }
  rows.push(assetToRow(out, size));
}
console.log(`${dry ? '[dry] ' : ''}${rows.length} rows to upsert; originals: ${stats.uploaded} uploaded, ${stats.exists} already in bucket, ${stats.skipped} skipped (missing locally)`);
if (!dry) {
  const res = await fetch(`${URL_}/rest/v1/media_assets?on_conflict=id`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
  if (!res.ok) { console.error(`upsert failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`); process.exit(1); }
  console.log('media_assets upserted.');
}
