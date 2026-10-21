// Social Content Engine proof of concept (v2: photography-first). Six posts from REAL SwimLoading data:
// image selection from the media catalogue, three visual approaches, pixel-level quality checks, captions,
// validation, and before/after previews in social-poc/. Read-only against the database. Publishes nothing.
//
//   node scripts/render-social-poc.mjs            (needs network: fonts, map tiles; uses local Chrome)
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { spotlightFromVenueMap, crossingFromDb, partnerFromPage, discoversRegion, spotFromDb, exploreUpcoming } from '../api/_lib/social/sources.js';
import { validateWithImage, revalidateEvents, ungroundedNumbers, derivedNumbers } from '../api/_lib/social/validate.js';
import { buildCaptions } from '../api/_lib/social/captions.js';
import { renderHtml, visualSlide, visualCopy } from '../api/_lib/social/templates.js';
import { renderSlides } from '../api/_lib/social/render.js';
import { nextSlots, CATEGORIES } from '../api/_lib/social/config.js';
import { loadCatalogueAuto, materialise, selectImage } from '../api/_lib/social/media.js';
import { dbGet } from '../api/seo-utils.js';

process.env.LAB_CHROME_PATH ||= '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = 'social-poc';
const now = new Date();
const uri = (path, mime) => `data:${mime};base64,${readFileSync(path).toString('base64')}`;
const logo = uri('icons/logo-wave.png', 'image/png');
const maurtenLogo = uri('icons/Maurten logo.jpg', 'image/jpeg');
const { assets: catalogue, source: catalogueSource } = await loadCatalogueAuto();
console.log(`media catalogue: ${catalogueSource} (${catalogue.length} assets)`);
const photoUri = (a) => uri(a.abs, /\.png$/i.test(a.abs) ? 'image/png' : 'image/jpeg');

const specs = [
  { id: '1-behind-the-brand-maurten', label: 'Behind the Brand: Maurten', build: async () => partnerFromPage({ name: 'Maurten', file: 'partners/maurten.html', url: '/partners/maurten', logo: 'icons/Maurten logo.jpg',
      quotes: [['claim', 'No sweeteners. No flavours. No additives.'], ['range', 'Gel 100 100kcal per gel.', 'Gel 100: 100kcal per gel.'], ['stock', 'Available from Art of Endurance in Cape Town and Durban.']] }) },
  { id: '2-swim-spotlight-tooting-bec', label: 'Swim Spotlight: Tooting Bec Lido', build: () => spotlightFromVenueMap('tooting-bec-lido') },
  { id: '3-crossing-english-channel', label: 'Crossing Intelligence: English Channel', build: () => crossingFromDb('english-channel') },
  { id: '4-discovers-london', label: 'SwimLoading Discovers: outdoor swimming around London', build: () => discoversRegion({ region: 'London', areaLike: 'London', countryCode: 'GB' }) },
  { id: '5-swim-spotlight-clifton-4th', label: 'Swim Spotlight: Clifton 4th Beach (South Africa)', build: () => spotFromDb('Clifton 4th Beach') },
  { id: '6-this-week-explore', label: 'This Week in Open Water: Explore events', build: () => exploreUpcoming({ from: now.toISOString() }) },
];

const FRESH_SELECT = 'id,title,discipline,status,date_confirmed,start_date,verification_tier,official_url,event_venues(display_name,city,country_code)';
const slots = nextSlots(now, 6);
const history = [];                         // simulated publication history, newest first
rmSync(`${OUT}/v2tmp`, { recursive: true, force: true });
const results = [];

