// Weekly autopilot: fill the next 2 weeks of Tue/Thu/Sat slots from real data, by the mix in config.js.
//
// Rules (each one is tested in test/social-autopilot.test.js):
//  * Existing APPROVED-but-unslotted posts take free slots first (same order as `social-queue.mjs schedule`).
//  * For each remaining free slot the group furthest below its mix target that has a usable candidate is chosen.
//    A group with no usable candidate is skipped and the others absorb its share. If nothing is usable the slot stays
//    EMPTY: weak content is never used to pad a slot (the hourly publisher emails Dave about an empty slot).
//  * 90-day de-duplication by source_key against social_posts AND social-poc/publish-ledger.json (manual Facebook CLI).
//  * Partner posts: at most `partnerMaxShare` of the recent window, enforced here and again in validatePost.
//  * AUTO_ELIGIBLE -> SCHEDULED into the slot. REVIEW_REQUIRED -> PENDING_REVIEW and NEVER takes a slot. BLOCKED -> skipped.
//  * Measured-conditions posts are "late bound": the slot is held until it is `lateBindingHours` away so the readings
//    are still inside the freshness ceiling when posted; the daily run fills it then (or any later run before the slot).
//  * Reserves: keep >= reserveMin APPROVED evergreen AUTO_ELIGIBLE reserves; report a shortfall.
import { readFileSync, existsSync } from 'node:fs';
import { dbGet } from '../../seo-utils.js';
import { SOCIAL_DEFAULTS, CATEGORIES, MIX_GROUP, nextSlots } from './config.js';
import { validatePost } from './validate.js';
import { spotlightFromVenueMap, exploreUpcoming } from './sources.js';
import { conditionsWeekly, regionalUnits, regionalMap, crossingAngles, partnerCards } from './series.js';
import { slotMs } from './queue.js';

export const GROUPS = ['explore', 'locations', 'crossings', 'ocean', 'partners', 'clubsAndPlatform'];
export const groupOf = (category) => MIX_GROUP[category] || null;
const DAY = 86400e3;

// ── de-duplication ─────────────────────────────────────────────────────────
/** Local files from the manual Facebook CLI: ledger ids -> source keys (via posts.json) with their publish time. */
export function loadLedgerKeys(dir = 'social-poc') {
  const out = {};
  const lf = `${dir}/publish-ledger.json`, pf = `${dir}/posts.json`;
  if (!existsSync(lf)) return out;
  const ledger = JSON.parse(readFileSync(lf, 'utf8'));
  const byId = existsSync(pf) ? Object.fromEntries((JSON.parse(readFileSync(pf, 'utf8')).posts || []).map((p) => [p.id, p.sourceKey])) : {};
  for (const [k, v] of Object.entries(ledger)) {
    const id = k.replace(/^(fb|ig):/, ''), key = byId[id];
    if (key && v?.at && (!out[key] || v.at > out[key])) out[key] = v.at;
  }
  return out;
}

/** source_key -> most recent time it was used (created or slotted), over non-rejected DB posts plus the ledger. */
export function recentKeyMap(posts, ledgerKeys = {}) {
  const m = { ...ledgerKeys };
  for (const p of posts) {
    if (p.status === 'REJECTED') continue;
    const t = p.status === 'PUBLISHED' ? (p.fb_result?.publishedAt || p.scheduled_for || p.created_at) : (p.scheduled_for && slotMs(p.scheduled_for) > slotMs(p.created_at) ? p.scheduled_for : p.created_at);
    if (!m[p.source_key] || slotMs(t) > slotMs(m[p.source_key])) m[p.source_key] = t;
  }
  return m;
}
export const isRecent = (keyMap, key, now, days = SOCIAL_DEFAULTS.dedupeDays) => !!keyMap[key] && (now - new Date(keyMap[key])) / DAY < days;

// ── mix ────────────────────────────────────────────────────────────────────
/** The group most below its target share that is available. Ties go to the earlier group in the mix. */
export function pickGroup(counts, mix, available) {
  const total = GROUPS.reduce((n, g) => n + (counts[g] || 0), 0);
  let best = null;
  for (const g of GROUPS) {
    if (!available.has(g) || !(mix[g] > 0)) continue;
    const deficit = mix[g] * (total + 1) - (counts[g] || 0);
    if (!best || deficit > best.deficit + 1e-9) best = { g, deficit };
  }
  return best?.g || null;
}

