import type {
  DatePrecision,
  EventStatus,
  EventType,
  ExtractionMethod,
  WaterBodyType,
  WetsuitPolicy,
} from './enums.js';
import type { EvidenceItem } from './evidence.js';

// A single distance/wave option within an event edition. Deliberately not
// a bare string — every distance keeps its own registration/wetsuit/
// timing facts, since those can differ per distance within one event.
export interface DistanceOption {
  originalLabel: string;
  distanceMetres: number | null;
  category: string | null;
  startTime: string | null;
  registrationUrl: string | null;
  wetsuitPolicy: WetsuitPolicy | null;
  qualificationRequired: boolean | null;
}

// The controlled candidate-event schema. Every field the discovery worker
// is allowed to produce is listed here explicitly — nothing else may be
// added ad hoc. Unknown facts are `null`, never guessed or defaulted.
export interface CandidateEvent {
  candidateId: string;
  // Stable per-source identity — see domain/candidate-key.ts. Paired with
  // sourceId this is the upsert key that makes re-extraction idempotent.
  candidateKey: string;
  sourceId: string;
  sourceUrl: string;
  officialUrl: string | null;
  registrationUrl: string | null;
  canonicalName: string | null;
  originalName: string | null;
  eventType: EventType | null;
  status: EventStatus | null;
  organiserName: string | null;
  venueName: string | null;
  locationText: string | null;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  startDate: string | null;
  endDate: string | null;
  datePrecision: DatePrecision;
  dateConfirmed: boolean;
  timezone: string | null;
  distances: DistanceOption[];
  waterBodyType: WaterBodyType | null;
  wetsuitPolicy: WetsuitPolicy | null;
  descriptionSummary: string | null;
  extractionMethod: ExtractionMethod;
  confidenceScore: number;
  confidenceReasons: string[];
  warnings: string[];
  evidence: EvidenceItem[];
  rawSourceValues: Record<string, unknown>;
  extractedAt: string;
}

// A blank candidate with every field at its explicit "unknown" value.
// normalize/event.ts fills this in field-by-field from extraction output
// — nothing is ever defaulted to a guessed value past this starting point.
export function blankCandidateEvent(sourceId: string, sourceUrl: string): CandidateEvent {
  return {
    candidateId: `cand:${sourceId}`,
    // Filled in by normalize/event.ts once the name and date are known —
    // it cannot be derived from sourceId alone.
    candidateKey: '',
    sourceId,
    sourceUrl,
    officialUrl: null,
    registrationUrl: null,
    canonicalName: null,
    originalName: null,
    eventType: null,
    status: null,
    organiserName: null,
    venueName: null,
    locationText: null,
    city: null,
    region: null,
    countryCode: null,
    latitude: null,
    longitude: null,
    startDate: null,
    endDate: null,
    datePrecision: 'unknown',
    dateConfirmed: false,
    timezone: null,
    distances: [],
    waterBodyType: null,
    wetsuitPolicy: null,
    descriptionSummary: null,
    extractionMethod: 'none',
    confidenceScore: 0,
    confidenceReasons: [],
    warnings: [],
    evidence: [],
    rawSourceValues: {},
    extractedAt: new Date().toISOString(),
  };
}
