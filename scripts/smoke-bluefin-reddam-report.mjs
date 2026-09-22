// One-off local smoke test for api/bluefin-reddam-report.js — mocks the
// Supabase REST calls with realistic shapes (matching what's actually in
// the DB as of 2026-09-23) so the handler's real rendering logic runs
// end-to-end without needing network access or the service key locally.
// Run: node scripts/smoke-bluefin-reddam-report.mjs

process.env.SUPABASE_SERVICE_KEY = 'test-key';

const CLUB = { id: 'club-1', name: 'Bluefin Swim Club', logo_url: '/icons/bluefin-logo.png', description: 'Bluefin Swim Club is a Masters lane and bay swim club.' };
const SQUAD = { id: 'squad-1', name: 'College Students' };
const ROSTER = [
  { id: 'r1', display_name: 'Kelvin', member_number: 29 },
  { id: 'r2', display_name: 'Onke', member_number: 30 },
  { id: 'r3', display_name: 'Yvette', member_number: 35 },
];
// Only some published — mirrors real state (all currently unpublished,
// pending coach review) plus one hypothetical published+re-published entry
// to exercise the multi-entry timeline path.
const REPORTS = [
  { roster_id: 'r3', term_label: '2026 Learn to Swim Programme', body: 'Able to swim short distances independently and float confidently. Attended 7 of 7 sessions to date. Water safe.', coach_name: 'Barbara Johnston-Read', updated_at: '2026-09-01T10:00:00Z', published_at: '2026-09-01T10:00:00Z' },
  { roster_id: 'r3', term_label: '2026 Term 4', body: 'Now swimming 25m unassisted with confident breathing. Continuing to build endurance.', coach_name: 'Scott Tait', updated_at: '2026-11-15T10:00:00Z', published_at: '2026-11-15T10:00:00Z' },
];

let fetchCallIndex = 0;
global.fetch = async (url) => {
  fetchCallIndex++;
  const body = url.includes('/clubs?')            ? [CLUB]
             : url.includes('/club_squads?')       ? [SQUAD]
             : url.includes('/club_roster?')        ? ROSTER
             : url.includes('/club_progress_reports?') ? REPORTS
             : (() => { throw new Error(`Unexpected fetch URL (call ${fetchCallIndex}): ${url}`); })();
  return { ok: true, json: async () => body };
};

const mockReq = { query: {} };
let captured = null;
const mockRes = {
  _headers: {},
  setHeader(k, v) { this._headers[k] = v; },
  status(code) { this._statusCode = code; return this; },
  send(html) { captured = { statusCode: this._statusCode, html }; },
};

const { default: handler } = await import('../api/bluefin-reddam-report.js');
await handler(mockReq, mockRes);

if (!captured) throw new Error('Handler never called res.send()');
if (captured.statusCode !== 200) throw new Error(`Expected 200, got ${captured.statusCode}`);
if (!captured.html.includes('<!DOCTYPE html>')) throw new Error('Missing doctype — malformed output');
if (!captured.html.includes('Kelvin') || !captured.html.includes('Onke') || !captured.html.includes('Yvette')) {
  throw new Error('Missing expected student names in output');
}
if (!captured.html.includes('No published update yet')) throw new Error('Missing unpublished-state copy for Kelvin/Onke');
if (!captured.html.includes('Water safe') || !captured.html.includes('confident breathing')) {
  throw new Error('Missing multi-entry timeline content for Yvette');
}
if ((captured.html.match(/<div class="timeline-entry">/g) || []).length !== 2) {
  throw new Error('Expected exactly 2 rendered timeline entries (Yvette has 2 published reports)');
}
// Only Yvette (of 3 roster members) has any published report.
if (!captured.html.includes('1 of 3')) throw new Error('Stat strip should show "1 of 3" students with updates');

console.log('SMOKE TEST PASSED — handler rendered valid HTML with correct dynamic content');
console.log(`Output size: ${captured.html.length} bytes`);
