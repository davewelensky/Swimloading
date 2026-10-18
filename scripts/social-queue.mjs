// Operate the social publishing queue. Needs SUPABASE_SERVICE_KEY in the environment (never in chat or argv).
//
//   node scripts/social-queue.mjs status                       settings (paused?) + counts by status
//   node scripts/social-queue.mjs list [status]
//   node scripts/social-queue.mjs enqueue [--dry-run]          social-poc/posts.json -> public bucket + social_posts
//   node scripts/social-queue.mjs approve <id|source_key>      PENDING_REVIEW/DRAFT -> APPROVED
//   node scripts/social-queue.mjs reject  <id|source_key>
//   node scripts/social-queue.mjs reserve <id|source_key>      mark an APPROVED evergreen post as reserve (fallback)
//   node scripts/social-queue.mjs schedule [--dry-run]         give APPROVED non-reserve posts the next free Tue/Thu/Sat slots
//   node scripts/social-queue.mjs pause
//   node scripts/social-queue.mjs resume --confirm-live        TURNS PUBLISHING ON. Nothing posts without Meta creds + this.
import { readFileSync, existsSync } from 'node:fs';
import { createStore, POSTS_BUCKET } from '../api/_lib/social/store.js';
import { nextSlots } from '../api/_lib/social/config.js';

