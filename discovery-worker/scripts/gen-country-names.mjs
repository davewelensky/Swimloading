// Regenerates src/normalize/country-names.ts from Node's own CLDR data.
//
// The country vocabulary used to be twelve hand-typed entries, which is why
// "Philippines" and "Greece" — both stated in plain text on the page —
// resolved to no country at all and published as countryless venues. A
// hand-maintained list will always be a list of the countries we happened
// to have crawled so far, so this generates the whole of ISO 3166-1 from
// Intl.DisplayNames instead of anyone typing 249 lines.
//
//   node scripts/gen-country-names.mjs > src/normalize/country-names.ts
//
// Re-run only when bumping Node (CLDR names shift occasionally, e.g.
// "Turkey" -> "Türkiye"). The ALIASES block below is hand-maintained on
// purpose: it holds the names real event pages use, which CLDR does not.

const CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ ' +
  'NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
)
  .split(/\s+/)
  .filter(Boolean);

// Must stay byte-identical to normaliseCountryName() in country-names.ts —
// the generated keys are matched against its output at runtime.
function normalise(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.,'’()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\bst\b/g, 'saint')
    .replace(/^the /, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Names real pages write that CLDR does not carry. Everything here is a
// name for a whole country — never a subdivision, and never a guess.
const ALIASES = {
  uk: 'GB',
  'great britain': 'GB',
  britain: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  usa: 'US',
  'united states of america': 'US',
  america: 'US',
  'republic of ireland': 'IE',
  holland: 'NL',
  'ivory coast': 'CI',
  burma: 'MM',
  'czech republic': 'CZ',
  turkey: 'TR',
  swaziland: 'SZ',
  macedonia: 'MK',
  'east timor': 'TL',
  vatican: 'VA',
  'holy see': 'VA',
  'hong kong': 'HK',
  macau: 'MO',
  macao: 'MO',
  uae: 'AE',
  'russian federation': 'RU',
  'south africa': 'ZA',
  'republic of south africa': 'ZA',
  'cabo verde': 'CV',
  palestine: 'PS',
  'trinidad and tobago': 'TT',
};

// Country names that are also a first-order subdivision somewhere we crawl,
// so reading one out of a bare comma segment is a coin flip. "Atlanta,
// Georgia" is not in the Caucasus. These resolve only from a field that
// explicitly means country (JSON-LD addressCountry), never from free text.
const AMBIGUOUS = ['georgia'];

const dn = new Intl.DisplayNames(['en'], { type: 'region' });
const byName = new Map();
for (const code of CODES) {
  const name = dn.of(code);
  if (!name || name === code) continue;
  const key = normalise(name);
  const existing = byName.get(key);
  if (existing && existing !== code) {
    console.error(`collision: "${key}" is both ${existing} and ${code} — skipped`);
    continue;
  }
  byName.set(key, code);
}
for (const [key, code] of Object.entries(ALIASES)) {
  const k = normalise(key);
  const existing = byName.get(k);
  if (existing && existing !== code) {
    console.error(`alias collision: "${k}" is ${existing} in CLDR but ${code} in ALIASES — CLDR wins`);
    continue;
  }
  byName.set(k, code);
}

const quote = (k) => (/^[a-z][a-z0-9]*$/.test(k) ? k : `'${k.replace(/'/g, "\\'")}'`);
const entries = [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]));

console.error(`${CODES.length} codes, ${entries.length} names`);

process.stdout.write(`// GENERATED FILE — do not edit by hand.
// Regenerate: node scripts/gen-country-names.mjs > src/normalize/country-names.ts
// Source: Node's Intl.DisplayNames (CLDR) plus the hand-maintained alias
// block in that script. See the script header for why this is generated.

// Every assigned ISO 3166-1 alpha-2 code. Used to reject a two-letter
// string that merely looks like a country code: "XX" is not a country, and
// storing it as one would be inventing a fact.
export const ISO_ALPHA2: ReadonlySet<string> = new Set([
${CODES.map((c) => `  '${c}',`).join('\n')}
]);

// Normalised English country name -> alpha-2. Keys are the output of
// normaliseCountryName(), so look up with that and nothing else.
export const COUNTRY_NAME_TO_CODE: Readonly<Record<string, string>> = {
${entries.map(([k, v]) => `  ${quote(k)}: '${v}',`).join('\n')}
};

// Names that are also a subdivision elsewhere — resolved only from a field
// that explicitly means "country", never from a trailing free-text segment.
export const AMBIGUOUS_COUNTRY_NAMES: ReadonlySet<string> = new Set([
${AMBIGUOUS.map((a) => `  '${a}',`).join('\n')}
]);
`);
