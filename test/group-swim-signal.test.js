// The group-swim detector reads temperature logs and says "several people
// seem to swim here together, every week, at this time". Everything it finds
// becomes a question for a human, so the tests that matter are the ones that
// stop it asking stupid questions — above all, mistaking a RACE for a habit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectGroupSwims, localParts, isoWeekKey } from '../api/_lib/group-swim-signal.js';

const CAMPS_BAY = {
  id: 'spot-cb', name: 'Camps Bay', country_code: 'ZA',
  timezone: 'Africa/Johannesburg', longitude: 18.3776, water_type: 'OCEAN',
};
const spotsMap = (...spots) => new Map(spots.map((s) => [s.id, s]));

/** n weekly logs at a spot on a given weekday and local hour. */
function weekly({ spot = CAMPS_BAY, weeks = 8, people = 4, hourUtc = 8, startSunday = '2026-06-07' }) {
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const day = new Date(`${startSunday}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + w * 7);
    for (let p = 0; p < people; p++) {
      out.push({
        spot_id: spot.id, user_id: `u${p}`,
        created_at: new Date(`${day.toISOString().slice(0, 10)}T${String(hourUtc).padStart(2, '0')}:15:00Z`).toISOString(),
      });
    }
  }
  return out;
}

test('finds a weekly group swim', () => {
  const found = detectGroupSwims(weekly({ weeks: 8, people: 4 }), spotsMap(CAMPS_BAY));
  assert.equal(found.length, 1);
  assert.equal(found[0].spot_name, 'Camps Bay');
  assert.equal(found[0].weekday, 'Sunday');
  assert.equal(found[0].people, 4);
  assert.equal(found[0].weeks, 8);
});

// The failure that would embarrass us. A race puts fifty logs from thirty
// people at one spot on ONE Saturday morning — a far stronger cluster than
// any weekly group — and it is not a group swim at all.
test('a single race day is NOT a group swim, however large', () => {
  const raceDay = [];
  for (let p = 0; p < 30; p++) {
    raceDay.push({
      spot_id: CAMPS_BAY.id, user_id: `racer${p}`,
      created_at: '2026-06-13T08:20:00Z',
    });
  }
  const found = detectGroupSwims(raceDay, spotsMap(CAMPS_BAY));
  assert.deepEqual(found, [],
    'thirty people at one spot on one morning is an event; only recurrence across ' +
    'separate weeks makes it a standing swim');
});

test('two friends are not a group anyone can join', () => {
  const found = detectGroupSwims(weekly({ weeks: 10, people: 2 }), spotsMap(CAMPS_BAY));
  assert.deepEqual(found, []);
});

test('a spot used evenly all week produces nothing', () => {
  // Same people, same spot, but spread across every day — ordinary use.
  const logs = [];
  for (let d = 0; d < 70; d++) {
    const day = new Date('2026-06-01T00:00:00Z');
    day.setUTCDate(day.getUTCDate() + d);
    for (let p = 0; p < 4; p++) {
      logs.push({
        spot_id: CAMPS_BAY.id, user_id: `u${p}`,
        created_at: `${day.toISOString().slice(0, 10)}T08:15:00Z`,
      });
    }
  }
  const found = detectGroupSwims(logs, spotsMap(CAMPS_BAY));
  assert.deepEqual(found, [],
    'no single slot should exceed the share threshold when use is spread evenly');
});

test('the busy-club case: many logs across many slots stays quiet', () => {
  // DUC has ~196 logs spread over every slot. Its biggest slot was 5.6% of
  // them, and surfacing that as a group swim is exactly the noise the share
  // threshold exists to stop.
  const duc = { ...CAMPS_BAY, id: 'spot-duc', name: 'DUC' };
  const logs = [];
  for (let w = 0; w < 20; w++) {
    for (let d = 0; d < 7; d++) {
      for (let h of [6, 8, 10, 17]) {
        const day = new Date('2026-04-05T00:00:00Z');
        day.setUTCDate(day.getUTCDate() + w * 7 + d);
        logs.push({
          spot_id: duc.id, user_id: `m${(w + d + h) % 9}`,
          created_at: `${day.toISOString().slice(0, 10)}T${String(h).padStart(2, '0')}:00:00Z`,
        });
      }
    }
  }
  const found = detectGroupSwims(logs, spotsMap(duc));
  assert.deepEqual(found, [], 'a club spot used all week should not look like one group swim');
});

test('local time is used, not UTC — a Perth swim keeps its own weekday', () => {
  // 23:30 UTC Saturday is Sunday morning in Perth. Reporting it as Saturday
  // would put the group on the wrong day of the week.
  const perth = {
    id: 'spot-perth', name: 'North Cottesloe', country_code: 'AU',
    timezone: 'Australia/Perth', longitude: 115.75, water_type: 'OCEAN',
  };
  const at = localParts('2026-06-13T23:30:00Z', perth);
  assert.equal(at.dow, 0, 'Saturday 23:30 UTC is Sunday in Perth');
  assert.equal(at.exact, true);
});

test('without a timezone the hour is estimated and says so', () => {
  const noTz = { id: 's', name: 'Somewhere', longitude: 115.75, water_type: 'OCEAN' };
  const at = localParts('2026-06-13T23:30:00Z', noTz);
  assert.equal(at.exact, false, 'an estimated local time must be flagged, never presented as known');
  assert.equal(at.dow, 0);
});

test('a slot built from estimated times is flagged on the candidate', () => {
  const noTz = { id: 'spot-x', name: 'Unzoned Beach', country_code: 'XX', longitude: 18.4, water_type: 'OCEAN' };
  const found = detectGroupSwims(weekly({ spot: noTz, weeks: 8, people: 4 }), spotsMap(noTz));
  assert.equal(found.length, 1);
  assert.equal(found[0].local_time_exact, false);
});

test('isoWeekKey separates adjacent weeks and survives a year boundary', () => {
  assert.notEqual(isoWeekKey(new Date('2026-06-07T00:00:00Z')), isoWeekKey(new Date('2026-06-14T00:00:00Z')));
  assert.equal(typeof isoWeekKey(new Date('2026-12-31T00:00:00Z')), 'string');
});

test('candidates come back strongest first', () => {
  const strong = { ...CAMPS_BAY, id: 'strong', name: 'Strong' };
  const weak = { ...CAMPS_BAY, id: 'weak', name: 'Weak' };
  const logs = [
    ...weekly({ spot: strong, weeks: 12, people: 6 }),
    ...weekly({ spot: weak, weeks: 5, people: 3 }),
  ];
  const found = detectGroupSwims(logs, spotsMap(strong, weak));
  assert.equal(found.length, 2);
  assert.equal(found[0].spot_name, 'Strong');
});
