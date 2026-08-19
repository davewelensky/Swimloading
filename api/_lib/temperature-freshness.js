// How old a water temperature is, and therefore what a page is allowed to
// call it.
//
// WHY THIS IS CENTRAL. A spot page ranking for "tooting lido temperature"
// is answering a question about RIGHT NOW. Showing a reading from last
// month under the words "current water temperature" is the fastest way to
// lose a swimmer's trust, and Google's — the page would be answering the
// query wrongly while appearing to answer it. Every page that shows a
// temperature must ask the same question of it, so the thresholds live
// here and nowhere else.
//
// The states are deliberately few. Four labels a reader can distinguish
// beat a continuous "3 days old" that every template then has to interpret
// for itself.

// Hours. Tuned to how fast the thing being measured actually moves: sea
// and lido temperatures change over days, not minutes, so a reading from
// this morning genuinely is today's. Change them HERE.
export const FRESHNESS_THRESHOLDS = {
  // Within this, the reading describes the water as it is now.
  liveHours: 6,
  // Still useful and honestly labelled as a recent reading, not as now.
  recentHours: 48,
  // Beyond recentHours it is history: shown, but never as the current state.
  // For measured observations (buoys/sensors), history is still worth a
  // "last reading" card up to this many days; beyond it the observation is
  // STALE and the page shows nothing rather than a misleading number.
  lastReadingDays: 7,
};

export const FRESHNESS_STATES = ['live', 'recent', 'stale', 'unavailable'];

// States for MEASURED observations (the global observation platform).
// Derived from the same thresholds above — these are the only names the
// observation service and the spot renderer may use, so the two can never
// disagree about what counts as "live".
export const OBSERVATION_STATES = ['LIVE', 'RECENT', 'LAST_READING', 'STALE'];

/**
 * Freshness state for a measured observation.
 *   LIVE          ≤ liveHours       — may be described as live/now/today
 *   RECENT        ≤ recentHours     — a recent measurement, not "now"
 *   LAST_READING  ≤ lastReadingDays — shown only as "last reading"
 *   STALE         beyond that       — not shown as a current value at all
 * Returns null for a missing/unparseable timestamp: no observation, no state.
 *
 * @param {string|Date|null|undefined} observedAt
 * @param {{ now?: Date }} [opts]
 * @returns {{ state: 'LIVE'|'RECENT'|'LAST_READING'|'STALE', ageMinutes: number, canSayLive: boolean }|null}
 */
export function getObservationState(observedAt, opts = {}) {
  const freshness = getTemperatureFreshness(observedAt, opts);
  if (freshness.state === 'unavailable') return null;
  const ageMinutes = Math.round(freshness.ageHours * 60);
  if (freshness.state === 'live') return { state: 'LIVE', ageMinutes, canSayLive: true };
  if (freshness.state === 'recent') return { state: 'RECENT', ageMinutes, canSayLive: false };
  const state = freshness.ageHours <= FRESHNESS_THRESHOLDS.lastReadingDays * 24
    ? 'LAST_READING' : 'STALE';
  return { state, ageMinutes, canSayLive: false };
}

/**
 * @param {string|Date|null|undefined} observedAt  when the reading was taken
 * @param {{ now?: Date }} [opts]                  injectable for tests
 * @returns {{
 *   state: 'live'|'recent'|'stale'|'unavailable',
 *   ageHours: number|null,
 *   observedAt: Date|null,
 *   canSayToday: boolean,
 *   label: string,
 * }}
 */
export function getTemperatureFreshness(observedAt, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();

  if (observedAt === null || observedAt === undefined || observedAt === '') {
    return { state: 'unavailable', ageHours: null, observedAt: null, canSayToday: false, label: 'No reading' };
  }

  const at = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (Number.isNaN(at.getTime())) {
    // An unparseable timestamp is not a fresh one. Treating it as current
    // because it "looked like a date" is exactly the failure this guards.
    return { state: 'unavailable', ageHours: null, observedAt: null, canSayToday: false, label: 'No reading' };
  }

  const ageHours = (now.getTime() - at.getTime()) / 3_600_000;

  // A reading from the future is a clock or timezone fault somewhere, not a
  // very fresh reading. Treat it as usable but never as "today", so a bad
  // timestamp can never manufacture a stronger claim than a real one.
  if (ageHours < 0) {
    return { state: 'recent', ageHours, observedAt: at, canSayToday: false, label: 'Recent water temperature' };
  }

  if (ageHours <= FRESHNESS_THRESHOLDS.liveHours) {
    return { state: 'live', ageHours, observedAt: at, canSayToday: true, label: 'Water temperature' };
  }
  if (ageHours <= FRESHNESS_THRESHOLDS.recentHours) {
    return { state: 'recent', ageHours, observedAt: at, canSayToday: false, label: 'Recent water temperature' };
  }
  return { state: 'stale', ageHours, observedAt: at, canSayToday: false, label: 'Last recorded water temperature' };
}

