import type { JsonLdPlace } from '../extract/jsonld.js';
import {
  AMBIGUOUS_COUNTRY_NAMES,
  COUNTRY_NAME_TO_CODE,
  ISO_ALPHA2,
} from './country-names.js';

// Every "we couldn't work out the country" warning starts with this, so
// mergeLocations can drop it when the other parser did work it out.
export const UNRESOLVED_COUNTRY_WARNING = 'Could not resolve a country';

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

// Must stay byte-identical to normalise() in scripts/gen-country-names.mjs
// — the generated keys are produced by that copy and matched against this
// one. If you change one, regenerate.
export function normaliseCountryName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.,'’()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\bst\b/g, 'saint')
    .replace(/^the /, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface CountryTextOptions {
  // True only for a field that explicitly means "country" (JSON-LD
  // addressCountry). A trailing free-text comma segment does not qualify:
  // "Atlanta, Georgia" is a US city, not the Caucasus.
  fieldMeansCountry?: boolean;
}

function countryTextToCode(
  text: string | null | undefined,
  opts: CountryTextOptions = {}
): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  // A two-letter string is only a country code if it is actually assigned.
  // "XX" is not a country, and storing it as one invents a fact. Note "UK"
  // is deliberately NOT an ISO code — it falls through to the name lookup,
  // which maps it to GB.
  if (/^[A-Za-z]{2}$/.test(trimmed) && ISO_ALPHA2.has(trimmed.toUpperCase())) {
    return trimmed.toUpperCase();
  }
  const key = normaliseCountryName(trimmed);
  if (AMBIGUOUS_COUNTRY_NAMES.has(key) && !opts.fieldMeansCountry) return null;
  return COUNTRY_NAME_TO_CODE[key] ?? null;
}

// US states / DC / territories and Canadian provinces, by their postal
// abbreviation. A closed lookup, so resolving "FL" to the United States
// is a fact rather than a guess. Deliberately abbreviation-only: full
// names like "Georgia" or "Washington" are ambiguous against countries
// and city names, and countryTextToCode already handles real country
// words before this is consulted.
const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA',
  'RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR','VI','GU','AS','MP',
]);
const CA_PROVINCES = new Set(['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT']);

function subdivisionToCountry(value: string | undefined): { country: string; code: string } | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  if (code.length !== 2) return null;
  if (US_STATES.has(code)) return { country: 'US', code };
  if (CA_PROVINCES.has(code)) return { country: 'CA', code };
  return null;
}

