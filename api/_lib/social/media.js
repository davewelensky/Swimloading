// Media catalogue + deterministic image selection. No AI, no randomness: the same post and the
// same usage history always select the same image, and the reason is stored with the post.
// Catalogue source today: media-library/catalogue.json (see MEDIA_LIBRARY.md). The selector only
// takes an array of assets, so the proposed `media_assets` table can replace the file later.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
import { SOCIAL_DEFAULTS } from './config.js';

export const TIERS = { EXACT: 'exact-location-photo', PRODUCT: 'partner-product-image', MAP: 'licensed-map', THEMATIC: 'thematic-photo', GRAPHIC: 'branded-graphic' };

/** Width/height from the file header (JPEG or PNG). Avoids an image dependency. */
export function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  throw new Error('unsupported image format');
}

export function loadCatalogue(path = resolve(ROOT, 'media-library/catalogue.json')) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return raw.assets.map((a) => {
    let w = a.width, h = a.height, exists = true;
    try { ({ w, h } = imageSize(readFileSync(resolve(ROOT, a.file)))); } catch { exists = false; }
    return { ...a, abs: resolve(ROOT, a.file), width: w, height: h, exists, orientation: !w ? null : w > h ? 'landscape' : w < h ? 'portrait' : 'square' };
  });
}

// ---- Production store: Supabase `media_assets` table + private `social-media` bucket -------------------------
// The selector only takes an array of assets, so the source is swappable. `loadCatalogueAuto` reads the table when a
// service key is present (RLS allows only Dave's login otherwise) and falls back to catalogue.json on any failure.
const SB_URL = () => process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
export const BUCKET = 'social-media';

