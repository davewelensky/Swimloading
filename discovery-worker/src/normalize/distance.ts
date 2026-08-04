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