// The event's own UTC offset, in minutes, from an ISO timestamp's suffix
// ("-04:00", "+02:00", "Z"). "Z" reads as unknown rather than zero: it is
// nearly always a normalised timestamp with the real zone thrown away,
// not a claim that the event happens on the Greenwich meridian.
function utcOffsetMinutes(utcOffset: string | null | undefined): number | null {
  if (!utcOffset) return null;
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(utcOffset.trim());
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

// A bare two-letter subdivision code is only safe to read as US/Canada if
// the event could plausibly BE there. Italy writes its provinces the same
// way — Como is "CO", Milano "MI", Palermo "PA", Salerno "SA" — and every
// one of those collides with a US state. Both the US (including Alaska
// and Hawaii) and Canada sit at a negative UTC offset all year, so an
// event whose own timestamp says +02:00 is not in Colorado.
//
// Unknown offset still infers, which keeps today's behaviour for sources
// that publish no timezone; the collision is recorded as a warning rather
// than hidden. US Pacific territories (GU, MP) sit at a positive offset
// and so are refused — an unset country with a warning, never a wrong one.
function subdivisionPlausibleAt(utcOffset: string | null | undefined): boolean {
  const minutes = utcOffsetMinutes(utcOffset);
  return minutes === null || minutes <= 0;
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

export interface JsonLdPlaceOptions {
  // The UTC offset from the event's own startDate ("-04:00", "+02:00",
  // "Z"). Used for one thing only: sanity-checking a bare subdivision code
  // before it is read as the United States or Canada.
  utcOffset?: string | null;
}

// Structured location, from a JSON-LD Place (with nested PostalAddress
// and GeoCoordinates). This is the preferred source when present.
export function parseJsonLdPlace(
  place: unknown,
  opts: JsonLdPlaceOptions = {}
): ParsedLocation {
  const result = blankLocation();
  if (!place || typeof place !== 'object') return result;
  const p = place as JsonLdPlace & Record<string, unknown>;

  result.venueName = toNullableString(p.name);

  const address = p.address;
  if (address && typeof address === 'object') {
    const addr = address as Record<string, unknown>;
    result.city = toNullableString(addr.addressLocality);
    result.region = toNullableString(addr.addressRegion);
    const countryText = toNullableString(addr.addressCountry);
    result.countryCode = countryTextToCode(countryText, { fieldMeansCountry: true });

    // Aggregators routinely ship addressCountry as "" and leave the
    // country implied by the state — active.com does exactly this on
    // every US listing. addressRegion explicitly means "subdivision", so
    // reading a state code out of it is better founded than the same
    // reading from a trailing comma segment. Only ever a fallback: a
    // stated country always wins.
    if (!result.countryCode) {
      const sub = subdivisionToCountry(result.region ?? undefined);
      if (sub && subdivisionPlausibleAt(opts.utcOffset)) {
        result.countryCode = sub.country;
        if (countryTextToCode(sub.code, { fieldMeansCountry: true })) {
          result.warnings.push(
            `"${sub.code}" read as a ${sub.country} subdivision, but it is also an ISO ` +
              `country code — confirm the country if this event is not in ${sub.country}`
          );
        }
      } else if (sub) {
        result.warnings.push(
          `"${sub.code}" looks like a ${sub.country} subdivision, but the event's own ` +
            `timezone (UTC${opts.utcOffset}) puts it elsewhere — country left unset rather ` +
            `than guessed`
        );
      }
    }

    const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.addressCountry]
      .map((v) => toNullableString(v))
      .filter((v): v is string => v !== null);
    if (parts.length > 0) result.locationText = parts.join(', ');

    // Without this the JSON-LD path failed silently. Six venues published
    // with no country at all — the Philippines read as zero events while
    // Caramoan sat in the table — and nothing in the queue said so.
    if (!result.countryCode && (result.city || result.region || result.locationText)) {
      result.warnings.push(
        `${UNRESOLVED_COUNTRY_WARNING} from the structured address: "${
          result.locationText ?? result.city ?? result.region
        }"`
      );
    }
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
export function parseLocationText(
  text: string | null,
  opts: JsonLdPlaceOptions = {}
): ParsedLocation {
  const result = blankLocation();
  if (!text || !text.trim()) return result;

  result.locationText = text.trim();
  const segments = text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (segments.length === 0) return result;

  const last = segments[segments.length - 1];
  // Subdivisions are checked FIRST, because many US state abbreviations
  // are also ISO country codes and the country reading is nearly always
  // wrong in practice: "South Boston, MA" is Massachusetts, not Morocco,
  // and "Newport, VT" is Vermont, not Vanuatu. North American calendars
  // write "City, ST" constantly and never spell the country out.
  //
  // A genuinely foreign listing written as a bare ISO code ("Casablanca,
  // MA") is misread by this, so the ambiguity is recorded as a warning
  // for the reviewer rather than hidden. Spelled-out country names are
  // unaffected — countryTextToCode still handles those below.
  const sub = subdivisionToCountry(last);
  if (sub && subdivisionPlausibleAt(opts.utcOffset)) {
    result.countryCode = sub.country;
    result.region = sub.code;
    segments.pop();
    if (countryTextToCode(last, { fieldMeansCountry: true })) {
      result.warnings.push(
        `"${last}" read as a ${sub.country} subdivision, but it is also an ISO country code — confirm the country if this event is not in ${sub.country}`
      );
    }
  } else if (sub) {
    // The subdivision reading was refused on timezone grounds, and we
    // deliberately do NOT then read the same two letters as a country
    // code: "Como, CO" would become Colombia, which is no less wrong for
    // arriving by a different route. The cost is a real one — "Casablanca,
    // MA" at UTC+01:00 genuinely is Morocco and is refused too — but an
    // unset country shows as "location to be confirmed", while a wrong one
    // files an Italian swim under the United States and puts it in that
    // country's hub. Missing beats wrong.
    result.warnings.push(
      `"${sub.code}" is both a ${sub.country} subdivision and an ISO country code, and the ` +
        `event's own timezone (UTC${opts.utcOffset}) fits neither reading — country left ` +
        `unset rather than guessed`
    );
  } else {
    const countryCode = countryTextToCode(last);
    if (countryCode) {
      result.countryCode = countryCode;
      segments.pop();
    }
  }

  if (segments.length > 0) result.city = segments[0] ?? null;
  if (!result.region && segments.length > 1) result.region = segments[segments.length - 1] ?? null;

  if (!result.countryCode) {
    result.warnings.push(`${UNRESOLVED_COUNTRY_WARNING} from location text: "${text.trim()}"`);
  }

  return result;
}

// Merges structured (JSON-LD) and free-text location facts, preferring
// structured facts field-by-field and filling gaps from free text.
export function mergeLocations(structured: ParsedLocation, freeText: ParsedLocation): ParsedLocation {
  const countryCode = structured.countryCode ?? freeText.countryCode;
  // Each parser warns about its own blind spot. Once merged, only one of
  // them needing help is not worth reporting — the country IS known, and a
  // warning that contradicts the stored value trains people to ignore
  // warnings.
  const warnings = [...structured.warnings, ...freeText.warnings].filter(
    (w) => !(countryCode && w.startsWith(UNRESOLVED_COUNTRY_WARNING))
  );
  return {
    venueName: structured.venueName ?? freeText.venueName,
    locationText: structured.locationText ?? freeText.locationText,
    city: structured.city ?? freeText.city,
    region: structured.region ?? freeText.region,
    countryCode,
    latitude: structured.latitude ?? freeText.latitude,
    longitude: structured.longitude ?? freeText.longitude,
    warnings,
  };
}
