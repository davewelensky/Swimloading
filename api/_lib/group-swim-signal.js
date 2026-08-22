// Finding regular group swims in our own temperature logs.
//
// A group that swims together every Sunday leaves a fingerprint: the same
// spot, the same weekday, several different people, week after week. Nothing
// else on the platform can see this — it needs swimmers who log, which is the
// one asset a crawler cannot copy.
//
// Proven against two groups we already knew about, neither given to the
// algorithm (see test/group-swim-signal.test.js):
//   * Camps Bay, Sunday ~10:00      → the Hot Chocolate Swim (9am start)
//   * Camps Bay Primary, Wednesday  → the Aqua Sharks squad session
//
// WHAT THIS PRODUCES IS A QUESTION, NEVER A ROW. A cluster means "several
// people swim here at the same time" — it does not mean the swim is public,
// that it welcomes newcomers, or that it has a name. Every candidate goes to
// a human who can ask someone who was there. That is the same rule the
// observation platform uses for coverage gaps: a sensor is not a beach.

/** Occurrences needed in a slot before it is worth a human's attention. */
export const MIN_LOGS = 5;
/** Distinct people. Two friends are not a group swim anyone can join. */
export const MIN_PEOPLE = 3;
/**
 * Distinct calendar weeks the slot appears in.
 *
 * This is the guard that matters most. A RACE fills one Saturday morning with
 * dozens of logs from dozens of people at one spot — the strongest possible
 * cluster, and completely wrong. Requiring the slot to recur across separate
 * weeks is what separates "a group swims here weekly" from "something
 * happened here once".
 */
export const MIN_WEEKS = 4;
/**
 * Share of that spot's logs falling on this WEEKDAY.
 *
 * Chance alone gives ~1/7 = 14%, so 25% is a marked deviation. Measured per
 * DAY, not per day-and-hour: an earlier version clustered on the hour too and
 * found nothing at all, because one hour can never be a fifth of a spot's
 * whole week. A group meets on a day; the hour its members happen to log
 * varies — Hot Chocolate starts at 09:00 and reports around 10:00. Splitting
 * by hour scattered the very signal it was looking for.
 *
 * The hour is still reported, as the modal hour of the day's logs, because
 * "Saturday around 10:00" is what makes the question answerable. It is
 * description, not part of the test.
 */
export const MIN_SHARE = 0.25;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Local weekday, hour and ISO week for a timestamp at a given place.
 *
 * Uses the spot's IANA timezone where we have one (154 of 205). Without it,
 * longitude gives a rough offset — good to about an hour, which is enough for
 * the weekday and honest enough for the hour as long as the caller is told.
 * Applying South African time to a Perth swim would move it a day.
 */
export function localParts(iso, { timezone, longitude } = {}) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  if (timezone) {
    try {
      const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone, weekday: 'short', hour: '2-digit', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
      });
      const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
      const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
      if (dow !== -1) {
        const local = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
        return { dow, hour: Number(parts.hour) % 24, week: isoWeekKey(local), exact: true };
      }
    } catch {
      // Unknown zone name — fall through to the longitude estimate rather
      // than dropping the log entirely.
    }
  }

  const offsetHours = longitude == null ? 0 : Math.round(Number(longitude) / 15);
  const shifted = new Date(d.getTime() + offsetHours * 3600_000);
  return {
    dow: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    week: isoWeekKey(shifted),
    exact: false,
  };
}

/** Year + ISO week, as a string, so "same week" is comparable across a year boundary. */
export function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Group logs into (spot, weekday) slots and keep the ones that look like a
 * standing swim. The typical hour is reported per slot, not clustered on.
 *
 * @param {Array} logs   {spot_id, user_id, created_at}
 * @param {Map}   spots  spot_id → {name, country_code, timezone, longitude, water_type}
 * @param {Object} opts  threshold overrides, for testing and tuning
 * @returns {Array} candidates, strongest first
 */
export function detectGroupSwims(logs, spots, opts = {}) {
  const {
    minLogs = MIN_LOGS, minPeople = MIN_PEOPLE,
    minWeeks = MIN_WEEKS, minShare = MIN_SHARE,
  } = opts;

  const perSpot = new Map();   // spot_id → total logs
  const slots = new Map();     // spot_id|dow → slot

  for (const log of logs) {
    const spot = spots.get(log.spot_id);
    if (!spot) continue;
    const at = localParts(log.created_at, spot);
    if (!at) continue;

    perSpot.set(log.spot_id, (perSpot.get(log.spot_id) || 0) + 1);

    const key = `${log.spot_id}|${at.dow}`;
    let slot = slots.get(key);
    if (!slot) {
      slot = {
        spot_id: log.spot_id, spot, dow: at.dow,
        logs: 0, people: new Set(), weeks: new Set(),
        hours: new Map(), exactTime: at.exact,
      };
      slots.set(key, slot);
    }
    slot.logs++;
    slot.people.add(log.user_id);
    slot.weeks.add(at.week);
    slot.hours.set(at.hour, (slot.hours.get(at.hour) || 0) + 1);
    if (!at.exact) slot.exactTime = false;
  }

  const out = [];
  for (const slot of slots.values()) {
    const total = perSpot.get(slot.spot_id) || 0;
    const share = total ? slot.logs / total : 0;
    const people = slot.people.size;
    const weeks = slot.weeks.size;

    if (slot.logs < minLogs) continue;
    if (people < minPeople) continue;
    if (weeks < minWeeks) continue;      // one busy day is an event, not a habit
    if (share < minShare) continue;

    // The hour most of the day's logs land in. Descriptive only — it makes
    // the question specific ("Saturday around 10:00?") without pretending to
    // be the start time, which is earlier than when people report.
    let hour = null, best = 0;
    for (const [h, n] of slot.hours) if (n > best) { best = n; hour = h; }

    out.push({
      spot_id: slot.spot_id,
      spot_name: slot.spot.name,
      country_code: slot.spot.country_code,
      water_type: slot.spot.water_type,
      weekday: DAY_NAMES[slot.dow],
      dow: slot.dow,
      hour,
      typical_hour_share: Math.round((best / slot.logs) * 100) / 100,
      logs: slot.logs,
      people,
      weeks,
      share: Math.round(share * 1000) / 1000,
      // Flagged so a report can say "the hour here is estimated from
      // longitude" rather than presenting a guess as a fact.
      local_time_exact: slot.exactTime,
      score: score({ people, weeks, share }),
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

/**
 * How much a human should want to look at this.
 *
 * People and weeks are what make it a GROUP and a HABIT; share is what makes
 * it stand out from ordinary use of the spot. Deliberately simple — the
 * output is a shortlist for someone to ask about, and a more elaborate score
 * would imply a confidence the data cannot support.
 */
export function score({ people, weeks, share }) {
  return Math.round((people * 2 + Math.min(weeks, 26) + share * 40) * 10) / 10;
}

/** Which swimmers to ask about a candidate — they were actually there. */
export function witnessesFor(candidate, logs, spots) {
  const seen = new Set();
  for (const log of logs) {
    if (log.spot_id !== candidate.spot_id) continue;
    const spot = spots.get(log.spot_id);
    const at = spot && localParts(log.created_at, spot);
    // Matched on the DAY, matching how the candidate was formed. Anyone who
    // logged there that weekday can answer whether it is a group.
    if (at && at.dow === candidate.dow) seen.add(log.user_id);
  }
  return [...seen];
}
