// Endpoint registry — single source of truth for what the smoke-test
// runner is allowed to call, and how. See docs/refactor/CHANGELOG.md for
// the two production incidents (both against /api/cron/purge-audit) that
// this exists to make structurally impossible to repeat — not just
// discouraged by a CLI flag, but refused in code regardless of flags.
//
// Every entry the runner touches MUST come from this registry, looked up
// by its unique `id` (NOT by path+method — the same URL can have multiple
// registry entries with very different risk profiles, e.g. "GET this cron
// path with no credential" vs "GET this cron path with a VALID credential"
// are the same path+method but must never be treated as the same call).
// An unregistered id is refused outright — there is no "assume it's safe"
// fallback.

export const CLASSIFICATIONS = ['PUBLIC_READ', 'AUTH_READ', 'AUTH_REJECTION', 'MUTATING', 'DESTRUCTIVE'];

// ids whose call must NEVER be invoked by this script, on any target,
// under any flag or token — regardless of what the registry entry itself
// says. A second, independent hard stop for endpoints with a documented
// incident history.
const PERMANENTLY_EXCLUDED_IDS = new Set([
  'purge-audit-success',
]);

function publicReadEntries(paths, expected_status) {
  return paths.map(path => ({
    id: `public-read:${path}`,
    path, method: 'GET',
    classification: 'PUBLIC_READ',
    mutates_state: false,
    safe_in_production: true,
    expected_status,
  }));
}

export const REGISTRY = [
  // ── Public pages ──────────────────────────────────────────────────────
  { id: 'home', path: '/', method: 'GET', classification: 'PUBLIC_READ', mutates_state: false, safe_in_production: true, expected_status: [200, 301], description: 'homepage' },
  { id: 'app-shell', path: '/app', method: 'GET', classification: 'PUBLIC_READ', mutates_state: false, safe_in_production: true, expected_status: [200], description: 'main app shell (auth is client-side beyond this)' },
  { id: 'clubs', path: '/clubs', method: 'GET', classification: 'PUBLIC_READ', mutates_state: false, safe_in_production: true, expected_status: [200], description: 'club directory' },
  { id: 'english-channel', path: '/crossings/english-channel', method: 'GET', classification: 'PUBLIC_READ', mutates_state: false, safe_in_production: true, expected_status: [200], description: 'crossing intelligence page' },
  { id: 'sitemap', path: '/sitemap.xml', method: 'GET', classification: 'PUBLIC_READ', mutates_state: false, safe_in_production: true, expected_status: [200], description: 'sitemap' },

  // ── Repo-doc / exposure sweep — expected 404 ─────────────────────────
  ...publicReadEntries([
    '/CLAUDE.md', '/PARTNERS.md', '/GROWTH_HUB.md', '/MIGRATIONS.md', '/EXPANDING.md', '/CLUB_ONBOARDING.md',
    '/Sponsors/', '/Sponsors/index.html',
    '/sql/MIGRATION_TEMPLATE.sql', '/sql/applied/rls_policies.sql',
    '/scripts/ship.sh', '/scripts/smoke-test-production.mjs',
    '/docs/refactor/README.md',
    '/14files/ONBOARDING_SQL.md', '/14files/liability-waiver.txt',
    '/archive/index.html', '/Deploy_SwimLoading/index.html',
    '/CLAUDE.md/', '/CLAUDE.MD',
  ], [404]),

  // ── Internal pages — page shell loads, protected content is client/RLS gated ──
  ...['dave', 'admin', 'PHtest', 'growth-hub', 'content-calendar', 'caption-agent'].map(name => ({
    id: `internal-page:${name}`,
    path: `/${name}`, method: 'GET',
    classification: 'AUTH_READ',
    mutates_state: false,
    safe_in_production: true,
    expected_status: [200],
    requires_noindex: true,
    description: 'internal page shell — loads for anyone, protected content is client/RLS gated',
  })),

  // ── Cron endpoints ────────────────────────────────────────────────────
  ...['purge-audit', 'sensor-import', 'marine-temps', 'venue-marine-temps', 'advance-challenge', 'observations-ndbc'].flatMap(name => {
    const path = `/api/cron/${name}`;
    return [
      { id: `${name}-no-auth`, path, method: 'GET', classification: 'AUTH_REJECTION', mutates_state: false, safe_in_production: true, expected_status: [401], description: 'no Authorization header' },
      { id: `${name}-wrong-auth`, path, method: 'GET', classification: 'AUTH_REJECTION', mutates_state: false, safe_in_production: true, expected_status: [401], description: 'wrong Authorization header', headers: { Authorization: 'Bearer definitely-not-the-real-secret' } },
      { id: `${name}-wrong-method`, path, method: 'POST', classification: 'AUTH_REJECTION', mutates_state: false, safe_in_production: true, expected_status: [405], description: 'unsupported method', headers: { Authorization: 'Bearer definitely-not-the-real-secret' } },
      { id: `${name}-success`, path, method: 'GET', classification: 'DESTRUCTIVE', mutates_state: true, safe_in_production: false, expected_status: [200], description: 'authorised success path — NEVER called by this script; registered for documentation only' },
    ];
  }),
];

