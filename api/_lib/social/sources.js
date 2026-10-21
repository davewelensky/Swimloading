// Extractors: real SwimLoading data in, post candidates out. Read-only (anon key, same
// as the public site). A candidate is { category, angle, sourceKey, sourceUrl, ... facts[] }
// and carries NO prose: wording is produced later from facts alone.
import { readFileSync } from 'node:fs';
import { dbGet } from '../../seo-utils.js';
import { countryByCode } from '../../_countries.js';
import { VENUE_MAP } from '../../mywaterlive-config.js';
import { getObservationState } from '../temperature-freshness.js';
import { CATEGORIES, SOCIAL_DEFAULTS } from './config.js';
import { fact, fmtDate } from './facts.js';

const SITE = 'https://www.swimloading.com';
const WATER = { POOL: 'Pool', LAKE: 'Lake', OCEAN: 'Sea', RIVER: 'River', DAM: 'Dam', LAGOON: 'Lagoon' };
/** Page text as a reader sees it: tags stripped, entities decoded, whitespace collapsed. */
export function plainText(file) {
  return readFileSync(file, 'utf8')
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&middot;/g, '·').replace(/&times;/g, '×').replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&rsquo;/g, "'").replace(/\\'/g, "'").replace(/\s+/g, ' ');
}
export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const countryName = (cc) => (countryByCode(cc)?.name || '').replace(/^the /, '') || null;

/** Latest approved-station observation for a spot, as a time-sensitive fact (or an honest "none"). */
async function conditionsFor(spotId) {
  const rows = await dbGet(`spot_conditions_live?select=water_temperature_c,observed_at,provider_name,station_name,is_primary&spot_id=eq.${spotId}&water_temperature_c=not.is.null&order=observed_at.desc&limit=1`);
  const r = rows?.[0];
  if (!r) return { fact: null, assessment: 'No measured reading exists for this spot, so no temperature is used.' };
  const st = getObservationState(r.observed_at);
  return { row: r, state: st, fact: null,
    assessment: `Latest measured reading ${r.water_temperature_c} C (${r.provider_name}) is ${st?.state}.` };
}

// ── 1. SWIM SPOTLIGHT: a spot with curated facts ─────────────────────────
export async function spotlightFromVenueMap(slug) {
  const v = VENUE_MAP[slug];
  const spotRows = await dbGet(`spots?select=id,name,water_type,area,country_code&name=ilike.${encodeURIComponent(v?.label || slug)}&active=eq.true`);
  const spot = spotRows?.[0];
  if (!v || !spot) return { gap: `No curated venue facts or no spot row for "${slug}".` };
  const src = { file: 'api/mywaterlive-config.js', quote: v.headline, label: `VENUE_MAP['${slug}']` };
  const facts = [
    fact('name', spot.name, { table: 'spots', row: spot.id, column: 'name' }),
    fact('country', countryName(spot.country_code), { table: 'spots', row: spot.id, column: 'country_code' }),
    fact('area', spot.area, { table: 'spots', row: spot.id, column: 'area' }),
    fact('water_type', `${WATER[spot.water_type] || spot.water_type}`, { table: 'spots', row: spot.id, column: 'water_type' }),
    fact('headline', v.headline, src),
    fact('opened', `Opened in ${v.built}`, { ...src, quote: String(v.built) }, { value: v.built }),
    fact('type', v.type, { ...src, quote: v.type }),
    ...v.facts.slice(0, 4).map((t, i) => fact(`fact${i}`, t, { ...src, quote: t })),
  ];
  const cond = await conditionsFor(spot.id);
  return {
    category: CATEGORIES.SWIM_SPOTLIGHT, angle: 'history',
    sourceKey: `spot:${spot.id}`, sourceUrl: `${SITE}/spots/${slugify(spot.name)}`,
    spot, facts,
    // The ogImage in mywaterlive-config.js returns 404 (checked 18 Oct 2026), so it cannot be used.
    // Replacement verified against the Wikimedia Commons API on 18 Oct 2026: CC BY-SA 2.0, author Des Blenkinsopp.
    image: {
      url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b5/Tooting_Bec_Lido-geograph-4422148-by-Des-Blenkinsopp.jpg/1280px-Tooting_Bec_Lido-geograph-4422148-by-Des-Blenkinsopp.jpg',
      credit: 'Photo: Des Blenkinsopp / geograph.org.uk / CC BY-SA 2.0',
      licence: 'CC BY-SA 2.0', licenceVerified: true,
      reviewNote: 'CC BY-SA 2.0 is share-alike: the cropped, overlaid image is an adaptation. Dave to confirm this is acceptable for auto-publishing; until then this post is review-only.',
    },
    freshnessAssessment: `Evergreen (history). ${cond.assessment}`,
    conditions: cond,
  };
}

