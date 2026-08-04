import { EVENT_TYPES, type Classification, type Discipline, type EventType } from '../domain/enums.js';

export interface ClassificationInput {
  categoryHint: string | null;
  waterBodyHint: string | null;
  hasSeparateSwimEntry: boolean | null;
  // Real-world text signals. Fixtures declare a categoryHint attribute;
  // no actual website does, so without these every real page classified
  // as 'unclassified' — which scoreCandidate treats as a hard veto,
  // force-rejecting perfectly good candidates. See the note below.
  titleText?: string | null;
  descriptionText?: string | null;
  urlPath?: string | null;
  // discovery_sources.source_type for the source this page came from.
  // A club or open-water governing body publishing a dated swim is
  // meaningful corroboration, and it is admin-curated rather than
  // inferred — we chose to trust that source when we enabled it.
  sourceType?: string | null;
}

export interface ClassificationResult {
  classification: Classification;
  eligible: boolean;
  // 'open_water' unless the page is a multisport race whose swim leg we
  // could actually identify. Never inferred from the event's name alone.
  discipline: Discipline;
  reasons: string[];
  warnings: string[];
}

const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);

// ── Multilingual signal vocabularies ────────────────────────────────────
// Matched against diacritic-folded, lowercased text, so "travesía" and
// "travesia" both hit. Kept as phrases rather than single words wherever
// a single word would be ambiguous ("swim" alone means very little).

const OPEN_WATER_PHRASES = [
  // English
  'open water', 'openwater', 'ows', 'sea swim', 'ocean swim', 'lake swim', 'river swim',
  'bay swim', 'harbour swim', 'harbor swim', 'island swim', 'crossing', 'marathon swim',
  'channel swim', 'wild swim', 'beach swim', 'pier to pub', 'round the island',
  // Spanish / Portuguese
  'aguas abiertas', 'agua abierta', 'travesia', 'cruce a nado', 'aguas abertas',
  'travessia', 'maratona aquatica', 'mar aberto',
  // French
  'eau libre', 'traversee', 'nage en eau libre', 'nage libre en mer',
  // German
  'freiwasser', 'freigewasser', 'seequerung', 'seeuberquerung', 'seeschwimmen',
  // Italian
  'acque libere', 'traversata', 'nuoto in acque libere', 'miglio marino',
  // Dutch
  'openwaterzwemmen', 'open water zwemmen', 'zwemloop',
  // Nordic
  'abent vand', 'apent vann', 'oppet vatten', 'oppetvatten', 'avovesi', 'avovesiuinti',
  'vidavatnssund', 'havsim',
  // Polish / Czech / Croatian / Slovenian
  'woda otwarta', 'wody otwarte', 'plywanie na wodach otwartych', 'daljinsko plivanje',
  'otvorene vode', 'dalkove plavani',
  // Turkish / Greek
  'acik su', 'acik deniz', 'bogaz', 'anoichtis thalassis', 'diaplous',
  // Japanese (romanised + native)
  'オープンウォーター', '遠泳', '横断',
];

// A pool signal is a hard veto — an indoor gala is never an open-water
// opportunity however well it scores otherwise.
const POOL_PHRASES = [
  'swimming pool', 'indoor pool', 'piscina', 'piscine', 'hallenbad', 'schwimmhalle',
  'zwembad', 'simhall', 'uimahalli', 'basen', 'bazen', 'kapali havuz',
  'short course', 'long course', '25m pool', '50m pool', 'scm', 'lcm',
];

// A multisport page states its swim leg explicitly or it does not. This
// looks for a distance sitting next to a swim word — "1.9 km swim",
// "natation : 1,9 km", "水泳 1.5km" — which is the page telling us how far
// the swim is, in its own words.
//
// The old gate for this was `hasSeparateSwimEntry`, read from a
// `.category-hint[data-separate-swim-entry]` attribute that exists only in
// the test fixtures. On every real page it is null, so the include path
// was unreachable and 94 of 787 candidates — 12% of everything crawled —
// were discarded by a rule that had never once evaluated real evidence.
//
// Requiring the distance is deliberate. A triathlon page lists bike and
// run distances too, so "any number on the page" would file a 90km bike
// leg as a swim. The swim word has to be adjacent.
const SWIM_WORDS =
  'swim|swimming|nage|natation|nuoto|nado|natacao|natacion|schwimmen|zwemmen|simning|svomming|uinti|plywanie|plivanje|yuzme|kolympi|水泳|スイム';
const DISTANCE_UNIT = '(?:km|k|m|mi|miles?|metres?|meters?|kms)';

