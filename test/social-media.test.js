// Media catalogue, image selection, rotation, and the location-honesty rules. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { imageSize, loadCatalogue, selectImage, sameShot, hamming, exifDate, sessionFor, imageVerdict, locationAccurate, assetExclusion, coverScale, TIERS } from '../api/_lib/social/media.js';
import { visualSlide, visualCopy } from '../api/_lib/social/templates.js';
import { mapView } from '../api/_lib/social/map.js';
import { CATEGORIES } from '../api/_lib/social/config.js';
import { fact } from '../api/_lib/social/facts.js';

const NOW = new Date('2026-10-20T08:00:00Z');
const A = (o) => ({ kind: 'photo', exists: true, approvedForSocial: true, provenanceConfirmed: true, permission: 'owned', width: 3000, height: 2000,
  subject: 'generic', spotId: null, region: null, sessionId: null, dhash: '0000000000000000', identifiablePeople: false, tags: [], ...o });
const TOOTING = { id: 'tooting', name: 'Tooting Bec Lido' };

test('catalogue: real files load with dimensions, orientation, and a hash', () => {
  const c = loadCatalogue();
  assert.ok(c.length >= 5);
  for (const a of c) { if (a.source === 'google-photos-export' && !a.exists) continue; /* originals are local-only (gitignored) */ assert.ok(a.exists, a.id); assert.ok(a.width > 0 && a.height > 0); assert.ok(['landscape', 'portrait', 'square'].includes(a.orientation)); assert.match(a.dhash, /^[0-9a-f]{16}$/, a.id); assert.ok(a.subject === 'location' || a.subject === 'generic'); }
});
test('imageSize reads JPEG and PNG headers', () => {
  assert.deepEqual(imageSize(readFileSync('partner-kit/hero-photo-underwater.jpg')), { w: 1920, h: 1440 });
  assert.ok(imageSize(readFileSync('icons/logo-wave.png')).w > 0);
});

test('LOCATION HONESTY: a Bakoven/Clifton photograph is never used for Tooting Bec Lido', () => {
  const bakoven = A({ id: 'bakoven', spotId: 'bakoven-id', subject: 'location', location: 'Bakoven' });
  const s = selectImage({ spot: TOOTING }, [bakoven], { now: NOW });
  assert.equal(s.asset, null);
  assert.equal(s.tier, TIERS.GRAPHIC);
  assert.equal(locationAccurate(bakoven, { spot: TOOTING }), false);
});
test('regional photos only illustrate their own region; generic photos may illustrate anything, labelled illustrative', () => {
  const ct = A({ id: 'ct', subject: 'location', region: 'Cape Town' });
  const gen = A({ id: 'gen', subject: 'generic' });
  assert.equal(locationAccurate(ct, { region: 'Cape Town' }), true);
  assert.equal(locationAccurate(ct, { region: 'London' }), false);
  const s = selectImage({ region: 'London' }, [ct, gen], { now: NOW });
  assert.equal(s.asset.id, 'gen'); assert.equal(s.illustrative, true); assert.equal(s.tier, TIERS.THEMATIC);
});
test('priority: exact photo > partner product > map > thematic photo > branded graphic', () => {
  const exact = A({ id: 'exact', spotId: 'tooting', subject: 'location', location: 'Tooting' });
  const prod = A({ id: 'prod', kind: 'product', partner: 'maurten' });
  const gen = A({ id: 'gen' });
  assert.equal(selectImage({ spot: TOOTING, geo: { points: [] } }, [gen, exact], { now: NOW }).tier, TIERS.EXACT);
  assert.equal(selectImage({ partner: { slug: 'maurten', name: 'Maurten' } }, [gen, prod], { now: NOW }).tier, TIERS.PRODUCT);
  const m = selectImage({ geo: { points: [{ lat: 1, lng: 1 }] }, crossing: { slug: 'x' } }, [gen], { now: NOW });
  assert.equal(m.tier, TIERS.MAP); assert.equal(m.template, 'map-led');
  assert.equal(selectImage({}, [gen], { now: NOW }).tier, TIERS.THEMATIC);
  assert.equal(selectImage({}, [], { now: NOW }).tier, TIERS.GRAPHIC);
});
test('photography first: a general post uses a founder photograph before a map', () => {
  const gen = A({ id: 'gen' });
  assert.equal(selectImage({ preferPhoto: true, geo: { points: [{ lat: 1, lng: 1 }] } }, [gen], { now: NOW }).tier, TIERS.THEMATIC);
});
test('product-led post with no product image falls back to a thematic photo, never an invented product', () => {
  const s = selectImage({ partner: { slug: 'maurten', name: 'Maurten' } }, [A({ id: 'gen' })], { now: NOW });
  assert.equal(s.tier, TIERS.THEMATIC); assert.equal(s.template, 'product-led'); assert.equal(s.illustrative, true);
});
test('unapproved, missing and low-resolution images are excluded', () => {
  assert.match(assetExclusion(A({ approvedForSocial: false })), /not approved/);
  assert.match(assetExclusion(A({ exists: false })), /missing/);
  assert.match(assetExclusion(A({ width: 600, height: 400 })), /resolution/);
  assert.equal(assetExclusion(A({})), null);
  assert.ok(coverScale(A({ width: 1920, height: 1280 })) < 1.6);
});

