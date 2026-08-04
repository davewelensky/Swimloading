import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEvent } from '../src/extract/classify.js';
import { scoreCandidate } from '../src/confidence/score.js';
import { blankCandidateEvent } from '../src/domain/candidate-event.js';
import { runExtractionPipeline } from '../src/jobs/extract-pipeline.js';
import { makeLiveSourceRecord } from '../src/domain/source-record.js';

const NOW = { now: new Date('2026-08-04T00:00:00Z') };

function noHints(over: Partial<Parameters<typeof classifyEvent>[0]> = {}) {
  return { categoryHint: null, waterBodyHint: null, hasSeparateSwimEntry: null, ...over };
}

test('a real page with no fixture attributes still classifies from its own words', () => {
  // The regression that mattered: classifyEvent only read a fixture-only
  // data-category attribute, so EVERY real page came back 'unclassified'.
  const result = classifyEvent(noHints({ titleText: 'Open Water Swim' }));
  assert.equal(result.classification, 'official_race');
  assert.equal(result.eligible, true);
});

test('open-water wording is recognised across languages', () => {
  const cases: [string, string][] = [
    ['Traversée du lac d\'Annecy', 'fr'],
    ['Travesía a nado Isla de Tabarca', 'es'],
    ['Copenhagen Beach Swim — åbent vand', 'da'],
    ['Freiwasserschwimmen im Senftenberger See', 'de'],
    ['Travessia dos Fortes — águas abertas', 'pt'],
    ['Traversata dello Stretto — acque libere', 'it'],
    ['Sopocki Maraton Pływacki woda otwarta', 'pl'],
    ['Boğaziçi Kıtalararası Yüzme — açık su', 'tr'],
    ['Openwaterzwemmen Breskens', 'nl'],
    ['Avovesiuinnin SM-kilpailut', 'fi'],
  ];
  for (const [title, lang] of cases) {
    const r = classifyEvent(noHints({ titleText: title }));
    assert.equal(r.eligible, true, `${lang}: "${title}" should be eligible, got ${r.classification}`);
  }
});

test('pool and triathlon pages are still vetoed', () => {
  assert.equal(classifyEvent(noHints({ titleText: 'Winter Gala — 25m indoor pool' })).classification, 'pool_only');
  assert.equal(classifyEvent(noHints({ titleText: 'Ironman 70.3 Durban' })).classification, 'triathlon_only');
  // ...but a triathlon with a separately enterable swim is eligible.
  assert.equal(
    classifyEvent(noHints({ titleText: 'Cotswold Triathlon', hasSeparateSwimEntry: true })).classification,
    'official_race'
  );
  // An open-water race held at a venue that merely mentions a pool is NOT vetoed.
  assert.equal(
    classifyEvent(noHints({ titleText: 'Lake Crossing open water swim', descriptionText: 'Registration at the piscina' }))
      .classification,
    'official_race'
  );
});

test('event type is refined when the wording supports it', () => {
  assert.equal(classifyEvent(noHints({ titleText: 'Thomas O\'Connor Charity Swim — ocean swim' })).classification, 'charity_swim');
  assert.equal(classifyEvent(noHints({ titleText: 'Cape Town marathon swim' })).classification, 'marathon_swim');
});

test('a curated club source corroborates when the page text says nothing', () => {
  const bare = classifyEvent(noHints({ titleText: 'Summer Series Round 3' }));
  assert.equal(bare.classification, 'unclassified');

  const withSource = classifyEvent(noHints({ titleText: 'Summer Series Round 3', sourceType: 'club' }));
  assert.equal(withSource.eligible, true);
  // ...and it must be honest that this rests on the source, not the page.
  assert.equal(withSource.warnings.some((w) => w.includes('source type alone')), true);

  // An aggregator lists everything, so its type corroborates nothing.
  assert.equal(
    classifyEvent(noHints({ titleText: 'Summer Series Round 3', sourceType: 'aggregator' })).classification,
    'unclassified'
  );
});

test('unclassified is no longer a hard veto — it reaches a reviewer', () => {
  const c = blankCandidateEvent('src', 'https://example.com/e');
  c.canonicalName = 'Something Swimmy';
  c.officialUrl = 'https://example.com/e';
  c.registrationUrl = 'https://example.com/enter';
  c.startDate = '2027-03-01';
  c.dateConfirmed = true;
  c.datePrecision = 'exact';
  c.extractionMethod = 'jsonld';
  c.organiserName = 'Some Club';
  c.countryCode = 'ZA';

  const unclassified = { classification: 'unclassified' as const, eligible: false, discipline: 'open_water' as const, reasons: [], warnings: [] };
  const scored = scoreCandidate(c, unclassified, NOW);
  assert.notEqual(scored.recommendation, 'rejected');

  // A POSITIVE ineligibility signal still vetoes outright, whatever the score.
  const pool = { classification: 'pool_only' as const, eligible: false, discipline: 'open_water' as const, reasons: [], warnings: [] };
  assert.equal(scoreCandidate(c, pool, NOW).recommendation, 'rejected');
});

test('the DUC regression: a real club swim now reaches review instead of being rejected', () => {
  // Reproduces the live candidate Dave flagged — Point Watersports Club,
  // 29 Aug 2026, JSON-LD, official + registration URL, but no address and
  // nothing the old classifier could read. It scored 30 and was rejected.
  const html = `<html lang="en"><head>
    <script type="application/ld+json">{
      "@type":"Event","name":"Open Water Swim",
      "startDate":"2026-08-29",
      "url":"https://duc.co.za/events/open-water-swim/",
      "organizer":{"@type":"Organization","name":"Steve Evans"},
      "location":{"@type":"Place","name":"Point Watersports Club"},
      "offers":{"url":"https://duc.co.za/events/open-water-swim/"}
    }</script></head><body><h1>Open Water Swim</h1></body></html>`;

  const source = makeLiveSourceRecord('src', 'https://duc.co.za/events/open-water-swim/', html);
  const { candidate, classification, confidence } = runExtractionPipeline(source, {
    sourceType: 'club',
    countryCode: 'ZA',
  });

  assert.equal(candidate.canonicalName, 'Open Water Swim');
  assert.equal(candidate.startDate, '2026-08-29');
  assert.equal(classification.eligible, true);
  // Country filled from the curated source, and flagged as such.
  assert.equal(candidate.countryCode, 'ZA');
  assert.equal(candidate.warnings.some((w) => w.includes("source's own country")), true);
  // The point of the fix: no longer rejected.
  assert.notEqual(confidence.recommendation, 'rejected');
  assert.equal(confidence.totalScore > 30, true);
});
