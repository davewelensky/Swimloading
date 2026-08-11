import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTableEvents, pageYearFrom } from '../src/extract/table.js';
import { buildFromRow, processTablePage } from '../src/jobs/process-table-page.js';
import { parseYearlessDate } from '../src/normalize/date.js';
import { parseLocationText } from '../src/normalize/location.js';

// Mirrors Ray's Notebook's real markup, including the <details> block that
// hides the street address, raw coordinates and three map links.
const RAYS = `<html><head><title>Ray's Notebook: Open Water Swims 2026 — The Whole Shebang</title></head>
<body><h1>The Whole Shebang</h1>
<table>
  <tr><th>Date</th><th>Location</th><th>Name</th><th>Distance</th><th>More</th></tr>
  <tr>
    <td class="when"><span class="date">Feb 14, Sat</span></td>
    <td class="where">
      <a class="mapq" href="http://www.google.com/maps/?q=27.975915,-82.828739">Clearwater, FL</a>
      <details><summary>…</summary><span class="extra"> Lifeguard Tower 5, Clearwater, FL
        <span class="latlon">{27.975915,-82.828739}</span>
        <span class="map_menu"><a class="maplink" href="http://bing.com/maps/x">B</a></span>
      </span></details>
    </td>
    <td class="name"><a href="https://runsignup.com/Race/FL/X/TOC">Thomas O'Connor Charity Swim</a></td>
    <td class="distance">1 mi</td>
    <td class="more"><span class="time"> 7:50 am</span> Gulf of Mexico</td>
  </tr>
  <tr>
    <td class="when"><span class="date">Aug 22, Sat</span></td>
    <td class="where"><a class="mapq" href="http://www.google.com/maps/?q=44.100000,-72.100000">Newport, VT</a></td>
    <td class="name"><a href="https://example.org/kingdom-swim">Kingdom Swim</a></td>
    <td class="distance">1, 3, 10 km</td>
    <td class="more"><span class="time">8:00 am</span> Lake Memphremagog</td>
  </tr>
</table></body></html>`;

test('page year comes from the page heading, not from anywhere in the body', () => {
  assert.equal(pageYearFrom(RAYS, new Date('2026-08-04T00:00:00Z')), 2026);
  assert.equal(pageYearFrom('<title>Swims</title><h1>Calendar</h1>', new Date('2026-08-04T00:00:00Z')), null);
  // A street number or a stale copyright must not read as a season.
  assert.equal(pageYearFrom('<title>Est. 1998 — 12 Baker St</title>', new Date('2026-08-04T00:00:00Z')), null);
});

