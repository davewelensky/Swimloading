// Partner product enquiries (JAKED): validation, rate limits, privacy of the public response, admin access, CSV.
// Runs the real handlers against the in-memory store. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  makePublicHandler, makeAdminHandler, memoryStore, validateEnquiry, validatePatch, toCsv, csvCell, summarise,
  makeReference, customerEmail, notifyEmail, STATUSES, LIMITS,
} from '../api/_lib/partner-enquiries/core.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function res() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
  };
}
const good = (over = {}) => ({
  partner: 'jaked', customer_name: 'Test Swimmer', email: 'Test@Example.com', phone: '+27 82 000 0000',
  product_category: 'open_water_wetsuit', preferred_model: 'BLADE', fit: 'womens', size: 'M', size_help: false,
  colour: 'Black', quantity: 1, comments: 'For Langebaan', consent: true, website: '', ...over,
});
const req = (body, { ip = '10.0.0.1', auth } = {}) => ({ method: 'POST', body, headers: { 'x-forwarded-for': ip, ...(auth ? { authorization: auth } : {}) } });

function setup() {
  const store = memoryStore();
  const sent = [];
  const pub = makePublicHandler({ store, sendMail: async (row) => { sent.push(row); return { notified: true, customerEmailed: true }; }, whoIs: async (r) => (r.headers.authorization === 'Bearer member' ? '11111111-1111-1111-1111-111111111111' : null) });
  const admin = makeAdminHandler({ store, auth: async (r) => (r.headers.authorization === 'Bearer admin' ? { userId: '22222222-2222-2222-2222-222222222222' } : r.headers.authorization ? { status: 403, error: 'Admins only' } : { status: 401, error: 'Sign in first' }) });
  return { store, sent, pub, admin };
}

test('a valid enquiry is stored and only the reference comes back', async () => {
  const { store, sent, pub } = setup();
  const r = res();
  await pub(req(good()), r);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['emailed', 'ok', 'reference']);
  assert.match(r.body.reference, /^JKD-[2-9A-HJKMNP-Z]{6}$/);
  assert.equal(store.rows.length, 1);
  const row = store.rows[0];
  assert.equal(row.email, 'test@example.com');
  assert.equal(row.status, 'new');
  assert.equal(row.partner, 'jaked');
  assert.equal(row.user_id, null);
  assert.ok(row.ip_hash && row.ip_hash.length === 64 && !row.ip_hash.includes('10.0.0.1'), 'IP is hashed, never stored raw');
  assert.equal(sent.length, 1);
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('the response never carries customer details', async () => {
  const { pub } = setup();
  const r = res();
  await pub(req(good({ customer_name: 'Unique Name Zq', email: 'zq@example.com', phone: '0820000001' })), r);
  const out = JSON.stringify(r.body);
  for (const s of ['Unique Name Zq', 'zq@example.com', '0820000001', 'BLADE', 'ip_hash', 'id']) assert.ok(!out.includes(s), s + ' leaked');
});

test('a signed-in member is linked by their verified token, not by anything in the body', async () => {
  const { store, pub } = setup();
  await pub(req(good({ user_id: '33333333-3333-3333-3333-333333333333' }), { auth: 'Bearer member' }), res());
  assert.equal(store.rows[0].user_id, '11111111-1111-1111-1111-111111111111');
});

test('validation: required fields, allowed values, lengths, consent', () => {
  assert.equal(validateEnquiry(good({ customer_name: ' ' })).error, 'name_required');
  assert.equal(validateEnquiry(good({ email: 'nope' })).error, 'email_invalid');
  assert.equal(validateEnquiry(good({ email: 'a@b' })).error, 'email_invalid');
  assert.equal(validateEnquiry(good({ phone: 'call me maybe' })).error, 'phone_invalid');
  assert.equal(validateEnquiry(good({ product_category: 'bikini' })).error, 'category_required');
  assert.equal(validateEnquiry(good({ quantity: 0 })).error, 'quantity_invalid');
  assert.equal(validateEnquiry(good({ quantity: 21 })).error, 'quantity_invalid');
  assert.equal(validateEnquiry(good({ quantity: 'lots' })).error, 'quantity_invalid');
  assert.equal(validateEnquiry(good({ consent: false })).error, 'consent_required');
  assert.equal(validateEnquiry(good({ consent: undefined })).error, 'consent_required');
  const { row } = validateEnquiry(good({ fit: 'robot', comments: 'x'.repeat(5000), preferred_model: 'y'.repeat(500), status: 'completed', internal_notes: 'hi' }));
  assert.equal(row.fit, null, 'unknown fit dropped');
  assert.equal(row.comments.length, 2000);
  assert.equal(row.preferred_model.length, 120);
  assert.equal(row.status, undefined, 'the public cannot set status');
  assert.equal(row.internal_notes, undefined, 'the public cannot set notes');
  assert.equal(validateEnquiry(good(), { partner: 'nike' }).error, 'bad_partner');
});

test('bad input is rejected with 400 and nothing is stored', async () => {
  const { store, pub } = setup();
  const r = res();
  await pub(req(good({ email: 'x' })), r);
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.error, 'email_invalid');
  assert.equal(store.rows.length, 0);
  const r2 = res();
  await pub({ method: 'GET', headers: {} }, r2);
  assert.equal(r2.statusCode, 405);
});

