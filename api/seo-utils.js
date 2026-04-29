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
  WEST_COAST:   { display: 'West Coast',        region: 'cape-town' },
  ATLANTIC:     { display: 'Atlantic Seaboard',  region: 'cape-town' },
  FALSE_BAY:    { display: 'False Bay',          region: 'cape-town' },
  KZN:          { display: 'KwaZulu-Natal',      region: 'kwazulu-natal' },
  EASTERN_CAPE: { display: 'Eastern Cape',       region: 'eastern-cape' },
  GARDEN_ROUTE: { display: 'Garden Route',       region: 'garden-route' },
  SOUTH_COAST:  { display: 'South Coast',        region: 'south-coast' },
  INLAND:       { display: null,                 region: 'inland' },
  NAMIBIA:      { display: 'Namibia',            region: 'namibia' },
  NON_COASTAL:  { display: null,                 region: 'inland' },
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
  'cape-town':     ['WEST_COAST', 'ATLANTIC', 'FALSE_BAY'],
  'kwazulu-natal': ['KZN'],
  'eastern-cape':  ['EASTERN_CAPE'],
  'garden-route':  ['GARDEN_ROUTE'],
  'south-coast':   ['SOUTH_COAST'],
  'inland':        ['INLAND', 'NON_COASTAL'],
  'namibia':       ['NAMIBIA'],
};

export const REGION_NAMES = {
  'cape-town':     'Cape Town',
  'kwazulu-natal': 'KwaZulu-Natal',
  'eastern-cape':  'Eastern Cape',
  'garden-route':  'Garden Route',
  'south-coast':   'South Coast',
  'inland':        'Inland',
  'namibia':       'Namibia',
};

export const REGION_INTROS = {
  'cape-town':
    "Cape Town is home to some of South Africa's most popular open water swimming spots, from the cold Atlantic Seaboard to the warmer waters of False Bay. Conditions vary significantly between the two sides of the peninsula.",
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
  'namibia':
    "SwimLoading is expanding into Namibia, tracking ocean temperatures at coastal spots including Swakopmund and Walvis Bay.",
};

export function getLocationLabel(domain, area) {
  const info = DOMAIN_MAP[domain];
  if (!info) return 'South Africa';
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
