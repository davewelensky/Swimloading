// ── my-water.live venue config ────────────────────────────────────────────────
// Maps SwimLoading spot slugs to my-water.live venue data.
//
// To add a new venue: add ONE entry here. No other code changes needed.
//   id       = my-water.live venue ID (from https://my-water.live/api/)
//   label    = short display name
//   url      = direct link to Peter's venue page
//   headline = one-line venue description shown as sub-heading
//   built    = year opened
//   poolSize = dimensions
//   type     = key characteristic tags
//   desc     = 2–3 sentence venue description shown in the hero
//   facts    = 3–4 bullet facts shown in the feature card

export const VENUE_MAP = {

  'tooting-bec-lido': {
    id:       '4kq1',
    label:    'Tooting Bec Lido',
    url:      'https://tbl.my-water.live',
    headline: 'The UK\'s largest outdoor freshwater pool',
    built:    1906,
    poolSize: '91m × 30m',
    type:     'Unheated · Freshwater · Open air',
    desc:     'Opened in 1906 on Tooting Bec Common, Tooting Bec Lido holds over one million gallons of unheated freshwater — making it the largest freshwater swimming pool by surface area in the UK. The South London Swimming Club (SLSC) keeps it open year-round for cold water swimmers. Brad Pitt filmed his boxing scene from Snatch in those famous coloured cubicles.',
    facts: [
      '91.4m long · largest freshwater pool in the UK by surface area',
      'Unheated freshwater · cool and bracing year-round',
      'Opened 1906 · over 118 years of open water history',
      'Iconic red, yellow and green changing cubicles · Grade II listed',
    ],
  },

  'brockwell-lido': {
    id:       '2kq1',
    label:    'Brockwell Lido',
    url:      'https://brockwell.my-water.live',
    headline: 'South London\'s Grade II listed outdoor pool',
    built:    1937,
    poolSize: '50m',
    type:     'Open air · Herne Hill · Lambeth',
    desc:     'Opened in July 1937 and awarded Grade II listed status in 2003, Brockwell Lido is one of London\'s most loved outdoor pools. After closing in 1990, the local community campaigned to reopen it — and succeeded. Today it\'s home to the Brockwell Icicles winter swimming group and Brockwell Swimmers club.',
    facts: [
      '50m outdoor pool · Grade II listed Moderne architecture',
      'Opened 1937 · closed 1990 · saved and reopened by community campaign in 1994',
      'Home to the Brockwell Icicles winter swimming group',
      'Herne Hill, London Borough of Lambeth',
    ],
  },

};

// Server-side cache TTL ceiling in seconds.
// Water temperature changes slowly — 10 minutes is fine.
// Actual TTL may be lower if refresh_hint_seconds from the API is smaller.
export const CACHE_TTL_SECONDS = 600;

// my-water.live API base URL (no trailing slash)
export const MW_API_BASE = 'https://api.my-water.live/v3/now';
