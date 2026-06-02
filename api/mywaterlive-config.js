// ── my-water.live venue config ────────────────────────────────────────────────
// Maps SwimLoading spot slugs to my-water.live venue IDs.
//
// To add a new venue: add ONE entry here. No other code changes needed.
//   key   = the SwimLoading URL slug (e.g. 'tooting-bec-lido' from /spots/tooting-bec-lido)
//   id    = the my-water.live venue ID (from https://my-water.live/api/)
//   label = display name shown in the widget
//
export const VENUE_MAP = {
  'tooting-bec-lido': { id: '4kq1', label: 'Tooting Bec Lido', url: 'https://tbl.my-water.live'        },
  'brockwell-lido':   { id: '2kq1', label: 'Brockwell Lido',   url: 'https://brockwell.my-water.live'  },
};

// Server-side cache TTL ceiling in seconds.
// Water temperature changes slowly — 10 minutes is appropriate.
// The actual TTL per response may be shorter if my-water.live's
// refresh_hint_seconds is smaller than this value.
export const CACHE_TTL_SECONDS = 600;

// my-water.live API base URL (no trailing slash)
export const MW_API_BASE = 'https://api.my-water.live/v3/now';
