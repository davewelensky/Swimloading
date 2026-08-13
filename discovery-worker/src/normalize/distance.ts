import type { WetsuitPolicy } from '../domain/enums.js';
import { WETSUIT_POLICIES } from '../domain/enums.js';
import type { DistanceOption } from '../domain/candidate-event.js';
import type { HtmlDistanceRaw } from '../extract/html.js';

const MILE_IN_METRES = 1609.344;

// Unit words, folded and accent-stripped before matching. The old
// English-only version failed on real pages in ways that were invisible
// until an event had no distances at all: the French federation prints
// "1 Kms" and "2.4 Kms", and `k(?:ilo)?m\b` cannot match either, because
// the trailing 's' means there is no word boundary after the 'm'.
//
// Order matters and is load-bearing: kilometres must be tried before
// metres, or "5 km" reads as 5 metres.
const KM_WORDS = 'km|kms|kilomet(?:er|re)s?|kilometr\\w*|chilometr\\w*|quilometr\\w*|キロ|公里';

// A bare "k" is how race listings most often write kilometres — "10k",
// "2,5k", "0,2k super sprint". It is deliberately NOT in KM_WORDS, because
// on its own it is a weaker signal than a spelled-out unit and needs two
// guards that the real unit words do not:
//
//   1. Not money. "$5k" and "₱7,500" are prizes and entry fees, not swims.
//   2. Bounded. Without this, "Rotto 2026 K-Swim" reads as a 2026 km swim
//      — a plausible-looking number that is wrong by a factor of 40. No
//      open-water swim is 100 km, so a bare-k number above that is not a
//      distance and we say nothing rather than guess.
const BARE_K_MAX_KM = 100;
const MILE_WORDS = 'mi|mile|miles|miglia|milja|milje|mijl';
const METRE_WORDS = 'm|ms|mtr|met(?:er|re)s?|metr\\w*|メートル|米';

// A number written the European way ("2,4") or the English way ("2.4").
// Thousands separators are deliberately NOT handled: "1,500" is 1.5 km in
// half of Europe and 1500 m in the other half, and there is no way to tell
// from the string alone. Guessing there would be a factor-of-1000 error.
const NUMBER = '(\\d+(?:[.,]\\d+)?)';

function toNumber(raw: string): number | null {
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function foldUnits(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '');
}

// Parses a distance value into metres, in whichever language and form the
// source used — a bare data attribute ("10km" / "3800"), English free text
// ("Sprint (750m)" / "1.2 miles"), or a localised label ("2,4 Kms",
// "5 kilómetros", "1500 mètres", "3 キロ"). Returns null rather than
// guessing when nothing recognisable is found.
export function parseDistanceToMetres(raw: string | null): number | null {
  if (!raw) return null;
  const text = foldUnits(raw.trim());

  const kmMatch = new RegExp(`${NUMBER}\\s*(?:${KM_WORDS})(?![a-z])`, 'i').exec(text);
  if (kmMatch?.[1]) {
    const km = toNumber(kmMatch[1]);
    return km === null ? null : Math.round(km * 1000);
  }

  const mileMatch = new RegExp(`${NUMBER}\\s*(?:${MILE_WORDS})(?![a-z])`, 'i').exec(text);
  if (mileMatch?.[1]) {
    const miles = toNumber(mileMatch[1]);
    return miles === null ? null : Math.round(miles * MILE_IN_METRES);
  }

  const metreMatch = new RegExp(`${NUMBER}\\s*(?:${METRE_WORDS})(?![a-z])`, 'i').exec(text);
  if (metreMatch?.[1]) {
    const metres = toNumber(metreMatch[1]);
    return metres === null ? null : Math.round(metres);
  }

  // Bare "k" — tried after every real unit word so "10km" is never read as
  // 10 metres, and guarded per BARE_K_MAX_KM above.
  const bareK = new RegExp(`(?<![\\p{Sc}])${NUMBER}\\s*k(?![a-z])`, 'iu').exec(text);
  if (bareK?.[1]) {
    const km = toNumber(bareK[1]);
    if (km !== null && km > 0 && km <= BARE_K_MAX_KM) return Math.round(km * 1000);
  }

  // A bare number with no unit at all (e.g. data-distance="3800") is
  // assumed to already be metres, matching how most organiser CMSs emit
  // this attribute — but only when it's genuinely unit-less.
  const bareNumber = /^\d+(?:[.,]\d+)?$/.exec(text);
  if (bareNumber) {
    const n = toNumber(text);
    return n === null ? null : Math.round(n);
  }

  return null;
}