// ── 2. CROSSING INTELLIGENCE: DB columns only ───────────────────────────
export async function crossingFromDb(slug) {
  const rows = await dbGet(`crossings?select=*&slug=eq.${slug}&is_active=eq.true`);
  const c = rows?.[0];
  if (!c) return { gap: `Crossing "${slug}" not found.` };
  const s = (col) => ({ table: 'crossings', row: c.id, column: col });
  const facts = [
    fact('name', c.name, s('name')),
    fact('distance', `${c.distance_km} km`, s('distance_km'), { value: Number(c.distance_km) }),
    fact('route', `${c.start_location} to ${c.end_location}`, s('start_location')),
    fact('qualifying', `A witnessed continuous swim of ${c.qualifying_duration_minutes / 60} hours is part of the qualifying requirement`, s('qualifying_duration_minutes'), { value: c.qualifying_duration_minutes }),
    fact('observer', 'An observer is required', s('requires_observer')),
  ];
  const conflicts = [];
  if (c.qualifying_temp_limit_c != null) {
    conflicts.push(`crossings.qualifying_temp_limit_c=${c.qualifying_temp_limit_c} but english-channel.html FAQ states CSA 15.5 C vs CS&PF 16 C. Temperature limit omitted from the post until reconciled.`);
  }
  return {
    category: CATEGORIES.CROSSING_INTELLIGENCE, angle: 'qualifying-swim',
    sourceKey: `crossing:${c.id}`, sourceUrl: `${SITE}/english-channel`,
    crossing: c, facts, conflicts,
    geo: c.start_lat != null && c.end_lat != null ? { route: true, points: [
      { lat: Number(c.start_lat), lng: Number(c.start_lng), label: c.start_location.split(',')[0] },
      { lat: Number(c.end_lat), lng: Number(c.end_lng), label: c.end_location.split(',')[0] }] } : null,
    image: { url: null, credit: null, licenceVerified: true, note: 'Brand graphic with route pins, no third-party imagery.' },
    freshnessAssessment: 'Evergreen. Requirements can change: re-check governing-body rules before each reuse.',
  };
}

// ── 3. BEHIND THE BRAND: approved live partner, claims quoted from its page ─
export function partnerFromPage({ name, file, url, logo, quotes, chipState = 'live' }) {
  const text = plainText(file);
  const facts = quotes.map(([key, q, shown]) => {
    if (!text.includes(q)) throw new Error(`Partner quote not found in ${file}: ${q}`);
    return fact(key, shown || q, { file, quote: q });
  });
  return {
    category: CATEGORIES.BEHIND_THE_BRAND, angle: 'product-benefit',
    sourceKey: `partner:${slugify(name)}`, sourceUrl: `${SITE}${url}`,
    partner: { name, slug: slugify(name), chipState, logo }, facts,
    image: { url: null, credit: 'Partner logo supplied for SwimLoading partner page', licenceVerified: true, localLogo: logo },
    freshnessAssessment: 'Evergreen product copy. The sponsored challenge on the page is excluded (challenges are time-bound).',
  };
}

// ── 4. SWIMLOADING DISCOVERS: three real spots in a region ─────────────────
export async function discoversRegion({ region, areaLike, countryCode }) {
  const rows = await dbGet(`spots?select=id,name,water_type,area,latitude,longitude&country_code=eq.${countryCode}&active=eq.true&area=ilike.*${areaLike}*&order=name`);
  if (!rows || rows.length < 3) return { gap: `Fewer than 3 spots found for ${region}.` };
  // Single-sex ponds are not a general "start here" recommendation. Variety of water type first, then A-Z.
  const pool = rows.filter((r) => !/Mens|Ladies/.test(r.name));
  const picked = [];
  const seen = new Set();
  for (const r of pool) { if (!seen.has(r.water_type)) { seen.add(r.water_type); picked.push(r); } }
  for (const r of pool) { if (picked.length >= 3) break; if (!picked.includes(r)) picked.push(r); }
  const three = picked.slice(0, 3);
  return {
    category: CATEGORIES.DISCOVERS, angle: 'regional-directory',
    sourceKey: `region:${countryCode}:${slugify(region)}`, sourceUrl: `${SITE}/spots/united-kingdom`,
    region,
    geo: three.every((x) => x.latitude != null) ? { points: three.map((x, i) => ({ lat: Number(x.latitude), lng: Number(x.longitude), label: x.name, n: i + 1 })) } : null,
    spots: three.map((s) => ({ name: s.name, type: WATER[s.water_type] || s.water_type, area: s.area })),
    facts: [
      fact('region', region, { table: 'spots', column: 'area', filter: `country_code=${countryCode}` }),
      ...three.map((s, i) => fact(`spot${i}`, `${s.name}: ${WATER[s.water_type] || s.water_type}${s.area ? `, ${s.area}` : ''}`, { table: 'spots', row: s.id })),
    ],
    image: { url: null, licenceVerified: true, note: 'Brand graphic, no photos or map tiles.' },
    freshnessAssessment: `Evergreen directory. ${rows.length} spots matched "${areaLike}"; 3 shown. Re-check that each spot is still active at publish time.`,
  };
}