test('a yearless date is CONFIRMED only when its weekday verifies the year', () => {
  // 14 Feb 2026 is a Saturday; 2025 and 2027 are not.
  const ok = parseYearlessDate('Feb 14, Sat', 2026);
  assert.equal(ok.startDate, '2026-02-14');
  assert.equal(ok.dateConfirmed, true);

  // Weekday that matches no nearby year -> not guessed.
  const bad = parseYearlessDate('Feb 14, Wed', 2026);
  assert.equal(bad.dateConfirmed, false);
  assert.equal(bad.startDate, null);

  // No weekday, but the page states a year -> accepted, with the split
  // named in the warning. The row states day and month, the page heading
  // states the year; both halves are read off the page, neither guessed.
  // Requiring a weekday here left 98 of 103 review-queue items dateless
  // and unactionable (75 Brazilian, 14 Japanese season-schedule rows).
  const noDay = parseYearlessDate('Feb 14', 2026);
  assert.equal(noDay.startDate, '2026-02-14');
  assert.equal(noDay.dateConfirmed, true);
  assert.match(noDay.warnings.join(' '), /taken from the page's own heading/);

  // No weekday AND no page year -> still nothing. Neither half was stated,
  // and the schema forbids storing an unconfirmed date anyway.
  const nothing = parseYearlessDate('Feb 14', null);
  assert.equal(nothing.startDate, null);
  assert.equal(nothing.dateConfirmed, false);

  // A weekday still WINS over the page's year — it verifies rather than
  // accepts, and can override the heading outright (see the spill case).
  const contradicts = parseYearlessDate('Feb 14, Wed', 2026);
  assert.equal(contradicts.startDate, null);

  // East Asian rows are numeric and carry no month word to look up.
  const jp = parseYearlessDate('6月28日', 2026);
  assert.equal(jp.startDate, '2026-06-28');
  assert.equal(jp.dateConfirmed, true);

  // A schedule spilling into the next year resolves onto it.
  const spill = parseYearlessDate('Jan 2, Fri', 2025); // 2 Jan 2026 is a Friday
  assert.equal(spill.startDate, '2026-01-02');
  assert.equal(spill.dateConfirmed, true);

  // No year context at all -> nothing invented.
  assert.equal(parseYearlessDate('Feb 14, Sat', null).startDate, null);
});

test('US state and Canadian province codes resolve the country', () => {
  const fl = parseLocationText('Clearwater, FL');
  assert.equal(fl.city, 'Clearwater');
  assert.equal(fl.region, 'FL');
  assert.equal(fl.countryCode, 'US');

  const bc = parseLocationText('Kelowna, BC');
  assert.equal(bc.countryCode, 'CA');

  // The collision that filed Boston in Morocco: MA is a US state AND the
  // ISO code for Morocco. The subdivision reading wins, and the
  // ambiguity is surfaced rather than hidden.
  const ma = parseLocationText('South Boston, MA');
  assert.equal(ma.countryCode, 'US');
  assert.equal(ma.region, 'MA');
  assert.equal(ma.warnings.some((w) => w.includes('ISO country code')), true);

  // Spelled-out country names are unaffected.
  assert.equal(parseLocationText('Durban, South Africa').countryCode, 'ZA');
});

test('extractTableEvents reads rows, coordinates and links; ignores collapsed detail', () => {
  const { rows, pageYear } = extractTableEvents(RAYS, new Date('2026-08-04T00:00:00Z'));
  assert.equal(pageYear, 2026);
  assert.equal(rows.length, 2);

  const first = rows[0]!;
  assert.equal(first.name, "Thomas O'Connor Charity Swim");
  assert.equal(first.dateText, 'Feb 14, Sat');
  // <details> content must not pollute the location cell.
  assert.equal(first.locationText, 'Clearwater, FL');
  assert.equal(first.latitude, 27.975915);
  assert.equal(first.longitude, -82.828739);
  // The event link, never the map link.
  assert.equal(first.url, 'https://runsignup.com/Race/FL/X/TOC');
});

test('one table page produces many distinct candidates', () => {
  const res = processTablePage('src', 'https://raysnotebook.info/ows/schedules/x.html', RAYS, {});
  assert.equal(res.rowsFound, 2);
  assert.equal(res.pages.length, 2);

  const keys = new Set(res.pages.map((p) => p.candidate.candidateKey));
  assert.equal(keys.size, 2, 'candidates from one page must not collide on candidate_key');

  const kingdom = res.pages.find((p) => p.candidate.canonicalName === 'Kingdom Swim')!;
  assert.equal(kingdom.candidate.startDate, '2026-08-22');
  assert.equal(kingdom.candidate.dateConfirmed, true);
  assert.equal(kingdom.candidate.countryCode, 'US');
  assert.equal(kingdom.candidate.latitude, 44.1);
  // "1, 3, 10 km" -> three options, unit carried across from the cell.
  assert.equal(kingdom.candidate.distances.length, 3);
  assert.equal(kingdom.candidate.distances.at(-1)!.distanceMetres, 10000);
  assert.equal(kingdom.candidate.rawSourceValues.extractedFromTable, true);
});

test('a page with no usable table yields nothing, so the caller falls through', () => {
  const res = processTablePage('src', 'https://example.com/e', '<html><body><h1>A race</h1></body></html>', {});
  assert.equal(res.pages.length, 0);
  assert.equal(res.rowsFound, 0);

  // A small layout table must not be mistaken for a calendar.
  const layout = '<table><tr><td>Menu</td></tr><tr><td>Home</td></tr></table>';
  assert.equal(processTablePage('src', 'https://example.com/e', layout, {}).pages.length, 0);
});

test('the row cap is enforced and reported', () => {
  const many = `<html><head><title>Swims 2026</title></head><body><table>
    <tr><th>Date</th><th>Name</th></tr>
    ${Array.from({ length: 30 }, (_, i) => `<tr><td>Aug ${(i % 28) + 1}</td><td>Race ${i}</td></tr>`).join('')}
  </table></body></html>`;
  const res = processTablePage('src', 'https://example.com/cal', many, {}, 10);
  assert.equal(res.pages.length <= 10, true);
  assert.equal(res.warnings.some((w) => w.includes('only the first 10')), true);
});

// ─────────────────────────────────────────────────────────────────────────
// Regression, 2026-08-06. Two bugs in one line of distance splitting put
// impossible swims in the catalogue: a 402 km "Swim250" and a 666 km
// Finnish championship.
// ─────────────────────────────────────────────────────────────────────────

test('a decimal comma is not a list separator', () => {
  // Finland's championship lists "5 km, 3,3 km, 1,666 km". Splitting on
  // every comma made that 5 km, 3, 3 km, 1 and 666 km — and 666 km was
  // stored as an open-water distance. Most of Europe writes decimals this
  // way, so this is not a Finnish problem.
  const row = {
    name: 'Test Swim', dateText: '12 September 2027', locationText: null,
    distanceText: '5 km, 3,3 km, 1,666 km', timeText: null,
    url: null, latitude: null, longitude: null, rawCells: {},
  };
  const built = buildFromRow('s', 'https://x/', row, 2027, 'en', {});
  assert.deepEqual(
    (built?.candidate.distances ?? []).map((d) => d.distanceMetres),
    [5000, 3300, 1666]
  );

  // A comma followed by a space is still a list, and a bare number in one
  // still borrows the unit.
  const list = buildFromRow('s', 'https://x/',
    { ...row, distanceText: '5, 10 km' }, 2027, 'en', {});
  assert.deepEqual((list?.candidate.distances ?? []).map((d) => d.distanceMetres), [5000, 10000]);
});

test('only a bare number borrows a unit from elsewhere in the string', () => {
  // Great North Swim lists "Swim250, Half Mile, 1 Mile, 2 Miles, 5k and
  // 10k". "Swim250" has no unit, so the old code lent it the first one it
  // found anywhere — "Mile" — and published a 250 metre swim as 402 km.
  const built = buildFromRow('s', 'https://x/', {
    name: 'Great North Swim', dateText: '12 September 2027', locationText: null,
    distanceText: 'Swim250, Half Mile, 1 Mile, 2 Miles, 5k and 10k',
    timeText: null, url: null, latitude: null, longitude: null, rawCells: {},
  }, 2027, 'en', {});

  const byLabel = new Map((built?.candidate.distances ?? []).map((d) => [d.originalLabel, d.distanceMetres]));
  // Unreadable is the correct answer here — better than a confident 402 km.
  assert.equal(byLabel.get('Swim250'), null);
  assert.equal(byLabel.get('1 Mile'), 1609);
  assert.equal(byLabel.get('2 Miles'), 3219);

  // Nothing in this list is a plausible-looking wrong answer.
  for (const m of byLabel.values()) {
    if (m !== null) assert.ok(m < 25000, `${m} m is not a swim distance`);
  }
});

// A season published as one table per month. Taking only the biggest
// table read March and threw away the other eleven — Brazil's 2026
// calendar is 12 tables, and we saw 22 of its 164 rows, every one of them
// already in the past. That is why Brazil showed zero live events while
// its source was healthy and its dates parsed perfectly.
const monthTable = (month: string, rows: Array<[string, string]>) =>
  `<h2>${month}</h2><table>
     <tr><th>Data</th><th>Evento</th><th>Local</th></tr>
     ${rows.map(([d, n]) => `<tr><td>${d}</td><td>${n}</td><td>Bertioga (SP)</td></tr>`).join('')}
   </table>`;

test('a calendar split across one table per month is read as one calendar', () => {
  const html = `<html><head><title>Calendário 2027</title></head><body>
    ${monthTable('Março', [['08 de Março', 'Travessia de Penha'], ['22 de Março', 'Maratour Mahi Mahi']])}
    ${monthTable('Agosto', [['15 de Agosto', 'Desafio 4 Ilhas'], ['30 de Agosto', 'Circuito Ocean']])}
    ${monthTable('Dezembro', [['07 de Dezembro', 'Copa Brasil de Águas Abertas']])}
  </body></html>`;

  const { rows, warnings } = extractTableEvents(html);
  assert.equal(rows.length, 5, 'every month table contributes its rows');
  assert.ok(
    warnings.some((w) => w.includes('split across 3 tables')),
    'the split is reported rather than silently merged'
  );
  const names = rows.map((r) => r.name);
  assert.ok(names.includes('Copa Brasil de Águas Abertas'), 'December was not discarded');
  assert.ok(names.includes('Desafio 4 Ilhas'), 'August was not discarded');
});

test('a navigation table alongside the calendar is still excluded', () => {
  const html = `<html><head><title>Calendário 2027</title></head><body>
    <table><tr><td><a href="/x">Home</a></td><td><a href="/y">Loja</a></td></tr></table>
    ${monthTable('Março', [['08 de Março', 'Travessia de Penha'], ['22 de Março', 'Maratour Mahi Mahi']])}
  </body></html>`;

  const { rows } = extractTableEvents(html);
  assert.equal(rows.length, 2, 'only the calendar rows are read');
  assert.ok(!rows.some((r) => r.name === 'Home'), 'nav links never become events');
});