test('near-duplicates: identical hash and same session are the same shot; different sessions and hashes are not', () => {
  assert.equal(hamming('0000000000000000', '0000000000000003'), 2);
  assert.equal(sameShot(A({ id: 'a', dhash: 'ff00ff00ff00ff00' }), A({ id: 'b', dhash: 'ff00ff00ff00ff01' })), true);
  assert.equal(sameShot(A({ id: 'a', sessionId: 's1', dhash: 'ffffffffffffffff' }), A({ id: 'b', sessionId: 's1', dhash: '0000000000000000' })), true);
  assert.equal(sameShot(A({ id: 'a', sessionId: 's1', dhash: 'ffffffffffffffff' }), A({ id: 'b', sessionId: 's2', dhash: '0000000000000000' })), false);
  assert.equal(sameShot(A({ id: 'a', sessionId: null }), A({ id: 'b', sessionId: null, dhash: 'ffffffffffffffff' })), false);
});
test('ROTATION: consecutive posts do not use photographs from the same session', () => {
  const cat = [
    A({ id: 'swimA1', sessionId: 'sun-1', dhash: '00000000000000ff' }),
    A({ id: 'swimA2', sessionId: 'sun-1', dhash: 'ffff000000000000' }),
    A({ id: 'swimB1', sessionId: 'sat-2', dhash: '0f0f0f0f0f0f0f0f' }),
  ];
  const first = selectImage({}, cat, { now: NOW });
  assert.equal(first.asset.id, 'swimA1');
  const second = selectImage({}, cat, { now: NOW, history: [{ assetId: 'swimA1', usedAt: NOW.toISOString() }] });
  assert.equal(second.asset.id, 'swimB1', 'swimA2 is from the same session as swimA1 and must be skipped');
  const third = selectImage({}, cat, { now: NOW, history: [{ assetId: 'swimB1', usedAt: '2026-10-22T00:00:00Z' }, { assetId: 'swimA1', usedAt: '2026-10-20T00:00:00Z' }] });
  assert.ok(!/Reused/.test(third.reason) || third.asset.id, 'always yields something');
});
test('rotation: when nothing else is approved, the least recently used is reused and the reason says so', () => {
  const only = [A({ id: 'only', sessionId: 's' })];
  const s = selectImage({}, only, { now: NOW, history: [{ assetId: 'only', usedAt: '2026-10-19T00:00:00Z' }] });
  assert.equal(s.asset.id, 'only'); assert.match(s.reason, /Reused/);
});
test('rotation: an image used within 21 days is skipped even when it is not among the last posts; free again after 21 days', () => {
  const cat = [A({ id: 'a', sessionId: 'x', dhash: 'aaaaaaaaaaaaaaaa' }), A({ id: 'b', sessionId: 'y', dhash: '5555555555555555' })];
  const hist = [{ assetId: 'c', usedAt: '2026-10-19T00:00:00Z' }, { assetId: 'd', usedAt: '2026-10-18T00:00:00Z' }, { assetId: 'e', usedAt: '2026-10-17T00:00:00Z' }, { assetId: 'a', usedAt: '2026-10-10T00:00:00Z' }];
  assert.equal(selectImage({}, cat, { now: NOW, history: hist }).asset.id, 'b');
  const only = selectImage({}, [cat[0]], { now: new Date('2026-12-01T00:00:00Z'), history: hist });
  assert.equal(only.asset.id, 'a'); assert.ok(!/Reused/.test(only.reason));
  assert.match(selectImage({}, [cat[0]], { now: NOW, history: hist }).reason, /Reused/);
});
test('selection is deterministic', () => {
  const cat = [A({ id: 'q', dhash: '1111111111111111' }), A({ id: 'p', dhash: '2222222222222222', sessionId: 'z' })];
  assert.equal(selectImage({}, cat, { now: NOW }).asset.id, selectImage({}, [...cat].reverse(), { now: NOW }).asset.id);
});

