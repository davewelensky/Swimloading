// Facebook Page publisher (Graph API). Publishing is OFF unless SOCIAL_PUBLISH_ENABLED=true (the global
// pause), and every call is idempotent: a ledger remembers what was posted, so a retry or a re-run can
// never create a second post. The token travels in an Authorization header, never in a URL or a log.
//
// Endpoints (Meta docs, checked 20 Oct 2026): POST /{page-id}/photos (multipart file, `caption`, `published`)
// and POST /{page-id}/feed with attached_media[n]={"media_fbid":...} for several photos. Needs a Page token
// with pages_manage_posts, pages_read_engagement, pages_show_list.
export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v26.0';
const BASE = () => `https://graph.facebook.com/${GRAPH_VERSION}`;

export class PublishError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra); }
}

// Graph error codes worth retrying (temporary / rate limit). 190 = token invalid or expired: never retried.
const TRANSIENT = new Set([1, 2, 4, 17, 32, 341, 368]);

export function publishingEnabled(env = process.env) { return env.SOCIAL_PUBLISH_ENABLED === 'true'; }

async function graph(path, { method = 'GET', form, token, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(`${BASE()}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, body: form });
  } catch (e) { throw new PublishError('ambiguous', `network error: ${e.message}`); }   // the request may or may not have landed
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (res.ok && body && !body.error) return body;
  const err = body?.error || {};
  if (err.code === 190) throw new PublishError('token', 'Page token is invalid or expired: create a new one (see docs/social-engine/FACEBOOK_SETUP.md)', { code: 190 });
  const transient = res.status >= 500 || TRANSIENT.has(err.code);
  throw new PublishError(transient ? 'transient' : 'permanent', err.message || `HTTP ${res.status}`, { code: err.code, status: res.status });
}

/** Read-only check that the token works and belongs to the expected Page. */
export async function verifyPage({ pageId, token, fetchImpl }) {
  const me = await graph('/me?fields=id,name', { token, fetchImpl });
  return { ok: me.id === pageId, id: me.id, name: me.name, expected: pageId };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, { attempts = 3, backoffMs = 1500 } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(i); } catch (e) {
      last = e;
      if (!(e instanceof PublishError) || e.kind !== 'transient' || i === attempts) throw e;
      await sleep(backoffMs * i);
    }
  }
  throw last;
}

/** After an ambiguous failure, did the post actually land? Look for our caption on the Page's latest posts. */
async function alreadyPosted({ pageId, token, caption, fetchImpl }) {
  const feed = await graph(`/${pageId}/feed?fields=id,message&limit=5`, { token, fetchImpl });
  const head = caption.slice(0, 60);
  return feed.data?.find((p) => (p.message || '').startsWith(head)) || null;
}

/**
 * @param o { key, caption, images: [{name, bytes: Buffer, mime}], pageId, token, ledger: {get,set},
 *            env, fetchImpl, dryRun, backoffMs }
 * @returns { status: 'PUBLISHED'|'DRY_RUN'|'ALREADY_PUBLISHED', facebookId?, request? }
 */
export async function publishToFacebook(o) {
  const { key, caption, images, pageId, token, ledger, env = process.env, fetchImpl = fetch, dryRun = false, backoffMs } = o;
  if (!key || !caption || !images?.length) throw new PublishError('invalid', 'key, caption and at least one image are required');
  const prior = ledger?.get(key);
  if (prior?.facebookId) return { status: 'ALREADY_PUBLISHED', facebookId: prior.facebookId };   // idempotent
  if (dryRun) return { status: 'DRY_RUN', request: { endpoint: images.length === 1 ? `/${pageId}/photos` : `/${pageId}/feed`, photos: images.length, captionChars: caption.length } };
  if (!publishingEnabled(env)) throw new PublishError('paused', 'Publishing is paused: SOCIAL_PUBLISH_ENABLED is not "true"');
  if (!pageId || !token) throw new PublishError('config', 'META_PAGE_ID and META_PAGE_TOKEN must be set');

  const upload = (img, published) => {
    const f = new FormData();
    f.set('source', new Blob([img.bytes], { type: img.mime || 'image/jpeg' }), img.name);
    f.set('published', published ? 'true' : 'false');
    if (published) f.set('caption', caption);
    return graph(`/${pageId}/photos`, { method: 'POST', form: f, token, fetchImpl });
  };

  try {
    let facebookId;
    if (images.length === 1) {
      const r = await withRetry(() => upload(images[0], true), { backoffMs });
      facebookId = r.post_id || r.id;
    } else {
      const ids = [];
      for (const img of images) ids.push((await withRetry(() => upload(img, false), { backoffMs })).id);   // unpublished uploads are safe to retry
      const f = new FormData();
      f.set('message', caption);
      ids.forEach((id, n) => f.set(`attached_media[${n}]`, JSON.stringify({ media_fbid: id })));
      const r = await withRetry(() => graph(`/${pageId}/feed`, { method: 'POST', form: f, token, fetchImpl }), { backoffMs });
      facebookId = r.id;
    }
    ledger?.set(key, { facebookId, at: new Date().toISOString() });
    return { status: 'PUBLISHED', facebookId };
  } catch (e) {
    if (e instanceof PublishError && e.kind === 'ambiguous') {
      const hit = await alreadyPosted({ pageId, token, caption, fetchImpl }).catch(() => null);
      if (hit) { ledger?.set(key, { facebookId: hit.id, at: new Date().toISOString(), recovered: true }); return { status: 'PUBLISHED', facebookId: hit.id }; }
    }
    throw e;
  }
}
