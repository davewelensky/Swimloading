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
    // Strip diacritics so accented names yield ASCII URLs. Without this,
    // 'Santa Ponça' → 'santa-ponça', which the handler (which does not
    // percent-decode the path) can never match — a guaranteed 404.
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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
  USA:               { display: 'United States',       region: 'san-francisco' },
  SEYCHELLES:        { display: 'Seychelles',          region: 'seychelles' },
  DALMATIA:          { display: 'Dalmatia',            region: 'dalmatia' },
  FRANCE:            { display: 'France',              region: 'france' },
  SPAIN:             { display: 'Spain',               region: 'spain' },
  THAILAND:          { display: 'Thailand',             region: 'thailand' },
  CANADA:            { display: 'Canada',               region: 'canada' },
};

// Country-code filter for region slugs that are sub-regions of a shared domain (e.g. EUROPE)
// If a slug appears here, the regional page only shows spots with that country_code
export const REGION_COUNTRY_FILTER = {
  'switzerland': 'CH',
  'portugal':    'PT',
  'france': 'FR',
  'spain':  'ES',
  'australia':   'AU',  // WESTERN_AUSTRALIA only has AU spots currently, but future-proof
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
  MALLORCA:        'Mallorca',
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
  'switzerland':       ['EUROPE'],           // CH spots — filtered by country_code
  'portugal':          ['EUROPE'],           // PT spots — filtered by country_code
  'western-australia': ['WESTERN_AUSTRALIA'],
  'australia':         ['WESTERN_AUSTRALIA'], // friendly alias
  'san-francisco':     ['USA'],
  'usa':               ['USA'],
  'seychelles':        ['SEYCHELLES'],
  'dalmatia':          ['DALMATIA'],
  'croatia':           ['DALMATIA'],
  'france':            ['FRANCE'],
  'spain':             ['SPAIN'],
  'thailand':          ['THAILAND'],
  'canada':            ['CANADA'],
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
  'san-francisco':     'San Francisco',
  'usa':               'United States',
  'seychelles':        'Seychelles',
  'dalmatia':          'Dalmatia, Croatia',
  'croatia':           'Dalmatia, Croatia',
  'france':            'France',
  'spain':             'Spain',
  'thailand':          'Thailand',
  'canada':            'Canada',
};

