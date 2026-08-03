import {
  DATE_PRECISIONS,
  EVENT_STATUSES,
  EVENT_TYPES,
  EXTRACTION_METHODS,
  WATER_BODY_TYPES,
  WETSUIT_POLICIES,
} from './enums.js';
import type { CandidateEvent, DistanceOption } from './candidate-event.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === 'string';
}

function isNumberOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isFinite(v));
}

function isBooleanOrNull(v: unknown): v is boolean | null {
  return v === null || typeof v === 'boolean';
}

function validateDistance(d: DistanceOption, index: number, errors: string[]): void {
  const prefix = `distances[${index}]`;
  if (typeof d.originalLabel !== 'string' || d.originalLabel.length === 0) {
    errors.push(`${prefix}.originalLabel must be a non-empty string`);
  }
  if (!isNumberOrNull(d.distanceMetres)) errors.push(`${prefix}.distanceMetres must be a number or null`);
  if (!isStringOrNull(d.category)) errors.push(`${prefix}.category must be a string or null`);
  if (!isStringOrNull(d.startTime)) errors.push(`${prefix}.startTime must be a string or null`);
  if (!isStringOrNull(d.registrationUrl)) errors.push(`${prefix}.registrationUrl must be a string or null`);
  if (d.wetsuitPolicy !== null && !WETSUIT_POLICIES.includes(d.wetsuitPolicy)) {
    errors.push(`${prefix}.wetsuitPolicy must be one of ${WETSUIT_POLICIES.join(', ')} or null`);
  }
  if (!isBooleanOrNull(d.qualificationRequired)) {
    errors.push(`${prefix}.qualificationRequired must be a boolean or null`);
  }
}

// Structural validator for the candidate-event schema. Deliberately hand
// written rather than pulling in a schema library — the shape is small,
// fixed, and the whole point is that this file IS the validation boundary
// (see the architecture design report: the shared contract lives at the
// database/schema layer for the real pipeline, and here, at this explicit
// function, for the local-only phase 1 pipeline).
export function validateCandidateEvent(candidate: CandidateEvent): ValidationResult {
  const errors: string[] = [];

  if (!candidate.candidateId) errors.push('candidateId is required');
  if (!candidate.sourceId) errors.push('sourceId is required');
  if (!candidate.sourceUrl) errors.push('sourceUrl is required');
  // The DB enforces NOT NULL + UNIQUE(source_id, candidate_key); an empty
  // key would upsert every candidate from a source onto one row.
  if (!candidate.candidateKey) errors.push('candidateKey is required');

  if (!isStringOrNull(candidate.officialUrl)) errors.push('officialUrl must be a string or null');
  if (!isStringOrNull(candidate.registrationUrl)) errors.push('registrationUrl must be a string or null');
  if (!isStringOrNull(candidate.canonicalName)) errors.push('canonicalName must be a string or null');
  if (!isStringOrNull(candidate.originalName)) errors.push('originalName must be a string or null');

  if (candidate.eventType !== null && !EVENT_TYPES.includes(candidate.eventType)) {
    errors.push(`eventType must be one of ${EVENT_TYPES.join(', ')} or null`);
  }
  if (candidate.status !== null && !EVENT_STATUSES.includes(candidate.status)) {
    errors.push(`status must be one of ${EVENT_STATUSES.join(', ')} or null`);
  }

  if (!isStringOrNull(candidate.organiserName)) errors.push('organiserName must be a string or null');
  if (!isStringOrNull(candidate.venueName)) errors.push('venueName must be a string or null');
  if (!isStringOrNull(candidate.locationText)) errors.push('locationText must be a string or null');
  if (!isStringOrNull(candidate.city)) errors.push('city must be a string or null');
  if (!isStringOrNull(candidate.region)) errors.push('region must be a string or null');
  if (candidate.countryCode !== null && !/^[A-Z]{2}$/.test(candidate.countryCode)) {
    errors.push('countryCode must be a 2-letter ISO code or null');
  }

  if (!isNumberOrNull(candidate.latitude) || (candidate.latitude !== null && Math.abs(candidate.latitude) > 90)) {
    errors.push('latitude must be a number between -90 and 90, or null');
  }
  if (!isNumberOrNull(candidate.longitude) || (candidate.longitude !== null && Math.abs(candidate.longitude) > 180)) {
    errors.push('longitude must be a number between -180 and 180, or null');
  }

  if (!isStringOrNull(candidate.startDate)) errors.push('startDate must be a string or null');
  if (!isStringOrNull(candidate.endDate)) errors.push('endDate must be a string or null');
  if (!DATE_PRECISIONS.includes(candidate.datePrecision)) {
    errors.push(`datePrecision must be one of ${DATE_PRECISIONS.join(', ')}`);
  }
  if (typeof candidate.dateConfirmed !== 'boolean') errors.push('dateConfirmed must be a boolean');

  // Core anti-hallucination invariant, enforced structurally: a date
  // without a confirmed year must never carry a startDate/endDate value —
  // see the date rules in normalize/date.ts for why.
  if (!candidate.dateConfirmed && (candidate.startDate !== null || candidate.endDate !== null)) {
    errors.push('startDate/endDate must be null when dateConfirmed is false (year must never be inferred)');
  }

  if (!isStringOrNull(candidate.timezone)) errors.push('timezone must be a string or null');

  if (!Array.isArray(candidate.distances)) {
    errors.push('distances must be an array');
  } else {
    candidate.distances.forEach((d, i) => validateDistance(d, i, errors));
  }

  if (candidate.waterBodyType !== null && !WATER_BODY_TYPES.includes(candidate.waterBodyType)) {
    errors.push(`waterBodyType must be one of ${WATER_BODY_TYPES.join(', ')} or null`);
  }
  if (candidate.wetsuitPolicy !== null && !WETSUIT_POLICIES.includes(candidate.wetsuitPolicy)) {
    errors.push(`wetsuitPolicy must be one of ${WETSUIT_POLICIES.join(', ')} or null`);
  }
  if (!isStringOrNull(candidate.descriptionSummary)) errors.push('descriptionSummary must be a string or null');

  if (!EXTRACTION_METHODS.includes(candidate.extractionMethod)) {
    errors.push(`extractionMethod must be one of ${EXTRACTION_METHODS.join(', ')}`);
  }

  if (typeof candidate.confidenceScore !== 'number' || candidate.confidenceScore < 0 || candidate.confidenceScore > 100) {
    errors.push('confidenceScore must be a number between 0 and 100');
  }
  if (!Array.isArray(candidate.confidenceReasons)) errors.push('confidenceReasons must be an array');
  if (!Array.isArray(candidate.warnings)) errors.push('warnings must be an array');
  if (!Array.isArray(candidate.evidence)) errors.push('evidence must be an array');
  if (typeof candidate.rawSourceValues !== 'object' || candidate.rawSourceValues === null) {
    errors.push('rawSourceValues must be an object');
  }
  if (!candidate.extractedAt) errors.push('extractedAt is required');

  return { valid: errors.length === 0, errors };
}
