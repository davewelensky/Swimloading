import { extractEventsWithAi, type AiModelPort, type AiUsage } from '../extract/ai.js';
import { pageYearFrom } from '../extract/table.js';
import { detectPageLanguage } from '../fetch/decode.js';
import type { TableEventRow } from '../extract/table.js';
import type { SourceContext } from './extract-pipeline.js';
import type { ProcessedPage } from './process-page.js';
import { AI_ORIGIN, buildFromRow } from './process-table-page.js';

// One unstructured page -> many candidates, via a model that only reads.
//
// The deliberate shape here: the model's output is coerced into exactly
// the TableEventRow the tabular parser produces, then handed to the same
// buildFromRow the tabular parser uses. So an AI-read row gets the
// weekday-verified year resolver, the subdivision-aware location parser,
// the multilingual distance parser, the same classifier and the same
// deterministic confidence arithmetic — none of which the model touches
// or can influence beyond the raw text it transcribed.
//
// The one thing that differs is provenance: AI_ORIGIN stamps
// extraction_method = 'ai_fallback' on the candidate and 'ai_fallback' on
// every evidence row, so `WHERE extraction_method = 'ai_fallback'` is
// always a complete and honest answer to "what did a model give us?".

export interface AiPageResult {
  pages: ProcessedPage[];
  rowsReturned: number;
  rowsUsable: number;
  usage: AiUsage | null;
  model: string | null;
  condensedChars: number;
  called: boolean;
  warnings: string[];
}

// Coordinates are deliberately absent: they are a fact a table can carry
// in a map link and a model must never supply, because a plausible-looking
// latitude is indistinguishable from a correct one and would put a swim in
// the wrong sea.
function toTableRow(row: {
  name: string | null;
  dateText: string | null;
  locationText: string | null;
  distanceText: string | null;
  timeText: string | null;
  url: string | null;
}): TableEventRow {
  return {
    dateText: row.dateText,
    name: row.name,
    locationText: row.locationText,
    distanceText: row.distanceText,
    timeText: row.timeText,
    url: row.url,
    latitude: null,
    longitude: null,
    rawCells: {
      ...(row.name ? { name: row.name } : {}),
      ...(row.dateText ? { date: row.dateText } : {}),
      ...(row.locationText ? { location: row.locationText } : {}),
      ...(row.distanceText ? { distance: row.distanceText } : {}),
      ...(row.timeText ? { time: row.timeText } : {}),
    },
  };
}

export async function processAiPage(
  sourceId: string,
  url: string,
  html: string,
  context: SourceContext,
  port: AiModelPort,
  maxRows = 200
): Promise<AiPageResult> {
  const extraction = await extractEventsWithAi(html, url, context.countryCode ?? null, port);
  const warnings = [...extraction.warnings];

  const empty: AiPageResult = {
    pages: [],
    rowsReturned: extraction.rowsReturned,
    rowsUsable: 0,
    usage: extraction.usage,
    model: extraction.model,
    condensedChars: extraction.condensedChars,
    called: extraction.usage !== null,
    warnings,
  };
  if (extraction.rows.length === 0) return empty;

  const pageYear = pageYearFrom(html);
  const pageLanguage = detectPageLanguage(html);
  const pages: ProcessedPage[] = [];
  const seenKeys = new Set<string>();

  for (const row of extraction.rows.slice(0, maxRows)) {
    const page = buildFromRow(sourceId, url, toTableRow(row), pageYear, pageLanguage, context, AI_ORIGIN);
    if (!page) continue;
    if (seenKeys.has(page.candidate.candidateKey)) continue;
    seenKeys.add(page.candidate.candidateKey);

    // Stated on every candidate, not just in the evidence rows, so it is
    // visible to a reviewer who is looking at the warnings column and
    // nothing else.
    page.candidate.warnings.push(
      'Read from an unstructured page by a language model, not from structured data — check the name, date and place against the source page before publishing'
    );
    if (extraction.truncated) {
      page.candidate.warnings.push('The source page was truncated to fit the AI input budget — it may list further events this run did not see');
    }
    page.candidate.rawSourceValues = {
      ...page.candidate.rawSourceValues,
      aiModel: extraction.model,
      aiCondensedChars: extraction.condensedChars,
      aiInputTruncated: extraction.truncated,
    };
    pages.push(page);
  }

  if (extraction.rows.length > maxRows) {
    warnings.push(`AI returned ${extraction.rows.length} rows; only the first ${maxRows} were processed this run`);
  }

  return {
    pages,
    rowsReturned: extraction.rowsReturned,
    rowsUsable: pages.length,
    usage: extraction.usage,
    model: extraction.model,
    condensedChars: extraction.condensedChars,
    called: extraction.usage !== null,
    warnings,
  };
}
