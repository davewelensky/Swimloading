// Sign-up verification screen: the user can finish by typing the emailed
// 6-digit code. Static checks on app.js (global-scope browser script).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync('app.js', 'utf8');
const start = js.indexOf('function showSignupSuccess');
const end = js.indexOf('function hideSignupSuccess');
const block = js.slice(start, end);

test('verify screen: code is checked with verifyOtp type signup', () => {
  assert.match(block, /verifyOtp\(\{ email, token: code, type: 'signup' \}\)/);
});

test('verify screen: email is never interpolated into HTML or onclick', () => {
  assert.doesNotMatch(block, /\$\{email\}/);
  assert.match(block, /verifyEmailLabel'\)\.textContent = email/);
});

test('verify screen: offers resend and change-email paths', () => {
  assert.match(block, /resendVerification\(email\)/);
  assert.match(block, /changeSignupEmail\(email\)/);
});

test('verify screen: success path loads the app with the new session', () => {
  assert.match(block, /currentUser = data\.session\.user;[\s\S]*loadApp\(\)/);
});

test('index.html cache-bust for app.js was bumped past v94', () => {
  const m = readFileSync('index.html', 'utf8').match(/app\.js\?v=(\d+)/);
  assert.ok(m && Number(m[1]) >= 95);
});
