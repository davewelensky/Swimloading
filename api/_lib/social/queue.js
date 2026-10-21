// Queue mechanics shared by scripts/social-queue.mjs and the autopilot: image upload, row shape, slot arithmetic.
// Kept identical to what `social-queue.mjs enqueue/schedule` always did, so a post is the same row however it got there.
import { POSTS_BUCKET } from './store.js';

export const slugForPath = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** DB timestamps come back as '2026-10-22 08:00:00+00' or '...T08:00:00+00:00'; slots are '...T08:00:00.000Z'. Compare on epoch ms. */
export const slotMs = (x) => new Date(x).getTime();

export async function uploadImage(path, body, { key = process.env.SUPABASE_SERVICE_KEY, url = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co', fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${url}/storage/v1/object/${POSTS_BUCKET}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'image/jpeg', 'x-upsert': 'false' }, body });
  if (res.ok) return;
  const t = await res.text();
  if (!(res.status === 409 || /already exists|Duplicate/i.test(t))) throw new Error(`upload ${path}: HTTP ${res.status} ${t.slice(0, 120)}`);
}

/** The social_posts row. status: AUTO + slot -> SCHEDULED; AUTO reserve -> APPROVED; anything needing a human -> PENDING_REVIEW. */
export function buildRow({ post, captions, verdict, imagePaths, slotIso = null, reserve = false, expiresAt = null }) {
  const auto = verdict.risk === 'AUTO_ELIGIBLE';
  return {
    source_key: post.sourceKey, category: post.category, angle: post.angle || null, origin: 'auto',
    facts: post.facts.map((f) => ({ key: f.key, text: f.text, kind: f.kind, observedAt: f.observedAt, source: f.source })),
    image_paths: imagePaths, fb_caption: captions.facebook, ig_caption: captions.instagram,
    risk: verdict.risk, review_reasons: verdict.reasons || [],
    status: !auto ? 'PENDING_REVIEW' : slotIso ? 'SCHEDULED' : 'APPROVED',
    is_reserve: auto && reserve, scheduled_for: auto && !reserve ? slotIso : null, expires_at: expiresAt,
  };
}

export async function insertPost(store, row, selections = []) {
  const [created] = await store.rest('social_posts', { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'return=representation' } });
  const media = selections.map((s, i) => ({ post_id: created.id, slide: i + 1, tier: s.tier, reason: s.reason, asset_id: s.assetId || null }));
  if (media.length) await store.rest('social_post_media', { method: 'POST', body: JSON.stringify(media), headers: { Prefer: 'return=minimal' } }).catch((e) => console.warn('  media usage not recorded:', e.message));
  return created;
}
