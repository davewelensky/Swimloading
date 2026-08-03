import type { JsonLdPlace } from '../extract/jsonld.js';

export interface ParsedLocation {
  venueName: string | null;
  locationText: string | null;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  warnings: string[];
}

// Small, deliberately non-exhaustive lookup for the common names our
// fixtures and early source registry will actually encounter. A real
// geocoding provider is out of scope for this phase (see README) — this
// is a controlled-vocabulary convenience, not a general gazetteer.
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  'united kingdom': 'GB',
  uk: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  'south africa': 'ZA',
  ireland: 'IE',
  france: 'FR',
  italy: 'IT',
  spain: 'ES',
  switzerland: 'CH',
  'united states': 'US',
  usa: 'US',
  'united states of america': 'US',
};

function blankLocation(): ParsedLocation {
  return {
    venueName: null,
    locationText: null,
    city: null,
    region: null,
    countryCode: null,
    latitude: null,
    longitude: null,
    warnings: [],
  };
}

function countryTextToCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return COUNTRY_NAME_TO_CODE[trimmed.toLowerCase()] ?? null;
}

function toNullableString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function toNullableNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Structured location, from a JSON-LD Place (with nested PostalAddress
// and GeoCoordinates). This is the preferred source when present.
export function parseJsonLdPlace(place: unknown): ParsedLocation {
  const result = blankLocation();
  if (!place || typeof place !== 'object') return result;
  const p = place as JsonLdPlace & Record<string, unknown>;

  result.venueName = toNullableString(p.name);

  const address = p.address;
  if (address && typeof address === 'object') {
    const addr = address as Record<string, unknown>;
    result.city = toNullableString(addr.addressLocality);
    result.region = toNullableString(addr.addressRegion);
    result.countryCode = countryTextToCode(toNullableString(addr.addressCountry));
    const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.addressCountry]
      .map((v) => toNullableString(v))
      .filter((v): v is string => v !== null);
    if (parts.length > 0) result.locationText = parts.join(', ');
  }

  const geo = p.geo;
  if (geo && typeof geo === 'object') {
    const g = geo as Record<string, unknown>;
    result.latitude = toNullableNumber(g.latitude);
    result.longitude = toNullableNumber(g.longitude);
  }

  return result;
}

// Free-text location parsing straight from HTML (e.g. ".event-location"
// text content). Deliberately simple comma-segmented heuristic — city,
// then region, then country, from the last segment inward. Never invents
// a value for a segment that isn't present.
export function parseLocationText(text: string | null): ParsedLocation {
  const result = blankLocation();
  if (!text || !text.trim()) return result;

  result.locationText = text.trim();
  const segments = text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (segments.length === 0) return result;

  const last = segments[segments.length - 1];
  const countryCode = countryTextToCode(last);
  if (countryCode) {
    result.countryCode = countryCode;
    segments.pop();
  }

  if (segments.length > 0) result.city = segments[0] ?? null;
  if (segments.length > 1) result.region = segments[segments.length - 1] ?? null;

  if (!result.countryCode) {
    result.warnings.push(`Could not resolve a country from location text: "${text.trim()}"`);
  }

  return result;
}

// Merges structured (JSON-LD) and free-text location facts, preferring
// structured facts field-by-field and filling gaps from free text.
export function mergeLocations(structured: ParsedLocation, freeText: ParsedLocation): ParsedLocation {
  return {
    venueName: structured.venueName ?? freeText.venueName,
    locationText: structured.locationText ?? freeText.locationText,
    city: structured.city ?? freeText.city,
    region: structured.region ?? freeText.region,
    countryCode: structured.countryCode ?? freeText.countryCode,
    latitude: structured.latitude ?? freeText.latitude,
    longitude: structured.longitude ?? freeText.longitude,
    warnings: [...structured.warnings, ...freeText.warnings],
  };
}