/** catalogue.json asset -> media_assets row. `size` = { w, h } read from the file. */
export function assetToRow(a, size = {}) {
  return {
    id: a.id, storage_path: a.storagePath || a.file, thumb_path: a.thumbStoragePath || a.thumb || null, original_filename: a.filename || null, sha1: a.sha1 || null,
    kind: a.kind || 'photo', source: a.source, source_album: a.album || null, source_url: a.sourceUrl || null, owner: a.owner || null, photographer: a.photographer || null,
    location: a.location || null, country: a.country || null, spot_id: a.spotId || null, region: a.region || null, crossing_slug: a.crossingSlug || null, partner: a.partner || null,
    subject: a.subject || 'generic', tags: a.tags || [], width: size.w ?? a.width ?? null, height: size.h ?? a.height ?? null, permission: a.permission || 'owned', attribution: a.attribution || null,
    approved_for_social: !!a.approvedForSocial, provenance_confirmed: !!a.provenanceConfirmed, identifiable_people: a.identifiablePeople ?? null, consent: a.consent || 'n/a',
    session_id: a.sessionId || null, captured_at: a.capturedAt || null, dhash: a.dhash || null, focus_x: a.focus?.x ?? 50, focus_y: a.focus?.y ?? 50, quality: a.quality ?? null, notes: a.notes || null,
  };
}
/** media_assets row -> asset in the shape the selector uses. Files not on disk are fetched by `materialise`. */
export function rowToAsset(r, root = ROOT) {
  // Serverless bundles are read-only: originals pulled from the private bucket go to the OS temp dir there.
  const cacheDir = process.env.SOCIAL_MEDIA_CACHE || (process.env.VERCEL ? resolve(tmpdir(), 'social-media-cache') : resolve(root, 'media-library/.cache'));
  const cache = resolve(cacheDir, r.id + (/\.png$/i.test(r.storage_path) ? '.png' : '.jpg'));
  const repoFile = resolve(root, r.storage_path);
  const local = existsSync(repoFile) ? repoFile : cache;
  const w = r.width, h = r.height;
  return {
    id: r.id, file: r.storage_path, thumb: r.thumb_path, filename: r.original_filename, sha1: r.sha1, kind: r.kind, source: r.source, album: r.source_album, sourceUrl: r.source_url,
    owner: r.owner, photographer: r.photographer, location: r.location, country: r.country, spotId: r.spot_id, region: r.region, crossingSlug: r.crossing_slug, partner: r.partner,
    subject: r.subject, tags: r.tags || [], permission: r.permission, attribution: r.attribution, approvedForSocial: r.approved_for_social, provenanceConfirmed: r.provenance_confirmed,
    identifiablePeople: r.identifiable_people, consent: r.consent, sessionId: r.session_id, capturedAt: r.captured_at, dhash: r.dhash, focus: { x: r.focus_x, y: r.focus_y },
    quality: r.quality ?? undefined, notes: r.notes, abs: local, width: w, height: h, exists: !!(w && h), inStorage: !existsSync(repoFile), orientation: !w ? null : w > h ? 'landscape' : w < h ? 'portrait' : 'square',
  };
}
/** Make sure the original is on disk (downloads from the private bucket into the git-ignored media-library/.cache). */
export async function materialise(a, { key = process.env.SUPABASE_SERVICE_KEY, fetchImpl = fetch } = {}) {
  if (existsSync(a.abs)) return a.abs;
  if (!a.inStorage || !key) throw new Error(`original for ${a.id} is not available locally`);
  const res = await fetchImpl(`${SB_URL()}/storage/v1/object/${BUCKET}/${a.file}`, { headers: { Authorization: `Bearer ${key}`, apikey: key } });
  if (!res.ok) throw new Error(`storage download ${a.id}: HTTP ${res.status}`);
  mkdirSync(resolve(a.abs, '..'), { recursive: true });
  writeFileSync(a.abs, Buffer.from(await res.arrayBuffer()));
  return a.abs;
}
/** Table when reachable, otherwise the JSON file. Returns { assets, source }. */
export async function loadCatalogueAuto({ key = process.env.SUPABASE_SERVICE_KEY, fetchImpl = fetch, jsonPath } = {}) {
  if (key) {
    try {
      const res = await fetchImpl(`${SB_URL()}/rest/v1/media_assets?select=*&order=id`, { headers: { Authorization: `Bearer ${key}`, apikey: key } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length) return { assets: rows.map((r) => rowToAsset(r)), source: 'supabase' };
      console.warn('media_assets is empty: using catalogue.json');
    } catch (e) { console.warn(`media_assets unavailable (${e.message}): using catalogue.json`); }
  }
  return { assets: loadCatalogue(jsonPath), source: 'catalogue.json' };
}

const OUT = { w: 1080, h: 1350 };
/** How much a full-bleed crop must magnify the source. 1 = native pixels. */
export const coverScale = (a) => Math.max(OUT.w / a.width, OUT.h / a.height);

/** Every reason an asset may not be used for a post at all (hard exclusions). */
export function assetExclusion(a, cfg = SOCIAL_DEFAULTS.media) {
  if (!a.exists) return 'file missing';
  if (!a.approvedForSocial) return 'not approved for social';
  if (a.kind === 'photo' && coverScale(a) > cfg.maxUpscale) return `resolution too low (would be enlarged ${coverScale(a).toFixed(2)}x)`;
  return null;
}

/** Location honesty: may this asset stand for this post's subject? */
export function locationAccurate(a, post) {
  if (a.spotId) return !!post.spot && post.spot.id === a.spotId;           // exact-location photos only for that spot
  if (a.crossingSlug) return post.crossing?.slug === a.crossingSlug;
  if (a.subject === 'generic') return true;                                 // generic swimming imagery: illustrative only
  if (a.region) return post.region === a.region;                            // regional photo only for that region
  return false;
}

/** Hamming distance between two 64-bit hex hashes (dHash). Small = visually near-identical. */
export function hamming(a, b) {
  if (!a || !b) return 64;
  let x = BigInt('0x' + a) ^ BigInt('0x' + b), n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

/** Two assets are "the same shot" if from one swimming session or visually near-identical. */
export function sameShot(a, b, cfg = SOCIAL_DEFAULTS.media) {
  if (a.id === b.id) return true;
  if (a.sessionId && a.sessionId === b.sessionId) return true;
  return hamming(a.dhash, b.dhash) <= cfg.dupDistance;
}

/** Capture time from JPEG EXIF (DateTimeOriginal), for grouping uploads into sessions. null if absent. */
export function exifDate(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const s = buf.subarray(0, Math.min(buf.length, 131072)).toString('latin1');
  const m = /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
}
/** Session = album + calendar day + 3-hour block, unless the manifest says otherwise. */
export function sessionFor(album, iso, fallback) {
  if (!iso) return `unknown:${fallback}`;
  return `${album || 'upload'}:${iso.slice(0, 10)}:b${Math.floor(Number(iso.slice(11, 13)) / 3)}`;
}

/**
 * @param post     { spot?, crossing?, partner?, geo?, region?, events? }
 * @param catalogue assets
 * @param opts     { history: [{assetId, usedAt}] newest first, now }
 * @returns { tier, template, asset|null, reason, illustrative, subject, considered }
 *
 * Rotation: an asset is skipped while it is the same shot (same session, or a near-duplicate) as any
 * of the last `rotationPosts` photographs used, or was itself used within `repeatDays`. If nothing
 * else is approved, the least recently used one is reused and the reason says so.
 */
export function selectImage(post, catalogue, { history = [], now = new Date() } = {}) {
  const cfg = SOCIAL_DEFAULTS.media;
  const byId = new Map(catalogue.map((a) => [a.id, a]));
  const usable = catalogue.filter((a) => !assetExclusion(a, cfg));
  const lastUsed = {};
  for (const h of history) if (!lastUsed[h.assetId] || h.usedAt > lastUsed[h.assetId]) lastUsed[h.assetId] = h.usedAt;
  const recent = history.slice(0, cfg.rotationPosts).map((h) => byId.get(h.assetId)).filter(Boolean);
  const blocked = (a) => recent.some((r) => sameShot(a, r, cfg)) || (lastUsed[a.id] && (now - new Date(lastUsed[a.id])) / 86400e3 < cfg.repeatDays);
  const order = (a, b) => (lastUsed[a.id] || '').localeCompare(lastUsed[b.id] || '') || (b.quality || 3) - (a.quality || 3) || a.id.localeCompare(b.id); // never-used first, then higher `quality` (1-5, default 3), then id
  const pick = (list) => {
    const f = list.filter((a) => !blocked(a)).sort(order);
    if (f.length) return { asset: f[0], repeat: false };
    const any = [...list].sort(order);
    return any.length ? { asset: any[0], repeat: true } : null;
  };
  const considered = catalogue.length;
  // Data tables (measured temperatures) are always a designed graphic: text over a photograph would hurt legibility.
  if (post.graphicOnly) return { tier: TIERS.GRAPHIC, template: 'graphic', asset: null, illustrative: false, considered, subject: null, reason: 'Data table: designed branded graphic.' };
  const done = (tier, template, pk, reason, illustrative) => ({
    tier, template, asset: pk.asset, illustrative, considered, subject: pk.asset.subject,
    reason: reason + (pk.repeat ? ` Reused: every approved alternative is the same session or was used in the last ${cfg.repeatDays} days.` : ''),
  });

  // 1. Verified photograph of the exact location.
  const exact = usable.filter((a) => a.kind === 'photo' && ((a.spotId && post.spot?.id === a.spotId) || (a.crossingSlug && post.crossing?.slug === a.crossingSlug)));
  let p = pick(exact);
  if (p) return done(TIERS.EXACT, 'photography-led', p, `Photograph documenting ${p.asset.location}.`, false);

  // 2. Approved partner product image.
  if (post.partner) {
    p = pick(usable.filter((a) => a.kind === 'product' && a.partner === post.partner.slug));
    if (p) return done(TIERS.PRODUCT, 'product-led', p, `Approved ${post.partner.name} product image.`, false);
  }

  // Photography first: a post with no specific place (general swimming, community, events across
  // countries) uses founder photography before any map.
  const general = !post.geo || post.preferPhoto;
  const them = usable.filter((a) => a.kind === 'photo' && !a.spotId && !a.crossingSlug && locationAccurate(a, post));
  if (general) {
    p = pick(them);
    if (p) return done(TIERS.THEMATIC, post.partner ? 'product-led' : 'photography-led', p,
      `No exact-location or product image. ${p.asset.subject === 'generic' ? 'Generic swimming photograph' : `Photograph of the ${p.asset.region} region`}, labelled illustrative.`, true);
  }

  // 3. Licensed map of the real coordinates (geographically specific posts).
  if (post.geo) return { tier: TIERS.MAP, template: 'map-led', asset: null, illustrative: false, considered, subject: 'location',
    reason: 'No exact-location photograph; licensed map (CARTO / OpenStreetMap) of the real coordinates.' };

  // 5. Branded information graphic.
  return { tier: TIERS.GRAPHIC, template: 'graphic', asset: null, illustrative: false, considered, subject: null, reason: 'No suitable approved image; designed branded graphic used.' };
}

/** Image-related quality checks for a selection (the renderer adds pixel-level checks). */
export function imageVerdict(sel, post, { acceptShareAlike = SOCIAL_DEFAULTS.media.acceptShareAlike } = {}) {
  const checks = [], review = [];
  const ok = (name, pass, detail) => checks.push({ name, pass, detail });
  const a = sel.asset;
  if (!a) { ok('image: branded graphic or map (no photo needed)', true, sel.tier); return { checks, review }; }
  ok('image exists', a.exists);
  ok('image approved for social', !!a.approvedForSocial);
  ok('image resolution sufficient', coverScale(a) <= SOCIAL_DEFAULTS.media.maxUpscale, `${a.width}x${a.height}, enlarged ${coverScale(a).toFixed(2)}x`);
  ok('image relevant and location accurate', locationAccurate(a, post) || sel.tier === TIERS.PRODUCT, sel.reason);
  ok('attribution recorded where required', ['owned', 'partner-supplied'].includes(a.permission) || !!a.attribution, a.attribution || a.permission);
  if (!a.provenanceConfirmed) review.push(`image ${a.id}: photographer/owner/consent not yet confirmed by Dave`);
  if (a.permission === 'cc-by-sa' && !acceptShareAlike) review.push(`image ${a.id}: CC BY-SA is share-alike; Dave to decide the policy once (media.acceptShareAlike)`);
  if (a.identifiablePeople && a.consent !== 'confirmed') review.push(`image ${a.id}: identifiable swimmers without recorded consent`);
  return { checks, review };
}
