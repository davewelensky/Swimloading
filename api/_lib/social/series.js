// Automatable series beyond the six hand-built posts. Every builder is PURE over rows handed to it
// (the autopilot loads rows once; tests pass fixtures), carries NO prose, and returns the same candidate
// shape as sources.js: { category, angle, sourceKey, sourceUrl, facts[], geo?, image, ... } or { gap }.
//
//   conditionsWeekly  measured readings only (spot_conditions_live), never model data
//   regionalUnits / regionalMap   discovery maps for every country/region with 3+ active spots with coordinates
//   crossingAngles    qualifying swim / season / route map, DB columns only
//   partnerCards      partner_pages rows with chip_state live, claims quoted from the row
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { countryByCode } from '../../_countries.js';
import { getObservationState, FRESHNESS_THRESHOLDS } from '../temperature-freshness.js';
import { CATEGORIES, SOCIAL_DEFAULTS } from './config.js';
import { fact, fmtDate, fmtUtc } from './facts.js';

const SITE = 'https://www.swimloading.com';
const ROOT = resolve(new URL('../../..', import.meta.url).pathname);
const WATER = { POOL: 'Pool', LAKE: 'Lake', OCEAN: 'Sea', RIVER: 'River', DAM: 'Dam', LAGOON: 'Lagoon' };
/** Area columns hold raw codes for some spots ('SAN_DIEGO', 'TILLAMOOK'): show them as words. Mixed-case values are left alone. */
export const prettyArea = (a) => (a && /^[A-Z0-9_ ./-]+$/.test(a) ? a.toLowerCase().replace(/[_]+/g, ' ').replace(/\b([a-z])/g, (m) => m.toUpperCase()) : a);
export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const countryName = (cc) => (countryByCode(cc)?.name || '').replace(/^the /, '') || null;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const km = (a, b) => { const R = 6371, r = (x) => (x * Math.PI) / 180, dLa = r(b.lat - a.lat), dLo = r(b.lng - a.lng);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

// ── (b) Measured conditions ─────────────────────────────────────────────────
/**
 * @param rows   spot_conditions_live rows (water_temperature_c not null)
 * @param spots  spots rows keyed by id (name, area, country_code)
 * @param opts   { now, slotIso }  slotIso = when the post will go out: a reading must still be inside the
 *               freshness ceiling AT THAT TIME, so the allowed age now shrinks by the lead time.
 * Rules: measured readings only; primary station within maxStationKm; observation time, source and station
 * are part of every fact; readings older than the RECENT ceiling at publish time are never used; one spot per
 * country first so the post is not a single beach; fewer than minReadings means no post (never padded).
 */
export function conditionsWeekly(rows, spots, { now = new Date(), slotIso = null } = {}) {
  const cfg = SOCIAL_DEFAULTS.autopilot.conditions;
  const at = slotIso ? new Date(slotIso) : now;
  const maxAgeAtSlot = Math.min(cfg.publishMaxAgeHours, FRESHNESS_THRESHOLDS.recentHours);
  const byId = new Map(spots.map((s) => [s.id, s]));
  const ok = rows.filter((r) => {
    if (!r.is_primary || r.water_temperature_c == null || !r.observed_at) return false;
    if (!(Number(r.distance_km) <= cfg.maxStationKm)) return false;
    const t = Number(r.water_temperature_c);
    if (!(t > -2 && t < 38)) return false;                                   // sensor garbage
    if (/model|forecast|climatolog|analysis|reanalysis/i.test(`${r.quality_code || ''} ${r.provider_code || ''}`)) return false;   // modelled, never measured
    if (!getObservationState(r.observed_at, { now })) return false;
    if (!byId.has(r.spot_id)) return false;
    return (at - new Date(r.observed_at)) / 3600e3 <= maxAgeAtSlot;           // still RECENT when it is posted
  });
  // freshest first, one per country, then any remaining
  ok.sort((a, b) => String(b.observed_at).localeCompare(String(a.observed_at)) || String(a.spot_id).localeCompare(String(b.spot_id)));
  const seenC = new Set(), seenS = new Set(), picked = [];
  for (const pass of [0, 1]) {                                                 // pass 0: one per country; pass 1: top up from what is left
    for (const r of ok) {
      if (picked.length >= cfg.maxReadings) break;
      const cc = byId.get(r.spot_id).country_code;
      if (seenS.has(r.spot_id) || (pass === 0 && seenC.has(cc))) continue;
      seenC.add(cc); seenS.add(r.spot_id); picked.push(r);
    }
  }
  if (picked.length < cfg.minReadings) return { gap: `Only ${picked.length} spot(s) have a fresh measured reading from a nearby primary station (need ${cfg.minReadings}).` };
  picked.sort((a, b) => byId.get(a.spot_id).name.localeCompare(byId.get(b.spot_id).name));
  const d = new Date(at.getTime() + 2 * 3600e3);                               // SAST wall clock of the slot
  const isoWeek = (() => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 86400e3 + 1) / 7)).padStart(2, '0')}`; })();
  const newest = picked.reduce((m, r) => (r.observed_at > m ? r.observed_at : m), picked[0].observed_at);
  const readings = picked.map((r) => {
    const s = byId.get(r.spot_id);
    return { spot: s.name, place: [prettyArea(s.area), countryName(s.country_code)].filter(Boolean).join(', ') || countryName(s.country_code) || '', temp: `${(Math.round(Number(r.water_temperature_c) * 10) / 10).toFixed(1)} C`,
      source: r.provider_name, station: r.station_name, distanceKm: Number(r.distance_km), observed: fmtUtc(r.observed_at), observedAt: r.observed_at, spotId: r.spot_id };
  });
  return {
    category: CATEGORIES.OPEN_WATER_INTEL, angle: 'measured-conditions', graphicOnly: true,
    sourceKey: `conditions:${isoWeek}`, sourceUrl: `${SITE}/spots`,
    readings, asOf: fmtUtc(newest).replace(/ \d\d:\d\d UTC$/, ''), asOfFull: fmtUtc(newest),
    facts: readings.flatMap((r, i) => {
      const src = { table: 'spot_conditions_live', row: r.spotId, column: 'water_temperature_c' };
      const o = { kind: 'time_sensitive', observedAt: r.observedAt };
      return [fact(`r${i}.spot`, r.spot, { table: 'spots', row: r.spotId, column: 'name' }),
        fact(`r${i}.temp`, r.temp, src, o),
        fact(`r${i}.source`, `${r.source}, ${r.station}, ${r.distanceKm} km from the spot`, { table: 'spot_conditions_live', row: r.spotId, column: 'station_name' }, o),
        fact(`r${i}.observed`, r.observed, { table: 'spot_conditions_live', row: r.spotId, column: 'observed_at' }, o)];
    }),
    image: { url: null, licenceVerified: true, note: 'Designed data graphic, no photos.' },
    expiresAtIso: new Date(Math.min(...picked.map((r) => new Date(r.observed_at).getTime())) + cfg.publishMaxAgeHours * 3600e3).toISOString(),
    freshnessAssessment: `Time-sensitive. Measured readings only (never model data) from primary stations within ${cfg.maxStationKm} km. Oldest reading must be under ${cfg.publishMaxAgeHours} h old when posted; re-checked at publish time.`,
  };
}

/**
 * Publish-time check for a conditions post. `freshRows` = current primary-station rows for the post's spots
 * (spot_conditions_live holds the LATEST reading per station, so a newer reading is normal and fine: the post states its own
 * observation time). It fails if a reading is older than the ceiling, the station no longer reports, or the same
 * observation now carries a different value (a correction).
 */
export function conditionsRecheck(post, freshRows, now = new Date()) {
  const bad = [];
  const max = SOCIAL_DEFAULTS.autopilot.conditions.publishMaxAgeHours;
  const temps = (post.facts || []).filter((f) => f.source?.table === 'spot_conditions_live' && f.source.column === 'water_temperature_c');
  for (const f of temps) {
    if (!f.observedAt || (now - new Date(f.observedAt)) / 3600e3 > max) { bad.push(`${f.key}: reading older than ${max} h`); continue; }
    const hit = (freshRows || []).filter((r) => r.spot_id === f.source.row && r.is_primary).sort((a, b) => String(b.observed_at).localeCompare(String(a.observed_at)))[0];
    if (!hit || new Date(hit.observed_at) < new Date(f.observedAt)) { bad.push(`${f.key}: reading no longer on record`); continue; }
    if (new Date(hit.observed_at).getTime() === new Date(f.observedAt).getTime() && `${(Math.round(Number(hit.water_temperature_c) * 10) / 10).toFixed(1)} C` !== f.text) bad.push(`${f.key}: value changed to ${hit.water_temperature_c}`);
  }
  return { ok: temps.length > 0 && bad.length === 0, reason: bad.join('; ') || (temps.length ? null : 'no readings in post') };
}

// ── (c) Regional discovery maps ────────────────────────────────────────────
const ZA_REGION = {
  ATLANTIC: ['Atlantic Seaboard', 'on the'], FALSE_BAY: ['False Bay', 'around'], KZN: ['KwaZulu-Natal', 'in'], WEST_COAST: ['the West Coast', 'on'],
  INLAND: ['Inland South Africa', 'in'], GAUTENG: ['Gauteng', 'in'], GARDEN_ROUTE: ['the Garden Route', 'on'], SOUTH_COAST: ['the South Coast', 'on'], EASTERN_CAPE: ['the Eastern Cape', 'in'],
};
// Page slugs api/spots-handler.js resolves (COUNTRY_SLUGS / REGION_DOMAINS in api/seo-utils.js).
const COUNTRY_PAGE = { GB: 'united-kingdom', US: 'usa', FR: 'france', CH: 'switzerland', HR: 'croatia', IE: 'ireland', CA: 'canada', NA: 'namibia', AU: 'australia', PT: 'portugal', ES: 'spain', GR: 'greece' };
const ZA_PAGE = { ATLANTIC: 'atlantic', FALSE_BAY: 'false-bay', KZN: 'kwazulu-natal', WEST_COAST: 'west-coast', INLAND: 'inland', GAUTENG: 'gauteng', GARDEN_ROUTE: 'garden-route', SOUTH_COAST: 'south-coast', EASTERN_CAPE: 'eastern-cape' };
const SINGLE_SEX = /\b(mens?|ladies|womens?)\b/i;

/** Groups spots into regional units: each non-ZA country, and each South African domain, with 3+ usable spots. */
export function regionalUnits(spots) {
  const usable = spots.filter((s) => s.latitude != null && s.longitude != null && s.country_code && !SINGLE_SEX.test(s.name));
  const groups = new Map();
  for (const s of usable) {
    const za = s.country_code === 'ZA';
    const key = za ? `ZA:${s.domain}` : s.country_code;
    if (za && !ZA_REGION[s.domain]) continue;
    if (!groups.has(key)) groups.set(key, { key, countryCode: s.country_code, label: za ? ZA_REGION[s.domain][0] : countryName(s.country_code), prep: za ? ZA_REGION[s.domain][1] : 'in', domain: za ? s.domain : null, spots: [] });
    groups.get(key).spots.push(s);
  }
  return [...groups.values()].filter((g) => g.label && g.spots.length >= 3).map((g) => ({ ...g, spots: g.spots.sort((a, b) => a.name.localeCompare(b.name)) }));
}

const take3 = (pool) => {
  // deterministic cluster: alphabetical seed + its two nearest neighbours, so the map is one place, not a continent
  const seed = pool[0];
  const near = pool.slice(1).map((s) => ({ s, d: km({ lat: +seed.latitude, lng: +seed.longitude }, { lat: +s.latitude, lng: +s.longitude }) })).sort((a, b) => a.d - b.d || a.s.name.localeCompare(b.s.name)).slice(0, 2);
  const three = [seed, ...near.map((n) => n.s)];
  const span = Math.max(...three.flatMap((a) => three.map((b) => km({ lat: +a.latitude, lng: +a.longitude }, { lat: +b.latitude, lng: +b.longitude }))));
  return { three, span };
};

/** Page `page` (0-based) of three nearby spots for a unit. Pages are disjoint, so they are different posts. */
export function regionalMap(unit, page = 0) {
  const maxPages = Math.min(SOCIAL_DEFAULTS.autopilot.regionMaxPages, Math.floor(unit.spots.length / 3));
  if (page >= maxPages) return { gap: `${unit.label}: no page ${page + 1} (${unit.spots.length} usable spots).` };
  let pool = [...unit.spots], three = null, span = 0;
  for (let i = 0; i <= page; i++) { ({ three, span } = take3(pool)); if (i < page) pool = pool.filter((s) => !three.includes(s)); }
  if (span > SOCIAL_DEFAULTS.autopilot.regionMaxSpanKm) return { gap: `${unit.label} page ${page + 1}: the three nearest spots are ${Math.round(span)} km apart, too wide for one map.` };
  three.sort((a, b) => a.name.localeCompare(b.name));
  return {
    category: CATEGORIES.DISCOVERS, angle: 'regional-map',
    sourceKey: `region:${unit.countryCode}:${slugify(unit.label)}:p${page + 1}`, sourceUrl: `${SITE}/spots${(unit.domain ? ZA_PAGE[unit.domain] : COUNTRY_PAGE[unit.countryCode]) ? `/${unit.domain ? ZA_PAGE[unit.domain] : COUNTRY_PAGE[unit.countryCode]}` : ''}`,
    region: unit.label, regionPrep: unit.prep, unitKey: unit.key,
    geo: { points: three.map((x, i) => ({ lat: Number(x.latitude), lng: Number(x.longitude), label: x.name, n: i + 1 })) },
    spots: three.map((s) => ({ id: s.id, name: s.name, type: WATER[s.water_type] || s.water_type, area: prettyArea(s.area) })),
    facts: [
      fact('region', unit.label, { table: 'spots', column: unit.domain ? 'domain' : 'country_code', filter: unit.key }),
      ...three.map((s, i) => fact(`spot${i}`, `${s.name}: ${WATER[s.water_type] || s.water_type}${s.area ? `, ${prettyArea(s.area)}` : ''}`, { table: 'spots', row: s.id })),
    ],
    image: { url: null, licenceVerified: true, note: 'Licensed map of the real coordinates.' },
    freshnessAssessment: `Evergreen directory, page ${page + 1} of ${maxPages}. ${unit.spots.length} usable spots in ${unit.label}; three within ${Math.round(span)} km of each other. Re-check each spot is still active at publish time.`,
  };
}

// ── (d) Crossing angles, DB columns only ───────────────────────────────────
const hoursText = (min) => { const h = min / 60; return Number.isInteger(h) ? String(h) : String(Math.round(h * 10) / 10); };
const monthText = (a, b) => (a && b ? (a === b ? MONTHS[a - 1] : `${MONTHS[a - 1]} to ${MONTHS[b - 1]}`) : null);

/**
 * Posts for one crossings row. Angles: 'qualifying' (needs distance + qualifying minutes), 'season' (needs season months and
 * enough other facts to be worth a post), 'route' (needs all four coordinates). The legacy key `crossing:<id>` is kept for
 * the qualifying angle so the English Channel post already published on 20 Oct 2026 counts as used.
 * qualifying_temp_limit_c is NEVER used: the English Channel row conflicts with the page (16 vs CSA 15.5 / CS&PF 16).
 */
export function crossingAngles(c) {
  if (!c?.slug || c.is_active === false) return [];
  const s = (col) => ({ table: 'crossings', row: c.id, column: col });
  const url = `${SITE}/${c.slug}`;
  const base = [fact('name', c.name, s('name'))];
  if (c.distance_km != null) base.push(fact('distance', `${Number(c.distance_km)} km`, s('distance_km'), { value: Number(c.distance_km) }));
  const route = c.start_location && c.end_location ? fact('route', `${c.start_location} to ${c.end_location}`, s('start_location')) : null;
  const gov = c.governing_body ? fact('governing', `Governing body listed: ${c.governing_body}`, s('governing_body')) : null;
  const common = { category: CATEGORIES.CROSSING_INTELLIGENCE, crossing: c, sourceUrl: url, tags: ['#openwaterswimming', '#marathonswimming', '#swimloading'],
    freshnessAssessment: 'Evergreen. Requirements and seasons can change: the caption says to confirm with the governing body.' };
  const geo = [c.start_lat, c.start_lng, c.end_lat, c.end_lng].every((v) => v != null)
    ? { route: true, points: [{ lat: +c.start_lat, lng: +c.start_lng, label: c.start_location.split(',')[0] }, { lat: +c.end_lat, lng: +c.end_lng, label: c.end_location.split(',')[0] }] } : null;
  const out = [];
  if (c.distance_km != null && c.qualifying_duration_minutes) {
    const facts = [...base, ...(route ? [route] : []),
      fact('qualifying', `A ${hoursText(c.qualifying_duration_minutes)} hour qualifying swim is listed`, s('qualifying_duration_minutes'), { value: c.qualifying_duration_minutes }),
      ...(c.requires_observer ? [fact('observer', 'An observer is required', s('requires_observer'))] : [])];
    out.push({ ...common, angle: 'qualifying-swim', sourceKey: `crossing:${c.id}`, facts, geo, image: { url: null, licenceVerified: true, note: 'Map or photo chosen by media selection.' },
      conflicts: c.qualifying_temp_limit_c != null ? [`crossings.qualifying_temp_limit_c=${c.qualifying_temp_limit_c} is deliberately not used (unreconciled with the governing bodies' published limits).`] : [] });
  }
  const season = monthText(c.season_start_month, c.season_end_month);
  if (season) {
    const facts = [...base, ...(route ? [route] : []), fact('season', `Season listed on SwimLoading: ${season}`, s('season_start_month')), ...(gov ? [gov] : [])];
    // Thin guard: a name, a distance and a season alone is not worth a post. Need a route or a governing body as well.
    if (c.distance_km != null && (route || gov)) out.push({ ...common, angle: 'season', sourceKey: `crossing:${c.id}:season`, facts, geo: null, image: { url: null, licenceVerified: true, note: 'Photo or graphic chosen by media selection.' } });
  }
  if (geo && c.distance_km != null) out.push({ ...common, angle: 'route', sourceKey: `crossing:${c.id}:route`, facts: [...base, route], geo, image: { url: null, licenceVerified: true, note: 'Map of the real coordinates.' } });
  return out;
}

