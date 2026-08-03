import type { CandidateEvent } from '../domain/candidate-event.js';
import { jaccardSimilarity, nameTokens } from './normalize-name.js';

export interface DuplicateMatchResult {
  score: number;
  matchingSignals: string[];
  conflictingSignals: string[];
  possibleDuplicate: boolean;
}

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// ISO 'YYYY-MM-DD' strings compare correctly with plain string comparison
// (fixed-width, zero-padded) — no Date parsing needed for the overlap check.
function datesOverlap(a: CandidateEvent, b: CandidateEvent): boolean {
  if (!a.startDate || !b.startDate) return false;
  const aEnd = a.endDate ?? a.startDate;
  const bEnd = b.endDate ?? b.startDate;
  return a.startDate <= bEnd && b.startDate <= aEnd;
}

// This never merges records — it only scores how likely two candidates
// are to represent the same real-world event, for a human reviewer to
// decide. A hard signal conflict (different country) vetoes
// possibleDuplicate outright, regardless of how similar the names look.
export function computeDuplicateScore(a: CandidateEvent, b: CandidateEvent): DuplicateMatchResult {
  let score = 0;
  const matchingSignals: string[] = [];
  const conflictingSignals: string[] = [];

  const nameSimilarity = jaccardSimilarity(nameTokens(a.canonicalName), nameTokens(b.canonicalName));
  if (nameSimilarity > 0) {
    score += Math.round(nameSimilarity * 35);
    if (nameSimilarity >= 0.4) matchingSignals.push(`name similarity ${(nameSimilarity * 100).toFixed(0)}%`);
  }

  if (a.startDate && b.startDate) {
    if (datesOverlap(a, b)) {
      score += 25;
      matchingSignals.push(`dates overlap (${a.startDate} vs ${b.startDate})`);
    } else {
      conflictingSignals.push(`dates do not overlap (${a.startDate} vs ${b.startDate})`);
    }
  }

  if (a.organiserName && b.organiserName) {
    const organiserSimilarity = jaccardSimilarity(nameTokens(a.organiserName), nameTokens(b.organiserName));
    if (organiserSimilarity >= 0.5) {
      score += 15;
      matchingSignals.push('organiser matches');
    } else if (organiserSimilarity === 0) {
      conflictingSignals.push('organiser names do not match');
    }
  }

  if (a.city && b.city) {
    if (a.city.trim().toLowerCase() === b.city.trim().toLowerCase()) {
      score += 10;
      matchingSignals.push(`same city (${a.city})`);
    } else {
      conflictingSignals.push(`different city (${a.city} vs ${b.city})`);
    }
  }

  if (a.latitude !== null && a.longitude !== null && b.latitude !== null && b.longitude !== null) {
    const distanceKm = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    if (distanceKm <= 5) {
      score += 10;
      matchingSignals.push(`within ${distanceKm.toFixed(1)}km of each other`);
    } else {
      conflictingSignals.push(`${distanceKm.toFixed(1)}km apart`);
    }
  }

  const aDistances = new Set(a.distances.map((d) => d.distanceMetres).filter((m): m is number => m !== null));
  const bDistances = new Set(b.distances.map((d) => d.distanceMetres).filter((m): m is number => m !== null));
  if (aDistances.size > 0 && bDistances.size > 0) {
    const hasOverlap = [...aDistances].some((m) => [...bDistances].some((m2) => Math.abs(m - m2) <= 50));
    if (hasOverlap) {
      score += 5;
      matchingSignals.push('overlapping distance options');
    }
  }

  const hasCountryConflict = Boolean(a.countryCode && b.countryCode && a.countryCode !== b.countryCode);
  if (hasCountryConflict) conflictingSignals.push(`different country (${a.countryCode} vs ${b.countryCode})`);

  const clampedScore = Math.max(0, Math.min(100, score));
  const possibleDuplicate = !hasCountryConflict && clampedScore >= 50;

  return { score: clampedScore, matchingSignals, conflictingSignals, possibleDuplicate };
}