/** Recent window (published + slotted + approved non-reserve posts), newest first, as mix counts. */
export function windowCounts(posts, size = SOCIAL_DEFAULTS.autopilot.recentWindow) {
  const live = posts.filter((p) => ['PUBLISHED', 'SCHEDULED', 'APPROVED'].includes(p.status) && !p.is_reserve)
    .sort((a, b) => slotMs(b.scheduled_for || b.created_at) - slotMs(a.scheduled_for || a.created_at)).slice(0, size);
  const counts = {};
  for (const p of live) { const g = groupOf(p.category); if (g) counts[g] = (counts[g] || 0) + 1; }
  return { counts, total: live.length };
}
/** May one more partner post go out without the partner share of the window exceeding the cap? */
export const partnerAllowed = (counts, cap = SOCIAL_DEFAULTS.partnerMaxShare) => {
  const total = GROUPS.reduce((n, g) => n + (counts[g] || 0), 0);
  return ((counts.partners || 0) + 1) / (total + 1) <= cap + 1e-9;
};

/** Explore edition ids already featured in a post made/slotted recently (so consecutive weeks do not repeat an event). */
export function recentEventIds(posts, now, days = SOCIAL_DEFAULTS.autopilot.exploreExcludeDays) {
  const ids = new Set();
  for (const p of posts) {
    if (p.status === 'REJECTED' || (now - new Date(p.scheduled_for || p.created_at)) / DAY > days) continue;
    for (const f of p.facts || []) if (f.source?.table === 'event_editions' && f.source.row) ids.add(f.source.row);
  }
  return ids;
}

// ── candidate pool ─────────────────────────────────────────────────────────
/**
 * Lazy candidates per group. A candidate = { group, key, evergreen, lateBinding, build(slotIso) -> post|{gap} }.
 * `data` supplies rows (live: Supabase; tests/snapshot: fixtures). Only reads.
 */
export async function buildPool(data, { now = new Date(), recentExploreIds = new Set() } = {}) {
  const pool = Object.fromEntries(GROUPS.map((g) => [g, []]));
  const add = (group, key, build, o = {}) => pool[group].push({ group, key, build, evergreen: true, lateBinding: false, ...o });
  // explore: one generator; the key is only known once built for a slot
  add('explore', 'explore:generator', (slot) => exploreUpcoming({ from: slot, excludeIds: recentExploreIds }), { evergreen: false, generator: true });
  // ocean = measured conditions, built at the slot's own time
  add('ocean', 'conditions:generator', async (slot) => conditionsWeekly(await data.conditions(), await data.conditionSpots(), { now, slotIso: slot }), { evergreen: false, lateBinding: true, generator: true });
  // locations
  for (const slug of ['tooting-bec-lido', 'brockwell-lido']) add('locations', `curated:${slug}`, () => spotlightFromVenueMap(slug), { dbKey: true });
  for (const u of regionalUnits(await data.spots())) for (let p = 0; p < SOCIAL_DEFAULTS.autopilot.regionMaxPages; p++) {
    const post = regionalMap(u, p);
    if (!post.gap) add('locations', post.sourceKey, () => post);
  }
  // crossings
  for (const c of await data.crossings()) for (const post of crossingAngles(c)) add('crossings', post.sourceKey, () => post);
  // partners (never reserves: they are capped and always deliberate)
  for (const post of partnerCards(await data.partners())) add('partners', post.sourceKey, () => post, { evergreen: false });
  return pool;
}

const orderCandidates = (list, keyMap, now) => [...list].sort((a, b) => {
  const ta = keyMap[a.key] ? new Date(keyMap[a.key]).getTime() : 0, tb = keyMap[b.key] ? new Date(keyMap[b.key]).getTime() : 0;
  return ta - tb || a.key.localeCompare(b.key);                       // never-used first, then least recently used, then stable
});