const SWIM_LEG_PATTERNS: RegExp[] = [
  // "1.9 km swim", "3,8km natation"
  new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${DISTANCE_UNIT}\\s*(?:of\\s+)?(?:${SWIM_WORDS})\\b`, 'i'),
  // "swim: 1.9 km", "natation 1,9 km", "Schwimmen – 3.8 km"
  new RegExp(`(?:${SWIM_WORDS})\\s*[:\\-–—]?\\s*(\\d+(?:[.,]\\d+)?)\\s*${DISTANCE_UNIT}\\b`, 'i'),
];

// fold() replaces every non-alphanumeric run with a space, which is right
// for phrase matching and fatal for distances: "1.9km" becomes "1 9km" and
// "3,8 km" becomes "3 8 km", so Ironman 70.3 and every European decimal
// silently failed to register a swim leg. This keeps the separators.
function foldKeepingNumbers(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}.,:–—-]+/gu, ' ')
    .trim();
}

function foldedText(input: ClassificationInput): string {
  return [
    foldKeepingNumbers(input.titleText),
    foldKeepingNumbers(input.descriptionText),
    foldKeepingNumbers(input.urlPath),
  ]
    .filter(Boolean)
    .join(' ');
}

function statedSwimLeg(text: string): string | null {
  for (const re of SWIM_LEG_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0].trim();
  }
  return null;
}

const TRIATHLON_PHRASES = [
  'triathlon', 'triatlon', 'triathlete', 'aquathlon', 'aquabike', 'swimrun',
  'ironman', 'duathlon',
];

// Words that suggest a page is a past-results write-up rather than an
// upcoming opportunity.
const RESULT_PHRASES = [
  'results', 'resultados', 'resultats', 'ergebnisse', 'risultati', 'uitslagen',
  'wyniki', 'sonuclar', 'race report', 'recap',
];

// Event-type refinements, checked only once we know it IS open water.
const TYPE_PHRASES: { type: EventType; phrases: string[] }[] = [
  { type: 'charity_swim', phrases: ['charity', 'fundrais', 'in aid of', 'beneficio', 'caritativ'] },
  { type: 'marathon_swim', phrases: ['marathon swim', 'maratona', 'maraton', 'ultra swim', 'channel swim'] },
  { type: 'swim_festival', phrases: ['festival', 'swim week', 'fest'] },
  { type: 'guided_swim', phrases: ['guided', 'escorted', 'gefuhrt', 'guiada'] },
  { type: 'swim_camp', phrases: ['camp', 'clinic', 'training week', 'stage de'] },
  { type: 'recurring_group_swim', phrases: ['weekly', 'every saturday', 'every sunday', 'club swim', 'social swim'] },
];

function fold(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function matchAny(haystack: string, phrases: string[]): string | null {
  for (const p of phrases) {
    const needle = fold(p);
    if (needle && haystack.includes(needle)) return p;
  }
  return null;
}

// Source types we accept as corroboration that a dated swim listing is an
// open-water opportunity. An 'aggregator' is excluded on purpose: it lists
// everything, so its nature tells us nothing about any single event.
const SWIM_AUTHORITY_SOURCE_TYPES = new Set(['club', 'organiser', 'governing_body']);

// Deterministic classification. Explicit page signals win; multilingual
// keyword matching is the real-world path; the source's curated type is
// corroboration of last resort, never a sole basis on its own.
//
// Every branch records WHY in `reasons`, so a reviewer can see exactly
// which signal drove the decision — no opaque judgements.
export function classifyEvent(input: ClassificationInput): ClassificationResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  // ── 1. Explicit fixture-style hints keep top priority ──
  if (input.waterBodyHint === 'pool') {
    reasons.push('waterBodyHint is "pool" — indoor/pool events are not open-water swim opportunities');
    return { classification: 'pool_only', eligible: false, discipline: 'open_water', reasons, warnings };
  }

  if (input.categoryHint === 'triathlon') {
    if (input.hasSeparateSwimEntry === true) {
      reasons.push('triathlon with a separately enterable swim leg — eligible as a standalone race entry');
      return { classification: 'official_race', eligible: true, discipline: 'open_water', reasons, warnings };
    }
    const legFromHint = statedSwimLeg(foldedText(input));
    if (legFromHint) {
      reasons.push(`triathlon page stating its swim leg ("${legFromHint}") — the swim is catalogued, the race is not`);
      // Same caveat whichever branch identified the leg. A reviewer must
      // never have to know which code path ran to learn that entry is
      // normally for the whole race.
      warnings.push(
        'This is the swim leg of a multisport race, not a standalone open-water swim — entry is normally for the whole race'
      );
      return { classification: 'official_race', eligible: true, discipline: 'multisport_swim_leg', reasons, warnings };
    }
    warnings.push(
      'Multisport page that never states its swim distance — nothing to catalogue as a swim, so it is excluded rather than guessed at'
    );
    reasons.push('triathlon page with no separately enterable swim leg and no stated swim distance');
    return { classification: 'triathlon_only', eligible: false, discipline: 'open_water', reasons, warnings };
  }

  if (input.categoryHint === 'historical_result') {
    reasons.push('page is a historical race-result article, not a listing for an upcoming opportunity');
    return { classification: 'historical_result', eligible: false, discipline: 'open_water', reasons, warnings };
  }
  if (input.categoryHint === 'tourism') {
    reasons.push('page is general beach/tourism content with no specific swim opportunity');
    return { classification: 'general_tourism_page', eligible: false, discipline: 'open_water', reasons, warnings };
  }
  if (input.categoryHint === 'no_opportunity') {
    reasons.push('page mentions swimming but offers no actual bookable/enterable opportunity');
    return { classification: 'no_actual_opportunity', eligible: false, discipline: 'open_water', reasons, warnings };
  }
  if (input.categoryHint !== null && EVENT_TYPE_SET.has(input.categoryHint)) {
    const eventType = input.categoryHint as EventType;
    reasons.push(`categoryHint matched a known event type: ${eventType}`);
    return { classification: eventType, eligible: true, discipline: 'open_water', reasons, warnings };
  }

  // ── 2. Real-world text signals ──
  const text = [fold(input.titleText), fold(input.descriptionText), fold(input.urlPath)]
    .filter(Boolean)
    .join(' ');

  if (text) {
    const pool = matchAny(text, POOL_PHRASES);
    const openWater = matchAny(text, OPEN_WATER_PHRASES);

    // Pool wins only when nothing marks it as open water — plenty of
    // open-water events legitimately mention a pool (registration venue,
    // qualifying times).
    if (pool && !openWater && input.waterBodyHint !== 'sea' && input.waterBodyHint !== 'lake') {
      reasons.push(`pool indicator "${pool}" found and no open-water signal — treated as a pool event`);
      return { classification: 'pool_only', eligible: false, discipline: 'open_water', reasons, warnings };
    }

    const triathlon = matchAny(text, TRIATHLON_PHRASES);
    if (triathlon && !openWater) {
      if (input.hasSeparateSwimEntry === true) {
        reasons.push(`multisport indicator "${triathlon}" but a separately enterable swim is declared`);
        return { classification: 'official_race', eligible: true, discipline: 'open_water', reasons, warnings };
      }
      // The page states how far the swim is. That is the swim leg, in the
      // organiser's own words — enough to catalogue the SWIM, which is
      // what a triathlete is choosing between and the part that decides
      // whether they finish.
      const leg = statedSwimLeg(foldedText(input));
      if (leg) {
        reasons.push(`multisport event stating its swim leg ("${leg}") — catalogued as a swim, flagged as a multisport leg`);
        warnings.push(
          'This is the swim leg of a multisport race, not a standalone open-water swim — entry is normally for the whole race'
        );
        return { classification: 'official_race', eligible: true, discipline: 'multisport_swim_leg', reasons, warnings };
      }
      reasons.push(`multisport indicator "${triathlon}" and no stated swim distance to catalogue`);
      return { classification: 'triathlon_only', eligible: false, discipline: 'open_water', reasons, warnings };
    }

    const resultish = matchAny(text, RESULT_PHRASES);

    if (openWater) {
      if (resultish) {
        warnings.push(`open-water event but the page also reads as a results page ("${resultish}") — check it is an upcoming edition`);
      }
      // Refine the event type where the wording supports it; default to
      // the neutral 'official_race' rather than inventing a specific type.
      for (const { type, phrases } of TYPE_PHRASES) {
        const hit = matchAny(text, phrases);
        if (hit) {
          reasons.push(`open-water signal "${openWater}" plus "${hit}" — classified as ${type}`);
          return { classification: type, eligible: true, discipline: 'open_water', reasons, warnings };
        }
      }
      reasons.push(`open-water signal "${openWater}" found in the page text`);
      return { classification: 'official_race', eligible: true, discipline: 'open_water', reasons, warnings };
    }

    if (resultish) {
      reasons.push(`page reads as a results/report page ("${resultish}") rather than an upcoming opportunity`);
      return { classification: 'historical_result', eligible: false, discipline: 'open_water', reasons, warnings };
    }
  }

  // ── 3. Source-type corroboration ──
  // Reached only when the text carried no decisive signal. A curated club,
  // organiser or open-water governing body publishing a swim listing is
  // reasonable grounds to put it in front of a reviewer — but it is weak
  // evidence, so it is flagged as such and confidence scoring still has to
  // carry it over the publication threshold on the strength of its facts.
  if (input.sourceType && SWIM_AUTHORITY_SOURCE_TYPES.has(input.sourceType)) {
    reasons.push(
      `no explicit open-water wording, but the source is a curated ${input.sourceType} — classified provisionally for review`
    );
    warnings.push('classification rests on the source type alone, not on anything the page itself says');
    return { classification: 'official_race', eligible: true, discipline: 'open_water', reasons, warnings };
  }

  warnings.push(input.categoryHint === null ? 'no category hint found on page' : `unrecognized category hint: "${input.categoryHint}"`);
  reasons.push('insufficient signal to classify this page');
  return { classification: 'unclassified', eligible: false, discipline: 'open_water', reasons, warnings };
}
