// Social Content Engine: defaults. Everything configurable lives here until
// the social_settings table exists (see docs/social-engine/). Change HERE.

export const SOCIAL_DEFAULTS = {
  timezone: 'Africa/Johannesburg',
  // day: 0=Sun..6=Sat (same as JS getDay() and club_squad_sessions). Tue/Thu/Sat 10:00 SAST.
  cadence: [
    { day: 2, hour: 10, minute: 0 },
    { day: 4, hour: 10, minute: 0 },
    { day: 6, hour: 10, minute: 0 },
  ],
  // Target share of posts. Targets, not quotas: a weak candidate is skipped, never padded in.
  mix: { explore: 0.30, locations: 0.25, crossings: 0.15, ocean: 0.10, partners: 0.10, clubsAndPlatform: 0.10 },
  dedupeDays: 90,
  reserveMin: 6,                      // validated evergreen posts held back as fallback
  partnerMaxShare: 0.10,              // never more than this share of recent posts
  media: {
    rotationPosts: 3,        // a photograph from the same session as any of the last N posts' photographs is skipped
    dupDistance: 10,         // dHash Hamming distance (of 64) at or below which two images count as the same shot
    repeatDays: 21,          // do not reuse the same photograph inside this window if an alternative exists
    maxUpscale: 1.6,         // a full-bleed crop may enlarge the source at most this much
    acceptShareAlike: false, // CC BY-SA images need one policy decision from Dave; until then they route to review
  },
  event: {
    windowDays: 21,
    // An event today or tomorrow is not worth a post by the time it is seen. Earliest start = publish date + this.
    minLeadDays: 2,
    // 'unverified' is never auto-published. 'listed' = published with a disclaimer (Dave's publish model).
    autoTiers: ['confirmed', 'listed'],
    // Explore holds registration_status='unknown' on every future edition today, so we
    // never say "open for registration". Only these values may be described that way.
    mayDescribeAsOpen: [],
  },
};

export const RISK = { AUTO: 'AUTO_ELIGIBLE', REVIEW: 'REVIEW_REQUIRED', BLOCKED: 'BLOCKED' };

export const CATEGORIES = {
  SWIM_SPOTLIGHT: 'SWIM SPOTLIGHT',
  CROSSING_INTELLIGENCE: 'CROSSING INTELLIGENCE',
  BEHIND_THE_BRAND: 'BEHIND THE BRAND',
  OPEN_WATER_INTEL: 'OPEN WATER INTEL',
  DISCOVERS: 'SWIMLOADING DISCOVERS',
  THIS_WEEK: 'THIS WEEK IN OPEN WATER',
  NEW_ON: 'NEW ON SWIMLOADING',
};

/** Next publish slots (Africa/Johannesburg, UTC+2, no DST) after `from`. Returns ISO strings in UTC. */
export function nextSlots(from = new Date(), n = 3, cadence = SOCIAL_DEFAULTS.cadence) {
  const SAST = 2 * 3600e3;
  const out = [];
  const local = new Date(from.getTime() + SAST);          // shift so UTC getters read SAST wall-clock
  for (let d = 0; d < 21 && out.length < n; d++) {
    const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + d));
    for (const c of cadence) {
      if (day.getUTCDay() !== c.day) continue;
      const at = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), c.hour, c.minute) - SAST;
      if (at > from.getTime()) out.push(new Date(at).toISOString());
    }
  }
  return out.sort().slice(0, n);
}
