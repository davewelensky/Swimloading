import type { WetsuitPolicy } from '../domain/enums.js';
import { WETSUIT_POLICIES } from '../domain/enums.js';
import type { DistanceOption } from '../domain/candidate-event.js';
import type { HtmlDistanceRaw } from '../extract/html.js';

const MILE_IN_METRES = 1609.344;

// Parses a distance value into metres. Accepts metres, kilometres, and
// miles, in whichever form the source used (a bare data attribute like
// "10km"/"3800", or free text like "Sprint (750m)" / "1.2 miles").
// Returns null rather than guessing when nothing recognisable is found.
export function parseDistanceToMetres(raw: string | null): number | null {
  if (!raw) return null;
  const text = raw.trim();

  const kmMatch = /([\d.]+)\s*k(?:ilo)?m\b/i.exec(text);
  if (kmMatch && kmMatch[1]) {
    const km = Number(kmMatch[1]);
    return Number.isFinite(km) ? Math.round(km * 1000) : null;
  }

  const mileMatch = /([\d.]+)\s*mi(?:les?)?\b/i.exec(text);
  if (mileMatch && mileMatch[1]) {
    const miles = Number(mileMatch[1]);
    return Number.isFinite(miles) ? Math.round(miles * MILE_IN_METRES) : null;
  }

  const metreMatch = /([\d.]+)\s*m\b/i.exec(text);
  if (metreMatch && metreMatch[1]) {
    const metres = Number(metreMatch[1]);
    return Number.isFinite(metres) ? Math.round(metres) : null;
  }

  // A bare number with no unit at all (e.g. data-distance="3800") is
  // assumed to already be metres, matching how most organiser CMSs emit
  // this attribute — but only when it's genuinely unit-less.
  const bareNumber = /^[\d.]+$/.exec(text);
  if (bareNumber) {
    const n = Number(text);
    return Number.isFinite(n) ? Math.round(n) : null;
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
