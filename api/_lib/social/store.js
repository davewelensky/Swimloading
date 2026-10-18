// Supabase REST store for social_posts / social_settings (service key; RLS allows only Dave's login otherwise).
const URL_ = () => process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
export const POSTS_BUCKET = 'social-posts'; // PUBLIC bucket: generated post images only (no EXIF, no originals)
export const publicUrl = (path) => `${URL_()}/storage/v1/object/public/${POSTS_BUCKET}/${path}`;

export function createStore({ key = process.env.SUPABASE_SERVICE_KEY, fetchImpl = fetch } = {}) {
  if (!key) throw new Error('SUPABASE_SERVICE_KEY not set');
  const H = { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' };
  const rest = async (path, init = {}) => {
    const res = await fetchImpl(`${URL_()}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`supabase ${path.split('?')[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    const text = await res.text();   // Prefer: return=minimal gives an empty 201/204 body
    return text ? JSON.parse(text) : null;
  };
  return {
    rest,
    getSettings: async () => (await rest('social_settings?select=*&limit=1'))[0] || null,
    listPublishable: () => rest('social_posts?select=*&status=in.(APPROVED,SCHEDULED)&scheduled_for=not.is.null&order=scheduled_for'),
    listReserves: () => rest('social_posts?select=*&is_reserve=eq.true&status=eq.APPROVED&risk=eq.AUTO_ELIGIBLE&order=created_at'),
    update: (id, patch) => rest(`social_posts?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }), headers: { Prefer: 'return=minimal' } }),
    /** Set the idempotency key only if unset (or already ours). False means another run owns this slot. */
    async claim(post, idemKey) {
      if (post.idempotency_key === idemKey) return true;
      const rows = await rest(`social_posts?id=eq.${post.id}&idempotency_key=is.null`, { method: 'PATCH', body: JSON.stringify({ idempotency_key: idemKey }), headers: { Prefer: 'return=representation' } });
      return rows.length === 1;
    },
  };
}
