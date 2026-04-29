// Sponsor configuration — add new sponsors here without touching page templates.
// contexts: water_type values this sponsor applies to. null = all.
// brandFlag: only show if spot.brand matches this value. null = all brands.
// activeUntil: ISO date string or null for indefinite.

import { escapeHtml } from './seo-utils.js';

export const sponsors = [
  {
    id: 'art-of-endurance',
    name: 'Art of Endurance',
    url: 'https://www.artofendurance.co.za',
    rel: 'sponsored',
    contexts: ['OCEAN', 'LAGOON', 'DAM'],
    domains: null,
    brandFlag: null,
    active: true,
    activeUntil: '2026-12-31',
  },
  {
    id: 'virgin-active',
    name: 'Virgin Active',
    url: 'https://www.virginactive.co.za',
    rel: 'nofollow',
    contexts: ['POOL'],
    domains: null,
    brandFlag: 'VIRGIN_ACTIVE',
    active: true,
    activeUntil: null,
  },
];

function isActive(sponsor) {
  if (!sponsor.active) return false;
  if (sponsor.activeUntil && sponsor.activeUntil < new Date().toISOString().slice(0, 10)) return false;
  return true;
}

export function getSpotSponsorHtml(spot) {
  const parts = [];
  for (const s of sponsors) {
    if (!isActive(s)) continue;
    if (s.contexts && !s.contexts.includes(spot.water_type)) continue;
    if (s.brandFlag && spot.brand !== s.brandFlag) continue;

    if (s.id === 'art-of-endurance') {
      parts.push(
        `<p class="sponsor-note">Fuelling your swim at ${escapeHtml(spot.name)}? SwimLoading's community challenge is sponsored by ` +
        `<a href="${s.url}" rel="${s.rel}">${escapeHtml(s.name)}</a>, official Maurten distributors in South Africa.</p>`
      );
    } else if (s.id === 'virgin-active') {
      const loc = spot._locationLabel ? escapeHtml(spot._locationLabel) : '';
      parts.push(
        `<p class="sponsor-note">Virgin Active ${loc} is part of the ` +
        `<a href="${s.url}" rel="${s.rel}">Virgin Active</a> gym network across South Africa.</p>`
      );
    }
  }
  return parts.join('');
}

export function getRegionSponsorHtml(regionSlug) {
  if (regionSlug === 'inland') return '';
  const s = sponsors.find(sp => sp.id === 'art-of-endurance');
  if (!s || !isActive(s)) return '';
  return (
    `<p class="sponsor-note">SwimLoading's monthly challenge is proudly sponsored by ` +
    `<a href="${s.url}" rel="${s.rel}">${escapeHtml(s.name)}</a> — Maurten nutrition for endurance athletes.</p>`
  );
}

export function getHomepageSponsorHtml() {
  const s = sponsors.find(sp => sp.id === 'art-of-endurance');
  if (!s || !isActive(s)) return '';
  return (
    `Monthly community challenge sponsored by ` +
    `<a href="${s.url}" rel="${s.rel}">${escapeHtml(s.name)}</a> × Maurten.`
  );
}
