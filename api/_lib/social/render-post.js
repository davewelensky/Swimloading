// One candidate post -> images + captions + final verdict. This is the render half of scripts/render-social-poc.mjs,
// extracted so the unattended autopilot and the manual script share it. Rendering is injected (`render`) so tests need no browser.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { CATEGORIES } from './config.js';
import { selectImage, materialise } from './media.js';
import { validateWithImage, ungroundedNumbers } from './validate.js';
import { buildCaptions } from './captions.js';
import { renderHtml, visualSlide, visualCopy } from './templates.js';
import { renderSlides } from './render.js';

const ROOT = resolve(new URL('../../..', import.meta.url).pathname);
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
export const fileUri = (path) => `data:${MIME[extname(path).toLowerCase()] || 'image/jpeg'};base64,${readFileSync(path).toString('base64')}`;
const stripUrl = (t) => t.replace(/https?:\/\/\S+/g, '');

/**
 * @param post  candidate (sources.js / series.js shape)
 * @param ctx   { catalogue, history (newest first, mutated), now, slotIso, logo (data URI), render?, fetchOriginal? }
 * @returns { images: Buffer[], selections, captions, verdict, problems }
 */
export async function renderPost(post, ctx) {
  const { catalogue, history, now, slotIso, logo, render = renderSlides } = ctx;
  const isWeek = post.category === CATEGORIES.THIS_WEEK;
  const partnerLogo = post.partner?.logo && existsSync(resolve(ROOT, post.partner.logo)) ? fileUri(resolve(ROOT, post.partner.logo)) : null;
  const base = { post, logo, partnerLogo, orange: [CATEGORIES.BEHIND_THE_BRAND, CATEGORIES.THIS_WEEK].includes(post.category) };
  const slideSpecs = [], selections = [];
  const addSlide = async (subPost, copy, urlText, geoOverride) => {
    let sel = selectImage({ ...subPost, geo: geoOverride !== undefined ? geoOverride : subPost.geo }, catalogue, { history, now });
    if (sel.asset && selections.some((x) => x.assetId === sel.asset.id)) {          // one photograph is never repeated inside a post
      sel = { tier: 'branded-graphic', template: 'graphic', asset: null, illustrative: false, subject: null, considered: sel.considered, reason: `Photograph ${sel.asset.id} already used on an earlier slide of this post; designed graphic used instead.` };
    }
    selections.push({ tier: sel.tier, template: sel.template, assetId: sel.asset?.id || null, reason: sel.reason, illustrative: sel.illustrative, subject: sel.subject });
    if (sel.asset) { await materialise(sel.asset); history.unshift({ assetId: sel.asset.id, usedAt: slotIso || now.toISOString() }); }
    slideSpecs.push({ sel, spec: { ...base, template: sel.template, asset: sel.asset, photoUri: sel.asset ? fileUri(sel.asset.abs) : null, illustrative: sel.illustrative,
      copy, geo: sel.template === 'map-led' ? (geoOverride !== undefined ? geoOverride : subPost.geo) : null, url: urlText } });
    return sel;
  };
  const urlText = post.sourceUrl.replace('https://www.', '').replace(/\?.*/, '');
  let primary;
  if (isWeek) {
    primary = await addSlide({ ...post, preferPhoto: true }, visualCopy(post), 'swimloading.com/explore', null);
    for (const [n, e] of post.events.entries()) await addSlide({ ...post, preferPhoto: false }, visualCopy(post, n), 'swimloading.com/explore',
      e.lat != null ? { points: [{ lat: e.lat, lng: e.lng, label: e.place.split(',')[0] }], maxZoom: 7 } : null);
  } else primary = await addSlide(post, visualCopy(post), urlText);

  const legacy = renderHtml(post, { logo, partnerLogo, photo: null });
  const rendered = await render(slideSpecs.map((s, n) => s.sel.template === 'graphic'
    ? { html: legacy[isWeek ? n : 0], template: undefined }
    : { html: visualSlide(s.spec), template: s.sel.template }));

  const captions = buildCaptions(post);
  const windowNote = post.windowDays ? [String(post.windowDays)] : [];
  const ungrounded = [...new Set([...ungroundedNumbers(stripUrl(captions.facebook), post.facts, windowNote), ...ungroundedNumbers(captions.instagram, post.facts, windowNote)])];
  const verdict = validateWithImage(post, primary, { now, ...(ctx.validateOpts || {}) });
  if (ungrounded.length) { verdict.reasons.push(`caption contains numbers not in facts: ${ungrounded}`); verdict.risk = 'BLOCKED'; }
  const problems = rendered.flatMap((r, n) => [...r.clipped.map((c) => `slide ${n + 1} clipping: ${c}`), ...r.problems.map((p) => `slide ${n + 1}: ${p}`)]);
  if (problems.length) { verdict.reasons.push(...problems); verdict.risk = 'BLOCKED'; }
  verdict.checks.push({ name: 'no clipping, template matches, text contrast >= 3:1, images loaded', pass: problems.length === 0 });
  return { images: rendered.map((r) => r.jpeg), selections, captions, verdict, problems };
}
