// Temperature history: summarisation and the SVG chart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summariseHistory, renderHistoryChart, getStationHistory, MIN_POINTS,
} from '../api/_lib/observations/history.js';

const NOW = new Date('2026-08-18T12:00:00Z');
const series = (temps, stepH = 1) => temps.map((c, i) => ({
  t: new Date(NOW.getTime() - (temps.length - 1 - i) * stepH * 3_600_000), c,
}));

test('summary: computes range, change and direction', () => {
  const s = summariseHistory(series([15, 15.4, 16, 16.2, 16.8, 17.1]));
  assert.equal(s.points, 6);
  assert.equal(s.minC, 15);
  assert.equal(s.maxC, 17.1);
  assert.equal(s.latestC, 17.1);
  assert.equal(s.changeC, 2.1);
  assert.equal(s.direction, 'warming');
  assert.equal(s.spanHours, 5);
});

test('summary: cooling and steady are distinguished, noise is not a trend', () => {
  assert.equal(summariseHistory(series([18, 17.6, 17.2, 16.8, 16.4, 16])).direction, 'cooling');
  // A tenth of a degree across the window is measurement noise.
  assert.equal(summariseHistory(series([16, 16.1, 16, 16.1, 16, 16.1])).direction, 'steady');
});

test('summary: too few points is null — two points are not a trend', () => {
  assert.equal(summariseHistory(series([16, 17])), null);
  assert.equal(summariseHistory([]), null);
  assert.equal(summariseHistory(null), null);
  assert.equal(summariseHistory(series(new Array(MIN_POINTS).fill(16))).points, MIN_POINTS);
});

test('chart: renders an SVG with the real numbers and an accessible label', () => {
  const html = renderHistoryChart(series([15, 15.5, 16, 16.5, 17, 17.4]));
  assert.match(html, /<svg/);
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="[^"]*15[^"]*17\.4[^"]*"/);
  assert.match(html, /17\.4&deg;C high/);
  assert.match(html, /15&deg;C low/);
  assert.match(html, /6 measurements/);
  assert.match(html, /2\.4°C warmer than 5 hours ago/);
  // The path must contain real coordinates, not NaN.
  assert.doesNotMatch(html, /NaN/);
});

test('chart: renders nothing when there is not enough data', () => {
  assert.equal(renderHistoryChart(series([16, 17])), '');
  assert.equal(renderHistoryChart([]), '');
  assert.equal(renderHistoryChart(null), '');
});

test('chart: a flat series does not render as jagged noise', () => {
  // Identical readings would give a zero range and divide-by-zero the scale.
  const html = renderHistoryChart(series([16, 16, 16, 16, 16, 16]));
  assert.match(html, /<svg/);
  assert.doesNotMatch(html, /NaN/);
  assert.match(html, /holding around 16°C/);
});

test('history fetch: every failure path returns an empty series, never throws', async () => {
  const id = '27ab125b-5e62-4bda-b1fc-73ea4e86be9e';
  assert.deepEqual(await getStationHistory('not-a-uuid'), []);
  assert.deepEqual(await getStationHistory(id, { fetchImpl: async () => ({ ok: false, status: 500 }) }), []);
  assert.deepEqual(await getStationHistory(id, { fetchImpl: async () => { throw new Error('network'); } }), []);
  assert.deepEqual(await getStationHistory(id, {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ error: 'nope' }) }),
  }), []);
});

test('history fetch: parses rows oldest-first and drops unusable ones', async () => {
  const rows = [
    { observed_at: '2026-08-18T09:00:00Z', water_temperature_c: '16.1' },
    { observed_at: 'not-a-date', water_temperature_c: '16.2' },
    { observed_at: '2026-08-18T10:00:00Z', water_temperature_c: null },
    { observed_at: '2026-08-18T11:00:00Z', water_temperature_c: '16.4' },
  ];
  const points = await getStationHistory('27ab125b-5e62-4bda-b1fc-73ea4e86be9e', {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => rows }),
  });
  assert.equal(points.length, 2);
  assert.equal(points[0].c, 16.1);
  assert.equal(points[1].c, 16.4);
});
