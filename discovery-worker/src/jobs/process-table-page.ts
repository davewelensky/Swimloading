import { extractTableEvents, type TableEventRow } from '../extract/table.js';
import { classifyEvent } from '../extract/classify.js';
import { blankCandidateEvent, type CandidateEvent } from '../domain/candidate-event.js';
import { buildCandidateKey } from '../domain/candidate-key.js';
import { evidence } from '../domain/evidence.js';
import { parseYearlessDate, parseFreeTextDate } from '../normalize/date.js';
import { parseDistanceToMetres } from '../normalize/distance.js';
import { parseLocationText } from '../normalize/location.js';
import { deriveCanonicalName, cleanText } from '../normalize/text.js';
import { scoreCandidate } from '../confidence/score.js';
import { validateCandidateEvent } from '../domain/validation.js';
import { detectPageLanguage } from '../fetch/decode.js';
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

function buildFromRow(
  sourceId: string,
  sourceUrl: string,
  row: TableEventRow,
  pageYear: number | null,
  pageLanguage: string | null,
  context: SourceContext
): ProcessedPage | null {
  const name = deriveCanonicalName(row.name);
  if (!name) return null;

  const candidate: CandidateEvent = blankCandidateEvent(sourceId, sourceUrl);
  candidate.originalName = row.name;
  candidate.canonicalName = name;
  candidate.evidence.push(evidence('originalName', 'html_selector', row.name, 'table row, name column'));

  // Dates: try the row text with a year first (some tables state one),
  // then fall back to the yearless resolver using the page's own year.
  const withYear = parseFreeTextDate(row.dateText);
  const resolved = withYear.dateConfirmed ? withYear : parseYearlessDate(row.dateText, pageYear);
  candidate.startDate = resolved.startDate;
  candidate.endDate = resolved.endDate;
  candidate.datePrecision = resolved.datePrecision;
  candidate.dateConfirmed = resolved.dateConfirmed;
  candidate.warnings.push(...resolved.warnings);
  if (row.dateText) {
    candidate.evidence.push(evidence('startDate', 'html_selector', row.dateText, 'table row, date column'));
  }

  const location = parseLocationText(row.locationText);
  candidate.locationText = location.locationText ?? cleanText(row.locationText);
  candidate.city = location.city;
  candidate.region = location.region;
  candidate.countryCode = location.countryCode;
  candidate.warnings.push(...location.warnings);
  if (row.locationText) {
    candidate.evidence.push(evidence('locationText', 'html_selector', row.locationText, 'table row, location column'));
  }

  // Coordinates from the row's own map data are a fact, not a geocode —
  // exactly the kind of evidence this pipeline is allowed to keep.
  if (row.latitude !== null && row.longitude !== null) {
    candidate.latitude = row.latitude;
    candidate.longitude = row.longitude;
    candidate.evidence.push(
      evidence('latitude', 'html_selector', `${row.latitude},${row.longitude}`, 'table row, map link/coordinates')
    );
  }

  candidate.distances = distancesFrom(row);
  if (row.distanceText) {
    candidate.evidence.push(evidence('distances', 'html_selector', row.distanceText, 'table row, distance column'));
  }

  if (row.url) {
    try {
      const abs = new URL(row.url, sourceUrl).toString();
      candidate.officialUrl = abs;
      candidate.registrationUrl = abs;
      candidate.evidence.push(evidence('officialUrl', 'html_selector', abs, 'table row, event link'));
    } catch {
      /* unparseable href — leave the URLs null rather than store a broken one */
    }
  }

  candidate.extractionMethod = 'html';
  candidate.rawSourceValues = {
    tableRow: row.rawCells,
    htmlDateText: row.dateText,
    pageYear,
    pageLanguage,
    extractedFromTable: true,
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