test('honeypot: a bot gets a believable success and nothing is stored or emailed', async () => {
  const { store, sent, pub } = setup();
  const r = res();
  await pub(req(good({ website: 'http://spam.example' })), r);
  assert.equal(r.statusCode, 200);
  assert.match(r.body.reference, /^JKD-/);
  assert.equal(store.rows.length, 0);
  assert.equal(sent.length, 0);
});

test(`rate limits: ${LIMITS.perEmailPerDay} per email per day, ${LIMITS.perIpPerHour} per IP per hour`, async () => {
  const { store, pub } = setup();
  for (let i = 0; i < LIMITS.perEmailPerDay; i++) { const r = res(); await pub(req(good(), { ip: '10.0.0.' + i }), r); assert.equal(r.statusCode, 200); }
  const blocked = res();
  await pub(req(good({ email: 'TEST@example.com' }), { ip: '10.9.9.9' }), blocked);
  assert.equal(blocked.statusCode, 429, 'same email, different case, different IP');

  const ipStore = setup();
  for (let i = 0; i < LIMITS.perIpPerHour; i++) { const r = res(); await ipStore.pub(req(good({ email: `p${i}@example.com` }), { ip: '10.1.1.1' }), r); assert.equal(r.statusCode, 200); }
  const r = res();
  await ipStore.pub(req(good({ email: 'fresh@example.com' }), { ip: '10.1.1.1' }), r);
  assert.equal(r.statusCode, 429);
  assert.equal(ipStore.store.rows.length, LIMITS.perIpPerHour);
});

test('a reference collision is retried, not lost', async () => {
  const store = memoryStore();
  let n = 0;
  const seq = [Buffer.from([0, 0, 0, 0, 0, 0]), Buffer.from([0, 0, 0, 0, 0, 0]), Buffer.from([1, 2, 3, 4, 5, 6])];
  const pub = makePublicHandler({ store, sendMail: async () => ({}), whoIs: null, rand: () => seq[Math.min(n++, seq.length - 1)] });
  const a = res(), b = res();
  await pub(req(good({ email: 'a@example.com' }), { ip: '1.1.1.1' }), a);
  await pub(req(good({ email: 'b@example.com' }), { ip: '2.2.2.2' }), b);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.notEqual(a.body.reference, b.body.reference);
  assert.equal(store.rows.length, 2);
});

test('a mail failure never loses the enquiry', async () => {
  const store = memoryStore();
  const pub = makePublicHandler({ store, sendMail: async () => { throw new Error('resend down'); }, whoIs: null });
  const r = res();
  await pub(req(good()), r);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.emailed, false);
  assert.equal(store.rows.length, 1);
});

