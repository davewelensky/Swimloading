import { extractTableEvents, type TableEventRow } from '../extract/table.js';
import { classifyEvent } from '../extract/classify.js';
import { blankCandidateEvent, type CandidateEvent } from '../domain/candidate-event.js';
import { buildCandidateKey } from '../domain/candidate-key.js';
import { evidence } from '../domain/evidence.js';
import { dayFirstForCountry, parseYearlessDate, parseFreeTextDate } from '../normalize/date.js';
import { parseDistanceToMetres, standardTriathlonSwimDistances } from '../normalize/distance.js';
import { parseLocationText } from '../normalize/location.js';
import { deriveCanonicalName, cleanText, rejectAsEventName } from '../normalize/text.js';
import { scoreCandidate } from '../confidence/score.js';
import { validateCandidateEvent } from '../domain/validation.js';
import { detectPageLanguage } from '../fetch/decode.js';
import type { EvidenceType, ExtractionMethod } from '../domain/enums.js';
import type { SourceContext } from './extract-pipeline.js';
import type { ProcessedPage } from './process-page.js';

// One tabular calendar page -> MANY candidates.
//
// The single-candidate pipeline assumes one event per page, which is
// right for an organiser's race page and useless for a season table.
// Ray's Notebook alone is 338 swims in one table, with coordinates and
// start times per row — better structured than most JSON-LD, just not in
// a shape the rest of the pipeline could see.
//
// Every candidate produced here shares the table's URL as its source_url,
// which is correct provenance. They stay distinct because candidate_key
// hashes (url | name | year), so different swims on one page never
// collide, and re-crawling the table updates each in place.

export interface TablePageResult {
  pages: ProcessedPage[];
  rowsFound: number;
  rowsUsable: number;
  warnings: string[];
}

function distancesFrom(row: TableEventRow) {
  if (!row.distanceText) return [];
  // "¼, ½, 1.2 mi; 5, 10 km" — split on separators, keep each option's own
  // wording, and let the shared parser handle units.
  return row.distanceText
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((label) => {
      // A bare "5" in "5, 10 km" needs the trailing unit to make sense.
      const unit = /\b(km|mi|m|miles?|metres?|meters?)\b/i.exec(row.distanceText!)?.[1] ?? '';
      const withUnit = /\d\s*(km|mi|m|miles?|metres?|meters?)/i.test(label) ? label : `${label} ${unit}`.trim();
      return {
        originalLabel: label,
        distanceMetres: parseDistanceToMetres(withUnit),
        category: null,
        startTime: row.timeText,
        registrationUrl: null,
        wetsuitPolicy: null,
        qualificationRequired: null,
      };
    })
    .filter((d) => d.originalLabel.length > 0);
}

// Where a row came from. Rows read out of a real <table> and rows a model
// transcribed off an unstructured page follow the SAME normalisation,
// classification and scoring path — that is the whole design — but they
// must never be indistinguishable afterwards, so the origin sets the
// candidate's extraction_method and the wording of every evidence row.
export interface RowOrigin {
  extractionMethod: ExtractionMethod;
  evidenceType: EvidenceType;
  // Human-readable provenance, e.g. 'table row' or 'AI-read page block'.
  label: string;
}

export const TABLE_ORIGIN: RowOrigin = {
  extractionMethod: 'html',
  evidenceType: 'html_selector',
  label: 'table row',
};

export const AI_ORIGIN: RowOrigin = {
  extractionMethod: 'ai_fallback',
  evidenceType: 'ai_fallback',
  label: 'AI-read page block',
};