// ── 5. SA spot: only what the table holds ─────────────────────────────────
export async function spotFromDb(name) {
  const rows = await dbGet(`spots?select=id,name,water_type,area,domain,country_code&name=ilike.${encodeURIComponent(name)}&active=eq.true`);
  const s = rows?.[0];
  if (!s) return { gap: `Spot "${name}" not found.` };
  const est = (await dbGet(`spot_temp_estimate?select=best_c,best_source,model_at,confidence&spot_id=eq.${s.id}`))?.[0];
  const REGION = { ATLANTIC: 'Atlantic Seaboard', FALSE_BAY: 'False Bay', KZN: 'KwaZulu-Natal', WEST_COAST: 'West Coast' };
  return {
    category: CATEGORIES.SWIM_SPOTLIGHT, angle: 'location-intro',
    sourceKey: `spot:${s.id}`, sourceUrl: `${SITE}/spots/${slugify(s.name)}`,
    spot: s,
    facts: [
      fact('name', s.name, { table: 'spots', row: s.id, column: 'name' }),
      fact('country', countryName(s.country_code), { table: 'spots', row: s.id, column: 'country_code' }),
      fact('region', REGION[s.domain] || s.domain, { table: 'spots', row: s.id, column: 'domain' }),
      fact('water_type', WATER[s.water_type] || s.water_type, { table: 'spots', row: s.id, column: 'water_type' }),
    ],
    image: { url: null, licenceVerified: true, note: 'Brand graphic only. No curated facts or photos exist for this spot.' },
    richness: 'thin',
    freshnessAssessment: `Evergreen only. A modelled temperature exists (${est?.best_c} C, ${est?.best_source}, confidence ${est?.confidence}) but is deliberately not used: it is a model, not a measurement, and the spot has no curated facts to build a useful post around.`,
  };
}

// ── 6. THIS WEEK IN OPEN WATER: Explore editions ─────────────────────────
export async function exploreUpcoming({ from, max = 4, excludeIds = new Set() }) {
  const f = new Date(from);
  const lead = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate() + SOCIAL_DEFAULTS.event.minLeadDays));
  from = `${lead.getUTCFullYear()}-${String(lead.getUTCMonth() + 1).padStart(2, '0')}-${String(lead.getUTCDate()).padStart(2, '0')}`;
  // "This week" means 7 days. Widen only if fewer than 3 events qualify, and say so honestly in the title.
  let last;
  for (const days of [7, 14, SOCIAL_DEFAULTS.event.windowDays]) {
    last = await exploreWindow({ from, windowDays: days, max, excludeIds });
    if (!last.gap) return last;
  }
  return last;
}

