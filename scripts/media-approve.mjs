// List, approve or revoke photos in the media catalogue for automatic social use. Changes only the flags below on
// the assets you select; every other field and every other asset is left byte-for-byte as it was.
//
//   node scripts/media-approve.mjs --list [--album "Clifton C4"] [--unapproved]
//   node scripts/media-approve.mjs --album "Clifton C4" --people none            # approve a whole album
//   node scripts/media-approve.mjs --ids id1,id2 --people some --consent confirmed
//   node scripts/media-approve.mjs --album "Clifton C4" --revoke
//   optional while approving: --spot-id <uuid> --location "Clifton 4th Beach" --region "Cape Town" --country ZA --tags a|b
//
// Approving states that the owner holds the rights (provenanceConfirmed) and whether identifiable swimmers appear.
// Photos with identifiable people and no confirmed consent are still approved but route their posts to review.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const die = (m) => { console.error(m); process.exit(1); };
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const CATALOGUE = resolve(ROOT, 'media-library/catalogue.json');
const cat = JSON.parse(readFileSync(CATALOGUE, 'utf8'));

const ids = opt('ids') ? opt('ids').split(',') : null;
const album = opt('album');
let sel = cat.assets.filter((a) => (!ids || ids.includes(a.id)) && (!album || a.album === album));
if (flag('unapproved')) sel = sel.filter((a) => !a.approvedForSocial);

if (flag('list')) {
  for (const a of sel) console.log(`${a.approvedForSocial ? 'APPROVED  ' : 'unapproved'}  ${a.id}  [${a.album || a.source}]  ${a.location || a.region || 'generic'}  ${a.tags.join('|')}  ${a.permission}`);
  const n = (f) => cat.assets.filter(f).length;
  console.log(`${sel.length} shown. Library: ${cat.assets.length} total, ${n((a) => a.approvedForSocial)} approved, ${n((a) => !a.approvedForSocial)} unapproved.`);
  process.exit(0);
}
if (!ids && !album) die('select photos with --album "<name>" or --ids a,b (or --list)');
if (!sel.length) die('no photos matched');

const revoke = flag('revoke');
const people = opt('people'), consent = opt('consent');
if (!revoke && !['none', 'some'].includes(people)) die('approving needs --people none|some (are identifiable swimmers visible?)');
if (!revoke && permissionNeedsAttribution(sel)) die('some selected photos are cc-by/cc-by-sa without an attribution line; add one before approving');
function permissionNeedsAttribution(list) { return list.some((a) => ['cc-by', 'cc-by-sa'].includes(a.permission) && !a.attribution); }

mkdirSync(resolve(ROOT, 'media-library/.backups'), { recursive: true });
copyFileSync(CATALOGUE, resolve(ROOT, `media-library/.backups/catalogue-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
for (const a of sel) {
  if (revoke) { a.approvedForSocial = false; continue; }
  a.approvedForSocial = true; a.provenanceConfirmed = true;
  a.identifiablePeople = people === 'some';
  a.consent = people === 'some' ? (consent || 'unknown') : 'n/a';
  if (opt('spot-id')) { a.spotId = opt('spot-id'); a.subject = 'location'; }
  if (opt('location')) { a.location = opt('location'); a.subject = 'location'; }
  if (opt('region')) { a.region = opt('region'); a.subject = 'location'; }
  if (opt('country')) a.country = opt('country');
  if (opt('tags')) a.tags = [...new Set([...a.tags, ...opt('tags').split('|').map((t) => t.trim().toLowerCase()).filter(Boolean)])];
}
const tmp = `${CATALOGUE}.tmp`;
writeFileSync(tmp, JSON.stringify(cat, null, 2) + '\n');
JSON.parse(readFileSync(tmp, 'utf8'));
renameSync(tmp, CATALOGUE);
console.log(`${revoke ? 'Revoked' : 'Approved'} ${sel.length} photo(s).`);