/**
 * The right heading for a body of water's temperature.
 *
 * Some pages have a measured reading and some only have a seasonal range.
 * A crossing page is the second kind: there is no sensor in the middle of
 * the Tsugaru Strait, so its 15–20°C is what the water is USUALLY like,
 * not what it is right now. Calling that "current water temperature" is
 * the same failure the freshness thresholds exist to prevent, one step
 * removed — so the typical case is named here, beside the rules it must
 * stay consistent with, rather than being invented per template.
 *
 * @param {object} opts
 * @param {string|Date|null} [opts.observedAt] when a measured reading was taken
 * @param {boolean} [opts.hasTypicalRange] whether a seasonal range exists
 * @returns {{ label: string, isCurrent: boolean, state: string }}
 */
export function waterTemperatureLabel(opts = {}) {
  const { observedAt, hasTypicalRange = false } = opts;
  const freshness = getTemperatureFreshness(observedAt, opts);
  if (freshness.state !== 'unavailable') {
    return { label: freshness.label, isCurrent: freshness.canSayToday, state: freshness.state };
  }
  if (hasTypicalRange) {
    return { label: 'Typical water temperature', isCurrent: false, state: 'typical' };
  }
  return { label: freshness.label, isCurrent: false, state: 'unavailable' };
}

/**
 * Which of two sources gets to define the page's freshness claim.
 *
 * A spot can have a swimmer log AND a nearby instrument, and they disagree
 * about how current they are. The wrong ordering here is quiet and costly:
 * the first version let a week-old swimmer log outrank a buoy 1 km away
 * that had read an hour ago, so Boscombe advertised "Swimming Conditions"
 * over a perfectly good live measurement.
 *
 * The rule: whoever can honestly claim the most, claims it. When both can
 * claim today the swimmer wins — a person was actually in that water, a
 * buoy was merely near it.
 *
 * @param {object} swimmer   freshness of the community reading
 * @param {object|null} measured freshness of a CLOSE instrument, or null
 */
export function preferredFreshness(swimmer, measured) {
  if (!measured) return swimmer;
  if (!swimmer) return measured;
  if (swimmer.canSayToday) return swimmer;
  if (measured.canSayToday) return measured;
  return swimmer.state !== 'unavailable' ? swimmer : measured;
}

/**
 * The page title for a spot, which may only say "Today" when the reading
 * actually supports it. Kept beside the freshness rule so the two can
 * never drift apart.
 */
export function spotTitle(spotName, freshness, opts = {}) {
  const suffix = opts.suffix ?? 'SwimLoading';
  const subject = opts.isPool ? 'Pool Temperature' : 'Water Temperature';
  // With no reading at all, promising a temperature in the title is a
  // promise the page cannot keep — the visitor clicks through to nothing.
  // The page is still genuinely useful (location, conditions, history), so
  // it says that instead of pretending to a number it does not have.
  if (!freshness || freshness.state === 'unavailable') {
    return `${spotName} Swimming Conditions | ${suffix}`;
  }
  return freshness.canSayToday
    ? `${spotName} ${subject} Today | ${suffix}`
    : `${spotName} ${subject} & Swimming Conditions | ${suffix}`;
}

/**
 * The meta description, whose freshness claim must match the title's.
 *
 * The search result is one artefact: a title saying "Today" beside a
 * description saying "last recorded" is incoherent, and a description
 * saying "Live" over a six-day-old reading is the same lie the title used
 * to tell — just in the line underneath. So both are derived here, from
 * the one freshness verdict.
 *
 * The surrounding sentence (community framing, location, call to action)
 * is preserved deliberately: this increment fixes a truth defect, it does
 * not rewrite descriptions that already work.
 */
export function spotMetaDescription(freshness, opts = {}) {
  const { spotName, locationLabel, waterType = 'OCEAN', isPool = false } = opts;
  const noun = isPool ? 'pool temperature'
    : waterType === 'LAKE' ? 'lake temperature'
    : waterType === 'LAGOON' ? 'lagoon temperature'
    : waterType === 'DAM' ? 'dam temperature'
    : 'ocean temperature';
  const where = locationLabel ? `${spotName}, ${locationLabel}` : spotName;
  const community = isPool
    ? 'Logged by the SwimLoading swimming community.'
    : 'Community-logged by open water swimmers on SwimLoading.';

  // No reading: describe what the page HAS rather than claiming a
  // temperature. "Latest recorded" would be false when nothing is recorded.
  if (!freshness || freshness.state === 'unavailable') {
    return `Swimming conditions, location and water temperature history for ${where}. ${community}`;
  }
  const lead = freshness.canSayToday
    ? `Today's ${noun}`
    : freshness.state === 'recent'
      ? `Recent ${noun}`
      : `Last recorded ${noun}`;
  return `${lead} at ${where}. ${community} Check conditions before you swim.`;
}

/**
 * "Updated 14 Aug 2026, 07:20" — the observation time, shown next to every
 * temperature so the reader can judge it themselves rather than trusting a
 * label. Rendered in the spot's own timezone where one is known, because
 * "07:20" means nothing to a swimmer in the wrong zone.
 */
export function formatObservedAt(observedAt, timezone) {
  if (!(observedAt instanceof Date) || Number.isNaN(observedAt.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(observedAt).replace(',', ',');
  } catch {
    // An invalid IANA zone must not take the page down over a caption.
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(observedAt);
  }
}
