import type { DatePrecision } from '../domain/enums.js';

export interface ParsedDate {
  startDate: string | null;
  endDate: string | null;
  datePrecision: DatePrecision;
  dateConfirmed: boolean;
  warnings: string[];
}

// Accent- and case-insensitive matching. NFKD plus combining-mark removal
// handles most of Europe; the handful of letters that do not decompose
// (ø, æ, ß, ł, đ) are mapped explicitly. Digits are untouched, so folding
// never disturbs the numbers a date is actually made of.
const LETTER_FOLDS: [RegExp, string][] = [
  [/ø/g, 'o'], [/æ/g, 'ae'], [/œ/g, 'oe'], [/ß/g, 'ss'], [/ł/g, 'l'], [/đ/g, 'd'], [/ð/g, 'd'], [/þ/g, 'th'],
];

export function foldForMatching(text: string): string {
  let out = text.toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '');
  for (const [re, to] of LETTER_FOLDS) out = out.replace(re, to);
  return out;
}

// Month names, by language, in calendar order. This is data on purpose:
// the crawler is multilingual by design, and an English-only table did
// real damage — "09 août 2026" matched no month, fell through to the
// year-only branch, and became 1 January 2026 marked CONFIRMED, with no
// warning. A fully-specified date silently read as a bare year.
//
// Alternative forms for one month are separated by '|'. Finnish is listed
// in both nominative and the genitive that dates actually use
// ("15. elokuuta"); Greek likewise.
const MONTHS_BY_LANGUAGE: Record<string, string[]> = {
  en: ['january|jan', 'february|feb', 'march|mar', 'april|apr', 'may', 'june|jun', 'july|jul', 'august|aug', 'september|sep|sept', 'october|oct', 'november|nov', 'december|dec'],
  fr: ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre|setiembre', 'octubre', 'noviembre', 'diciembre'],
  pt: ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
  de: ['januar|janner', 'februar', 'marz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'],
  it: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
  nl: ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'],
  da: ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'],
  no: ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'],
  sv: ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'],
  fi: ['tammikuu|tammikuuta', 'helmikuu|helmikuuta', 'maaliskuu|maaliskuuta', 'huhtikuu|huhtikuuta', 'toukokuu|toukokuuta', 'kesakuu|kesakuuta', 'heinakuu|heinakuuta', 'elokuu|elokuuta', 'syyskuu|syyskuuta', 'lokakuu|lokakuuta', 'marraskuu|marraskuuta', 'joulukuu|joulukuuta'],
  pl: ['styczen|stycznia', 'luty|lutego', 'marzec|marca', 'kwiecien|kwietnia', 'maj|maja', 'czerwiec|czerwca', 'lipiec|lipca', 'sierpien|sierpnia', 'wrzesien|wrzesnia', 'pazdziernik|pazdziernika', 'listopad|listopada', 'grudzien|grudnia'],
  hr: ['sijecanj|sijecnja', 'veljaca|veljace', 'ozujak|ozujka', 'travanj|travnja', 'svibanj|svibnja', 'lipanj|lipnja', 'srpanj|srpnja', 'kolovoz|kolovoza', 'rujan|rujna', 'listopad|listopada', 'studeni|studenog', 'prosinac|prosinca'],
  tr: ['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik'],
  el: ['ιανουαριος|ιανουαριου', 'φεβρουαριος|φεβρουαριου', 'μαρτιος|μαρτιου', 'απριλιος|απριλιου', 'μαιος|μαιου', 'ιουνιος|ιουνιου', 'ιουλιος|ιουλιου', 'αυγουστος|αυγουστου', 'σεπτεμβριος|σεπτεμβριου', 'οκτωβριος|οκτωβριου', 'νοεμβριος|νοεμβριου', 'δεκεμβριος|δεκεμβριου'],
};

// Weekday names, same treatment. These matter more than they look: the
// weekday is what turns a yearless "14 Feb" into a CHECKABLE claim rather
// than a guess (see parseYearlessDate). Without the local word, a foreign
// calendar row can only ever be unconfirmed.
const WEEKDAYS_BY_LANGUAGE: Record<string, string[]> = {
  en: ['sunday|sun', 'monday|mon', 'tuesday|tue|tues', 'wednesday|wed', 'thursday|thu|thur|thurs', 'friday|fri', 'saturday|sat'],
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  es: ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'],
  pt: ['domingo', 'segunda-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sabado'],
  de: ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag|sonnabend'],
  it: ['domenica', 'lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato'],
  nl: ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'],
  da: ['sondag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lordag'],
  no: ['sondag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lordag'],
  sv: ['sondag', 'mandag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lordag'],
  fi: ['sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai'],
  pl: ['niedziela', 'poniedzialek', 'wtorek', 'sroda', 'czwartek', 'piatek', 'sobota'],
  hr: ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'cetvrtak', 'petak', 'subota'],
  tr: ['pazar', 'pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi'],
};