export const REGION_INTROS = {
  'west-coast':
    "The West Coast stretches north from Cape Town through Langebaan, Paternoster, and beyond — a wild, wind-scoured coastline shaped by the cold Benguela current that upwells from the deep Atlantic. Water temperatures here typically range from 10–17°C year-round, cold enough to demand a wetsuit for most swimmers but bracing and clear for those who brave it.\n\nLangebaan Lagoon is the standout open water venue — sheltered, relatively warm (temperatures can push into the low 20s in summer inside the lagoon), and the site of major open water races including the Berg River Classic finish. Ocean-side spots at Yzerfontein, Paternoster, and along the Strandveld are wilder, colder, and rarely crowded.\n\nSwimLoading tracks water temperatures across the West Coast so you know what to expect before you drive out. Community logs reflect actual conditions — not a monthly average from a buoy offshore. Whether you're planning a lagoon lap or a coastal open water session, the data comes from swimmers who were there.",
  'atlantic':
    "The Atlantic Seaboard — from Sea Point's promenade pools to the boulders at Llandudno and the white sand of Camps Bay — is Cape Town's most iconic open water swimming corridor. The cold Benguela current keeps temperatures honest year-round, typically 10–16°C, with the coldest readings in late summer when the south-easter drives upwelling along the coast.\n\nSea Point Pavilion is the heartbeat of Cape Town open water swimming — a tidal pool at the edge of the Atlantic where swimmers log before sunrise every day of the year. Sandy Bay, Clifton 4th, and Llandudno draw the more adventurous; they're beautiful but exposed, with swells and currents that demand respect. Mouille Point, with its gentle entry and reliable calm, is popular with beginners and those building mileage.\n\nSwimLoading Atlantic Seaboard data is community-logged — the temperature reading you see was submitted by a swimmer who got in that water, on that day. Check the latest log before heading out and add your own reading after your swim.",
  'false-bay':
    "False Bay is the warmer side of the Cape Peninsula — protected from the dominant south-wester and warmed by the Agulhas current that swings south from the east coast. Water temperatures run 3–5°C warmer than the Atlantic Seaboard, typically 14–20°C in summer, making it the preferred training ground for Cape Town open water swimmers looking for more comfortable conditions.\n\nFish Hoek Beach has a long tradition of organised open water swimming, with the False Bay Masters running regular club swims from the beach. Glencairn offers a sheltered tidal pool alongside ocean entry. Simons Town is popular with stronger swimmers; Gordons Bay and Rooiels draw those willing to make the drive for calmer, warmer water.\n\nFor Robben Island swimmers, False Bay conditions matter — the crossing ends in Atlantic water, so temperature variance across the bay is significant for race day planning. SwimLoading tracks both sides so you can compare what the water is actually doing.",
  'kwazulu-natal':
    "KwaZulu-Natal is South Africa's warm water province — the Indian Ocean coast runs from the Mozambique border south to the Wild Coast, and temperatures regularly sit above 22°C in summer, rarely dropping below 20°C even in midwinter. For swimmers, it's the closest South Africa gets to year-round warm water open water swimming without a wetsuit.\n\nDurban's beachfront is the hub, with the Bay of Plenty and North Beach hosting major ocean swims and the Durban surf lifesaving community. Umhlanga is the Northern Suburbs go-to — cleaner water, strong community, and a bustling lighthouse stretch ideal for point-to-point swims. The Dolphin Coast stretches north through Ballito and Salt Rock, with reef-sheltered swimming in calmer conditions.\n\nWater clarity and swell vary considerably along the KZN coast. Durban harbour outflow affects city beach conditions after heavy rain; the further north you go, the cleaner the water typically gets. SwimLoading community logs give you real-time visibility — what the water looked like, felt like, and whether any hazards were spotted on the day.",
  'eastern-cape':
    "The Eastern Cape coastline spans from Gqeberha (Port Elizabeth) east to East London and the Wild Coast — a long, varied stretch where the warm Agulhas current from the east meets cooler Atlantic-influenced water upwelling along the south coast. Water temperatures typically run 16–22°C depending on location and season, with Gqeberha running cooler and the East London area warmer.\n\nGqeberha's Kings Beach and Hobie Beach host the country's biggest open water racing events — the Iron Man triathlon and the Splash and Dash series draw competitive swimmers from across the country. The upwelling keeps visibility good and jellyfish seasonal. East London's Nahoon Beach is one of the best surf beaches in the country and a growing open water venue, with the Buffalo City community expanding steadily.\n\nSwimLoading is building its Eastern Cape community. If you swim in Gqeberha, East London, or along the Wild Coast, your logs help the whole region plan better.",
  'garden-route':
    "The Garden Route is South Africa's most scenic swimming corridor — from Mossel Bay east through George, Wilderness, Sedgefield, Knysna, Plettenberg Bay, and Nature's Valley to Storms River. The coastline alternates between sheltered lagoons, east-facing beaches warmed by the Agulhas current, and exposed headlands where swell drives in from the Southern Ocean.\n\nKnysna Lagoon is the signature open water venue — calm, warm (often 20°C+ in summer), and the setting for the renowned Knysna Oyster Festival swimathon. Sedgefield's Swartvlei Lagoon and Wilderness's Touw River mouth are quieter alternatives. Ocean-side at Plett and Wilderness, the Indian Ocean is noticeably warmer than the Atlantic coast — summer temperatures regularly reaching 18–21°C — while winter months can drop back to 15°C.\n\nFor pool swimmers, George is the main inland hub. SwimLoading tracks both lagoon and ocean temperatures along the Garden Route so you can plan whether today's session is in the lagoon or taking on the open sea.",
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
  'san-francisco':
    "San Francisco Bay is one of the world's great open water swimming venues. Aquatic Park — home of the legendary South End Rowing Club and Dolphin Club — offers year-round bay swimming in water that hovers between 12–16°C. The Pacific at Ocean Beach is wilder, colder, and not for the faint-hearted.",
  'usa':
    "SwimLoading is tracking open water temperatures across the United States, starting with San Francisco Bay. Aquatic Park's sheltered cove has a 50+ year tradition of year-round cold water swimming — one of the most dedicated open water communities anywhere in the world.",
  'seychelles':
    "SwimLoading is live in the Seychelles, tracking open water temperatures in the warm Indian Ocean. Beau Vallon on Mahé is the island's most popular swim beach — sheltered, warm, and stunning year-round.",
  'dalmatia':
    "The Dalmatian coast is one of Europe's finest open water swimming destinations — crystalline Adriatic water, island-dotted channels, and summer temperatures that peak at 25–27°C. SwimLoading tracks conditions in Hvar and Split, where the swimming season runs from May through October. Sea urchins on rocky entries are the main hazard; jellyfish are seasonal (July–September). Blue Flag beaches are the gold standard for water quality along the coast.",
  'croatia':
    "Croatia's Dalmatian coast offers some of the clearest and warmest open water swimming in the Mediterranean. SwimLoading tracks temperatures at Hvar Town Beach, the Pakleni Islands, and Split's beaches. The Adriatic is warmest in July–August (24–27°C) and swimmable from May through October.",
'france':
  "France's Mediterranean coastline offers some of Europe's finest open water swimming — warm, clear water, sheltered bays, and a year-round swimming culture rooted in the Côte d'Azur. Water temperatures along the French Riviera typically range from 13–14°C in winter to 24–26°C in summer, making it genuinely swimmable for most of the year.\n\nVillefranche-sur-Mer is one of the jewels of the coast — a deep natural harbour between Nice and Monaco with exceptionally clear water, minimal current, and a sheltered bay that stays calm even when the open sea is choppy. The old fishing village, colourful waterfront, and proximity to Nice make it one of the most picturesque open water venues in Europe.\n\nNice's Promenade des Anglais stretches 7 kilometres along the Baie des Anges — a pebble beach with easy water access and a strong local swimming tradition. The open water here is deeper and slightly more exposed than Villefranche but offers a spectacular urban swim backdrop year-round.\n\nSwimLoading is building its French community. If you swim along the Côte d'Azur, log your temperature and conditions — your data helps every swimmer planning a session on this coastline.",
  'spain':
    "Spain offers some of Europe's most varied open water swimming — from the sheltered Mediterranean bays of the Balearic Islands to the Atlantic surf of the north coast. SwimLoading's Spanish coverage starts in Mallorca at Santa Ponsa, a broad, sheltered sandy bay on the island's southwest coast with calm, clear water and easy access. The Balearic Sea is warmest in July–September (24–26°C), swimmable from May through October, and rarely drops below 14°C even in winter. Jellyfish are the main seasonal hazard — check local beach flags.\n\nSwimLoading is building its Spanish community. If you swim in Spain, log your temperature and conditions — your data helps every swimmer planning a session on this coastline.",
  'thailand':
    "Thailand offers warm, tropical open water swimming year-round in the Andaman Sea — the west coast washed by water that rarely drops below 27°C. SwimLoading's Thai coverage starts in Phuket, the country's largest island and its most established open water swimming and triathlon hub, with sheltered bays alongside more exposed, current-affected channels between the mainland and nearby islands.\n\nWater stays warm all year, so cold shock is not a concern — the real considerations are seasonal monsoon swell (roughly May–October, strongest on the west coast) and boat traffic in popular bays. Visibility varies with runoff after heavy rain but is generally good outside the wet season.\n\nSwimLoading is building its Thai community. If you swim in Phuket or elsewhere in Thailand, log your temperature and conditions — your data helps every swimmer planning a session in these waters.",
  'canada':
    "SwimLoading is expanding into Canada, starting on the Pacific coast in Vancouver, British Columbia. English Bay — with Second Beach and Kitsilano nearby — has a strong year-round open water community, cold Pacific water, and one of the world's great urban swim backdrops against the North Shore mountains.\n\nThe Pacific Northwest swims cold: English Bay typically runs 6–10°C in winter and 17–21°C at the summer peak, so cold water acclimatisation matters here the way it does in Cape Town or San Francisco. Summer brings warm, calm evenings and busy beaches; boat traffic and tidal currents in Burrard Inlet deserve respect year-round.\n\nSwimLoading is building its Canadian community. If you swim in Vancouver or anywhere in Canada, log your temperature and conditions — your data helps every swimmer planning a session in these waters.",
};

// Maps /countries/[slug] → the region slug that spots-handler should render.
// Adding a new country: add one entry here and the /countries/[slug] SEO page is live.
export const COUNTRY_SLUGS = {
  'south-africa':   'atlantic',           // redirect to SA's main region
  'namibia':        'namibia',
  'united-kingdom': 'united-kingdom',
  'australia':      'western-australia',
  'switzerland':    'switzerland',
  'portugal':       'portugal',
  'united-states':  'san-francisco',
  'seychelles':     'seychelles',
  'croatia':        'dalmatia',
  'france':         'france',
  'spain':          'spain',
  'thailand':       'thailand',
  'canada':         'canada',
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