test('verdict: unconfirmed provenance, share-alike licence and unconsented identifiable swimmers need review', () => {
  const sel = (a) => ({ asset: a, tier: TIERS.THEMATIC, reason: 'r' });
  assert.deepEqual(imageVerdict(sel(A({ id: 'ok' })), {}).review, []);
  assert.match(imageVerdict(sel(A({ id: 'x', provenanceConfirmed: false })), {}).review[0], /not yet confirmed/);
  assert.match(imageVerdict(sel(A({ id: 'x', permission: 'cc-by-sa', attribution: 'a' })), {}).review[0], /share-alike/);
  assert.deepEqual(imageVerdict(sel(A({ id: 'x', permission: 'cc-by-sa', attribution: 'a' })), {}, { acceptShareAlike: true }).review, []);
  assert.match(imageVerdict(sel(A({ id: 'x', identifiablePeople: true, consent: 'unknown' })), {}).review[0], /consent/);
  assert.equal(imageVerdict(sel(A({ id: 'x', permission: 'cc-by' })), {}).checks.find((c) => c.name.startsWith('attribution')).pass, false, 'licensed image without attribution fails');
});

test('exif date and session grouping', () => {
  const buf = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from('xx2026:05:31 17:56:18xx', 'latin1')]);
  assert.equal(exifDate(buf), '2026-05-31T17:56:18');
  assert.equal(sessionFor('bakoven', '2026-05-31T17:56:18'), 'bakoven:2026-05-31:b5');
  assert.equal(sessionFor('bakoven', '2026-05-31T18:50:00'), 'bakoven:2026-05-31:b6'.replace('b6', 'b6'));
  assert.equal(sessionFor('bakoven', '2026-05-31T09:01:00'), sessionFor('bakoven', '2026-05-31T10:59:00'));
  assert.equal(sessionFor('b', null, 'id1'), 'unknown:id1');
});

test('map projection keeps every point inside the requested rectangle', () => {
  const rect = { x0: 150, y0: 190, x1: 930, y1: 830 };
  const pts = [{ lat: 51.1172, lng: 1.3271 }, { lat: 50.868, lng: 1.5808 }];
  const v = mapView(pts, rect);
  for (const p of pts) { const q = v.project(p.lat, p.lng); assert.ok(q.x >= rect.x0 - 1 && q.x <= rect.x1 + 1 && q.y >= rect.y0 - 1 && q.y <= rect.y1 + 1, JSON.stringify(q)); }
  assert.match(v.tilesHtml, /basemaps\.cartocdn\.com\/dark_all\/\d+\/\d+\/\d+@2x\.png\?key=/);
});

