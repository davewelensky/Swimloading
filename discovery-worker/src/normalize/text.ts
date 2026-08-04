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
export function deriveCanonicalName(originalName: string | null): string | null {
  return cleanText(originalName);
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
      ].join('|'),
      'i'
    ),
    why: 'an age category, which describes who starts in a wave rather than a swim',
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
