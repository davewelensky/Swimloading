// Small, dependency-free text helpers shared by the normalisation layer.
// Nothing here invents content — only whitespace/entity cleanup and
// truncation of text that was already extracted verbatim.

export function cleanText(text: string | null): string | null {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function truncateSummary(text: string | null, maxLength = 280): string | null {
  const cleaned = cleanText(text);
  if (!cleaned) return null;
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
}

// The canonical name starts as the cleaned original name. Later phases
// (aggregator-source normalisation, brand-suffix stripping) belong to the
// dedupe-aware name normaliser in dedupe/normalize-name.ts, not here —
// this stays a plain, literal cleanup of what was actually found.
// Listing sites put their own furniture in the page <title>, and when that
// title becomes the event name it also becomes the SLUG — a permanent URL.
// Two real examples from 2026-08-05, both of which shipped:
//   "Lorne Pier to Pub – Ocean Swim in Lorne VIC | oceanswims.com"
//   "Swimjunkie Challenge: CARAMOAN 2026 Year10 - Pili, Camarines Sur October 04, 2026"
// giving slugs like ...-pili-camarines-sur-october-04-2026-2026.
//
// Every rule below is ANCHORED TO THE END and specific in shape. Precision
// over recall, the same standard rejectAsEventName() is held to: over-
// trimming silently renames a real swim, and a wrong name is harder to
// notice than a verbose one.
const TITLE_SUFFIX_RULES: { re: RegExp; why: string }[] = [
  // " | oceanswims.com" — a site suffix, identified by the dot. Requiring a
  // dot is what stops this eating "Swim | The Big One".
  { re: /\s*[|·]\s*[\w-]+\.[a-z]{2,}\s*$/i, why: 'site domain suffix' },
  // " – Ocean Swim in Lorne VIC" / " - Open Water Swim in X" — an SEO
  // descriptor, always "<something> Swim in <place>" at the very end.
  { re: /\s*[–—-]\s*(?:ocean|open water|sea|lake|river)\s+swim\s+in\s+.+$/i, why: 'SEO descriptor' },
  // A full date at the end: "October 04, 2026", "October 09 - 11, 2026",
  // "4 October 2026". Requires MONTH NAME + DAY + YEAR together, so a bare
  // trailing year survives — "Woda Bydgoska 2026" keeps its year, which is
  // part of the name.
  { re: /\s*[–—-]?\s*(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:\s*[–—-]\s*\d{1,2})?,?\s+\d{4}\s*$/i, why: 'trailing date' },
  { re: /\s*[–—-]?\s*\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\s*$/i, why: 'trailing date' },
  // " - Pili, Camarines Sur" / " - Miami, FL" — a trailing "City, Region".
  // Requires the comma AND a leading dash, so "Bosphorus Cross-Continental
  // Swim" is untouched (no comma) and "Baltimore Wet Weekend" is untouched
  // (no dash-comma tail).
  { re: /\s+[–—-]\s+[\p{L}'.\s]{2,40},\s*[\p{L}\s]{2,40}\s*$/u, why: 'trailing city, region' },
];

export function deriveCanonicalName(originalName: string | null): string | null {
  let name = cleanText(originalName);
  if (!name) return name;

  // Applied repeatedly: active.com stacks a location AND a date, and each
  // rule only strips its own shape.
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const { re } of TITLE_SUFFIX_RULES) {
      const stripped = name.replace(re, '').trim();
      // NEVER strip down to nothing or near-nothing. If a rule would eat
      // most of the name, the name was probably not what the rule assumed,
      // and a verbose title beats a mangled one.
      if (stripped && stripped !== name && stripped.length >= 4) {
        name = stripped;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return cleanText(name);
}

// A name that is not a name.
//
// The Midmar Mile publishes its start-wave schedule on one page, and the
// AI extractor faithfully transcribed each wave as an event: "Disabled,
// Pope-Ellis and 71yr/over", "Boys 13 Years and Under & Men 31 Years and
// Older", "Event 1", "EVENT 3 – RACE/ENTRY INFORMATION". Five of them
// reached the live catalogue before anyone noticed, and one of those is a
// disability category presented to the public as a swim you can enter.
//
// The prompt now says a wave is not an event. This is the part that does
// not depend on a model agreeing: three high-precision classes, each of
// which a genuine open-water race is essentially never called.
const NOT_A_NAME: { test: RegExp; why: string }[] = [
  {
    // "Event 1", "Race 3", "Wave 2", "Heat 4" — a position in a schedule,
    // not what anyone calls the swim.
    test: /^(?:event|race|wave|heat|group|start|leg)\s*[-–—:.]?\s*\d*$/i,
    why: 'a numbered placeholder rather than the name of a swim',
  },
  {
    // Page furniture that happened to sit in a heading.
    test: /\b(?:race\s*\/\s*entry|entry|event)\s+information\b/i,
    why: 'a page section heading rather than the name of a swim',
  },
  {
    // Age brackets and start categories. No open-water race is called
    // "71yr/over" — that is who starts in that wave, not what it is.
    test: new RegExp(
      [
        // "71 yr and over", "13 Years and Under"
        '\\b\\d+\\s*(?:yr|years?)\\b.*\\b(?:and\\s+)?(?:over|older|under)\\b',
        // "71yr/over"
        '\\byrs?\\s*\\/\\s*over\\b',
        '\\byears?\\s+and\\s+(?:older|under)\\b',
        // "14 Years to 30 Years" — a bracket expressed as a range rather
        // than an over/under, which the first pattern misses entirely.
        '\\b\\d+\\s*(?:yr|years?)\\s+to\\s+\\d+\\s*(?:yr|years?)\\b',
        // "9-10 years", "11–12 yrs" — the same bracket written with a
        // hyphen, which is how a junior entry table usually prints it.
        // Anchored, because "Swim 5-10 Years On" would be a real name.
        '^\\d{1,2}\\s*[-–—]\\s*\\d{1,2}\\s*(?:yr|yrs|years?)$',
      ].join('|'),
      'i'
    ),
    why: 'an age category, which describes who starts in a wave rather than a swim',
  },
  {
    // A bare distance: "10K", "2.5K", "1 Mile", "1500m". The whole name is
    // the length of the swim, so it is one of the ways to enter something
    // — rule 4's distanceText — not a thing with a name. Anchored to the
    // entire string, because every real race that states a distance also
    // says what it is: "Swim Serpentine 10K", "Midmar Mile".
    test: /^\d+(?:[.,]\d+)?\s*(?:k|km|m|mi|mile|miles|metres|meters|yd|yards?)$/i,
    why: 'a distance rather than the name of a swim',
  },
  {
    // Standard race formats and entry tiers, whole-string only. A multisport
    // festival sells "Sprint", "Olympic", "Middle" and "Half Marathon" as
    // the ways in; none of them is what anyone calls the race. Anchoring is
    // doing all the work here — "Bosphorus Cross-Continental Marathon" and
    // "Capri-Napoli Marathon" are real swims and must survive, and they do,
    // because the format word is never the entire name of a real event.
    test: /^(?:(?:super|ultra)\s+)?(?:sprint|olympic|standard|middle|long|short|full)(?:\s+(?:plus|distance))?$|^(?:half\s+)?marathon$|^(?:starter|novice|beginner|intermediate|advanced|elite)$/i,
    why: 'a race format or entry tier rather than the name of a swim',
  },
  {
    // Entry classifications: "Company Teams", "Non-Company Teams",
    // "Corporate Teams". Who you enter AS, not what you enter. Anchored to
    // the whole string on purpose — a real race called "Team Relay Swim"
    // or "Cape Town Corporate Challenge" must survive.
    test: /^(?:non[-\s]?)?(?:company|corporate|club|school|social)\s+teams?$/i,
    why: 'an entry classification rather than a swim',
  },
];

export function rejectAsEventName(name: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  for (const rule of NOT_A_NAME) {
    if (rule.test.test(trimmed)) return rule.why;
  }
  return null;
}