test('admin endpoint: no token is 401, a non-admin is 403, and neither sees any data', async () => {
  const { pub, admin } = setup();
  await pub(req(good()), res());
  const anon = res();
  await admin({ method: 'GET', query: { partner: 'jaked' }, headers: {} }, anon);
  assert.equal(anon.statusCode, 401);
  assert.ok(!JSON.stringify(anon.body).includes('example.com'));
  const member = res();
  await admin({ method: 'GET', query: { partner: 'jaked' }, headers: { authorization: 'Bearer member' } }, member);
  assert.equal(member.statusCode, 403);
  assert.ok(!JSON.stringify(member.body).includes('example.com'));
  const patch = res();
  await admin({ method: 'PATCH', body: { id: '00000000-0000-0000-0000-000000000000', status: 'completed' }, headers: { authorization: 'Bearer member' } }, patch);
  assert.equal(patch.statusCode, 403);
});

test('admin: list + summary, status update with timestamps, notes, CSV', async () => {
  const { store, pub, admin } = setup();
  await pub(req(good(), { ip: '1.1.1.1' }), res());
  await pub(req(good({ email: 'two@example.com', product_category: 'racing_swimsuit', preferred_model: '', size: '', size_help: true, quantity: 2 }), { ip: '2.2.2.2' }), res());
  const list = res();
  await admin({ method: 'GET', query: { partner: 'jaked' }, headers: { authorization: 'Bearer admin' } }, list);
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.summary.total, 2);
  assert.equal(list.body.summary.newCount, 2);
  assert.ok(list.body.rows.every((r) => r.ip_hash === undefined), 'the hashed IP stays server side even for admins');

  const id = store.rows[0].id;
  const before = store.rows[0].status_changed_at;
  const up = res();
  await admin({ method: 'PATCH', body: { id, status: 'confirmed', internal_notes: 'Size M confirmed on WhatsApp' }, headers: { authorization: 'Bearer admin' } }, up);
  assert.equal(up.statusCode, 200);
  assert.equal(store.rows[0].status, 'confirmed');
  assert.equal(store.rows[0].internal_notes, 'Size M confirmed on WhatsApp');
  assert.equal(store.rows[0].updated_by, '22222222-2222-2222-2222-222222222222');
  assert.ok(store.rows[0].status_changed_at >= before);

  const bad = res();
  await admin({ method: 'PATCH', body: { id, status: 'paid' }, headers: { authorization: 'Bearer admin' } }, bad);
  assert.equal(bad.statusCode, 400);
  const nobody = res();
  await admin({ method: 'PATCH', body: { id: '00000000-0000-0000-0000-000000000000', status: 'contacted' }, headers: { authorization: 'Bearer admin' } }, nobody);
  assert.equal(nobody.statusCode, 404);

  const csv = res();
  await admin({ method: 'GET', query: { partner: 'jaked', format: 'csv' }, headers: { authorization: 'Bearer admin' } }, csv);
  assert.equal(csv.statusCode, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.headers['content-disposition'], /jaked-enquiries-\d{4}-\d{2}-\d{2}\.csv/);
  assert.match(csv.body, /"Reference","Received","Status"/);
  assert.match(csv.body, /"Confirmed"/);
  assert.match(csv.body, /"Needs sizing help"/);
});