for (const [i, spec] of specs.entries()) {
  const entry = { id: spec.id, label: spec.label, generatedAt: now.toISOString(), version: 2 };
  try {
    const post = await spec.build();
    if (post.gap) { Object.assign(entry, { status: 'GAP', gap: post.gap }); results.push(entry); console.log('GAP', spec.id, post.gap); continue; }
    const isWeek = post.category === CATEGORIES.THIS_WEEK;

    // Time-sensitive content: re-validate against the live tables immediately before final assets are built.
    if (isWeek) {
      const ids = post.events.map((e) => e.id).join(',');
      const fresh = await dbGet(`event_editions?select=${FRESH_SELECT}&id=in.(${ids})`) || [];
      const changes = await dbGet(`event_change_log?select=edition_id,change_type&edition_id=in.(${ids})&change_type=in.(date_changed,venue_changed,cancelled,postponed)`) || [];
      const rv = revalidateEvents(post, fresh, changes, now);
      entry.eventRecheck = rv;
      if (!rv.ok) { Object.assign(entry, { status: 'SUPPRESSED', gap: `Event re-check failed: ${JSON.stringify(rv.dropped)}` }); results.push(entry); console.log('SUPPRESSED', spec.id); continue; }
    }

    // Image selection (deterministic) + slide specs.
    const base = { post, logo, partnerLogo: maurtenLogo, orange: [CATEGORIES.BEHIND_THE_BRAND, CATEGORIES.THIS_WEEK].includes(post.category) };
    const slideSpecs = [], selections = [];
    const addSlide = async (subPost, copy, urlText, geoOverride) => {
      let sel = selectImage({ ...subPost, geo: geoOverride !== undefined ? geoOverride : subPost.geo }, catalogue, { history, now });
      // One photograph is never repeated across the slides of a single post: fall back to a designed graphic.
      if (sel.asset && selections.some((x) => x.assetId === sel.asset.id) && selections.length > 0) {
        sel = { tier: 'branded-graphic', template: 'graphic', asset: null, illustrative: false, subject: null, considered: sel.considered,
          reason: `Photograph ${sel.asset.id} is already used on an earlier slide of this post; designed branded graphic used instead.` };
      }
      selections.push({ tier: sel.tier, template: sel.template, assetId: sel.asset?.id || null, reason: sel.reason, illustrative: sel.illustrative, subject: sel.subject,
        source: sel.asset ? { file: sel.asset.file, attribution: sel.asset.attribution, permission: sel.asset.permission, sourceUrl: sel.asset.sourceUrl || null } : sel.tier === 'licensed-map' ? { attribution: '© OpenStreetMap contributors © CARTO' } : null });
      if (sel.asset) await materialise(sel.asset);
      if (sel.asset) history.unshift({ assetId: sel.asset.id, usedAt: slots[i] || now.toISOString() });
      slideSpecs.push({ sel, spec: { ...base, template: sel.template, asset: sel.asset, photoUri: sel.asset ? photoUri(sel.asset) : null, illustrative: sel.illustrative,
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

    const rendered = await renderSlides(slideSpecs.map((s, n) => s.sel.template === 'graphic'
      ? { html: renderHtml(post, { logo, partnerLogo: maurtenLogo, photo: null })[isWeek ? n : 0], template: undefined }
      : { html: visualSlide(s.spec), template: s.sel.template }));

    const captions = buildCaptions(post);
    const stripUrl = (t) => t.replace(/https?:\/\/\S+/g, '');
    const windowNote = derivedNumbers(post);
    const ungrounded = [...new Set([...ungroundedNumbers(stripUrl(captions.facebook), post.facts, windowNote), ...ungroundedNumbers(captions.instagram, post.facts, windowNote)])];
    const verdict = validateWithImage(post, primary, { now });
    const extraSelChecks = selections.slice(1).map((s) => s);
    if (ungrounded.length) { verdict.reasons.push(`caption contains numbers not in facts: ${ungrounded}`); verdict.risk = 'BLOCKED'; }
    const problems = rendered.flatMap((r, n) => [...r.clipped.map((c) => `slide ${n + 1} clipping: ${c}`), ...r.problems.map((p) => `slide ${n + 1}: ${p}`)]);
    if (problems.length) { verdict.reasons.push(...problems); verdict.risk = 'BLOCKED'; }
    verdict.checks.push({ name: 'no clipping, template matches, text contrast >= 3:1, images loaded', pass: problems.length === 0, detail: rendered.map((r) => r.contrast.join('/') || '-').join(' | ') });

    mkdirSync(`${OUT}/${spec.id}`, { recursive: true });
    const images = rendered.map((r, n) => { const f = `${spec.id}/slide-${n + 1}.jpg`; writeFileSync(`${OUT}/${f}`, r.jpeg); return f; });
    const prev = [1, 2, 3, 4, 5].map((n) => `v1/${spec.id}/slide-${n}.jpg`).filter((f) => existsSync(`${OUT}/${f}`));
    Object.assign(entry, {
      status: 'GENERATED', category: post.category, angle: post.angle, sourceUrl: post.sourceUrl, sourceKey: post.sourceKey,
      template: primary.template, images, previousImages: prev, selections,
      instagramCaption: captions.instagram, facebookCaption: captions.facebook,
      facts: post.facts.map((f) => ({ key: f.key, text: f.text, kind: f.kind, observedAt: f.observedAt, source: f.source })),
      freshness: post.freshnessAssessment, eligibility: verdict, proposedSlot: slots[i] || null,
      extra: post.rejectedCount != null ? { eventsRejectedByRules: post.rejectedCount, sample: post.rejectedSample } : undefined,
    });
    console.log(verdict.risk.padEnd(16), spec.id.padEnd(34), selections.map((s) => `${s.template}/${s.assetId || '-'}`).join(' '), problems.length ? 'PROBLEMS' : '');
  } catch (err) {
    Object.assign(entry, { status: 'ERROR', error: String(err.stack || err.message || err).split('\n').slice(0, 3).join(' ') });
    console.log('ERROR', spec.id, entry.error);
  }
  results.push(entry);
}
writeFileSync(`${OUT}/posts.json`, JSON.stringify({ generatedAt: now.toISOString(), version: 2, note: 'Proof of concept, photography-first. Nothing published.', posts: results }, null, 2));
console.log(`wrote ${OUT}/posts.json`);
