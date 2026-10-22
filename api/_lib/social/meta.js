// Meta Graph API client for Facebook Page + Instagram Business publishing. Network and clock are injected so
// every request shape is testable offline. Nothing here runs unless the publisher is given a live client;
// `dry: true` returns the requests it WOULD make and touches nothing.
//
// Checked against Meta's docs on 19 Oct 2026 (Instagram content-publishing + Pages posts pages; examples use v26.0):
// Facebook Login route via graph.facebook.com and a Page access token; image_url must be a public JPEG; carousel = child
// containers (is_carousel_item) -> CAROUSEL container -> poll status_code until FINISHED (docs: about once a minute, up to
// 5 minutes) -> media_publish. NOT confirmed by the docs: the Pages `attached_media` multi-photo feed post (the Pages page
// documents only single-photo posts), and the Instagram daily cap (docs say both 100 and 50 per 24h). Re-test on a test Page.
//
// The access token is only ever sent in the POST body and is scrubbed from every error message.

const BASE = 'https://graph.facebook.com';

export function createMeta({ pageId, igUserId, token, version = process.env.META_GRAPH_VERSION || 'v26.0', fetchImpl = fetch, dry = false, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = 5000, pollMax = 24 } = {}) {
  const planned = [];
  const scrub = (s) => (token ? String(s).split(token).join('[token]') : String(s));
  async function call(path, params, method = 'POST') {
    planned.push({ method, path, params: { ...params } });
    if (dry) return { id: `dry-${planned.length}`, status_code: 'FINISHED' };
    const body = new URLSearchParams({ ...params, access_token: token });
    const res = await fetchImpl(`${BASE}/${version}/${path}`, method === 'GET' ? undefined : { method, body });
    let json = {};
    try { json = await res.json(); } catch { /* non-JSON error body */ }
    if (!res.ok || json.error) throw new Error(scrub(`Meta ${path}: ${json.error?.message || `HTTP ${res.status}`}${json.error?.code ? ` (code ${json.error.code})` : ''}`));
    return json;
  }
  const status = async (id) => {
    if (dry) return 'FINISHED';
    const res = await fetchImpl(`${BASE}/${version}/${id}?fields=status_code&access_token=${encodeURIComponent(token)}`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(scrub(`Meta status ${id}: ${j.error?.message || `HTTP ${res.status}`}`));
    return j.status_code;
  };
  async function waitReady(id) {
    for (let i = 0; i < pollMax; i++) {
      const s = await status(id);
      if (s === 'FINISHED') return;
      if (s === 'ERROR' || s === 'EXPIRED') throw new Error(`Instagram container ${id} ${s}`);
      await sleep(pollMs);
    }
    throw new Error(`Instagram container ${id} not ready after ${pollMax} checks`);
  }
  return {
    planned,
    /** Crash/ambiguity recovery: did a post with this caption already land on the Page? Returns {id} or null. Never throws. */
    async findFacebookPost({ caption }) {
      if (dry || !pageId) return null;
      try {
        const res = await fetchImpl(`${BASE}/${version}/${pageId}/feed?fields=id,message&limit=5`, { headers: { Authorization: `Bearer ${token}` } });
        const j = await res.json().catch(() => ({}));
        const head = String(caption).slice(0, 60);
        return (j.data || []).find((p) => (p.message || '').startsWith(head)) || null;
      } catch { return null; }
    },
    /** @returns {{externalId}} Facebook Page post id. One image = photo post; several = unpublished photos attached to one feed post. */
    async publishFacebook({ caption, imageUrls }) {
      if (!pageId) throw new Error('META_PAGE_ID not set');
      // Photos are uploaded as BYTES (multipart `source`), not by `url`: Facebook's own fetcher rejected our public Supabase URLs
      // (code 324, 22 Oct 2026) while the byte upload is what published the first post on 20 Oct.
      const upload = async (imageUrl, fields) => {
        planned.push({ method: 'POST', path: `${pageId}/photos`, params: { url: imageUrl, ...fields } });
        if (dry) return { id: `dry-${planned.length}` };
        const img = await fetchImpl(imageUrl);
        if (!img.ok) throw new Error(`could not download ${imageUrl}: HTTP ${img.status}`);
        const f = new FormData();
        f.set('source', new Blob([Buffer.from(await img.arrayBuffer())], { type: 'image/jpeg' }), 'slide.jpg');
        for (const [k, v] of Object.entries(fields)) f.set(k, v);
        const res = await fetchImpl(`${BASE}/${version}/${pageId}/photos`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: f });
        let json = {};
        try { json = await res.json(); } catch { /* non-JSON error body */ }
        if (!res.ok || json.error) throw new Error(scrub(`Meta ${pageId}/photos: ${json.error?.message || `HTTP ${res.status}`}${json.error?.code ? ` (code ${json.error.code})` : ''}`));
        return json;
      };
      if (imageUrls.length === 1) {
        const r = await upload(imageUrls[0], { caption, published: 'true' });
        return { externalId: r.post_id || r.id };
      }
      const ids = [];
      for (const url of imageUrls) ids.push((await upload(url, { published: 'false' })).id);
      const params = { message: caption };
      ids.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
      return { externalId: (await call(`${pageId}/feed`, params)).id };
    },
    /** @returns {{externalId}} Instagram media id. */
    async publishInstagram({ caption, imageUrls }) {
      if (!igUserId) throw new Error('META_IG_USER_ID not set');
      if (imageUrls.length > 10) throw new Error('Instagram carousels hold at most 10 images');
      let creation;
      if (imageUrls.length === 1) creation = (await call(`${igUserId}/media`, { image_url: imageUrls[0], caption })).id;
      else {
        const kids = [];
        for (const url of imageUrls) { const k = (await call(`${igUserId}/media`, { image_url: url, is_carousel_item: 'true' })).id; await waitReady(k); kids.push(k); }
        creation = (await call(`${igUserId}/media`, { media_type: 'CAROUSEL', children: kids.join(','), caption })).id;
      }
      await waitReady(creation);
      return { externalId: (await call(`${igUserId}/media_publish`, { creation_id: creation })).id };
    },
  };
}

export function metaFromEnv(opts = {}, platforms = ['fb', 'ig']) {
  const { META_PAGE_TOKEN: token, META_PAGE_ID: pageId, META_IG_USER_ID: igUserId } = process.env;
  return { configured: !!(token && pageId && (!platforms.includes('ig') || igUserId)), client: createMeta({ pageId, igUserId, token, ...opts }) };
}
