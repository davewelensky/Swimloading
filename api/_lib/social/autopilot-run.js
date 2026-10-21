// Live wiring for the autopilot: data sources, rendering, uploads and inserts. The rules live in autopilot.js (pure, tested);
// this file only connects them to Supabase, headless Chromium and the media catalogue.
//   dry = true  -> reads only, validates, prints the plan. No render, no upload, no insert, no update.
//   dry = false -> renders, uploads to the public social-posts bucket, inserts rows. Never switches publishing on:
//                  social_settings.paused and SOCIAL_PUBLISH_ENABLED still gate posting.
import { dbGet } from '../../seo-utils.js';
import { SOCIAL_DEFAULTS } from './config.js';
import { buildPool, runAutopilot, loadLedgerKeys, recentEventIds } from './autopilot.js';
import { makeRecheck } from './recheck.js';
import { renderPost, fileUri } from './render-post.js';
import { loadCatalogueAuto } from './media.js';
import { buildRow, insertPost, uploadImage, slugForPath } from './queue.js';

const need = async (p) => { const r = await dbGet(p); if (r == null) throw new Error(`query failed: ${p.split('?')[0]}`); return r; };

/** Public tables via the anon key; partner_pages via the store (service key) or a snapshot. */
export function makeData({ store = null, snapshot = null, now = new Date() } = {}) {
  let spots;
  const getSpots = async () => (spots ??= snapshot?.spots || await need('spots?select=id,name,water_type,area,domain,country_code,latitude,longitude&active=eq.true&limit=2000'));
  const since = new Date(now.getTime() - 72 * 3600e3).toISOString();
  return {
    spots: getSpots, conditionSpots: getSpots,
    crossings: async () => snapshot?.crossings || need('crossings?select=*&is_active=eq.true'),
    partners: async () => snapshot?.partner_pages || (store ? store.rest('partner_pages?select=*') : (() => { throw new Error('partner_pages needs SUPABASE_SERVICE_KEY (or --snapshot)'); })()),
    conditions: async () => snapshot?.conditions || (await dbGet(`spot_conditions_live?select=spot_id,water_temperature_c,observed_at,provider_code,provider_name,station_name,distance_km,is_primary,quality_code&water_temperature_c=not.is.null&is_primary=eq.true&observed_at=gte.${encodeURIComponent(since)}&limit=1000`)) || [],
  };
}

export async function loadPosts(store, snapshot) {
  if (snapshot?.social_posts) return snapshot.social_posts;
  return store.rest('social_posts?select=id,source_key,category,status,is_reserve,risk,scheduled_for,expires_at,created_at,origin,facts,fb_result&status=neq.REJECTED&order=created_at.desc&limit=500');
}

/**
 * @returns the autopilot result (+ `dry`). Throws only on infrastructure failure; content problems are in plan/skipped/notes.
 */
export async function runWeekly({ store = null, snapshot = null, dry = true, now = new Date(), ledgerDir = 'social-poc', renderImpl = undefined, log = () => {} } = {}) {
  if (!dry && !store) throw new Error('a store (service key) is required to write');
  const posts = await loadPosts(store, snapshot);
  const data = makeData({ store, snapshot, now });
  const excludeIds = recentEventIds(posts, now);
  const pool = await buildPool(data, { now, recentExploreIds: excludeIds });
  const restForRecheck = store ? store.rest : (p) => dbGet(p);
  const recheck = makeRecheck(restForRecheck);

  let realise = null, assignExisting = null;
  if (!dry) {
    const { assets: catalogue, source } = await loadCatalogueAuto();
    log(`media catalogue: ${source} (${catalogue.length} assets)`);
    const hist = await store.rest('social_post_media?select=asset_id,used_at&asset_id=not.is.null&order=used_at.desc&limit=60').catch(() => []);
    const history = hist.map((h) => ({ assetId: h.asset_id, usedAt: h.used_at }));
    const logo = fileUri(new URL('../../../icons/logo-wave.png', import.meta.url).pathname);
    realise = async (post, { slotIso, reserve, review, expiresAt, validateOpts }) => {
      const r = await renderPost(post, { catalogue, history, now, slotIso, logo, validateOpts, ...(renderImpl ? { render: renderImpl } : {}) });
      if (r.verdict.risk === 'BLOCKED') return { ok: false, reason: r.verdict.reasons.join('; ') };
      const dir = `${now.toISOString().slice(0, 10)}/${slugForPath(post.sourceKey)}`;
      const paths = r.images.map((_, i) => `${dir}/slide-${i + 1}.jpg`);
      for (const [i, img] of r.images.entries()) await uploadImage(paths[i], img);
      await insertPost(store, buildRow({ post, captions: r.captions, verdict: r.verdict, imagePaths: paths, slotIso, reserve, expiresAt }), r.selections);
      const auto = r.verdict.risk === 'AUTO_ELIGIBLE';
      return auto || review ? { ok: true } : { ok: false, reason: `needs review after image checks (queued as PENDING_REVIEW): ${r.verdict.reasons.join('; ')}` };
    };
    assignExisting = async (p, slot) => store.update(p.id, { status: 'SCHEDULED', scheduled_for: slot });
  }
  const result = await runAutopilot({ pool, posts, ledgerKeys: loadLedgerKeys(ledgerDir), now, cfg: SOCIAL_DEFAULTS, realise, assignExisting, recheck, excludeIds });
  return { ...result, dry };
}

/** Human-readable plan for the CLI and for the cron's JSON-free log. */
export function formatPlan(r) {
  const L = [`Autopilot plan (${r.dry ? 'DRY RUN: nothing written' : 'written'})`];
  for (const p of r.plan) {
    const slot = p.slot ? p.slot.replace('T08:00:00.000Z', ' 10:00 SAST') : '-';
    L.push(`  ${slot}  ${String(p.action).padEnd(20)} ${p.group || ''} ${p.key || ''}${p.title ? `  (${p.title})` : ''}${p.risk && p.risk !== 'AUTO_ELIGIBLE' ? `  [${p.risk}: ${p.reasons.join('; ')}]` : ''}${p.reason ? `  ${p.reason}` : ''}`);
  }
  L.push(`  mix counts in window: ${JSON.stringify(r.counts)}`);
  L.push(`  reserves: ${r.reserves.have} held, minimum ${r.reserves.min}, ${r.reserves.built.length} ${r.dry ? 'would be built' : 'built'}${r.reserves.shortfall ? `, SHORTFALL ${r.reserves.shortfall}` : ''}`);
  for (const k of r.reserves.built) L.push(`    reserve  ${k.category}  ${k.key}`);
  for (const s of r.skipped) L.push(`  group ${s.group} had nothing usable for ${s.slot}: ${s.tried.slice(0, 4).map((t) => `${t.key} (${String(t.skip).slice(0, 70)})`).join('; ')}${s.tried.length > 4 ? ` +${s.tried.length - 4} more` : ''}`);
  for (const n of r.notes) L.push(`  NOTE: ${n}`);
  return L.join('\n');
}