// Collisions are resolved by REFUSING, never by guessing.
//
// "listopad" is November in Polish and October in Croatian — and both are
// live sources. Publishing a swim a month out because two languages spell
// a month the same way is exactly the class of error this pipeline exists
// to avoid, so any token two languages disagree about is dropped from the
// lookup and recorded as ambiguous. A date using one is then left
// unconfirmed with a warning naming the problem, which a reviewer can act
// on; a silently wrong month is not.
function buildLookup(byLanguage: Record<string, string[]>, offset: number): {
  names: Record<string, number>;
  ambiguous: Set<string>;
} {
  const claims = new Map<string, Set<number>>();
  for (const words of Object.values(byLanguage)) {
    words.forEach((word, index) => {
      for (const token of word.split('|')) {
        const key = foldForMatching(token);
        if (!key) continue;
        const set = claims.get(key) ?? new Set<number>();
        set.add(index + offset);
        claims.set(key, set);
      }
    });
  }
  const names: Record<string, number> = {};
  const ambiguous = new Set<string>();
  for (const [key, values] of claims) {
    const only = [...values];
    if (only.length === 1 && only[0] !== undefined) names[key] = only[0];
    else ambiguous.add(key);
  }
  return { names, ambiguous };
}

function toPattern(keys: Iterable<string>): string {
  return [...keys]
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
}

const MONTH_LOOKUP = buildLookup(MONTHS_BY_LANGUAGE, 1);
const MONTH_NAMES = MONTH_LOOKUP.names;
const AMBIGUOUS_MONTHS = MONTH_LOOKUP.ambiguous;
const MONTH_PATTERN = toPattern(Object.keys(MONTH_NAMES));
const AMBIGUOUS_MONTH_PATTERN = toPattern(AMBIGUOUS_MONTHS);

// Exported for the test suite, which asserts that the known collision
// ("listopad") is actually caught rather than trusting it silently.
export const AMBIGUOUS_MONTH_TOKENS: ReadonlySet<string> = AMBIGUOUS_MONTHS;

// A month name two languages disagree about, present in this text.
function ambiguousMonthIn(folded: string): string | null {
  if (AMBIGUOUS_MONTHS.size === 0) return null;
  const m = new RegExp(`\\b(${AMBIGUOUS_MONTH_PATTERN})\\b`, 'i').exec(folded);
  return m?.[1] ?? null;
}