export function buildFromRow(
  sourceId: string,
  sourceUrl: string,
  row: TableEventRow,
  pageYear: number | null,
  pageLanguage: string | null,
  context: SourceContext,
  origin: RowOrigin = TABLE_ORIGIN
): ProcessedPage | null {
  const name = deriveCanonicalName(row.name);
  if (!name) return null;
  // A wave, an age bracket or a numbered placeholder is not a swim. Dropped
  // here rather than scored low, because a low score still reaches the
  // review queue and — as Midmar proved — can still be auto-approved onto
  // the public page.
  const notAName = rejectAsEventName(row.name);
  if (notAName) return null;

  const candidate: CandidateEvent = blankCandidateEvent(sourceId, sourceUrl);
  candidate.originalName = row.name;
  candidate.canonicalName = name;
  candidate.evidence.push(evidence('originalName', origin.evidenceType, row.name, `${origin.label}, name`));

  // Dates: try the row text with a year first (some tables state one),
  // then fall back to the yearless resolver using the page's own year.
  const withYear = parseFreeTextDate(row.dateText, { dayFirst: dayFirstForCountry(context.countryCode) });
  const resolved = withYear.dateConfirmed ? withYear : parseYearlessDate(row.dateText, pageYear);
  candidate.startDate = resolved.startDate;
  candidate.endDate = resolved.endDate;
  candidate.datePrecision = resolved.datePrecision;
  candidate.dateConfirmed = resolved.dateConfirmed;
  candidate.warnings.push(...resolved.warnings);
  if (row.dateText) {
    candidate.evidence.push(evidence('startDate', origin.evidenceType, row.dateText, `${origin.label}, date`));
  }

  const location = parseLocationText(row.locationText);
  candidate.locationText = location.locationText ?? cleanText(row.locationText);
  candidate.city = location.city;
  candidate.region = location.region;
  candidate.countryCode = location.countryCode;
  candidate.warnings.push(...location.warnings);

  // A table row's location column IS its venue — "Clearwater, FL" is the
  // best name we have for where the swim happens. Without a venue_name
  // the approval path creates no event_venues row at all, so the city,
  // region, country and coordinates extracted above never reach the
  // published event and every listing renders as "location to be
  // confirmed". Prefer the city (a cleaner venue name) and fall back to
  // the whole location string.
  candidate.venueName = location.city ?? cleanText(row.locationText);
  if (row.locationText) {
    candidate.evidence.push(evidence('locationText', origin.evidenceType, row.locationText, `${origin.label}, location`));
  }

  // Coordinates from the row's own map data are a fact, not a geocode —
  // exactly the kind of evidence this pipeline is allowed to keep.
  if (row.latitude !== null && row.longitude !== null) {
    candidate.latitude = row.latitude;
    candidate.longitude = row.longitude;
    candidate.evidence.push(
      evidence('latitude', origin.evidenceType, `${row.latitude},${row.longitude}`, `${origin.label}, map link/coordinates`)
    );
  }

  candidate.distances = distancesFrom(row);
  if (row.distanceText) {
    candidate.evidence.push(evidence('distances', origin.evidenceType, row.distanceText, `${origin.label}, distance`));
  }

  if (row.url) {
    try {
      const abs = new URL(row.url, sourceUrl).toString();
      candidate.officialUrl = abs;
      candidate.registrationUrl = abs;
      candidate.evidence.push(evidence('officialUrl', origin.evidenceType, abs, `${origin.label}, event link`));
    } catch {
      /* unparseable href — leave the URLs null rather than store a broken one */
    }
  }

  candidate.extractionMethod = origin.extractionMethod;
  candidate.rawSourceValues = {
    // Named by origin rather than always "tableRow": an AI-read row never
    // came out of a <table>, and a rawSourceValues key that says it did
    // would mislead exactly the reviewer this trail exists to inform.
    [origin.extractionMethod === 'ai_fallback' ? 'aiRow' : 'tableRow']: row.rawCells,
    htmlDateText: row.dateText,
    pageYear,
    pageLanguage,
    extractedFromTable: origin.extractionMethod !== 'ai_fallback',
    extractedByAi: origin.extractionMethod === 'ai_fallback',
  };

  const classification = classifyEvent({
    categoryHint: null,
    waterBodyHint: null,
    hasSeparateSwimEntry: null,
    titleText: row.name,
    descriptionText: [row.locationText, row.distanceText].filter(Boolean).join(' '),
    urlPath: row.url,
    sourceType: context.sourceType ?? null,
  });

  candidate.discipline = classification.discipline;
  // A multisport row that printed no metres still states its swim leg if
  // it named a standard format. Only for multisport — on an open-water
  // listing "Sprint" is the organiser's own short swim, not 750 m.
  if (classification.discipline === 'multisport_swim_leg' && candidate.distances.length === 0) {
    const standard = standardTriathlonSwimDistances([row.name, row.distanceText].filter(Boolean).join(' '));
    candidate.distances = standard.map((d) => ({
      originalLabel: d.label,
      distanceMetres: d.metres,
      category: null,
      startTime: row.timeText,
      registrationUrl: null,
      wetsuitPolicy: null,
      qualificationRequired: null,
    }));
    if (standard.length > 0) {
      candidate.evidence.push(
        evidence('distances', origin.evidenceType, standard.map((d) => d.label).join(', '),
          `${origin.label}, standard triathlon format`,
          'Distance defined by the format name, not printed on the page')
      );
    }
  }
  if (classification.discipline === 'multisport_swim_leg') {
    candidate.warnings.push(...classification.warnings);
  }

  if (!candidate.countryCode && context.countryCode) {
    candidate.countryCode = context.countryCode;
    candidate.rawSourceValues = { ...candidate.rawSourceValues, countryFromSource: context.countryCode };
  }

  candidate.extractedAt = new Date().toISOString();
  candidate.candidateKey = buildCandidateKey({
    sourceUrl,
    name: candidate.canonicalName,
    startDate: candidate.startDate,
    dateConfirmed: candidate.dateConfirmed,
  });

  const confidence = scoreCandidate(candidate, classification);
  candidate.confidenceScore = confidence.totalScore;
  candidate.confidenceReasons = confidence.reasons;

  return {
    url: sourceUrl,
    pageLanguage,
    candidate,
    classification,
    confidence,
    validation: validateCandidateEvent(candidate),
  };
}

// Returns [] when the page is not a tabular calendar, so the caller can
// simply fall through to the normal single-candidate path.
export function processTablePage(
  sourceId: string,
  url: string,
  html: string,
  context: SourceContext = {},
  maxRows = 400
): TablePageResult {
  const { rows, pageYear, warnings } = extractTableEvents(html);
  if (rows.length === 0) return { pages: [], rowsFound: 0, rowsUsable: 0, warnings };

  const pageLanguage = detectPageLanguage(html);
  const pages: ProcessedPage[] = [];
  const seenKeys = new Set<string>();

  for (const row of rows.slice(0, maxRows)) {
    const page = buildFromRow(sourceId, url, row, pageYear, pageLanguage, context);
    if (!page) continue;
    // Two rows of one table can legitimately share a key (the same swim
    // listed twice). Keep the first; the DB upsert would collapse them
    // anyway, and writing both wastes a round trip.
    if (seenKeys.has(page.candidate.candidateKey)) continue;
    seenKeys.add(page.candidate.candidateKey);
    pages.push(page);
  }

  if (rows.length > maxRows) {
    warnings.push(`Table had ${rows.length} rows; only the first ${maxRows} were processed this run`);
  }
  return { pages, rowsFound: rows.length, rowsUsable: pages.length, warnings };
}
