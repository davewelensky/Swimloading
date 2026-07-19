#!/usr/bin/env node
// Local, in-process unit test for the shared cron auth helper
// (api/cron/_auth.js). Never makes a network call, never touches Supabase,
// never imports the actual cron handlers (which would pull in business
// logic) — it tests requireCronAuth() in isolation with mock req/res.
//
// Safe to run anywhere, including with real production env vars loaded —
// it never reaches the point where a handler would do privileged work.
//
// Usage: node scripts/test-cron-auth.mjs

import { requireCronAuth } from '../api/cron/_auth.js';

let pass = 0;
let fail = 0;

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function check(label, condition) {
  if (condition) { pass++; console.log(`  OK   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
}

function withEnv(secret, fn) {
  const prev = process.env.CRON_SECRET;
  if (secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = secret;
  try { fn(); } finally {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  }
}

console.log('Cron auth helper — local unit tests\n');

// 1. Missing secret configuration (env var unset entirely)
withEnv(undefined, () => {
  const res = mockRes();
  const ok = requireCronAuth({ method: 'GET', headers: {} }, res, 'test');
  check('missing secret configuration -> fails closed (not 200/401)', ok === false && res.statusCode === 500);
});

// 2. Missing request credential (secret configured, no Authorization header sent)
withEnv('real-secret-value', () => {
  const res = mockRes();
  const ok = requireCronAuth({ method: 'GET', headers: {} }, res, 'test');
  check('missing request credential -> 401', ok === false && res.statusCode === 401);
});

// 3. Invalid request credential
withEnv('real-secret-value', () => {
  const res = mockRes();
  const ok = requireCronAuth({ method: 'GET', headers: { authorization: 'Bearer wrong-value' } }, res, 'test');
  check('invalid request credential -> 401', ok === false && res.statusCode === 401);
});

// 4. Unsupported HTTP method (even with a correct secret)
withEnv('real-secret-value', () => {
  const res = mockRes();
  const ok = requireCronAuth({ method: 'DELETE', headers: { authorization: 'Bearer real-secret-value' } }, res, 'test');
  check('unsupported method (DELETE) -> 405, rejected before auth even checked', ok === false && res.statusCode === 405);
});
withEnv('real-secret-value', () => {
  const res = mockRes();
  const ok = requireCronAuth({ method: 'POST', headers: { authorization: 'Bearer real-secret-value' } }, res, 'test');
  check('unsupported method (POST) -> 405', ok === false && res.statusCode === 405);
});

// 5. Valid credential, non-production test secret — auth passes, no handler invoked
withEnv('local-test-secret-not-real', () => {
  const res = mockRes();
  const ok = requireCronAuth({ method: 'GET', headers: { authorization: 'Bearer local-test-secret-not-real' } }, res, 'test');
  check('valid credential (test secret) -> authorised, no response sent yet', ok === true && res.statusCode === null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