const BY_ID = new Map(REGISTRY.map(e => [e.id, e]));

/**
 * Decides whether a call is allowed. Returns { allowed: boolean, reason?: string, entry? }.
 * This is the hard stop — call it before every request, keyed by the
 * registry entry's unique id, not by path+method (see file header).
 */
export function classifyCall(id, { target, allowDestructive = false, confirmToken = null }) {
  const entry = BY_ID.get(id);

  // Rule 3: unknown endpoints are refused outright — no assume-safe fallback.
  if (!entry) {
    return { allowed: false, reason: `Unregistered endpoint id "${id}" — refusing (not in endpoint-registry.mjs)` };
  }

  if (!CLASSIFICATIONS.includes(entry.classification)) {
    return { allowed: false, reason: `Invalid classification "${entry.classification}" on registry entry "${id}"` };
  }

  // Second, independent hard stop for endpoints with an incident history —
  // wins over everything else, including --allow-destructive + confirm token.
  if (PERMANENTLY_EXCLUDED_IDS.has(id)) {
    return { allowed: false, reason: `"${id}" is permanently excluded from testing (documented incident history) — cannot be overridden by any flag` };
  }

  if (target === 'production') {
    // Rules 1 & 2: production refuses MUTATING/DESTRUCTIVE and anything
    // that mutates state, full stop — --allow-destructive is not even
    // consulted here, it structurally cannot reach this branch.
    if (entry.classification === 'MUTATING' || entry.classification === 'DESTRUCTIVE') {
      return { allowed: false, reason: `Production refuses classification "${entry.classification}" for "${id}"` };
    }
    if (entry.mutates_state) {
      return { allowed: false, reason: `Production refuses mutates_state=true for "${id}"` };
    }
    if (!entry.safe_in_production) {
      return { allowed: false, reason: `Registry marks "${id}" as not safe_in_production` };
    }
    return { allowed: true, entry };
  }

  // target is local or preview
  if (entry.classification === 'MUTATING' || entry.classification === 'DESTRUCTIVE' || entry.mutates_state) {
    // Rule 5: explicit flag + explicit environment + explicit confirmation token.
    if (!allowDestructive) {
      return { allowed: false, reason: `"${id}" mutates state — requires --allow-destructive` };
    }
    if (target !== 'preview' && target !== 'local') {
      return { allowed: false, reason: `Destructive calls only permitted on preview/local (got target="${target}")` };
    }
    if (confirmToken !== 'CONFIRM-DESTRUCTIVE-TEST') {
      return { allowed: false, reason: 'Destructive calls require --confirm-token=CONFIRM-DESTRUCTIVE-TEST (exact literal)' };
    }
    return { allowed: true, entry };
  }

  return { allowed: true, entry };
}

export function lookup(id) {
  return BY_ID.get(id) || null;
}
