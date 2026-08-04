// Controlled vocabularies for the candidate-event model. Every value here
// is a closed set on purpose — normalize/classify code must map onto one
// of these, never invent a new string at runtime.

export const EVENT_TYPES = [
  'official_race',
  'mass_participation_swim',
  'marathon_swim',
  'charity_swim',
  'swim_festival',
  'guided_swim',
  'swim_camp',
  'expedition',
  'recurring_group_swim',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// Reasons a page is explicitly rejected or marked ineligible, rather than
// classified as one of the EVENT_TYPES above.
export const INELIGIBLE_REASONS = [
  'pool_only',
  'triathlon_only',
  'historical_result',
  'general_tourism_page',
  'no_actual_opportunity',
] as const;
export type IneligibleReason = (typeof INELIGIBLE_REASONS)[number];

// What classify.ts returns: either an eligible event type, one of the
// ineligible reasons above, or 'unclassified' when there isn't enough
// signal either way (never silently guessed into a real EventType).
export type Classification = EventType | IneligibleReason | 'unclassified';

// Which sport the swim belongs to. Deliberately SEPARATE from EventType:
// a triathlon's swim leg is a real official race — the event type is not
// what differs, the discipline is. Keeping them apart is what lets
// /explore show open water only by default while a triathlete can opt the
// swim legs in, without either group seeing a catalogue that is not for
// them.
export const DISCIPLINES = ['open_water', 'multisport_swim_leg'] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const EVENT_STATUSES = [
  'scheduled',
  'cancelled',
  'postponed',
  'completed',
  'unknown',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const DATE_PRECISIONS = ['exact', 'range', 'month', 'year', 'unknown'] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

// 'ai_fallback' means a language model read the page's text into columns
// because JSON-LD, table and selector extraction all found nothing. It is
// a separate value precisely so a reviewer can always tell, at a glance
// and in SQL, which candidates came from a model rather than from
// structured data. Everything downstream of the reading — dates,
// locations, distances, classification, scoring — is deterministic
// regardless of which method produced the raw text.
export const EXTRACTION_METHODS = ['jsonld', 'html', 'jsonld+html', 'ai_fallback', 'none'] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

export const WATER_BODY_TYPES = ['sea', 'lake', 'river', 'reservoir', 'pool', 'unknown'] as const;
export type WaterBodyType = (typeof WATER_BODY_TYPES)[number];

export const WETSUIT_POLICIES = [
  'permitted',
  'mandatory',
  'banned',
  'wave_dependent',
  'unknown',
] as const;
export type WetsuitPolicy = (typeof WETSUIT_POLICIES)[number];

export const PUBLICATION_RECOMMENDATIONS = [
  'high_confidence',
  'manual_review',
  'insufficient_evidence',
  'rejected',
] as const;
export type PublicationRecommendation = (typeof PUBLICATION_RECOMMENDATIONS)[number];

export const EVIDENCE_TYPES = ['jsonld', 'html_selector', 'meta_tag', 'ai_fallback'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
