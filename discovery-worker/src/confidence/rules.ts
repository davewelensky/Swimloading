import type { CandidateEvent } from '../domain/candidate-event.js';
import type { ClassificationResult } from '../extract/classify.js';

export interface ConfidenceContext {
  now: Date;
}

export interface RuleOutcome {
  points: number;
  reason: string;
}

export interface ScoringRule {
  id: string;
  evaluate(candidate: CandidateEvent, classification: ClassificationResult, ctx: ConfidenceContext): RuleOutcome | null;
}

function hasConflictingDatesWarning(candidate: CandidateEvent): boolean {
  return candidate.warnings.some((w) => w.toLowerCase().includes('conflicting dates'));
}

function startYear(candidate: CandidateEvent): number | null {
  if (!candidate.startDate) return null;
  const y = Number(candidate.startDate.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

// ── Positive signals ─────────────────────────────────────────────────────
const POSITIVE_RULES: ScoringRule[] = [
  {
    id: 'official_url_present',
    evaluate: (c) => (c.officialUrl ? { points: 10, reason: 'official event URL present' } : null),
  },
  {
    id: 'explicit_future_year',
    evaluate: (c, _cl, ctx) => {
      const year = startYear(c);
      if (c.dateConfirmed && year !== null && year >= ctx.now.getUTCFullYear()) {
        return { points: 15, reason: `explicit future year (${year})` };
      }
      return null;
    },
  },
  {
    id: 'exact_start_date',
    evaluate: (c) => (c.datePrecision === 'exact' ? { points: 10, reason: 'exact start date known' } : null),
  },
  {
    id: 'city_and_country_present',
    evaluate: (c) => (c.city && c.countryCode ? { points: 10, reason: 'city and country both present' } : null),
  },
  {
    id: 'registration_url_present',
    evaluate: (c) => (c.registrationUrl ? { points: 10, reason: 'registration URL present' } : null),
  },
  {
    id: 'jsonld_event_data',
    evaluate: (c) =>
      c.extractionMethod === 'jsonld' || c.extractionMethod === 'jsonld+html'
        ? { points: 10, reason: 'Schema.org JSON-LD Event data used' }
        : null,
  },
  {
    id: 'organiser_present',
    evaluate: (c) => (c.organiserName ? { points: 5, reason: 'organiser present' } : null),
  },
  {
    id: 'distances_extracted',
    evaluate: (c) => (c.distances.length > 0 ? { points: 10, reason: `${c.distances.length} distance option(s) extracted` } : null),
  },
];

// ── Negative signals ─────────────────────────────────────────────────────
const NEGATIVE_RULES: ScoringRule[] = [
  {
    id: 'missing_year',
    evaluate: (c) => (!c.dateConfirmed ? { points: -20, reason: 'date year is missing or unconfirmed' } : null),
  },
  {
    id: 'historical_page',
    evaluate: (c, _cl, ctx) => {
      if (!c.dateConfirmed || !c.startDate) return null;
      const startsInPast = new Date(`${c.startDate}T00:00:00Z`).getTime() < ctx.now.getTime();
      return startsInPast ? { points: -30, reason: 'event date is in the past — historical page' } : null;
    },
  },
  {
    id: 'aggregator_only_source',
    evaluate: (c) =>
      c.sourceUrl.toLowerCase().includes('aggregator')
        ? { points: -15, reason: 'source looks like an aggregator listing, not the organiser\'s own page' }
        : null,
  },
  {
    id: 'conflicting_dates',
    evaluate: (c) => (hasConflictingDatesWarning(c) ? { points: -15, reason: 'conflicting dates found between sources' } : null),
  },
  {
    id: 'unknown_location',
    evaluate: (c) => (!c.city && !c.countryCode ? { points: -10, reason: 'no city or country could be resolved' } : null),
  },
  {
    // -10 rather than -20: this is "we could not tell what kind of swim
    // this is", not "this is the wrong kind of thing". The hard vetoes in
    // score.ts handle actual evidence of ineligibility; an unclear page
    // with otherwise strong facts should still reach a reviewer.
    id: 'classification_uncertainty',
    evaluate: (_c, cl) => (cl.classification === 'unclassified' ? { points: -10, reason: 'classification could not be determined' } : null),
  },
  {
    id: 'triathlon_only_page',
    evaluate: (_c, cl) => (cl.classification === 'triathlon_only' ? { points: -30, reason: 'triathlon page with no separately enterable swim' } : null),
  },
  {
    id: 'pool_only_page',
    evaluate: (_c, cl) => (cl.classification === 'pool_only' ? { points: -30, reason: 'pool-only event, not open water' } : null),
  },
];

export const ALL_RULES: ScoringRule[] = [...POSITIVE_RULES, ...NEGATIVE_RULES];
