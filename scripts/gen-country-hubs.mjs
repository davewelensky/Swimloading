// Regenerates api/_countries.js — the single source of truth for country
// hub slugs and display names.
//
//   node scripts/gen-country-hubs.mjs > api/_countries.js
//
// Why this is generated. The hub list used to be twenty entries typed by
// hand in api/events-handler.js, and the SAME twenty typed again in
// api/sitemap-dynamic.js. On 5 Aug 2026 the catalogue had live events in
// 31 countries, so 16 of them — the Philippines, Sweden, Hong Kong, the
// UAE and twelve more — had no reachable hub at all, and nobody noticed
// because nothing fails when a hand-written list falls behind. It is the
// same failure that quietly dropped welcome.html's footer to 7 of 12
// countries in July. CLAUDE.md's rule is explicit: never hand-write a
// per-country list.
//
// Slugs are PERMANENT — a live URL must never change — so every slug that
// has already shipped is pinned in SLUG_OVERRIDES below and the generator
// is not allowed to compute a different one. The check at the bottom fails
// the build if it ever does.

const CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ ' +
  'NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(/\s+/).filter(Boolean);

// Already live. Changing any of these breaks a URL Google has indexed.
const SLUG_OVERRIDES = {
  ZA: 'south-africa', US: 'united-states', GB: 'united-kingdom', FR: 'france',
  CA: 'canada', GR: 'greece', DK: 'denmark', ES: 'spain', IT: 'italy',
  IE: 'ireland', AU: 'australia', BB: 'barbados', NZ: 'new-zealand',
  TR: 'turkiye', PT: 'portugal', HR: 'croatia', JP: 'japan', PL: 'poland',
  BR: 'brazil', MX: 'mexico',
  // Not yet live, but CLDR's names make hideous slugs — pin them before
  // they ship rather than after, because then it is too late.
  HK: 'hong-kong', MO: 'macau', MM: 'myanmar', VI: 'us-virgin-islands',
  CI: 'cote-divoire', TL: 'timor-leste', PS: 'palestine',
};

// Countries whose English name takes a definite article. "Open Water Swims
// in Philippines" reads like a machine wrote it, because one did.
const TAKES_THE = new Set(['US', 'GB', 'PH', 'AE', 'DO', 'NL', 'BS', 'MV', 'GM', 'CZ', 'CD', 'CG']);

const NAME_OVERRIDES = {
  HK: 'Hong Kong', MO: 'Macau', MM: 'Myanmar', CZ: 'the Czech Republic',
  CD: 'the Democratic Republic of the Congo', CG: 'the Republic of the Congo',
  VI: 'the US Virgin Islands',
};

function slugify(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bst\.\s*/g, 'saint ')
    .replace(/\s*sar china\b/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const dn = new Intl.DisplayNames(['en'], { type: 'region' });
const entries = [];
const seenSlug = new Map();

for (const code of CODES) {
  const cldr = dn.of(code);
  if (!cldr || cldr === code) continue;

  const slug = SLUG_OVERRIDES[code] ?? slugify(cldr);
  const computed = slugify(cldr);
  if (SLUG_OVERRIDES[code] && SLUG_OVERRIDES[code] !== computed) {
    console.error(`pinned: ${code} "${cldr}" -> ${SLUG_OVERRIDES[code]} (would compute "${computed}")`);
  }
  if (seenSlug.has(slug)) {
    throw new Error(`slug collision: "${slug}" wanted by both ${seenSlug.get(slug)} and ${code}`);
  }
  seenSlug.set(slug, code);

  const base = NAME_OVERRIDES[code] ?? (TAKES_THE.has(code) ? `the ${cldr}` : cldr);
  entries.push([code, slug, base]);
}

// Any already-live slug that vanished would be a 404 on an indexed URL.
for (const [code, slug] of Object.entries(SLUG_OVERRIDES)) {
  if (!entries.some((e) => e[0] === code && e[1] === slug)) {
    throw new Error(`live slug lost: ${code} -> ${slug}`);
  }
}

console.error(`${entries.length} countries, ${Object.keys(SLUG_OVERRIDES).length} pinned slugs`);

process.stdout.write(`// GENERATED FILE — do not edit by hand.
// Regenerate: node scripts/gen-country-hubs.mjs > api/_countries.js
//
// One source of truth for country hub slugs and names, replacing the two
// hand-typed twenty-country lists that used to live in events-handler.js
// and sitemap-dynamic.js and drift apart. A country appearing in the data
// now gets a hub with no code change at all — which is the whole point,
// because 16 countries with live events had no hub on 5 Aug 2026.
//
// SLUGS ARE PERMANENT. Every slug that has shipped is pinned in the
// generator and it throws if one would change.

export const COUNTRIES = Object.freeze({
${entries.map(([code, slug, name]) => `  ${code}: { slug: '${slug}', name: ${JSON.stringify(name)} },`).join('\n')}
});

const BY_SLUG = Object.freeze(Object.fromEntries(
  Object.entries(COUNTRIES).map(([code, c]) => [c.slug, { code, ...c }])
));

// Resolve a URL slug to a country, or null if it is not one. Callers use
// null to fall through to the next namespace (a bookable route), exactly
// as the hand-written map did.
export function countryBySlug(slug) {
  return BY_SLUG[String(slug || '').toLowerCase()] || null;
}

export function countryByCode(code) {
  const c = COUNTRIES[String(code || '').toUpperCase()];
  return c ? { code: String(code).toUpperCase(), ...c } : null;
}
`);
