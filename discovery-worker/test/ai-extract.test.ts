import test from 'node:test';
import assert from 'node:assert/strict';

import { condenseForAi, extractEventsWithAi, type AiModelPort, type AiEventRow } from '../src/extract/ai.js';
import { processAiPage } from '../src/jobs/process-ai-page.js';

// A model that returns whatever the test hands it, and records what it was
// asked. No network, no API key — the same injectable-port shape the crawl
// ports use.
function fakeModel(rows: AiEventRow[]): AiModelPort & { calls: { pageText: string; pageUrl: string; countryHint: string | null }[] } {
  const calls: { pageText: string; pageUrl: string; countryHint: string | null }[] = [];
  return {
    calls,
    async extractRows(input) {
      calls.push(input);
      return {
        rows,
        usage: { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        model: 'test-model',
      };
    },
  };
}

const row = (over: Partial<AiEventRow> = {}): AiEventRow => ({
  name: 'Traversée du lac',
  dateText: '15 août 2026',
  locationText: 'ANNECY',
  distanceText: '2.4 km, 5 km',
  timeText: null,
  url: '/evenements/voir/6357',
  ...over,
});

// ─────────────────────────── condensing ────────────────────────────────

test('condensing keeps the readable text and drops the markup around it', () => {
  const html = `
    <html><head><style>.x{color:red}</style><script>var a=1;</script></head>
    <body>
      <nav><a href="/home">Home</a><a href="/about">About</a></nav>
      <div class="wrap"><div class="event">
        <h3>Bay Swim</h3>
        <p>14 February, Saturday</p>
        <a href="/races/bay-swim">Enter</a>
      </div></div>
      <footer>© 2026 Someone</footer>
    </body></html>`;
  const out = condenseForAi(html);

  assert.match(out.text, /Bay Swim/);
  assert.match(out.text, /14 February, Saturday/);
  // The href survives — it is the only attribute worth paying for.
  assert.match(out.text, /\[\/races\/bay-swim\]/);
  // Navigation, footer, script and style are gone.
  assert.doesNotMatch(out.text, /var a=1/);
  assert.doesNotMatch(out.text, /color:red/);
  assert.doesNotMatch(out.text, /About/);
  assert.doesNotMatch(out.text, /© 2026 Someone/);
  assert.ok(out.condensedChars < html.length);
});

test('a nested layout is not repeated once per wrapper div', () => {
  const html = `<body><div><div><div><p>One line only</p></div></div></div></body>`;
  const out = condenseForAi(html);
  const occurrences = out.text.split('One line only').length - 1;
  assert.equal(occurrences, 1);
});

test('truncation is reported, never silent', () => {
  const many = Array.from({ length: 500 }, (_v, i) => `<p>Event number ${i} on some date in some place</p>`).join('');
  const out = condenseForAi(`<body>${many}</body>`, { maxChars: 500 });
  assert.equal(out.truncated, true);
  assert.equal(out.condensedChars, 500);
});

// ─────────────────────── the guard and the cost ────────────────────────

test('a page too thin to be a listing never reaches the API', async () => {
  // A JavaScript shell: this is literally what KNZB and Swimming NZ serve,
  // 357 and 991 characters of chrome around an empty <div id="app">.
  const model = fakeModel([row()]);
  const result = await extractEventsWithAi('<body><div id="app"></div></body>', 'https://x.test/', 'NL', model);

  assert.equal(model.calls.length, 0, 'no call should have been made');
  assert.equal(result.usage, null);
  assert.equal(result.rows.length, 0);
  assert.match(result.warnings.join(' '), /too thin/);
});

test('the country hint is offered as a reading aid, never as a fact to assert', async () => {
  const model = fakeModel([row()]);
  const html = `<body>${listingLines(12, 'Une course de natation en eau libre')}</body>`;
  await extractEventsWithAi(html, 'https://ffneaulibre.fr/calendrier', 'FR', model);

  const prompt = model.calls[0]?.pageText ?? '';
  assert.ok(prompt.length > 0);
  assert.equal(model.calls[0]?.countryHint, 'FR');
});

// ────────────────────── rows through the real pipeline ─────────────────

// Distinct lines on purpose: the condenser collapses consecutive
// duplicates (repeated menu labels survive the structural drop on plenty
// of real sites), so a fixture of twelve identical paragraphs would
// condense to one line and trip the thin-page guard.
function listingLines(count: number, prefix: string): string {
  return Array.from({ length: count }, (_v, i) => `<p>${prefix} numéro ${i}, une épreuve en eau libre sur plusieurs distances</p>`).join('');
}

const HTML = `<body><h1>Calendrier 2026</h1>${listingLines(12, 'Course')}</body>`;

test('AI rows are normalised and scored by the same deterministic code as table rows', async () => {
  const result = await processAiPage('src-1', 'https://ffneaulibre.fr/calendrier', HTML, { countryCode: 'FR', sourceType: 'governing_body' }, fakeModel([row()]));

  assert.equal(result.called, true);
  assert.equal(result.rowsUsable, 1);
  const page = result.pages[0]!;

  // The distance parser ran — the model supplied only the printed text.
  assert.deepEqual(
    page.candidate.distances.map((d) => d.distanceMetres),
    [2400, 5000]
  );
  // The confidence score is arithmetic over the candidate, not anything
  // the model said about itself.
  assert.equal(typeof page.confidence.totalScore, 'number');
  assert.ok(page.confidence.reasons.length > 0);
});

test('every AI candidate is marked as AI-read, in the method, the evidence and the warnings', async () => {
  const result = await processAiPage('src-1', 'https://ffneaulibre.fr/calendrier', HTML, { countryCode: 'FR' }, fakeModel([row()]));
  const candidate = result.pages[0]!.candidate;

  assert.equal(candidate.extractionMethod, 'ai_fallback');
  assert.ok(candidate.evidence.length > 0);
  assert.ok(candidate.evidence.every((e) => e.evidenceType === 'ai_fallback'));
  assert.match(candidate.warnings.join(' '), /language model/);
  assert.equal(candidate.rawSourceValues.extractedByAi, true);
  assert.equal(candidate.rawSourceValues.extractedFromTable, false);
});

test('a model-supplied year is not trusted over the weekday check', async () => {
  // 14 February 2026 is a Saturday; 2027 is a Sunday. The resolver must
  // pick the year the weekday actually fits, whatever the page year says.
  const result = await processAiPage(
    'src-1',
    'https://x.test/c',
    `<body><h1>2026 season</h1>${listingLines(12, 'An open water swim')}</body>`,
    {},
    fakeModel([row({ name: 'Bay Swim', dateText: 'Sat 14 Feb', locationText: 'Boston, MA', distanceText: '5 km', url: null })])
  );
  const candidate = result.pages[0]!.candidate;
  assert.equal(candidate.startDate, '2026-02-14');
  assert.equal(candidate.dateConfirmed, true);
});

test('rows with no name, or with neither a date nor a place, are discarded', async () => {
  const result = await processAiPage(
    'src-1',
    'https://x.test/c',
    HTML,
    {},
    fakeModel([
      row(),
      row({ name: null }),
      row({ name: 'Nameless date', dateText: null, locationText: null }),
      row({ name: '   ' }),
    ])
  );
  assert.equal(result.rowsReturned, 4);
  assert.equal(result.rowsUsable, 1);
});

test('the model never supplies coordinates — a plausible latitude is not a known one', async () => {
  const result = await processAiPage('src-1', 'https://x.test/c', HTML, {}, fakeModel([row()]));
  const candidate = result.pages[0]!.candidate;
  assert.equal(candidate.latitude, null);
  assert.equal(candidate.longitude, null);
});

test('two rows that resolve to the same event are collapsed, not written twice', async () => {
  const result = await processAiPage('src-1', 'https://x.test/c', HTML, {}, fakeModel([row(), row()]));
  assert.equal(result.rowsReturned, 2);
  assert.equal(result.rowsUsable, 1);
});
