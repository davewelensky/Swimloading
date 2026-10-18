// Validation: can this post be published, and does it need a human?
// Pure functions: no network, no clock unless passed in, so every rule is testable.
import { RISK, SOCIAL_DEFAULTS } from './config.js';
import { plainText } from './sources.js';
import { eventIneligibility } from './sources.js';
import { imageVerdict } from './media.js';

const EVENT_MAX_VERIFICATION_AGE_DAYS = 90;

export function validatePost(post, { now = new Date(), recentSourceKeys = {}, partnerShare = 0 } = {}) {
  const reasons = [];   // blockers or review triggers
  const warnings = [];  // informational
  const checks = [];
  const ok = (name, pass, detail) => checks.push({ name, pass, detail });
  let risk = RISK.AUTO;
  const raise = (level, why) => { reasons.push(why); if (level === RISK.BLOCKED || risk === RISK.AUTO) risk = level === RISK.BLOCKED ? RISK.BLOCKED : (risk === RISK.BLOCKED ? risk : level); };

  // 1. Facts exist and are sourced.
  ok('has facts', post.facts?.length > 0);
  if (!post.facts?.length) raise(RISK.BLOCKED, 'no facts');
  const unsourced = (post.facts || []).filter((f) => !f.source);
  ok('every fact has a source', unsourced.length === 0);
  if (unsourced.length) raise(RISK.BLOCKED, `${unsourced.length} fact(s) without a source`);

  // 2. File-sourced facts quote their source verbatim.
  const fileFacts = (post.facts || []).filter((f) => f.source?.file && f.source.quote);
  const cache = {};
  const missing = fileFacts.filter((f) => {
    cache[f.source.file] ??= plainText(f.source.file);
    return !cache[f.source.file].includes(String(f.source.quote));
  });
  ok('quoted facts found in source file', missing.length === 0, missing.map((f) => f.key).join(','));
  if (missing.length) raise(RISK.BLOCKED, `source text no longer contains: ${missing.map((f) => f.key).join(', ')}`);

  // 3. Source URL.
  ok('source URL present', !!post.sourceUrl);
  if (!post.sourceUrl) raise(RISK.BLOCKED, 'no source URL');

  // 4. Time-sensitive facts need an observation time.
  const ts = (post.facts || []).filter((f) => f.kind === 'time_sensitive');
  const noTime = ts.filter((f) => !f.observedAt);
  ok('time-sensitive facts carry an observation time', noTime.length === 0);
  if (noTime.length) raise(RISK.REVIEW, 'time-sensitive fact without timestamp');

  // 5. Image permission.
  if (post.image?.url && !post.image.licenceVerified) raise(RISK.REVIEW, `photo licence/attribution not verified (${post.image.credit})`);
  if (post.image?.reviewNote) raise(RISK.REVIEW, post.image.reviewNote);
  ok('image permission', !(post.image?.url && !post.image.licenceVerified), post.image?.credit || post.image?.note);

  // 6. Partner rules.
  if (post.partner) {
    const live = post.partner.chipState === 'live';
    ok('partner is live/approved', live);
    if (!live) raise(RISK.REVIEW, `partner status is "${post.partner.chipState}"`);
    if (partnerShare > SOCIAL_DEFAULTS.partnerMaxShare) raise(RISK.REVIEW, 'partner share of recent posts would exceed cap');
  }

  // 7. Conflicts and thin content.
  if (post.conflicts?.length) for (const c of post.conflicts) warnings.push(`Source conflict handled by omission: ${c}`);
  if (post.richness === 'thin') raise(RISK.REVIEW, 'thin content: only database fields available, not worth auto-publishing');

  // 8. Events.
  if (post.events) {
    const today = now.toISOString().slice(0, 10);
    for (const e of post.events) {
      if (e.isoDate < today) raise(RISK.BLOCKED, `${e.title} is in the past`);
      if (!SOCIAL_DEFAULTS.event.autoTiers.includes(e.tier)) raise(RISK.REVIEW, `${e.title}: tier ${e.tier}`);
      const ageDays = (now - new Date(e.lastVerifiedAt)) / 86400e3;
      if (!(ageDays <= EVENT_MAX_VERIFICATION_AGE_DAYS)) raise(RISK.REVIEW, `${e.title}: last verified ${Math.round(ageDays)} days ago`);
    }
    ok('events: future, acceptable tier, recently verified', risk !== RISK.BLOCKED);
    warnings.push('Registration status is "unknown" for all events: copy must not say registration is open.');
  }

  // 9. Duplicate within window.
  const last = recentSourceKeys[post.sourceKey];
  const dupe = last && (now - new Date(last)) / 86400e3 < SOCIAL_DEFAULTS.dedupeDays;
  ok(`not used in last ${SOCIAL_DEFAULTS.dedupeDays} days`, !dupe);
  if (dupe) raise(RISK.BLOCKED, 'source used within de-duplication window');

  return { risk, reasons, warnings, checks };
}

/**
 * Run IMMEDIATELY before publishing a post that cites Explore events. `freshRows` are the
 * current event_editions rows (with event_venues), `changes` the event_change_log rows since
 * the post was built. Returns the verdict; a dropped event means "flag for review / suppress".
 */
export function revalidateEvents(post, freshRows, changes, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const byId = new Map(freshRows.map((r) => [r.id, r]));
  const changed = new Set((changes || []).map((c) => c.edition_id));
  const dropped = [];
  for (const ev of post.events || []) {
    const row = byId.get(ev.id);
    const why = row ? eventIneligibility(row, changed, today) : 'edition no longer public';
    if (why) dropped.push({ title: ev.title, reason: why });
  }
  return { ok: dropped.length === 0, dropped, action: dropped.length ? 'SUPPRESS_AND_REPLACE_FROM_RESERVE' : 'PUBLISH' };
}

/** Every number in a caption must come from a fact (or the source URL / allowed list). */
export function ungroundedNumbers(caption, facts, extraAllowed = []) {
  const allowed = facts.map((f) => f.text).join(' ') + ' ' + extraAllowed.join(' ');
  const nums = (caption.match(/\d[\d.,]*\d|\d/g) || []).map((n) => n.replace(/[.,]$/, ''));
  return [...new Set(nums.filter((n) => !allowed.includes(n)))];
}

/** validatePost + the media checks for the selected image. Photo licences/consent come from the catalogue, not the post. */
export function validateWithImage(post, selection, opts = {}) {
  const base = validatePost({ ...post, image: { url: null, licenceVerified: true } }, opts);
  const iv = imageVerdict(selection, post, opts);
  const out = { ...base, checks: [...base.checks, ...iv.checks], reasons: [...base.reasons, ...iv.review] };
  if (iv.review.length && out.risk === RISK.AUTO) out.risk = RISK.REVIEW;
  if (iv.checks.some((c) => !c.pass)) { out.risk = RISK.BLOCKED; out.reasons.push('failed image check: ' + iv.checks.filter((c) => !c.pass).map((c) => c.name).join(', ')); }
  return out;
}
