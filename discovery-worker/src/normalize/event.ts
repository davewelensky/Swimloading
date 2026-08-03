import type { SourceRecord } from '../domain/source-record.js';
import { blankCandidateEvent, type CandidateEvent } from '../domain/candidate-event.js';
import { buildCandidateKey } from '../domain/candidate-key.js';
import { EVENT_STATUSES, WATER_BODY_TYPES, type EventStatus, type EventType, type WaterBodyType } from '../domain/enums.js';
import { evidence } from '../domain/evidence.js';
import type { JsonLdEventNode, JsonLdExtractionResult } from '../extract/jsonld.js';
import type { HtmlExtractionResult } from '../extract/html.js';
import type { ClassificationResult } from '../extract/classify.js';
import { parseFreeTextDate, parseStructuredDates, reconcileDates } from './date.js';
import { normaliseDistances, parseWetsuitPolicy } from './distance.js';
import { mergeLocations, parseJsonLdPlace, parseLocationText } from './location.js';
import { deriveCanonicalName, truncateSummary } from './text.js';

function toNullableString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

// schema.org eventStatus is usually a full URL like
// "https://schema.org/EventCancelled" — matched by substring rather than
// exact URL to tolerate http vs https and trailing slashes.
function mapEventStatus(raw: unknown): EventStatus | null {
  const text = toNullableString(raw);
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower.includes('cancel')) return 'cancelled';
  if (lower.includes('postpon')) return 'postponed';
  if (lower.includes('completed')) return 'completed';
  if (lower.includes('scheduled')) return 'scheduled';
  return (EVENT_STATUSES as readonly string[]).includes(lower) ? (lower as EventStatus) : 'unknown';
}

function mapWaterBodyType(raw: string | null): WaterBodyType | null {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  return (WATER_BODY_TYPES as readonly string[]).includes(lower) ? (lower as WaterBodyType) : null;
}

function extractTimezoneOffset(iso: string | null): string | null {
  if (!iso) return null;
  const m = /([+-]\d{2}:\d{2}|Z)$/.exec(iso.trim());
  return m ? (m[1] ?? null) : null;
}

function firstOfferUrl(offers: unknown): string | null {
  if (!offers) return null;
  const first = Array.isArray(offers) ? offers[0] : offers;
  if (first && typeof first === 'object') return toNullableString((first as Record<string, unknown>).url);
  return null;
}

function organiserNameFrom(organizer: unknown): string | null {
  if (!organizer || typeof organizer !== 'object') return null;
  return toNullableString((organizer as Record<string, unknown>).name);
}

export interface BuildCandidateParams {
  source: SourceRecord;
  jsonld: JsonLdExtractionResult;
  html: HtmlExtractionResult;
  classification: ClassificationResult;
}