async function exploreWindow({ from, windowDays, max, excludeIds = new Set() }) {
  const start = from.slice(0, 10);
  const endD = new Date(Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10) + windowDays));
  const end = `${endD.getUTCFullYear()}-${String(endD.getUTCMonth() + 1).padStart(2, '0')}-${String(endD.getUTCDate()).padStart(2, '0')}`;
  const tiers = SOCIAL_DEFAULTS.event.autoTiers.join(',');
  const rows = await dbGet(
    `event_editions?select=id,slug,title,discipline,start_date,end_date,status,verification_tier,registration_status,official_url,date_confirmed,last_verified_at,is_searchable,is_indexable,` +
    `event_venues(display_name,city,region,country_code,latitude,longitude),event_distances(original_label,distance_metres)` +
    `&is_searchable=eq.true&status=eq.announced&date_confirmed=eq.true&verification_tier=in.(${tiers})` +
    `&start_date=gte.${start}&start_date=lte.${end}&order=start_date&limit=60`);
  if (!rows) return { gap: 'Explore query failed.' };
  const ids = rows.map((r) => r.id);
  const changes = ids.length ? await dbGet(`event_change_log?select=edition_id,change_type,changed_at&edition_id=in.(${ids.join(',')})&change_type=in.(date_changed,venue_changed,cancelled,postponed)`) : [];
  const recentlyChanged = new Set((changes || []).map((c) => c.edition_id));
  const rejected = [];
  const eligible = [];
  for (const e of rows) {
    const why = excludeIds.has(e.id) ? 'already featured in a recent post' : eventIneligibility(e, recentlyChanged);
    if (why) rejected.push({ title: e.title, reason: why }); else eligible.push(e);
  }
  // Prefer confirmed tier, then earliest date, and at most one event per country so the slide is not one-sided.
  eligible.sort((a, b) => (a.verification_tier === 'confirmed' ? 0 : 1) - (b.verification_tier === 'confirmed' ? 0 : 1) || a.start_date.localeCompare(b.start_date));
  const byCountry = new Set();
  const chosen = [];
  for (const e of eligible) {
    const cc = e.event_venues.country_code;
    if (byCountry.has(cc)) continue;
    byCountry.add(cc); chosen.push(e);
    if (chosen.length >= max) break;
  }
  chosen.sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (chosen.length < 3) return { gap: `Only ${chosen.length} eligible events in the next ${windowDays} days.`, rejected: rejected.length };
  const events = chosen.map((e) => {
    const v = e.event_venues;
    const dist = e.event_distances?.find((d) => d.distance_metres)?.original_label || null;
    return {
      id: e.id, title: e.title, date: fmtDate(e.start_date), isoDate: e.start_date,
      place: [v.city || v.display_name, countryName(v.country_code)].filter(Boolean).join(', '),
      lat: v.latitude != null ? Number(v.latitude) : null, lng: v.longitude != null ? Number(v.longitude) : null,
      distance: dist, tier: e.verification_tier, officialUrl: e.official_url, lastVerifiedAt: e.last_verified_at,
      url: `${SITE}/events/${e.slug}`,
    };
  });
  return {
    category: CATEGORIES.THIS_WEEK, angle: 'upcoming-events',
    sourceKey: `explore:week:${start}`, sourceUrl: `${SITE}/explore`,
    events, windowDays,
    facts: events.flatMap((e, i) => [
      fact(`event${i}.title`, e.title, { table: 'event_editions', row: e.id, column: 'title' }, { kind: 'time_sensitive', observedAt: e.lastVerifiedAt }),
      fact(`event${i}.date`, e.date, { table: 'event_editions', row: e.id, column: 'start_date' }, { kind: 'time_sensitive', observedAt: e.lastVerifiedAt }),
      fact(`event${i}.place`, e.place, { table: 'event_venues', column: 'city/country_code' }),
      ...(e.distance ? [fact(`event${i}.distance`, e.distance, { table: 'event_distances', column: 'original_label' })] : []),
    ]),
    image: { url: null, licenceVerified: true, note: 'Brand graphic only.' },
    freshnessAssessment: `Time-sensitive. ${eligible.length} of ${rows.length} candidate editions passed the eligibility rules. Must be re-validated immediately before publishing (cancel/reschedule check against event_change_log).`,
    rejectedCount: rejected.length, rejectedSample: rejected.slice(0, 5),
  };
}

export const NOT_OPEN_WATER_TITLE = /\(\s*25\s*m\s*\)|\b25\s*m(ts)?\b|\b50\s*m\b|art[ií]stic|synchro|\bdiving\b|water\s*polo|\bpool\b|\btriathlon\b|duathlon|aquathlon|acuatl[oó]n/i;

/** Why an Explore edition may NOT be promoted. null = eligible. */
export function eventIneligibility(e, recentlyChanged = new Set(), today = null) {
  if (!e) return 'missing';
  if (e.status !== 'announced') return `status is ${e.status}`;
  if (!e.date_confirmed || !e.start_date) return 'date not confirmed';
  if (today && e.start_date < today) return 'event date is in the past';
  if (!SOCIAL_DEFAULTS.event.autoTiers.includes(e.verification_tier)) return `verification tier "${e.verification_tier}" is below the floor`;
  const v = e.event_venues;
  if (!v || !(v.city || v.display_name) || !v.country_code) return 'venue or country unknown';
  if (!e.official_url) return 'no source URL';
  if (!e.title || e.title.trim().length < 4) return 'title missing';
  if (e.discipline !== 'open_water') return `discipline "${e.discipline}" is not open water`;
  // Explore tags some pool and artistic-swimming meets as open_water (seen Oct 2026). A "this week in OPEN WATER"
  // post must never include them, so a title that looks like a pool or non-open-water event is held back.
  if (NOT_OPEN_WATER_TITLE.test(e.title)) return 'title looks like a pool or non-open-water event';
  if (recentlyChanged.has(e.id)) return 'edition has a date/venue/status change on record: needs human re-check';
  return null;
}