// ── (e) Live partners from partner_pages ───────────────────────────────────
/** Only chip_state 'live' in section 'active'. Claims are the row's own blurb, verbatim. status_note is internal and is never used. */
export function partnerCards(rows) {
  return rows.filter((r) => r.chip_state === 'live' && r.section === 'active' && r.blurb && r.hero_page).map((r) => {
    const slug = slugify(r.name.replace(/\s*[×x]\s*Art of Endurance/i, ''));
    const logoFile = r.logo_url ? resolve(ROOT, r.logo_url.replace(/^\//, '')) : null;
    const src = (col) => ({ table: 'partner_pages', row: r.id, column: col });
    return {
      category: CATEGORIES.BEHIND_THE_BRAND, angle: 'partner-profile',
      sourceKey: `partner:${slug}`, sourceUrl: `${SITE}${r.hero_page}`,
      partner: { name: r.name.replace(/\s*×\s*Art of Endurance/, ''), slug, chipState: r.chip_state, logo: logoFile && existsSync(logoFile) ? logoFile : null, pageId: r.id },
      facts: [fact('name', r.name.replace(/\s*×\s*Art of Endurance/, ''), src('name')), fact('blurb', r.blurb, src('blurb'))],
      image: { url: null, credit: 'Partner logo supplied for SwimLoading partner page', licenceVerified: true },
      freshnessAssessment: 'Evergreen partner description from partner_pages. Re-checked at publish: the partner must still be live.',
    };
  });
}
export const weekdayName = (iso) => WEEKDAY[new Date(iso).getUTCDay()];
export { fmtDate };