test('summary counts confirmed orders and units, ignoring cancelled', () => {
  const s = summarise([
    { status: 'new', product_category: 'open_water_wetsuit', quantity: 1, preferred_model: 'BLADE', size: 'M', fit: 'womens' },
    { status: 'shipped', product_category: 'open_water_wetsuit', quantity: 2, preferred_model: 'BLADE', size: 'L', fit: 'mens' },
    { status: 'cancelled', product_category: 'racing_swimsuit', quantity: 5, preferred_model: null, size: null, size_help: true },
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.confirmed, 1);
  assert.equal(s.open, 2);
  assert.deepEqual(s.unitsByCategory, [{ key: 'open_water_wetsuit', count: 3 }]);
  assert.deepEqual(s.models[0], { key: 'BLADE', count: 2 });
  assert.equal(s.byStatus.length, Object.keys(STATUSES).length);
});

test('CSV cells cannot run as spreadsheet formulas', () => {
  assert.equal(csvCell('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"');
  assert.equal(csvCell('+27 82'), '"\'+27 82"');
  assert.equal(csvCell('@SUM(A1)'), '"\'@SUM(A1)"');
  assert.equal(csvCell('BLADE'), '"BLADE"');
  assert.ok(toCsv([]).startsWith('﻿'));
});

test('admin patch only allows status and notes', () => {
  assert.equal(validatePatch({ email: 'x@y.z' }).error, 'nothing_to_update');
  assert.equal(validatePatch({ status: 'refunded' }).error, 'bad_status');
  assert.deepEqual(validatePatch({ status: 'quoted', email: 'x@y.z' }).patch, { status: 'quoted' });
  assert.equal(validatePatch({ internal_notes: 'n'.repeat(5000) }).patch.internal_notes.length, 4000);
});

test('emails promise nothing that is not agreed and escape customer input', () => {
  const row = { id: 'x', reference: 'JKD-ABCDEF', customer_name: 'Ann <b>Lee</b>', email: 'a@b.co', product_category: 'racing_swimsuit', quantity: 1, size_help: true, comments: '<script>x</script>' };
  for (const m of [customerEmail(row), notifyEmail(row)]) {
    assert.doesNotMatch(m.html, /<script>|<b>Lee/);
  }
  const c = customerEmail(row);
  assert.match(c.text, /We've received your enquiry and will contact you regarding availability, pricing, sizing and delivery options\./);
  assert.match(c.text, /JKD-ABCDEF/);
  assert.doesNotMatch(c.text + c.html, /\bR\s?\d|€|% off|discount|in stock|within \d|\d+ (working )?days|hours/i);
});

test('references avoid look-alike characters', () => {
  for (let i = 0; i < 200; i++) assert.match(makeReference('JKD'), /^JKD-[2-9ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
});

test('migration keeps the table server-only and matches the code', () => {
  const sql = fs.readFileSync(path.join(root, fs.existsSync(path.join(root, 'sql/2026-11-16_partner-enquiries.sql')) ? 'sql/2026-11-16_partner-enquiries.sql' : 'sql/applied/2026-11-16_partner-enquiries.sql'), 'utf8');
  const body = sql.split('BEGIN;')[1].split('COMMIT;')[0];
  assert.match(body, /ENABLE ROW LEVEL SECURITY/);
  assert.match(body, /REVOKE ALL ON public\.partner_enquiries FROM anon, authenticated/);
  assert.doesNotMatch(body, /CREATE POLICY/, 'no policies: the browser must never read or write this table');
  for (const s of Object.keys(STATUSES)) assert.ok(body.includes(`'${s}'`), 'status ' + s + ' allowed by the CHECK');
});

// ── JAKED team access (18 Nov 2026): admins OR the JAKED role in user_roles ─────────────────────────────
test('JAKED enquiries access: admin, platform_admin, JAKED partner_manager in; everyone else out', async () => {
  const { canManageJakedEnquiries, JAKED_PARTNER_ID } = await import('../api/_lib/partner-enquiries/core.js');
  const pm = (resource_id, extra = {}) => ({ role: 'partner_manager', scope: 'partner', resource_id, revoked_at: null, ...extra });
  assert.equal(canManageJakedEnquiries({ is_admin: true }, []), true, 'SwimLoading admin keeps access');
  assert.equal(canManageJakedEnquiries({ is_admin: false }, [{ role: 'platform_admin', scope: 'platform', resource_id: null, revoked_at: null }]), true, 'platform_admin');
  assert.equal(canManageJakedEnquiries({ is_admin: false }, [pm(JAKED_PARTNER_ID)]), true, 'Carina: partner_manager on JAKED');
  assert.equal(canManageJakedEnquiries({ is_admin: false }, [pm('00000000-0000-0000-0000-000000000001')]), false, 'manager of another partner');
  assert.equal(canManageJakedEnquiries({ is_admin: false }, [pm(JAKED_PARTNER_ID, { revoked_at: '2026-11-18T10:00:00Z' })]), false, 'revoked grant');
  assert.equal(canManageJakedEnquiries({ is_admin: false }, [{ role: 'partner_viewer', scope: 'partner', resource_id: JAKED_PARTNER_ID, revoked_at: null }]), false, 'viewer role is not a manager');
  assert.equal(canManageJakedEnquiries(undefined, undefined), false, 'no profile, no roles');
  assert.equal(canManageJakedEnquiries({ is_admin: 'true' }, []), false, 'only a real boolean true counts');
});