/** A candidate whose source data is incomplete must become a reported gap, never crash the run. */
const safeBuild = async (c, slot) => { try { return await c.build(slot); } catch (e) { return { gap: `could not build (${String(e.message).slice(0, 90)})` }; } };
const summarise = (post, v) => ({ key: post.sourceKey, category: post.category, angle: post.angle, risk: v.risk, reasons: v.reasons });

/**
 * @param o { pool, posts (existing DB rows), ledgerKeys, now, validate?, build? hooks, write? hooks }
 *   hooks.realise(post, {slotIso, reserve, validateOpts}) -> { verdict, insert() } ; absent in dry-run (validation only).
 * @returns { plan: [...], reserves: {...}, notes: [...] }
 */
export async function runAutopilot({ pool, posts, ledgerKeys = {}, now = new Date(), cfg = SOCIAL_DEFAULTS, realise = null, assignExisting = null, recheck = null, excludeIds = new Set() }) {
  const ap = cfg.autopilot;
  const horizon = now.getTime() + ap.horizonDays * DAY;
  const keyMap = recentKeyMap(posts, ledgerKeys);
  const plan = [], notes = [];
  const work = posts.map((p) => ({ ...p }));
  let reviewMade = 0;
  const skipped = [];

  const allSlots = nextSlots(now, 10, cfg.cadence).filter((s) => slotMs(s) <= horizon);
  const taken = new Set(work.filter((p) => ['SCHEDULED', 'PUBLISHED'].includes(p.status) && p.scheduled_for && !p.is_reserve).map((p) => slotMs(p.scheduled_for)));
  let free = allSlots.filter((s) => !taken.has(slotMs(s)));

  // 1. Already-approved posts waiting for a slot go first (soonest-expiring first, as `schedule` does).
  const waiting = work.filter((p) => p.status === 'APPROVED' && !p.is_reserve && !p.scheduled_for)
    .sort((a, b) => String(a.expires_at || '9').localeCompare(String(b.expires_at || '9')) || String(a.created_at).localeCompare(String(b.created_at)));
  for (const p of waiting) {
    const s = free.shift(); if (!s) break;
    plan.push({ slot: s, action: 'assign-existing', key: p.source_key, group: groupOf(p.category) });
    p.status = 'SCHEDULED'; p.scheduled_for = s;
    if (assignExisting) await assignExisting(p, s);
  }

  // 2. Fill the rest.
  const { counts } = windowCounts(work);
  for (const [g] of Object.entries(counts)) counts[g] = counts[g] || 0;
  const used = new Set();                                   // keys placed during THIS run (history is in keyMap)
  const exhausted = new Set();
  for (const slotIso of free) {
    const lead = (slotMs(slotIso) - now.getTime()) / 3600e3;
    let done = false;
    while (!done) {
      const available = new Set(GROUPS.filter((g) => pool[g]?.length && !exhausted.has(g) && (g !== 'partners' || partnerAllowed(counts, cfg.partnerMaxShare))));
      const g = pickGroup(counts, cfg.mix, available);
      if (!g) { plan.push({ slot: slotIso, action: 'left-empty', reason: 'no usable candidate in any group (slot is not padded with weak content)' }); done = true; break; }
      const cands = orderCandidates(pool[g], keyMap, now);
      if (cands.some((c) => c.lateBinding) && lead > ap.lateBindingHours) {
        plan.push({ slot: slotIso, action: 'held-for-conditions', group: g, reason: `measured readings must be fresh when posted: slot is ${Math.round(lead)} h away, built when it is within ${ap.lateBindingHours} h` });
        counts[g] = (counts[g] || 0) + 1; done = true; break;
      }
      let placed = false;
      const tried = [];
      for (const c of cands) {
        if (!c.generator && isRecent(keyMap, c.key, now)) { tried.push({ key: c.key, skip: 'used within 90 days' }); continue; }
        const post = await safeBuild(c, slotIso);
        if (post.gap) { tried.push({ key: c.key, skip: post.gap }); continue; }
        if (isRecent(keyMap, post.sourceKey, now) || used.has(post.sourceKey)) { tried.push({ key: post.sourceKey, skip: 'used within 90 days' }); continue; }
        if (post.events && recheck) { const rv = await recheck({ ...post, created_at: now.toISOString() }, now); if (!rv.ok) { tried.push({ key: post.sourceKey, skip: rv.reason }); continue; } }
        const share = ((counts.partners || 0) + (post.partner ? 1 : 0)) / (GROUPS.reduce((n, x) => n + (counts[x] || 0), 0) + 1);
        const v = validatePost(post, { now, recentSourceKeys: keyMap, partnerShare: share });
        const entry = { slot: slotIso, group: g, ...summarise(post, v) };
        if (v.risk === 'BLOCKED') { tried.push({ key: post.sourceKey, skip: `blocked: ${v.reasons.join('; ')}` }); continue; }
        if (v.risk === 'REVIEW_REQUIRED') {
          // Needs a human: queue for review (never takes the slot) and carry on to the next candidate.
          if (reviewMade < ap.reviewPerRun) { reviewMade++; used.add(post.sourceKey); keyMap[post.sourceKey] = now.toISOString(); plan.push({ ...entry, action: 'pending-review' }); if (realise) await realise(post, { slotIso: null, reserve: false, review: true, expiresAt: post.expiresAtIso }); }
          else tried.push({ key: post.sourceKey, skip: `needs review (review cap ${ap.reviewPerRun} per run reached)` });
          continue;
        }
        const out = realise ? await realise(post, { slotIso, reserve: false, expiresAt: post.expiresAtIso || (post.events ? new Date(slotMs(slotIso) + DAY).toISOString() : null), validateOpts: { recentSourceKeys: keyMap, partnerShare: share } }) : { ok: true };
        if (!out.ok) { tried.push({ key: post.sourceKey, skip: `render: ${out.reason}` }); continue; }
        plan.push({ ...entry, action: 'schedule', title: post.region || post.partner?.name || post.crossing?.name || post.facts[0]?.text });
        for (const e of post.events || []) excludeIds.add(e.id);
        used.add(post.sourceKey); keyMap[post.sourceKey] = slotIso; counts[g] = (counts[g] || 0) + 1; placed = true; done = true; break;
      }
      if (!placed) { exhausted.add(g); skipped.push({ slot: slotIso, group: g, tried }); }
    }
  }

  // 3. Reserves: evergreen, AUTO_ELIGIBLE, unslotted. Round-robin the groups that have evergreen supply.
  const have = work.filter((p) => p.is_reserve && p.status === 'APPROVED' && p.risk === 'AUTO_ELIGIBLE').length;
  const need = Math.max(0, cfg.reserveMin - have);
  const built = [];
  const rr = ['locations', 'crossings', 'locations', 'crossings'];
  let misses = 0;
  for (let i = 0; built.length < Math.min(need, ap.reserveBatch) && misses < rr.length; i++) {
    const g = rr[i % rr.length];
    let made = false;
    for (const c of orderCandidates(pool[g].filter((x) => x.evergreen && !x.generator), keyMap, now)) {
      if (isRecent(keyMap, c.key, now) || used.has(c.key)) continue;
      const post = await safeBuild(c, null);
      if (post.gap || isRecent(keyMap, post.sourceKey, now) || used.has(post.sourceKey)) continue;
      const v = validatePost(post, { now, recentSourceKeys: keyMap });
      if (v.risk !== 'AUTO_ELIGIBLE') continue;
      const out = realise ? await realise(post, { slotIso: null, reserve: true, validateOpts: { recentSourceKeys: keyMap } }) : { ok: true };
      if (!out.ok) continue;
      used.add(post.sourceKey); keyMap[post.sourceKey] = now.toISOString(); built.push({ key: post.sourceKey, category: post.category }); made = true; break;
    }
    misses = made ? 0 : misses + 1;
  }
  const reserves = { have, min: cfg.reserveMin, needed: need, built, shortfall: Math.max(0, cfg.reserveMin - have - built.length) };
  if (reserves.shortfall) notes.push(`Reserve queue will be ${have + built.length} of the required ${cfg.reserveMin}: not enough eligible evergreen content to refill it.`);
  return { plan, reserves, skipped, notes, counts };
}