// Shared by both per-distance and event-level wetsuit-policy parsing.
export function parseWetsuitPolicy(raw: string | null): WetsuitPolicy | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (WETSUIT_POLICIES as readonly string[]).includes(value) ? (value as WetsuitPolicy) : null;
}

function parseBooleanFlag(raw: string | null): boolean | null {
  if (raw === null) return null;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === 'yes' || v === '1') return true;
  if (v === 'false' || v === 'no' || v === '0') return false;
  return null;
}

export function normaliseDistance(raw: HtmlDistanceRaw): DistanceOption {
  return {
    originalLabel: raw.label,
    distanceMetres: parseDistanceToMetres(raw.distanceAttr ?? raw.label),
    category: null,
    startTime: raw.startTime,
    registrationUrl: raw.registrationUrl,
    wetsuitPolicy: parseWetsuitPolicy(raw.wetsuit),
    qualificationRequired: parseBooleanFlag(raw.qualificationRequired),
  };
}

export function normaliseDistances(rawDistances: HtmlDistanceRaw[]): DistanceOption[] {
  return rawDistances.map(normaliseDistance);
}

// ── Distances from schema.org offers ──────────────────────────────────
//
// buildCandidateEvent's comment used to say schema.org Event "has no clean
// multi-distance shape", so distances came only from HTML selectors. That
// is true of the Event node itself, but it overlooked `offers`: a
// registration platform publishes one Offer per entry category, and for a
// swim the entry category IS the distance. active.com's Caramoan page
// carries five of them, and we stored none — including a 20 km marathon
// swim, which is exactly the rare thing worth having.
//
// The hard part is that `offers` also carries things that are not swims:
// accommodation bundles, merchandise, "General Admission", and entry types
// like "Open" / "Assist". So this never treats an offer as a distance
// merely because it is an offer.
//
// The rule is sibling evidence. Platforms emit "<category> - <variant>",
// so offers are grouped by the text before the first " - " and a group
// counts as distance options only when at least one member states a real
// distance. That one parsed sibling is the evidence that the whole group
// is the distance menu:
//
//   SWIM DISTANCE - 2Km Swim          -> 2000   ┐ group states distances,
//   SWIM DISTANCE - 15Km Island Swim  -> 15000  │ so MARATHON 20 is kept
//   SWIM DISTANCE - MARATHON 20       -> null   ┘ as a labelled option
//   GROUP REGISTERED... - Accommodations for 9+1  -> dropped, no sibling
//
// A member that does not parse keeps its label with `distanceMetres: null`
// rather than being dropped or guessed at. "MARATHON 20" is 20 of
// something the offer name never says; the page body says kilometres, but
// this function only sees the offer, so it records the label and leaves
// the number unknown for a reviewer.
interface OfferLike {
  name?: unknown;
  url?: unknown;
  category?: unknown;
}

function offerGroupKey(name: string): string {
  const idx = name.indexOf(' - ');
  return (idx === -1 ? name : name.slice(0, idx)).trim().toLowerCase();
}

