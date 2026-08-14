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
};

export const FRESHNESS_STATES = ['live', 'recent', 'stale', 'unavailable'];

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
 * The page title for a spot, which may only say "Today" when the reading
 * actually supports it. Kept beside the freshness rule so the two can
 * never drift apart.
 */
export function spotTitle(spotName, freshness, opts = {}) {
  const suffix = opts.suffix ?? 'SwimLoading';
  const subject = opts.isPool ? 'Pool Temperature' : 'Water Temperature';
  return freshness?.canSayToday
    ? `${spotName} ${subject} Today | ${suffix}`
    : `${spotName} ${subject} & Swimming Conditions | ${suffix}`;
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
