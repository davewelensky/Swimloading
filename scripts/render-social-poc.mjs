// Social Content Engine: proof of concept. Builds six posts from REAL SwimLoading data,
// renders images, writes captions, validates, and writes previews to social-poc/.
// Read-only against the database. Publishes nothing. Needs network (fonts, one photo).
//
//   LAB_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/render-social-poc.mjs
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spotlightFromVenueMap, crossingFromDb, partnerFromPage, discoversRegion, spotFromDb, exploreUpcoming } from '../api/_lib/social/sources.js';
import { validatePost, ungroundedNumbers } from '../api/_lib/social/validate.js';
import { buildCaptions } from '../api/_lib/social/captions.js';
import { renderHtml } from '../api/_lib/social/templates.js';
import { renderSlides } from '../api/_lib/social/render.js';
import { nextSlots } from '../api/_lib/social/config.js';

process.env.LAB_CHROME_PATH ||= '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = 'social-poc';
const now = new Date();
const dataUri = (path, mime) => `data:${mime};base64,${readFileSync(path).toString('base64')}`;
async function remoteUri(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'SwimLoadingSocialPOC/1.0 (support@swimloading.com)' } });
  if (!r.ok) throw new Error(`photo fetch ${r.status}`);
  return `data:${r.headers.get('content-type') || 'image/jpeg'};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
}

const logo = dataUri('icons/logo-wave.png', 'image/png');
const maurtenLogo = dataUri('icons/Maurten logo.jpg', 'image/jpeg');

const specs = [
  { id: '1-behind-the-brand-maurten', label: 'Behind the Brand: Maurten (live partner; EO Lab substituted, it is still "soon")',
    build: async () => partnerFromPage({ name: 'Maurten', file: 'partners/maurten.html', url: '/partners/maurten', logo: 'icons/Maurten logo.jpg',
      quotes: [
        ['claim', 'No sweeteners. No flavours. No additives.'],
        ['range', 'Gel 100 100kcal per gel.', 'Gel 100: 100kcal per gel.'],
        ['stock', 'Available from Art of Endurance in Cape Town and Durban.'],
      ] }) },
  { id: '2-swim-spotlight-tooting-bec', label: 'Swim Spotlight: Tooting Bec Lido', build: () => spotlightFromVenueMap('tooting-bec-lido') },
  { id: '3-crossing-english-channel', label: 'Crossing Intelligence: English Channel', build: () => crossingFromDb('english-channel') },
  { id: '4-discovers-london', label: 'SwimLoading Discovers: outdoor swimming around London', build: () => discoversRegion({ region: 'London', areaLike: 'London', countryCode: 'GB' }) },
  { id: '5-swim-spotlight-clifton-4th', label: 'Swim Spotlight: South African spot (Clifton 4th Beach)', build: () => spotFromDb('Clifton 4th Beach') },
  { id: '6-this-week-explore', label: 'This Week in Open Water: Explore events', build: () => exploreUpcoming({ from: now.toISOString() }) },
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const results = [];
const slots = nextSlots(now, 6);

for (const [i, spec] of specs.entries()) {
  const entry = { id: spec.id, label: spec.label, generatedAt: now.toISOString() };
  try {
    const post = await spec.build();
    if (post.gap) { Object.assign(entry, { status: 'GAP', gap: post.gap }); results.push(entry); console.log('GAP ', spec.id, post.gap); continue; }
    const assets = { logo, partnerLogo: maurtenLogo, photo: post.image?.url ? await remoteUri(post.image.url) : null };
    const captions = buildCaptions(post);
    const stripUrl = (t) => t.replace(/https?:\/\/\S+/g, '');
    const windowNote = post.windowDays ? [String(post.windowDays)] : [];
    const ungrounded = [...new Set([...ungroundedNumbers(stripUrl(captions.facebook), post.facts, windowNote), ...ungroundedNumbers(captions.instagram, post.facts, windowNote)])];
    const verdict = validatePost(post, { now });
    if (ungrounded.length) { verdict.reasons.push(`caption contains numbers not in facts: ${ungrounded}`); verdict.risk = 'BLOCKED'; }
    const rendered = await renderSlides(renderHtml(post, assets));
    mkdirSync(`${OUT}/${spec.id}`, { recursive: true });
    const images = rendered.map((r, n) => { const f = `${spec.id}/slide-${n + 1}.jpg`; writeFileSync(`${OUT}/${f}`, r.jpeg); return f; });
    const clipped = rendered.flatMap((r) => r.clipped);
    if (clipped.length) { verdict.reasons.push(`layout clipping: ${clipped.join('; ')}`); verdict.risk = 'BLOCKED'; }
    Object.assign(entry, {
      status: 'GENERATED', category: post.category, angle: post.angle, sourceUrl: post.sourceUrl, sourceKey: post.sourceKey,
      images, instagramImages: images, facebookImages: images, facebookNote: 'Same 4:5 image reused for Facebook; the feed displays it uncropped.',
      instagramCaption: captions.instagram, facebookCaption: captions.facebook,
      facts: post.facts.map((f) => ({ key: f.key, text: f.text, kind: f.kind, observedAt: f.observedAt, source: f.source })),
      freshness: post.freshnessAssessment, eligibility: verdict, imageNote: post.image?.credit || post.image?.note || null,
      proposedSlot: slots[i] || null, extra: post.rejectedCount != null ? { eventsRejectedByRules: post.rejectedCount, sample: post.rejectedSample } : undefined,
    });
    console.log(verdict.risk.padEnd(16), spec.id, clipped.length ? 'CLIPPED' : '');
  } catch (err) {
    Object.assign(entry, { status: 'ERROR', error: String(err.message || err) });
    console.log('ERROR', spec.id, entry.error);
  }
  results.push(entry);
}
writeFileSync(`${OUT}/posts.json`, JSON.stringify({ generatedAt: now.toISOString(), note: 'Proof of concept. Nothing published.', posts: results }, null, 2));
console.log(`wrote ${OUT}/posts.json`);