// East Asian dates are numeric, not named: "8月15日". Handled separately
// because there is no month WORD to look up.
const CJK_MONTH_DAY = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/;
const CJK_YEAR = /(\d{4})\s*年/;

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
  // Match against the folded form so "août", "März" and "Οκτωβρίου" are
  // read; quote the ORIGINAL in every warning, because that is what a
  // reviewer will be looking at on the source page.
  const folded = foldForMatching(cleaned);

  // East Asian numeric dates have no month word to look up.
  const cjk = CJK_MONTH_DAY.exec(cleaned);
  if (cjk?.[1] && cjk[2]) {
    const month = Number(cjk[1]);
    const day = Number(cjk[2]);
    const yearMatch = CJK_YEAR.exec(cleaned) ?? /\b(20\d{2})\b/.exec(cleaned);
    if (month >= 1 && month <= 12 && yearMatch?.[1]) {
      const year = Number(yearMatch[1]);
      if (day >= 1 && day <= daysInMonth(year, month)) {
        return { startDate: isoDate(year, month, day), endDate: null, datePrecision: 'exact', dateConfirmed: true, warnings: [] };
      }
    }
  }

  const rangeRe = new RegExp(`\\b(\\d{1,2})\\s*(?:-|–|to)\\s*(\\d{1,2})\\s+(${MONTH_PATTERN})\\s+(\\d{4})\\b`, 'i');
  const rangeMatch = rangeRe.exec(folded);
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

  const exactRe = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|\\.)?\\s+(${MONTH_PATTERN})\\s+(\\d{4})\\b`, 'i');
  const exactMatch = exactRe.exec(folded);
  if (exactMatch && exactMatch[1] && exactMatch[2] && exactMatch[3]) {
    const month = MONTH_NAMES[exactMatch[2].toLowerCase()];
    const year = Number(exactMatch[3]);
    if (month) {
      return { startDate: isoDate(year, month, Number(exactMatch[1])), endDate: null, datePrecision: 'exact', dateConfirmed: true, warnings: [] };
    }
  }

  const monthYearRe = new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{4})\\b`, 'i');
  const monthYearMatch = monthYearRe.exec(folded);
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

  const noYearRe = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|\\.)?\\s+(${MONTH_PATTERN})\\b`, 'i');
  if (noYearRe.test(folded)) {
    return unknownDate([`Date text has no year — left unconfirmed rather than guessed: "${cleaned}"`]);
  }

  const ambiguous = ambiguousMonthIn(folded);
  if (ambiguous) {
    return unknownDate([
      `Month name "${ambiguous}" means different months in different languages ` +
        `(e.g. listopad is November in Polish and October in Croatian) — left unparsed rather than guessed: "${cleaned}"`,
    ]);
  }

  const yearOnlyRe = /\b(\d{4})\b/;
  const yearOnlyMatch = yearOnlyRe.exec(folded);
  if (yearOnlyMatch && yearOnlyMatch[1]) {
    const year = Number(yearOnlyMatch[1]);
    // A year is all we could read. If the text also contains a day-sized
    // number, a fuller date was almost certainly printed and we failed to
    // parse it — say so. Returning a clean-looking year-precision date for
    // "09 août 2026" is how a swim ends up published on 1 January.
    const looksFuller = /\b\d{1,2}\b/.test(cleaned.replace(String(year), ' '));
    return {
      startDate: isoDate(year, 1, 1),
      endDate: isoDate(year, 12, 31),
      datePrecision: 'year',
      dateConfirmed: true,
      warnings: looksFuller
        ? [`Only the year ${year} could be read from "${cleaned}", which appears to state a fuller date — the month and day were not recognised`]
        : [],
    };
  }

  return unknownDate([`Could not parse any date from text: "${cleaned}"`]);
}

const WEEKDAY_LOOKUP = buildLookup(WEEKDAYS_BY_LANGUAGE, 0);
const WEEKDAY_NAMES = WEEKDAY_LOOKUP.names;
const WEEKDAY_PATTERN = toPattern(Object.keys(WEEKDAY_NAMES));

// Parses a yearless calendar-row date such as "Feb 14, Sat", "14 Feb Sat"
// or "Feb 14", against a year taken from the page's own context (a
// schedule headed "Open Water Swims 2026", say).
//
// The weekday is what makes this honest rather than a guess. "Feb 14" plus
// a year hint is an assumption; "Feb 14, Sat" plus that year is a
// CHECKABLE claim — 14 Feb falls on a Saturday in exactly one year of any
// nearby span. So:
//   * weekday present and it matches the hinted year  -> confirmed
//   * weekday present and it matches a NEIGHBOURING year (a schedule
//     spilling past New Year) -> confirmed on that year instead
//   * weekday present and it matches nothing nearby   -> left unconfirmed
//   * no weekday at all -> date returned but NOT confirmed, because a
//     bare year hint is inference, and this pipeline does not publish
//     inferred dates as fact
export function parseYearlessDate(text: string | null, yearHint: number | null): ParsedDate {
  if (!text || !text.trim()) return unknownDate();
  const cleaned = text.trim();
  const folded = foldForMatching(cleaned);

  // "Feb 14" (month first) or "14 Feb" (day first).
  const monthFirst = new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})\\b`, 'i').exec(folded);
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|\\.)?\\s+(${MONTH_PATTERN})\\b`, 'i').exec(folded);

  let month: number | undefined;
  let day: number | undefined;
  if (monthFirst?.[1] && monthFirst[2]) {
    month = MONTH_NAMES[monthFirst[1].toLowerCase()];
    day = Number(monthFirst[2]);
  } else if (dayFirst?.[1] && dayFirst[2]) {
    day = Number(dayFirst[1]);
    month = MONTH_NAMES[dayFirst[2].toLowerCase()];
  }
  if (!month || !day || day < 1 || day > daysInMonth(2024, month)) {
    const ambiguous = ambiguousMonthIn(folded);
    return unknownDate([
      ambiguous
        ? `Month name "${ambiguous}" means different months in different languages — left unparsed rather than guessed: "${cleaned}"`
        : `Could not parse a day and month from "${cleaned}"`,
    ]);
  }

  const weekdayMatch = new RegExp(`\\b(${WEEKDAY_PATTERN})\\b`, 'i').exec(folded);
  const weekday = weekdayMatch?.[1] ? WEEKDAY_NAMES[weekdayMatch[1].toLowerCase()] : undefined;

  if (yearHint === null) {
    return unknownDate([`Date "${cleaned}" has no year and the page gave no year context`]);
  }

  if (weekday === undefined) {
    // Usable, but not something we will call confirmed.
    return {
      startDate: isoDate(yearHint, month, day),
      endDate: null,
      datePrecision: 'exact',
      dateConfirmed: false,
      warnings: [`Year ${yearHint} assumed from page context for "${cleaned}"; no weekday to verify it against`],
    };
  }

  // Check the hinted year first, then its neighbours — a season schedule
  // published in one year routinely runs into the next.
  for (const year of [yearHint, yearHint + 1, yearHint - 1]) {
    if (day > daysInMonth(year, month)) continue; // 29 Feb in a non-leap year
    const actual = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (actual === weekday) {
      return {
        startDate: isoDate(year, month, day),
        endDate: null,
        datePrecision: 'exact',
        dateConfirmed: true,
        warnings:
          year === yearHint
            ? []
            : [`Year resolved to ${year} rather than the page's ${yearHint}: only ${year} puts ${cleaned} on the stated weekday`],
      };
    }
  }

  return unknownDate([
    `"${cleaned}" does not fall on the stated weekday in ${yearHint - 1}, ${yearHint} or ${yearHint + 1} — left unconfirmed rather than guessed`,
  ]);
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
