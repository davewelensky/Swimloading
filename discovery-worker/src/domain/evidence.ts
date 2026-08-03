import type { EvidenceType } from './enums.js';

// One evidence row per fact extracted, tying a candidate field back to
// exactly where it came from. Mirrors the provenance shape already used
// elsewhere in the SwimLoading schema for crossing_evidence — a field,
// where it was found, and the raw text, never the final normalised value
// (that lives on the candidate itself).
export interface EvidenceItem {
  field: string;
  evidenceType: EvidenceType;
  rawValue: string | null;
  selector: string | null;
  note: string | null;
}

export function evidence(
  field: string,
  evidenceType: EvidenceType,
  rawValue: string | null,
  selector: string | null = null,
  note: string | null = null
): EvidenceItem {
  return { field, evidenceType, rawValue, selector, note };
}
