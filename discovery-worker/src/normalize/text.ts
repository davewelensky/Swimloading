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