const [cmd = 'status', arg] = process.argv.slice(2);
const flag = (n) => process.argv.includes(`--${n}`);
const dry = flag('dry-run');
const URL_ = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error('Set SUPABASE_SERVICE_KEY in the environment.'); process.exit(1); }
const store = createStore();
const find = async (a) => {
  const q = /^[0-9a-f-]{36}$/.test(a) ? `id=eq.${a}` : `source_key=eq.${encodeURIComponent(a)}&order=created_at.desc&limit=1`;
  const r = await store.rest(`social_posts?select=*&${q}`);
  if (!r.length) { console.error(`no post matches ${a}`); process.exit(1); }
  return r[0];
};
async function upload(path, file) {
  const res = await fetch(`${URL_}/storage/v1/object/${POSTS_BUCKET}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, 'Content-Type': 'image/jpeg', 'x-upsert': 'false' }, body: readFileSync(file) });
  if (res.ok) return;
  const t = await res.text();
  if (!(res.status === 409 || /already exists|Duplicate/i.test(t))) throw new Error(`upload ${path}: HTTP ${res.status} ${t.slice(0, 120)}`);
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

if (cmd === 'status') {
  const s = await store.getSettings();
  console.log(`publishing ${s?.paused === false ? 'ON' : 'PAUSED'} (social_settings.paused = ${s?.paused})`);
  const rows = await store.rest('social_posts?select=status,is_reserve');
  const c = {}; for (const r of rows) { const k = r.status + (r.is_reserve ? ' (reserve)' : ''); c[k] = (c[k] || 0) + 1; }
  console.log(c);
} else if (cmd === 'list') {
  const rows = await store.rest(`social_posts?select=id,source_key,category,risk,status,is_reserve,scheduled_for${arg ? `&status=eq.${arg}` : ''}&order=created_at.desc&limit=50`);
  for (const r of rows) console.log(`${r.id}  ${r.status.padEnd(14)} ${r.risk.padEnd(15)} ${r.is_reserve ? 'RESERVE ' : '        '}${(r.scheduled_for || 'unslotted').padEnd(25)} ${r.source_key}`);
} else if (cmd === 'enqueue') {
  const f = 'social-poc/posts.json';
  if (!existsSync(f)) { console.error('run node scripts/render-social-poc.mjs first'); process.exit(1); }
  const { posts } = JSON.parse(readFileSync(f, 'utf8'));
  const existing = await store.rest('social_posts?select=source_key,status,created_at&status=neq.REJECTED');
  const cutoff = Date.now() - 90 * 86400e3;
  for (const p of posts.filter((x) => x.status === 'GENERATED')) {
    if (p.eligibility.risk === 'BLOCKED') { console.log(`skip (blocked)  ${p.sourceKey}`); continue; }
    if (existing.some((e) => e.source_key === p.sourceKey && new Date(e.created_at) > cutoff)) { console.log(`skip (already queued in last 90 days)  ${p.sourceKey}`); continue; }
    const dir = `${p.generatedAt.slice(0, 10)}/${slug(p.sourceKey)}`;
    const paths = p.images.map((_, i) => `${dir}/slide-${i + 1}.jpg`);
    const auto = p.eligibility.risk === 'AUTO_ELIGIBLE';
    const row = {
      source_key: p.sourceKey, category: p.category, angle: p.angle || null, origin: 'auto', facts: p.facts, image_paths: paths,
      fb_caption: p.facebookCaption, ig_caption: p.instagramCaption, risk: p.eligibility.risk, review_reasons: p.eligibility.reasons || [],
      status: auto ? 'APPROVED' : 'PENDING_REVIEW', expires_at: p.category === 'THIS WEEK IN OPEN WATER' ? new Date(Date.parse(p.generatedAt) + 3 * 86400e3).toISOString() : null,
    };
    console.log(`${dry ? '[dry] ' : ''}${row.status.padEnd(14)} ${p.sourceKey}  (${paths.length} image${paths.length > 1 ? 's' : ''})`);
    if (dry) continue;
    for (const [i, img] of p.images.entries()) await upload(paths[i], `social-poc/${img}`);
    const [created] = await store.rest('social_posts', { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'return=representation' } });
    const media = p.selections.map((s, i) => ({ post_id: created.id, slide: i + 1, tier: s.tier, reason: s.reason, asset_id: s.assetId || null }));
    await store.rest('social_post_media', { method: 'POST', body: JSON.stringify(media), headers: { Prefer: 'return=minimal' } }).catch((e) => console.warn('  media usage not recorded:', e.message));
  }
} else if (cmd === 'approve' || cmd === 'reject' || cmd === 'reserve') {
  if (!arg) { console.error(`usage: ${cmd} <id|source_key>`); process.exit(1); }
  const p = await find(arg);
  if (cmd === 'reserve' && (p.status !== 'APPROVED' || p.risk !== 'AUTO_ELIGIBLE')) { console.error('only APPROVED + AUTO_ELIGIBLE posts can be reserves'); process.exit(1); }
  const patch = cmd === 'approve' ? { status: 'APPROVED' } : cmd === 'reject' ? { status: 'REJECTED' } : { is_reserve: true, scheduled_for: null };
  await store.update(p.id, patch);
  console.log(`${cmd}: ${p.source_key} -> ${JSON.stringify(patch)}`);
} else if (cmd === 'schedule') {
  const rows = await store.rest('social_posts?select=id,source_key,status,is_reserve,scheduled_for&status=in.(APPROVED,SCHEDULED)&is_reserve=eq.false&order=expires_at.asc.nullslast,created_at');   // soonest-expiring first
  const taken = new Set(rows.filter((r) => r.scheduled_for).map((r) => new Date(r.scheduled_for).toISOString()));
  const todo = rows.filter((r) => !r.scheduled_for);
  const slots = nextSlots(new Date(), todo.length + taken.size + 3).filter((s) => !taken.has(s));
  for (const [i, r] of todo.entries()) {
    if (!slots[i]) break;
    console.log(`${dry ? '[dry] ' : ''}${slots[i]}  ${r.source_key}`);
    if (!dry) await store.update(r.id, { status: 'SCHEDULED', scheduled_for: slots[i] });
  }
} else if (cmd === 'pause') { await store.rest('social_settings?id=eq.true', { method: 'PATCH', body: JSON.stringify({ paused: true, updated_at: new Date().toISOString() }), headers: { Prefer: 'return=minimal' } }); console.log('publishing PAUSED'); }
else if (cmd === 'resume') {
  if (!flag('confirm-live')) { console.error('Refusing: this turns live publishing ON. Re-run with --confirm-live.'); process.exit(1); }
  await store.rest('social_settings?id=eq.true', { method: 'PATCH', body: JSON.stringify({ paused: false, updated_at: new Date().toISOString() }), headers: { Prefer: 'return=minimal' } });
  console.log('publishing ON');
} else { console.error('unknown command'); process.exit(1); }
