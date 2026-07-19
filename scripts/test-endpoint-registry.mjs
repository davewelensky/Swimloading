#!/usr/bin/env node
// Unit tests for scripts/lib/endpoint-registry.mjs — proves the production
// hard stop cannot be bypassed by any combination of flags. No network
// calls. Safe anywhere, anytime.
//
// Usage: node scripts/test-endpoint-registry.mjs

import { classifyCall, REGISTRY } from './lib/endpoint-registry.mjs';

let pass = 0;
let fail = 0;

function check(label, condition) {
  if (condition) { pass++; console.log(`  OK   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
}

console.log('Endpoint registry — unit tests\n');

// ── Every entry has a unique id, a valid classification, consistent flags ──
const ids = new Set();
for (const e of REGISTRY) {
  check(`entry "${e.id}" has a unique id`, !ids.has(e.id));
  ids.add(e.id);

  check(
    `entry "${e.id}" has a valid classification`,
    CLASSIFICATIONS_INCLUDES(e.classification)
  );
  if (e.classification === 'DESTRUCTIVE' || e.classification === 'MUTATING') {
    check(`"${e.id}" (${e.classification}) is marked mutates_state=true`, e.mutates_state === true);
    check(`"${e.id}" (${e.classification}) is marked safe_in_production=false`, e.safe_in_production === false);
  }
}
function CLASSIFICATIONS_INCLUDES(c) {
  return ['PUBLIC_READ', 'AUTH_READ', 'AUTH_REJECTION', 'MUTATING', 'DESTRUCTIVE'].includes(c);
}

// ── Production hard stop: DESTRUCTIVE never allowed, no matter the flags ──
const destructiveEntries = REGISTRY.filter(e => e.classification === 'DESTRUCTIVE');
check('registry contains at least one DESTRUCTIVE entry to test against', destructiveEntries.length > 0);

for (const e of destructiveEntries) {
  const r1 = classifyCall(e.id, { target: 'production' });
  check(`production refuses "${e.id}" with no flags`, r1.allowed === false);

  const r2 = classifyCall(e.id, { target: 'production', allowDestructive: true });
  check(`production refuses "${e.id}" even with --allow-destructive`, r2.allowed === false);

  const r3 = classifyCall(e.id, { target: 'production', allowDestructive: true, confirmToken: 'CONFIRM-DESTRUCTIVE-TEST' });
  check(`production refuses "${e.id}" even with --allow-destructive AND the correct confirm token`, r3.allowed === false);
}

// ── purge-audit specifically: permanently excluded even on preview/local ──
check('purge-audit-success entry exists in the registry', REGISTRY.some(e => e.id === 'purge-audit-success'));
const rPreview = classifyCall('purge-audit-success', { target: 'preview', allowDestructive: true, confirmToken: 'CONFIRM-DESTRUCTIVE-TEST' });
check('purge-audit-success refused even on preview with every flag correct (permanent exclusion)', rPreview.allowed === false);
const rLocal = classifyCall('purge-audit-success', { target: 'local', allowDestructive: true, confirmToken: 'CONFIRM-DESTRUCTIVE-TEST' });
check('purge-audit-success refused even on local with every flag correct (permanent exclusion)', rLocal.allowed === false);

// ── AUTH_REJECTION calls to purge-audit are NOT excluded (only the success path is) ──
const rAuthRejection = classifyCall('purge-audit-no-auth', { target: 'production' });
check('purge-audit-no-auth (AUTH_REJECTION) is still allowed on production — only the success path is excluded', rAuthRejection.allowed === true);

// ── Preview/local: destructive calls DO require all three of flag + env + token ──
const otherDestructive = destructiveEntries.find(e => e.id !== 'purge-audit-success');
if (otherDestructive) {
  const noFlag = classifyCall(otherDestructive.id, { target: 'preview' });
  check(`preview refuses "${otherDestructive.id}" with no --allow-destructive`, noFlag.allowed === false);

  const flagNoToken = classifyCall(otherDestructive.id, { target: 'preview', allowDestructive: true });
  check(`preview refuses "${otherDestructive.id}" with --allow-destructive but no confirm token`, flagNoToken.allowed === false);

  const flagWrongToken = classifyCall(otherDestructive.id, { target: 'preview', allowDestructive: true, confirmToken: 'wrong-token' });
  check(`preview refuses "${otherDestructive.id}" with an incorrect confirm token`, flagWrongToken.allowed === false);

  const allCorrect = classifyCall(otherDestructive.id, { target: 'preview', allowDestructive: true, confirmToken: 'CONFIRM-DESTRUCTIVE-TEST' });
  check(`preview allows "${otherDestructive.id}" with flag + preview target + correct token, all three present`, allCorrect.allowed === true);

  const localAllCorrect = classifyCall(otherDestructive.id, { target: 'local', allowDestructive: true, confirmToken: 'CONFIRM-DESTRUCTIVE-TEST' });
  check(`local allows "${otherDestructive.id}" with flag + local target + correct token, all three present`, localAllCorrect.allowed === true);
}

// ── Unknown / unregistered ids are refused, not assumed safe ──────────────
const unknown = classifyCall('some-future-endpoint-nobody-registered', { target: 'production' });
check('unregistered id is refused on production (no assume-safe fallback)', unknown.allowed === false);
const unknownLocal = classifyCall('some-future-endpoint-nobody-registered', { target: 'local', allowDestructive: true, confirmToken: 'CONFIRM-DESTRUCTIVE-TEST' });
check('unregistered id is refused on local even with every flag set (no assume-safe fallback)', unknownLocal.allowed === false);

// ── AUTH_REJECTION calls are allowed everywhere, including production ─────
const authRejection = REGISTRY.find(e => e.classification === 'AUTH_REJECTION');
if (authRejection) {
  const r = classifyCall(authRejection.id, { target: 'production' });
  check(`AUTH_REJECTION call "${authRejection.id}" is allowed on production with no special flags`, r.allowed === true);
}

// ── PUBLIC_READ calls are allowed everywhere ───────────────────────────────
const publicRead = REGISTRY.find(e => e.classification === 'PUBLIC_READ');
if (publicRead) {
  const r = classifyCall(publicRead.id, { target: 'production' });
  check(`PUBLIC_READ call "${publicRead.id}" is allowed on production`, r.allowed === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
