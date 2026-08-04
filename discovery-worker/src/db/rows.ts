import { createHash } from 'node:crypto';
import type { CandidateEvent } from '../domain/candidate-event.js';
import type { ConfidenceBreakdown } from '../confidence/score.js';

// Pure CandidateEvent -> database row mapping. Deliberately separated from
// persist.ts (which does the I/O) so the shape of every row written to
// production is unit-testable with no network and no credentials.
//
// Column names are snake_case to match the schema; the worker's own model
// is camelCase. This file is the single place that translation happens.

export interface CandidateEventRow {
  candidate_key: string;
  source_id: string;
  source_page_id: string | null;
  source_url: string;
  official_url: string | null;
  registration_url: string | null;
  canonical_name: string | null;
  original_name: string | null;
  event_type: string | null;
  organiser_name: string | null;
  venue_name: string | null;
  location_text: string | null;
  city: string | null;
  region: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  start_date: string | null;
  end_date: string | null;
  original_date_text: string | null;
  date_precision: string;
  date_confirmed: boolean;
  timezone: string | null;
  water_body_type: string | null;
  wetsuit_policy: string | null;
  description_summary: string | null;
  extraction_method: string;
  confidence_score: number;
  publication_recommendation: string;
  confidence_reasons: string[];
  warnings: string[];
  raw_source_values: Record<string, unknown>;
  raw_payload: Record<string, unknown>;
  extracted_at: string;
}

export interface CandidateDistanceRow {
  candidate_id: string;
  original_label: string;
  distance_metres: number | null;
  category: string | null;
  start_time: string | null;
  registration_url: string | null;
  wetsuit_policy: string | null;
  qualification_required: boolean | null;
}

export interface EvidenceRow {
  candidate_id: string;
  source_page_id: string | null;
  evidence_type: string;
  field_name: string;
  raw_snippet: string | null;
  structured_value: unknown;
  selector_or_path: string | null;
  extracted_at: string;
  extraction_warnings: string[];
}

export interface SourcePageRow {
  source_id: string;
  url: string;
  canonical_url: string;
  page_type: string;
  content_hash: string;
  http_status: number | null;
  last_fetched_at: string;
}

export function contentHash(html: string): string {
  return createHash('sha256').update(html).digest('hex');
}

// The worker's evidence types are a narrower set than the DB CHECK allows;
// this maps them explicitly rather than casting, so an unexpected value
// fails loudly here instead of as a constraint violation mid-write.
const EVIDENCE_TYPE_MAP: Record<string, string> = {
  jsonld: 'jsonld',
  html_selector: 'html_selector',
  meta_tag: 'meta_tag',
  // Already permitted by the schema's CHECK since discovery-schema-v1 —
  // the column was designed for this before the extractor existed.
  ai_fallback: 'ai_fallback',
};

export function toCandidateEventRow(
  candidate: CandidateEvent,
  confidence: ConfidenceBreakdown,
  sourceId: string,
  sourcePageId: string | null
): CandidateEventRow {
  return {
    candidate_key: candidate.candidateKey,
    source_id: sourceId,
    source_page_id: sourcePageId,
    source_url: candidate.sourceUrl,
    official_url: candidate.officialUrl,
    registration_url: candidate.registrationUrl,
    canonical_name: candidate.canonicalName,
    original_name: candidate.originalName,
    event_type: candidate.eventType,
    organiser_name: candidate.organiserName,
    venue_name: candidate.venueName,
    location_text: candidate.locationText,
    city: candidate.city,
    region: candidate.region,
    country_code: candidate.countryCode,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    start_date: candidate.startDate,
    end_date: candidate.endDate,
    // Promoted out of rawSourceValues into a real column — the schema has
    // a dedicated home for the organiser's own date wording.
    original_date_text:
      typeof candidate.rawSourceValues.htmlDateText === 'string'
        ? candidate.rawSourceValues.htmlDateText
        : null,
    date_precision: candidate.datePrecision,
    date_confirmed: candidate.dateConfirmed,
    timezone: candidate.timezone,
    water_body_type: candidate.waterBodyType,
    wetsuit_policy: candidate.wetsuitPolicy,
    description_summary: candidate.descriptionSummary,
    extraction_method: candidate.extractionMethod,
    confidence_score: candidate.confidenceScore,
    publication_recommendation: confidence.recommendation,
    confidence_reasons: candidate.confidenceReasons,
    warnings: candidate.warnings,
    // KNOWN GAP: discovery_candidate_events has no column for the event's
    // own status (scheduled/cancelled/postponed) — only candidate_status,
    // which is the REVIEW state. Rather than drop the fact, it is carried
    // here under an explicit key. A follow-up additive migration should
    // give it a real column; see discovery-worker/README.md.
    raw_source_values: { ...candidate.rawSourceValues, eventStatus: candidate.status },
    raw_payload: {
      candidateId: candidate.candidateId,
      classificationEventType: candidate.eventType,
      status: candidate.status,
      distances: candidate.distances,
    },
    extracted_at: candidate.extractedAt,
  };
}

export function toCandidateDistanceRows(candidate: CandidateEvent, candidateId: string): CandidateDistanceRow[] {
  return candidate.distances.map((d) => ({
    candidate_id: candidateId,
    original_label: d.originalLabel,
    distance_metres: d.distanceMetres,
    category: d.category,
    start_time: d.startTime,
    registration_url: d.registrationUrl,
    wetsuit_policy: d.wetsuitPolicy,
    qualification_required: d.qualificationRequired,
  }));
}

export function toEvidenceRows(
  candidate: CandidateEvent,
  candidateId: string,
  sourcePageId: string | null
): EvidenceRow[] {
  return candidate.evidence.map((e) => {
    const evidenceType = EVIDENCE_TYPE_MAP[e.evidenceType];
    if (!evidenceType) {
      throw new Error(`Unmappable evidence type "${e.evidenceType}" — refusing to write an invalid row`);
    }
    return {
      candidate_id: candidateId,
      source_page_id: sourcePageId,
      evidence_type: evidenceType,
      field_name: e.field,
      raw_snippet: e.rawValue,
      structured_value: null,
      selector_or_path: e.selector,
      extracted_at: candidate.extractedAt,
      extraction_warnings: e.note ? [e.note] : [],
    };
  });
}

export function toSourcePageRow(sourceId: string, sourceUrl: string, html: string): SourcePageRow {
  return {
    source_id: sourceId,
    url: sourceUrl,
    canonical_url: sourceUrl,
    page_type: 'event_detail',
    content_hash: contentHash(html),
    // null, not 200 — nothing was fetched over HTTP in this phase, and
    // recording a fabricated status code would be a lie in the audit trail.
    http_status: null,
    last_fetched_at: new Date().toISOString(),
  };
}
