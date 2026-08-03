import { createHash } from 'node:crypto';

// The stable per-source identity of one discovered event. Paired with
// source_id it forms `UNIQUE (source_id, candidate_key)` in
// discovery_candidate_events, which is what makes worker writes an
// idempotent upsert instead of a duplicate-generator.
//
// ── What goes into the key, and why ──────────────────────────────────
// Three inputs: the source page URL, the event name, and the edition YEAR.
//
// The year is the interesting choice. Two failure modes pull in opposite
// directions:
//
//   * Key on the FULL date  → an organiser correcting "12 June" to
//     "13 June" produces a brand-new candidate, and the old one lingers
//     as a phantom. Change monitoring breaks.
//   * Key on NO date        → an annual race published at a stable URL
//     collides with itself every year: the 2028 listing overwrites the
//     2027 candidate. Historical editions are destroyed.
//
// Year-granularity is the point that avoids both: a date correction
// within a year updates the same candidate (correct), while next year's
// running gets its own candidate (also correct).
//
// Deliberately NOT included: confidence score, classification, distances,
// warnings, coordinates. All of those legitimately change between
// extractions of the same event, and none of them changes its identity.

export interface CandidateKeyInput {
  sourceUrl: string;
  name: string | null;
  startDate: string | null;
  dateConfirmed: boolean;
}

// Light, faithful normalisation — NOT the fuzzy normaliser used by
// dedupe/normalize-name.ts. That one strips stopwords on purpose so
// near-miss names match; doing the same here would let two genuinely
// different events on one page ("The Sprint" vs "Sprint") share a key and
// silently overwrite each other. A key wants stability, not fuzziness.
//
// Unicode-aware on purpose: sources span every script (Turkish, Italian,
// Spanish, Greek, Thai…). The old ASCII-only rule collapsed a fully
// non-Latin name to '' — every such event on one page would share a key
// and overwrite each other. Diacritics are folded (NFKD, strip combining
// marks) so "Gijón" and "Gijon" key identically; for pure-ASCII input the
// output is byte-for-byte what the old rule produced, so existing keys of
// ASCII-named candidates are unchanged.
export function normaliseForKey(value: string | null): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Strips the noise that does not change which page this is, so the same
// page reached via a tracking parameter or a trailing slash keys the same.
export function normaliseUrlForKey(url: string): string {
  const trimmed = url.trim().toLowerCase();
  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    parsed.search = '';
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.host}${path}`;
  } catch {
    // Not a parseable URL (fixture pseudo-URLs, relative paths) — fall
    // back to the raw trimmed string rather than throwing.
    return trimmed.replace(/[#?].*$/, '').replace(/\/+$/, '');
  }
}

// The edition year, or null when the date was never confirmed. Never
// guessed: an unconfirmed date contributes 'unknown-year', matching the
// worker's anti-inference rule everywhere else.
export function editionYearForKey(startDate: string | null, dateConfirmed: boolean): number | null {
  if (!dateConfirmed || !startDate) return null;
  const year = Number(startDate.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

export function buildCandidateKey(input: CandidateKeyInput): string {
  const year = editionYearForKey(input.startDate, input.dateConfirmed);
  const parts = [
    normaliseUrlForKey(input.sourceUrl),
    normaliseForKey(input.name),
    year === null ? 'unknown-year' : String(year),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}