export function distanceOptionsFromOffers(offers: unknown): DistanceOption[] {
  if (!offers) return [];
  const list = (Array.isArray(offers) ? offers : [offers]).filter(
    (o): o is OfferLike => !!o && typeof o === 'object'
  );

  const named = list
    .map((o) => ({
      label: typeof o.name === 'string' && o.name.trim().length > 0 ? o.name.trim() : null,
      url: typeof o.url === 'string' && o.url.trim().length > 0 ? o.url.trim() : null,
      category: typeof o.category === 'string' && o.category.trim().length > 0 ? o.category.trim() : null,
    }))
    .filter((o): o is { label: string; url: string | null; category: string | null } => o.label !== null)
    .map((o) => ({ ...o, metres: parseDistanceToMetres(o.label) }));

  const groupsStatingADistance = new Set(
    named.filter((o) => o.metres !== null).map((o) => offerGroupKey(o.label))
  );
  if (groupsStatingADistance.size === 0) return [];

  const out: DistanceOption[] = [];
  const seenMetres = new Set<number>();
  const seenLabels = new Set<string>();
  for (const o of named) {
    if (!groupsStatingADistance.has(offerGroupKey(o.label))) continue;
    // Combo entries ("10k & 0,2k") and duplicated price tiers resolve to a
    // distance already recorded. The swimmer is choosing between distances,
    // so one row per distance — not one per way of buying it.
    if (o.metres !== null) {
      if (seenMetres.has(o.metres)) continue;
      seenMetres.add(o.metres);
    } else {
      const key = o.label.toLowerCase();
      if (seenLabels.has(key)) continue;
      seenLabels.add(key);
    }
    out.push({
      originalLabel: o.label,
      distanceMetres: o.metres,
      category: o.category,
      startTime: null,
      registrationUrl: o.url,
      wetsuitPolicy: null,
      qualificationRequired: null,
    });
  }
  return out;
}

// ── Standard triathlon distances ──────────────────────────────────────
//
// These are DEFINED, not inferred. World Triathlon standardises the swim
// leg of each format, so "Olympic Distance" states 1.5 km as surely as
// printing "1.5 km" does — the organiser simply used the name every
// athlete already knows. Greek, Spanish and Portuguese calendars in
// particular list formats rather than metres ("Triathlon: Middle, Olympic,
// Sprint Distance"), and requiring the number discarded them all.
//
// Guarded by context at the call site: these names mean a swim leg only on
// a page already identified as multisport. "Sprint" on an open-water
// listing means a short swim of the organiser's choosing, not 750 m.
const STANDARD_SWIM_METRES: { metres: number; names: string[] }[] = [
  { metres: 750,  names: ['sprint'] },
  { metres: 1500, names: ['olympic', 'olimpica', 'olimpico', 'olympique', 'olympische', 'olimpica', 'ολυμπιακη', 'standard', 'standaard'] },
  { metres: 1900, names: ['middle', 'half', '70.3', '70,3', 'medio', 'mezza', 'mitteldistanz', 'media'] },
  { metres: 3800, names: ['full', 'ironman', 'long distance', '140.6', '140,6', 'langdistanz', 'completo'] },
];

// EVERY standard format the text names, not just the first. A race
// advertising "Middle, Olympic, Sprint Distance" offers three different
// swims, and recording one of them would be picking a winner arbitrarily
// — the swimmer choosing between 750 m and 1.9 km needs both.
export function standardTriathlonSwimDistances(
  raw: string | null
): { label: string; metres: number }[] {
  if (!raw) return [];
  const folded = raw.toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '');
  const found = new Map<number, string>();
  for (const entry of STANDARD_SWIM_METRES) {
    for (const n of entry.names) {
      // Word-boundary-ish so "sprint" does not fire inside another word,
      // while still matching "Sprint Distance" and "70.3".
      const re = new RegExp(
        `(?:^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^\\p{L}\\p{N}]|$)`,
        'iu'
      );
      if (re.test(folded) && !found.has(entry.metres)) {
        // The organiser's own word for it, so the label a reviewer sees is
        // the one printed on the page.
        found.set(entry.metres, `${n.charAt(0).toUpperCase()}${n.slice(1)} (swim leg)`);
      }
    }
  }
  return [...found.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([metres, label]) => ({ label, metres }));
}
