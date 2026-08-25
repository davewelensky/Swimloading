// The tide locations SwimLoading asks WorldTides about.
//
// ONE definition, imported by both the cron that fetches them and the route
// that serves them. Two copies of a list like this is how a place ends up
// fetched but never served, or served from a stale window nobody refreshes —
// and this session already spent an afternoon on a facet function that drifted
// from its twin for exactly that reason.
//
// NAMED PLACES, NOT lat/lon, and that is the security decision. A tide proxy
// taking arbitrary coordinates is no safer than the public API key it
// replaced: anyone could point their own site at it and spend our credits.
// A request for anything not in this map is refused rather than forwarded.
//
// `days` is fixed per place too. WorldTides charges per call and a wider
// window is a dearer call, so a caller cannot ask for 14 days somewhere we
// only ever display 2.

export const TIDE_PLACES = {
  'big-bay':   { lat: -33.7297, lon:  18.4611, days:  2, label: 'Big Bay, Bloubergstrand' },
  'millers':   { lat: -34.2269, lon:  18.4648, days:  2, label: "Miller's Point" },
  'langebaan': { lat: -33.03,   lon:  17.97,   days:  4, label: 'Langebaan lagoon' },
  'dover':     { lat:  51.1279, lon:   1.3134, days: 14, label: 'Dover' },
};

export const TIDE_PLACE_KEYS = Object.keys(TIDE_PLACES);

/** The place, or null. Case-insensitive; never throws on odd input. */
export function tidePlace(key) {
  return TIDE_PLACES[String(key || '').toLowerCase()] || null;
}

/**
 * How long a stored prediction stays usable.
 *
 * Tide extremes are harmonics — computed, not measured — so a stored row is
 * exactly as correct a week after it was fetched as the minute it arrived.
 * What DOES expire is the window: a 2-day fetch stops covering "the next
 * tide" once it is 2 days old. So a place is stale when the newest extreme we
 * hold is close to running out, not when the fetch was old.
 *
 * Half the window, floored at a day: a 2-day place needs refreshing with a
 * day still in hand, and the daily cron gives it four chances to succeed
 * before anyone notices.
 */
export function staleAfterHours(place) {
  return Math.max(24, (place.days * 24) / 2);
}