// The core normalisation step: JSON-LD first (per extraction priority),
// deterministic HTML selectors filling any gap JSON-LD left, distances
// always sourced from HTML (schema.org Event has no clean multi-distance
// shape). Every field stays null if neither source provided it — nothing
// here invents a fact.
export function buildCandidateEvent(params: BuildCandidateParams): CandidateEvent {
  const { source, jsonld, html, classification } = params;
  const candidate = blankCandidateEvent(source.sourceId, source.sourceUrl);
  const warnings: string[] = [...jsonld.warnings, ...html.warnings, ...classification.warnings];

  const eventNode: JsonLdEventNode | null = jsonld.events[0] ?? null;
  if (jsonld.events.length > 1) {
    warnings.push(`Multiple JSON-LD Event nodes found (${jsonld.events.length}) — using the first`);
  }

  let usedJsonLd = false;
  let usedHtml = false;

  // ── name ──
  if (eventNode) {
    const name = toNullableString(eventNode.name);
    if (name) {
      candidate.originalName = name;
      candidate.evidence.push(evidence('originalName', 'jsonld', name));
      usedJsonLd = true;
    }
  }
  if (!candidate.originalName && html.titleText) {
    candidate.originalName = html.titleText;
    candidate.evidence.push(evidence('originalName', 'html_selector', html.titleText, '.event-title, h1, title'));
    usedHtml = true;
  }
  candidate.canonicalName = deriveCanonicalName(candidate.originalName);

  // ── urls ──
  if (eventNode) {
    const url = toNullableString(eventNode.url);
    if (url) {
      candidate.officialUrl = url;
      candidate.evidence.push(evidence('officialUrl', 'jsonld', url));
      usedJsonLd = true;
    }
    const offerUrl = firstOfferUrl(eventNode.offers);
    if (offerUrl) {
      candidate.registrationUrl = offerUrl;
      candidate.evidence.push(evidence('registrationUrl', 'jsonld', offerUrl));
      usedJsonLd = true;
    }
  }
  if (!candidate.officialUrl && html.officialUrl) {
    candidate.officialUrl = html.officialUrl;
    candidate.evidence.push(evidence('officialUrl', 'html_selector', html.officialUrl, 'a.official-link'));
    usedHtml = true;
  }
  if (!candidate.registrationUrl && html.registrationUrl) {
    candidate.registrationUrl = html.registrationUrl;
    candidate.evidence.push(evidence('registrationUrl', 'html_selector', html.registrationUrl, 'a.registration-link'));
    usedHtml = true;
  }

  // ── description ──
  if (eventNode) {
    const description = toNullableString(eventNode.description);
    if (description) {
      candidate.descriptionSummary = truncateSummary(description);
      candidate.evidence.push(evidence('descriptionSummary', 'jsonld', description));
      usedJsonLd = true;
    }
  }
  if (!candidate.descriptionSummary && html.descriptionText) {
    candidate.descriptionSummary = truncateSummary(html.descriptionText);
    candidate.evidence.push(
      evidence('descriptionSummary', 'html_selector', html.descriptionText, 'meta[name=description], .event-description')
    );
    usedHtml = true;
  }

  // ── organiser ──
  if (eventNode) {
    const organiserName = organiserNameFrom(eventNode.organizer);
    if (organiserName) {
      candidate.organiserName = organiserName;
      candidate.evidence.push(evidence('organiserName', 'jsonld', organiserName));
      usedJsonLd = true;
    }
  }
  if (!candidate.organiserName && html.organiserName) {
    candidate.organiserName = html.organiserName;
    candidate.evidence.push(evidence('organiserName', 'html_selector', html.organiserName, '.organiser'));
    usedHtml = true;
  }

  // ── status ──
  if (eventNode) {
    const status = mapEventStatus(eventNode.eventStatus);
    if (status) {
      candidate.status = status;
      candidate.evidence.push(evidence('status', 'jsonld', toNullableString(eventNode.eventStatus)));
      usedJsonLd = true;
    }
  }
  if (!candidate.status && html.statusText) {
    candidate.status = mapEventStatus(html.statusText) ?? 'unknown';
    candidate.evidence.push(evidence('status', 'html_selector', html.statusText, '.event-status'));
    usedHtml = true;
  }

  // ── location ──
  const structuredLocation = parseJsonLdPlace(eventNode?.location ?? null);
  const freeTextLocation = parseLocationText(html.locationText);
  const location = mergeLocations(structuredLocation, freeTextLocation);
  candidate.venueName = location.venueName;
  candidate.locationText = location.locationText;
  candidate.city = location.city;
  candidate.region = location.region;
  candidate.countryCode = location.countryCode;
  candidate.latitude = location.latitude;
  candidate.longitude = location.longitude;
  warnings.push(...location.warnings);
  if (structuredLocation.venueName || structuredLocation.city || structuredLocation.countryCode) {
    candidate.evidence.push(evidence('locationText', 'jsonld', JSON.stringify(eventNode?.location ?? null)));
    usedJsonLd = true;
  }
  if (html.locationText) {
    candidate.evidence.push(evidence('locationText', 'html_selector', html.locationText, '.event-location'));
    usedHtml = true;
  }

  // ── dates ──
  const structuredDates = parseStructuredDates(
    eventNode ? toNullableString(eventNode.startDate) : null,
    eventNode ? toNullableString(eventNode.endDate) : null
  );
  const freeTextDates = parseFreeTextDate(html.dateText);
  const resolvedDates = reconcileDates(structuredDates, freeTextDates);
  candidate.startDate = resolvedDates.startDate;
  candidate.endDate = resolvedDates.endDate;
  candidate.datePrecision = resolvedDates.datePrecision;
  candidate.dateConfirmed = resolvedDates.dateConfirmed;
  warnings.push(...resolvedDates.warnings);
  if (eventNode && toNullableString(eventNode.startDate)) {
    candidate.evidence.push(evidence('startDate', 'jsonld', toNullableString(eventNode.startDate)));
    usedJsonLd = true;
  }
  if (html.dateText) {
    candidate.evidence.push(evidence('startDate', 'html_selector', html.dateText, '.event-date'));
    usedHtml = true;
  }
  candidate.timezone = extractTimezoneOffset(eventNode ? toNullableString(eventNode.startDate) : null);

  // ── water body / wetsuit ──
  candidate.waterBodyType = mapWaterBodyType(html.waterBodyHint);
  candidate.wetsuitPolicy = parseWetsuitPolicy(html.eventWetsuitPolicy);

  // ── distances (always via deterministic HTML selectors — schema.org
  // Event has no clean nested-multi-distance shape to rely on) ──
  candidate.distances = normaliseDistances(html.distances);
  if (candidate.distances.length > 0) {
    candidate.evidence.push(
      evidence('distances', 'html_selector', JSON.stringify(html.distances), '.distance-options li[data-distance]')
    );
    usedHtml = true;
  }

  // ── classification -> eventType ──
  candidate.eventType = classification.eligible ? (classification.classification as EventType) : null;

  // ── raw source values — preserve originals verbatim, per the date rule
  // "preserve the original date text" and generally for auditability ──
  candidate.rawSourceValues = {
    htmlDateText: html.dateText,
    jsonLdStartDate: eventNode ? toNullableString(eventNode.startDate) : null,
    jsonLdEndDate: eventNode ? toNullableString(eventNode.endDate) : null,
    htmlLocationText: html.locationText,
    jsonLdLocationRaw: eventNode?.location ?? null,
    htmlTitleText: html.titleText,
    jsonLdName: eventNode ? toNullableString(eventNode.name) : null,
  };

  candidate.extractionMethod = usedJsonLd && usedHtml ? 'jsonld+html' : usedJsonLd ? 'jsonld' : usedHtml ? 'html' : 'none';
  candidate.warnings = warnings;
  candidate.extractedAt = new Date().toISOString();

  // Computed last, so it sees the final reconciled name and date.
  candidate.candidateKey = buildCandidateKey({
    sourceUrl: candidate.sourceUrl,
    name: candidate.canonicalName ?? candidate.originalName,
    startDate: candidate.startDate,
    dateConfirmed: candidate.dateConfirmed,
  });

  return candidate;
}
