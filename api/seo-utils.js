// Shared SEO utilities — slug generation, domain mapping, Supabase fetch helpers.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';

const COMMON_HEADERS = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, Accept: 'application/json' };

export async function dbGet(path) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: COMMON_HEADERS });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function dbRpc(fn, params) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { ...COMMON_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/\s*[—–]\s*/g, '-')
    .replace(/\s+/g, '-')
    .replace(/['''()[\]/]/g, '')
    .replace(/&/g, 'and')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

export const DOMAIN_MAP = {
  WEST_COAST:   { display: 'West Coast',        region: 'west-coast' },
  ATLANTIC:     { display: 'Atlantic Seaboard',  region: 'atlantic' },
  FALSE_BAY:    { display: 'False Bay',          region: 'false-bay' },
  KZN:          { display: 'KwaZulu-Natal',      region: 'kwazulu-natal' },
  EASTERN_CAPE: { display: 'Eastern Cape',       region: 'eastern-cape' },
  GARDEN_ROUTE: { display: 'Garden Route',       region: 'garden-route' },
  SOUTH_COAST:  { display: 'South Coast',        region: 'south-coast' },
  INLAND:       { display: null,                 region: 'inland' },
  GAUTENG:      { display: 'Gauteng',            region: 'gauteng' },
  FREE_STATE:   { display: 'Free State',         region: 'free-state' },
  NAMIBIA:           { display: 'Namibia',            region: 'namibia' },
  NON_COASTAL:       { display: null,                 region: 'inland' },
  UK:                { display: 'United Kingdom',     region: 'united-kingdom' },
  EUROPE:            { display: 'Europe',             region: 'europe' },
  WESTERN_AUSTRALIA: { display: 'Western Australia',  region: 'western-australia' },
};

// For EUROPE domain spots, resolve a specific country label from the ISO code
export const EUROPE_COUNTRY_MAP = {
  CH: 'Switzerland',
  PT: 'Portugal',
  FR: 'France',
  DE: 'Germany',
  IT: 'Italy',
  ES: 'Spain',
  NL: 'Netherlands',
  BE: 'Belgium',
  AT: 'Austria',
  NO: 'Norway',
  SE: 'Sweden',
  DK: 'Denmark',
};

export const AREA_MAP = {
  CAPE_TOWN:       'Cape Town',
  JOHANNESBURG:    'Johannesburg',
  PRETORIA:        'Pretoria',
  DURBAN:          'Durban',
  GQEBERHA:        'Gqeberha',
  STELLENBOSCH:    'Stellenbosch',
  GEORGE:          'George',
  KIMBERLEY:       'Kimberley',
  BLOEMFONTEIN:    'Bloemfontein',
  MBOMBELA:        'Mbombela',
  EAST_LONDON:     'East London',
  HERMANUS:        'Hermanus',
  LANGEBAAN_LAGOON:'Langebaan',
  KNYSNA_LAGOON:   'Knysna',
  PLETT:           'Plettenberg Bay',
};

export const REGION_DOMAINS = {
  'west-coast':    ['WEST_COAST'],
  'atlantic':      ['ATLANTIC'],
  'false-bay':     ['FALSE_BAY'],
  'kwazulu-natal': ['KZN'],
  'eastern-cape':  ['EASTERN_CAPE'],
  'garden-route':  ['GARDEN_ROUTE'],
  'south-coast':   ['SOUTH_COAST'],
  'inland':        ['INLAND', 'NON_COASTAL'],
  'gauteng':       ['GAUTENG'],
  'free-state':    ['FREE_STATE'],
  'namibia':           ['NAMIBIA'],
  'united-kingdom':    ['UK'],
  'europe':            ['EUROPE'],
  'switzerland':       ['EUROPE'],           // CH spots live in EUROPE domain
  'portugal':          ['EUROPE'],           // PT spots live in EUROPE domain
  'western-australia': ['WESTERN_AUSTRALIA'],
  'australia':         ['WESTERN_AUSTRALIA'], // friendly alias
};

export const REGION_NAMES = {
  'west-coast':    'West Coast',
  'atlantic':      'Atlantic Seaboard',
  'false-bay':     'False Bay',
  'kwazulu-natal': 'KwaZulu-Natal',
  'eastern-cape':  'Eastern Cape',
  'garden-route':  'Garden Route',
  'south-coast':   'South Coast',
  'inland':        'Inland & Pools',
  'gauteng':       'Gauteng',
  'free-state':    'Free State',
  'namibia':           'Namibia',
  'united-kingdom':    'United Kingdom',
  'europe':            'Europe',
  'switzerland':       'Switzerland',
  'portugal':          'Portugal',
  'western-australia': 'Western Australia',
  'australia':         'Australia',
};

export const REGION_INTROS = {
  'west-coast':
    "The West Coast stretches north from Cape Town through Langebaan, Paternoster, and beyond. Water temperatures here are influenced by the cold Benguela current upwelling, typically ranging from 10–17°C year-round.",
  'atlantic':
    "The Atlantic Seaboard — from Sea Point to Llandudno and Camps Bay — is one of Cape Town's most iconic open water swimming zones. Cold Benguela current water keeps temperatures brisk, typically 10–16°C.",
  'false-bay':
    "False Bay is significantly warmer than the Atlantic side, with water temperatures often 3–5°C higher. Popular spots include Fish Hoek, Simons Town, Glencairn, and Gordons Bay.",
  'kwazulu-natal':
    "KwaZulu-Natal offers some of South Africa's warmest ocean swimming year-round, with water temperatures regularly exceeding 22°C. Popular spots include Umhlanga, Durban's beachfront, and the Dolphin Coast.",
  'eastern-cape':
    "The Eastern Cape coastline stretches from Gqeberha to East London, with water temperatures influenced by both the warm Agulhas current and cooler upwellings.",
  'garden-route':
    "The Garden Route offers a mix of ocean and lagoon swimming, with Knysna Lagoon and Sedgefield among the most popular spots.",
  'south-coast':
    "The Western Cape South Coast, including Hermanus and surrounds, offers sheltered swimming spots with water temperatures between the cold Atlantic and the warmer Agulhas system.",
  'inland':
    "SwimLoading tracks heated pool temperatures across South Africa's inland cities, helping swimmers plan training sessions year-round.",
  'gauteng':
    "Gauteng is South Africa's swimming heartland, with heated indoor and outdoor pools across Johannesburg and Pretoria. SwimLoading tracks pool temperatures so you know what to expect before you dive in.",
  'free-state':
    "SwimLoading tracks pool temperatures in Bloemfontein and the Free State, helping inland swimmers plan training sessions year-round.",
  'namibia':
    "SwimLoading is expanding into Namibia, tracking ocean temperatures at coastal spots including Swakopmund and Walvis Bay.",
  'united-kingdom':
    "SwimLoading is tracking open water temperatures across the United Kingdom — from the lakes and reservoirs of England to the wild coastlines of Scotland and Wales. Cold, clear, and growing fast.",
  'europe':
    "SwimLoading is expanding across Europe, tracking open water temperatures at lakes, rivers, and coastal spots. Find your local swim and see what the water is doing before you get in.",
  'western-australia':
    "Western Australia offers world-class open water swimming along its Indian Ocean coastline, from Perth's metropolitan beaches to remote coastal stretches. SwimLoading tracks water temperatures across WA's growing swim community.",
  'australia':
    "SwimLoading is live in Australia, tracking ocean and open water temperatures from Cottesloe Beach in Perth to the wider Australian swim community. International spots are shown with a gold border in the app.",
  'switzerland':
    "SwimLoading tracks lake swimming temperatures across Switzerland — including Lake Geneva spots like Gland Plage and Promenthoux. Swiss lake temperatures vary dramatically by season, from icy spring melt to warm summer swims.",
  'portugal':
    "SwimLoading is live in Portugal, tracking ocean temperatures along the Atlantic coast. Cascais — just west of Lisbon — is one of the most popular open water swimming destinations in Europe, with Atlantic water that swims warm in summer and cold and wild in winter.",
};

export function getLocationLabel(domain, area, countryCode) {
  const info = DOMAIN_MAP[domain];
  if (!info) return 'South Africa';
  // EUROPE domain: resolve to specific country if country_code is known
  if (domain === 'EUROPE' && countryCode && EUROPE_COUNTRY_MAP[countryCode]) {
    return EUROPE_COUNTRY_MAP[countryCode];
  }
  if (info.display) return info.display;
  return (area && AREA_MAP[area]) || 'South Africa';
}

export function getRegionSlug(domain) {
  return DOMAIN_MAP[domain]?.region || 'south-africa';
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-ZA', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}