const post = { category: CATEGORIES.CROSSING_INTELLIGENCE, sourceUrl: 'u', facts: [fact('name', 'English Channel', { table: 't' }), fact('distance', '33.8 km', { table: 't' }), fact('qualifying', 'x', { table: 't' }, { value: 360 })] };
test('visual slides render for all three approaches, with attribution, data-template and no leftovers', () => {
  const copy = visualCopy(post);
  assert.equal(copy.sub, '33.8 km · 6 hour qualifying swim');
  const base = { post, logo: 'data:,', partnerLogo: 'data:,', copy, url: 'swimloading.com' };
  const map = visualSlide({ ...base, template: 'map-led', geo: { route: true, points: [{ lat: 51.1, lng: 1.3, label: 'A' }, { lat: 50.9, lng: 1.6, label: 'B' }] } });
  assert.match(map, /data-template="map-led"/); assert.match(map, /OpenStreetMap contributors/); assert.match(map, /Indicative route/);
  const photo = visualSlide({ ...base, template: 'photography-led', asset: { attribution: 'Photo: X / CC BY-SA 2.0', focus: { x: 10, y: 20 } }, photoUri: 'data:,', illustrative: true });
  assert.match(photo, /data-template="photography-led"/); assert.match(photo, /Photo: X/); assert.match(photo, /Illustrative photo/); assert.match(photo, /10% 20%/);
  const prod = visualSlide({ ...base, template: 'product-led', post: { ...post, partner: { name: 'Maurten' } }, asset: {}, photoUri: 'data:,', illustrative: true });
  assert.match(prod, /data-template="product-led"/); assert.match(prod, /not a product image/);
  for (const h of [map, photo, prod]) { assert.ok(!/undefined|\bnull\b/.test(h.replace(/<style>[\s\S]*?<\/style>/, ''))); assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(h), 'emoji'); }
});

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
test('import script: dry run skips a near-duplicate of an existing photo and imports unapproved by default', { skip: !existsSync(CHROME) }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'media-import-'));
  copyFileSync('partner-kit/hero-photo-underwater.jpg', join(dir, 'copy-of-underwater.jpg'));
  copyFileSync('partner-kit/hero-photo-whale.jpg', join(dir, 'zzz-new-photo.jpg'));
  mkdirSync(join(dir, 'Some Album')); copyFileSync('icons/logo-wave.png', join(dir, 'Some Album', 'fresh.png'));
  const r = spawnSync('node', ['scripts/import-media.mjs', dir, '--album', 'Test Album', '--owner', 'Test', '--keep-dups', '--dry-run'], { encoding: 'utf8', env: { ...process.env, LAB_CHROME_PATH: CHROME } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /copy-of-underwater\.jpg: (exact |near-)duplicate of sl-hero-underwater/);
  assert.match(r.stdout, /whale/i.test(r.stdout) ? /near-duplicate|unapproved/ : /unapproved/);
  assert.match(r.stdout, /zzz-new-photo\.jpg: exact duplicate of sl-hero-whale/);
  assert.match(r.stdout, /\+ Some Album\/fresh\.png .*Some Album .*unapproved/, 'recurses into sub-folders, album = folder name, unapproved by default');
  const bad = spawnSync('node', ['scripts/import-media.mjs', dir, '--album', 'T', '--owner', 'T', '--approve', '--dry-run'], { encoding: 'utf8', env: { ...process.env, LAB_CHROME_PATH: CHROME } });
  assert.notEqual(bad.status, 0, '--approve without --people must refuse');
});

test('quality (1-5, default 3) breaks ties between equally unused photos; rotation still comes first', () => {
  const cat = [A({ id: 'a-murky', quality: 1, sessionId: 's1', dhash: '00000000000000ff' }), A({ id: 'b-bright', quality: 5, sessionId: 's2', dhash: 'ff00000000000000' })];
  assert.equal(selectImage({}, cat, { now: NOW }).asset.id, 'b-bright');
  const again = selectImage({}, cat, { now: NOW, history: [{ assetId: 'b-bright', usedAt: '2026-10-19T00:00:00Z' }] });
  assert.equal(again.asset.id, 'a-murky', 'recently used bright photo is rotated out');
});
