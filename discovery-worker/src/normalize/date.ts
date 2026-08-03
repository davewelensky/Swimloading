import type { DatePrecision } from '../domain/enums.js';

export interface ParsedDate {
  startDate: string | null;
  endDate: string | null;
  datePrecision: DatePrecision;
  dateConfirmed: boolean;
  warnings: string[];
}

const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

const MONTH_PATTERN = Object.keys(MONTH_NAMES)
  .sort((a, b) => b.length - a.length)
  .join('|');

function unknownDate(warnings: string[] = []): ParsedDate {
  return { startDate: null, endDate: null, datePrecision: 'unknown', dateConfirmed: false, warnings };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Parses a schema.org-style ISO date string ("2026-09-12" or
// "2026-09-12T09:00:00+01:00"). Returns null (not a thrown error) if it
// doesn't match, so callers can fall back to free-text parsing.
export function parseIsoDateString(value: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

// Structured dates (from JSON-LD startDate/endDate) are trusted at face
// value — they're already machine-formatted by the publisher, so there is
// no "missing year" case to guard here (a malformed value is a parse
// failure, not a missing-year ambiguity).
export function parseStructuredDates(startDateRaw: string | null, endDateRaw: string | null): ParsedDate {
  const warnings: string[] = [];
  if (!startDateRaw) return unknownDate(warnings);

  const start = parseIsoDateString(startDateRaw);
  if (!start) {
    warnings.push(`Could not parse structured startDate: "${startDateRaw}"`);
    return unknownDate(warnings);
  }

  const end = endDateRaw ? parseIsoDateString(endDateRaw) : null;
  if (endDateRaw && !end) warnings.push(`Could not parse structured endDate: "${endDateRaw}"`);

  const startIso = isoDate(start.year, start.month, start.day);
  const endIso = end ? isoDate(end.year, end.month, end.day) : null;

  if (endIso && endIso !== startIso) {
    return { startDate: startIso, endDate: endIso, datePrecision: 'range', dateConfirmed: true, warnings };
  }
  return { startDate: startIso, endDate: null, datePrecision: 'exact', dateConfirmed: true, warnings };
}

// Free-text date parsing straight from visible HTML. The one rule that
// overrides everything else: NEVER infer a missing year. A day+month with
// no year anywhere in the text stays unconfirmed with null dates — it is
// never resolved to "the next occurrence" of that day, which would risk
// silently turning a past event's page into a fabricated future one.
export function parseFreeTextDate(text: string | null): ParsedDate {
  if (!text || !text.trim()) return unknownDate();
  const cleaned = text.trim();

  const rangeRe = new RegExp(`\\b(\\d{1,2})\\s*(?:-|–|to)\\s*(\\d{1,2})\\s+(${MONTH_PATTERN})\\s+(\\d{4})\\b`, 'i');
  const rangeMatch = rangeRe.exec(cleaned);
  if (rangeMatch && rangeMatch[1] && rangeMatch[2] && rangeMatch[3] && rangeMatch[4]) {
    const month = MONTH_NAMES[rangeMatch[3].toLowerCase()];
    const year = Number(rangeMatch[4]);
    if (month) {
      return {
        startDate: isoDate(year, month, Number(rangeMatch[1])),
        endDate: isoDate(year, month, Number(rangeMatch[2])),
        datePrecision: 'range',
        dateConfirmed: true,
        warnings: [],
      };
    }
  }

  const exactRe = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\s+(\\d{4})\\b`, 'i');
  const exactMatch = exactRe.exec(cleaned);
  if (exactMatch && exactMatch[1] && exactMatch[2] && exactMatch[3]) {
    const month = MONTH_NAMES[exactMatch[2].toLowerCase()];
    const year = Number(exactMatch[3]);
    if (month) {
      return { startDate: isoDate(year, month, Number(exactMatch[1])), endDate: null, datePrecision: 'exact', dateConfirmed: true, warnings: [] };
    }
  }

  const monthYearRe = new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{4})\\b`, 'i');
  const monthYearMatch = monthYearRe.exec(cleaned);
  if (monthYearMatch && monthYearMatch[1] && monthYearMatch[2]) {
    const month = MONTH_NAMES[monthYearMatch[1].toLowerCase()];
    const year = Number(monthYearMatch[2]);
    if (month) {
      return {
        startDate: isoDate(year, month, 1),
        endDate: isoDate(year, month, daysInMonth(year, month)),
        datePrecision: 'month',
        dateConfirmed: true,
        warnings: [],
      };
    }
  }

  const noYearRe = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\b`, 'i');
  if (noYearRe.test(cleaned)) {
    return unknownDate([`Date text has no year — left unconfirmed rather than guessed: "${cleaned}"`]);
  }

  const yearOnlyRe = /\b(\d{4})\b/;
  const yearOnlyMatch = yearOnlyRe.exec(cleaned);
  if (yearOnlyMatch && yearOnlyMatch[1]) {
    const year = Number(yearOnlyMatch[1]);
    return {
      startDate: isoDate(year, 1, 1),
      endDate: isoDate(year, 12, 31),
      datePrecision: 'year',
      dateConfirmed: true,
      warnings: [],
    };
  }

  return unknownDate([`Could not parse any date from text: "${cleaned}"`]);
}

// Reconciles a structured (JSON-LD) date with a free-text (HTML) date.
// Structured data is trusted first; if both are confirmed but disagree,
// the result is explicitly marked unconfirmed with a conflict warning
// rather than silently preferring one source.
export function reconcileDates(structured: ParsedDate, freeText: ParsedDate): ParsedDate {
  const warnings = [...structured.warnings, ...freeText.warnings];

  if (structured.dateConfirmed && freeText.dateConfirmed) {
    if (structured.startDate !== freeText.startDate) {
      return {
        ...structured,
        dateConfirmed: false,
        warnings: [
          ...warnings,
          `Conflicting dates found: structured data says ${structured.startDate}, page text implies ${freeText.startDate}`,
        ],
      };
    }
    return { ...structured, warnings };
  }
  if (structured.dateConfirmed) return { ...structured, warnings };
  if (freeText.dateConfirmed) return { ...freeText, warnings };
  return unknownDate(warnings);
}
