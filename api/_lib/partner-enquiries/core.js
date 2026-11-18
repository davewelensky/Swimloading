// Partner product enquiries (JAKED first): validation, store, handlers, emails.
// Used by api/partner-enquiry.js (public submit), api/partner-enquiries.js (admin list / update / CSV),
// the local harness scripts/partner-enquiry-dev.mjs and test/partner-enquiries.test.js.
//
// This is enquiry coordination, NOT a shop. Nothing here prices, stocks, ships or orders anything:
// SwimLoading reads the enquiry, confirms price and delivery with JAKED by hand, and replies.
//
// Security model (see sql/2026-11-16_partner-enquiries.sql): the table has RLS on and no policies, so only the
// service key can touch it. The public handler returns a reference number and nothing else; the admin handler
// requires a session token whose profile has is_admin = true.
import crypto from 'node:crypto';

export const PARTNERS = {
  jaked: { name: 'JAKED', refPrefix: 'JKD', source: 'partners/jaked' },
};

export const CATEGORIES = {
  open_water_wetsuit: 'Open-water wetsuit',
  racing_swimsuit:    'Racing swimsuit',
  training_swimwear:  'Training swimwear',
};

export const FITS = { womens: "Women's", mens: "Men's", unisex: 'Unisex', not_sure: 'Not sure' };

// Order matters: it is the workflow, and the admin page shows it in this order.
export const STATUSES = {
  new:                'New',
  contacted:          'Contacted',
  awaiting_pricing:   'Awaiting pricing',
  quoted:             'Quoted',
  confirmed:          'Confirmed',
  ordered_from_jaked: 'Ordered from JAKED',
  shipped:            'Shipped',
  completed:          'Completed',
  cancelled:          'Cancelled',
};
// "Confirmed orders" in the report = the customer said yes, whatever happened after.
export const CONFIRMED_STATUSES = ['confirmed', 'ordered_from_jaked', 'shipped', 'completed'];

// The exact wording the customer ticks. Stored with the enquiry so we can show what they agreed to.
export const CONSENT_TEXT =
  'SwimLoading may contact me about this enquiry, and share my order details with JAKED only if I go ahead with an order.';

export const LIMITS = { perEmailPerDay: 3, perIpPerHour: 5 };

const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O, 1/I/L: easy to read out over WhatsApp

export function makeReference(prefix, rand = crypto.randomBytes) {
  const bytes = rand(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
  return `${prefix}-${s}`;
}

export function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update('swimloading-partner-enquiry:' + ip).digest('hex');
}

export function clientIp(req) {
  const xf = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  return xf || (req.socket && req.socket.remoteAddress) || null;
}

const clean = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);
const cleanBlock = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\r\n/g, '\n').slice(0, max) : null);
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

/** Validate a raw form body. Returns { row } or { error }. Never trusts the browser for partner, status or consent text. */
export function validateEnquiry(b, { partner = 'jaked' } = {}) {
  b = b && typeof b === 'object' ? b : {};
  const p = PARTNERS[partner];
  if (!p) return { error: 'bad_partner' };

  const customer_name = clean(b.customer_name, 120);
  if (!customer_name) return { error: 'name_required' };
  const email = clean(b.email, 254);
  if (!email || !EMAIL_RE.test(email)) return { error: 'email_invalid' };
  const phone = clean(b.phone, 40);
  if (phone && !/^[0-9+()\-\s.]{6,40}$/.test(phone)) return { error: 'phone_invalid' };

  const product_category = typeof b.product_category === 'string' ? b.product_category : '';
  if (!CATEGORIES[product_category]) return { error: 'category_required' };

  const fit = b.fit && FITS[b.fit] ? b.fit : null;
  const quantity = Number.parseInt(b.quantity, 10);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return { error: 'quantity_invalid' };

  if (b.consent !== true && b.consent !== 'true' && b.consent !== 'on') return { error: 'consent_required' };

  return {
    row: {
      partner,
      source: p.source,
      customer_name,
      email: email.toLowerCase(),
      phone,
      product_category,
      preferred_model: clean(b.preferred_model, 120),
      fit,
      size: clean(b.size, 40),
      size_help: b.size_help === true || b.size_help === 'true' || b.size_help === 'on',
      colour: clean(b.colour, 60),
      quantity,
      comments: cleanBlock(b.comments, 2000),
      consent_contact: true,
      consent_text: CONSENT_TEXT,
    },
  };
}

/** Validate an admin patch: only status and internal_notes can change. */
export function validatePatch(b) {
  b = b && typeof b === 'object' ? b : {};
  const patch = {};
  if (b.status !== undefined) {
    if (!STATUSES[b.status]) return { error: 'bad_status' };
    patch.status = b.status;
  }
  if (b.internal_notes !== undefined) {
    if (b.internal_notes !== null && typeof b.internal_notes !== 'string') return { error: 'bad_notes' };
    patch.internal_notes = b.internal_notes ? b.internal_notes.slice(0, 4000) : null;
  }
  if (!Object.keys(patch).length) return { error: 'nothing_to_update' };
  return { patch };
}

// ---------------------------------------------------------------- report + CSV

export function summarise(rows) {
  const by = (key) => {
    const m = {};
    for (const r of rows) { const k = r[key] == null || r[key] === '' ? '(not given)' : String(r[key]); m[k] = (m[k] || 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, count]) => ({ key: k, count }));
  };
  const live = rows.filter((r) => r.status !== 'cancelled');
  const units = {};
  for (const r of live) units[r.product_category] = (units[r.product_category] || 0) + (r.quantity || 0);
  return {
    total: rows.length,
    open: rows.filter((r) => !['completed', 'cancelled'].includes(r.status)).length,
    newCount: rows.filter((r) => r.status === 'new').length,
    confirmed: rows.filter((r) => CONFIRMED_STATUSES.includes(r.status)).length,
    byCategory: by('product_category'),
    byStatus: Object.keys(STATUSES).map((s) => ({ key: s, count: rows.filter((r) => r.status === s).length })),
    models: by('preferred_model'),
    sizes: rows.reduce((m, r) => {
      const k = (r.size || (r.size_help ? 'Needs sizing help' : '(not given)')) + (r.fit ? ` · ${FITS[r.fit] || r.fit}` : '');
      const hit = m.find((x) => x.key === k); if (hit) hit.count++; else m.push({ key: k, count: 1 }); return m;
    }, []).sort((a, b) => b.count - a.count),
    unitsByCategory: Object.entries(units).map(([k, count]) => ({ key: k, count })),
  };
}

export const CSV_COLUMNS = [
  ['reference', 'Reference'], ['created_at', 'Received'], ['status', 'Status'], ['customer_name', 'Name'], ['email', 'Email'],
  ['phone', 'Phone'], ['product_category', 'Category'], ['preferred_model', 'Model'], ['fit', 'Fit'], ['size', 'Size'],
  ['size_help', 'Needs sizing help'], ['colour', 'Colour'], ['quantity', 'Quantity'], ['comments', 'Comments'],
  ['internal_notes', 'Internal notes'], ['status_changed_at', 'Status changed'], ['is_member', 'SwimLoading member'],
];

/** CSV cell: quoted, and a leading = + - @ is neutralised so a customer comment can't run as a spreadsheet formula. */
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

// "2026-11-16 12:12" in Cape Town time, which is what a spreadsheet should show
const sast = (iso) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Africa/Johannesburg', hour12: false }).slice(0, 16) : '');

export function toCsv(rows) {
  const out = [CSV_COLUMNS.map(([, h]) => csvCell(h)).join(',')];
  for (const r of rows) {
    const view = {
      ...r,
      created_at: sast(r.created_at),
      status_changed_at: sast(r.status_changed_at),
      status: STATUSES[r.status] || r.status,
      product_category: CATEGORIES[r.product_category] || r.product_category,
      fit: r.fit ? FITS[r.fit] || r.fit : '',
      size_help: r.size_help ? 'Yes' : '',
      is_member: r.user_id ? 'Yes' : '',
    };
    out.push(CSV_COLUMNS.map(([k]) => csvCell(view[k])).join(','));
  }
  return '﻿' + out.join('\r\n') + '\r\n'; // BOM so Excel reads accents (Italian model names) correctly
}

// ---------------------------------------------------------------- stores

const SB_URL = () => process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
const ADMIN_COLS = 'id,created_at,updated_at,status_changed_at,partner,reference,source,customer_name,email,phone,product_category,preferred_model,fit,size,size_help,colour,quantity,comments,user_id,status,internal_notes,entry_method,channel,assigned_to,created_by';

export function supabaseStore() {
  const rest = async (path, init = {}) => {
    const res = await fetch(`${SB_URL()}/rest/v1/${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', apikey: KEY(), Authorization: `Bearer ${KEY()}`, ...(init.headers || {}) },
    });
    if (!res.ok) { const e = new Error(`db ${res.status} ${await res.text()}`); e.status = res.status; throw e; }
    return res;
  };
  return {
    configured: () => !!KEY(),
    async insert(row) {
      const r = await rest('partner_enquiries', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
      const [saved] = await r.json();
      return saved;
    },
    async countRecent({ field, value, sinceIso }) {
      if (!value) return 0;
      const r = await rest(`partner_enquiries?select=id&${field}=eq.${encodeURIComponent(value)}&created_at=gte.${encodeURIComponent(sinceIso)}`, {
        method: 'HEAD', headers: { Prefer: 'count=exact', Range: '0-0' },
      });
      const cr = r.headers.get('content-range') || '';
      return Number(cr.split('/')[1]) || 0;
    },
    async list(partner) {
      const r = await rest(`partner_enquiries?partner=eq.${encodeURIComponent(partner)}&select=${ADMIN_COLS}&order=created_at.desc&limit=2000`);
      return r.json();
    },
    async update(id, patch) {
      const r = await rest(`partner_enquiries?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
      const [row] = await r.json();
      return row || null;
    },
  };
}

export function memoryStore() {
  const rows = [];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  return {
    rows,
    configured: () => true,
    async insert(row) {
      if (rows.some((r) => r.reference === row.reference)) { const e = new Error('duplicate reference'); e.status = 409; throw e; }
      const now = new Date().toISOString();
      const r = { id: crypto.randomUUID(), created_at: now, updated_at: now, status_changed_at: now, status: 'new', internal_notes: null, updated_by: null, user_id: null, ...clone(row) };
      rows.push(r);
      return clone(r);
    },
    async countRecent({ field, value, sinceIso }) {
      return rows.filter((r) => r[field] === value && r.created_at >= sinceIso).length;
    },
    async list(partner) {
      return rows.filter((r) => r.partner === partner).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .map((r) => { const { ip_hash, consent_text, consent_contact, updated_by, ...rest } = clone(r); return rest; });
    },
    async update(id, patch) {
      const r = rows.find((x) => x.id === id);
      if (!r) return null;
      Object.assign(r, clone(patch));
      return clone(r);
    },
  };
}

// ---------------------------------------------------------------- auth

/** Returns the signed-in user's id for a bearer token, or null. Never throws. */
export function supabaseWhoIs() {
  return async function whoIs(req) {
    const token = String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '');
    if (!token || !KEY()) return null;
    try {
      const r = await fetch(`${SB_URL()}/auth/v1/user`, { headers: { apikey: KEY(), Authorization: `Bearer ${token}` } });
      if (!r.ok) return null;
      const u = await r.json();
      return u && u.id ? u.id : null;
    } catch { return null; }
  };
}

/** The JAKED partner (partner_pages.id) — the resource the JAKED team role is scoped to (sql/applied/2026-11-18_*). */
export const JAKED_PARTNER_ID = 'eb8644d9-28d2-4d08-87f1-4230da07e1c5';

/**
 * Who may manage JAKED enquiries: a SwimLoading admin (profiles.is_admin), or anyone with an active
 * user_roles grant of platform_admin, or partner_manager on the JAKED partner (Carina, 18 Nov 2026).
 * Pure function so the rule is unit-tested; roles = rows of user_roles for this user.
 */
export function canManageJakedEnquiries(profile, roles) {
  if (profile && profile.is_admin === true) return true;
  return (Array.isArray(roles) ? roles : []).some((r) => r && !r.revoked_at && (
    (r.role === 'platform_admin' && r.scope === 'platform') ||
    (r.role === 'partner_manager' && r.scope === 'partner' && r.resource_id === JAKED_PARTNER_ID)));
}

/** Auth for the admin handler: { userId } | { error, status }. SwimLoading admins or the JAKED team role. */
export function supabaseAdminAuth() {
  const whoIs = supabaseWhoIs();
  return async function auth(req) {
    if (!String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '')) return { status: 401, error: 'Sign in first' };
    const userId = await whoIs(req);
    if (!userId) return { status: 401, error: 'Session expired. Sign in again.' };
    const h = { headers: { apikey: KEY(), Authorization: `Bearer ${KEY()}` } };
    const id = encodeURIComponent(userId);
    const [p, r] = await Promise.all([
      fetch(`${SB_URL()}/rest/v1/profiles?id=eq.${id}&select=is_admin`, h),
      fetch(`${SB_URL()}/rest/v1/user_roles?user_id=eq.${id}&revoked_at=is.null&select=role,scope,resource_id,revoked_at`, h),
    ]);
    const prof = p.ok ? await p.json() : [];
    const roles = r.ok ? await r.json() : [];
    if (!canManageJakedEnquiries(prof[0], roles)) return { status: 403, error: 'JAKED team only' };
    return { userId };
  };
}

// ---------------------------------------------------------------- email (Resend, already used by lab-enquiry and welcome email)

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function detailLines(row) {
  return [
    ['Product', CATEGORIES[row.product_category]],
    ['Model', row.preferred_model],
    ['Fit', row.fit ? FITS[row.fit] : null],
    ['Size', row.size || (row.size_help ? 'Not sure, needs sizing help' : null)],
    row.size && row.size_help ? ['Sizing help', 'Yes, asked for help'] : null,
    ['Colour', row.colour],
    ['Quantity', String(row.quantity)],
  ].filter((x) => x && x[1]);
}

const table = (lines) => `<table style="border-collapse:collapse;margin:14px 0">${lines.map(([k, v]) =>
  `<tr><td style="padding:6px 14px 6px 0;color:#64748b;font:13px system-ui;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;color:#0f172a;font:15px system-ui"><b>${esc(v)}</b></td></tr>`).join('')}</table>`;

export function notifyEmail(row) {
  const lines = [['Reference', row.reference], ['Name', row.customer_name], ['Email', row.email], ['Phone', row.phone], ['Member', row.user_id ? 'Yes, signed in' : null], ...detailLines(row)].filter((x) => x[1]);
  return {
    subject: `JAKED enquiry ${row.reference}: ${CATEGORIES[row.product_category]} for ${row.customer_name}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px"><p style="font-size:15px;color:#0f172a">New JAKED enquiry from the partner page.</p>${table(lines)}${row.comments ? `<p style="font-size:14px;color:#334155;background:#f1f5f9;padding:12px 14px;border-radius:8px;white-space:pre-wrap">${esc(row.comments)}</p>` : ''}<p style="font-size:13px;color:#64748b">Reply to this email to reach them. Track it at https://www.swimloading.com/partner-enquiries</p></div>`,
    text: ['New JAKED enquiry from the partner page.', '', ...lines.map(([k, v]) => `${k}: ${v}`), row.comments ? `\nComments:\n${row.comments}` : null, '', 'Reply to this email to reach them. Track it at https://www.swimloading.com/partner-enquiries'].filter((x) => x !== null).join('\n'),
  };
}

// Promises nothing beyond "we'll contact you": no price, no stock, no delivery date, no response time.
export function customerEmail(row) {
  const first = row.customer_name.split(' ')[0];
  const intro = "Thank you for your interest in JAKED. We've received your enquiry and will contact you regarding availability, pricing, sizing and delivery options.";
  const lines = [['Reference', row.reference], ...detailLines(row)];
  return {
    subject: `Your JAKED enquiry (${row.reference})`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#0f172a"><p style="font-size:15px">Hi ${esc(first)},</p><p style="font-size:15px">${esc(intro)}</p>${table(lines)}<p style="font-size:14px;color:#334155">If anything changes, just reply to this email and quote your reference.</p><p style="font-size:14px;color:#334155">SwimLoading</p><p style="font-size:12px;color:#64748b">You're receiving this because you sent an enquiry from swimloading.com/partners/jaked. It does not subscribe you to anything.</p></div>`,
    text: [`Hi ${first},`, '', intro, '', ...lines.map(([k, v]) => `${k}: ${v}`), '', 'If anything changes, just reply to this email and quote your reference.', '', 'SwimLoading', '', "You're receiving this because you sent an enquiry from swimloading.com/partners/jaked. It does not subscribe you to anything."].join('\n'),
  };
}

const FROM_ADDRESS = 'SwimLoading <no-reply@swimloading.com>';
const CUSTOMER_REPLY_TO = 'support@swimloading.com';

/** Real mailer. Returns { notified, customerEmailed, errors }. Best effort: never throws. */
export function resendMailer() {
  return async function send(row) {
    const out = { notified: false, customerEmailed: false, errors: [] };
    const key = process.env.RESEND_API_KEY;
    const to = (process.env.PARTNER_ENQUIRY_NOTIFY_TO || 'dave.welensky@gmail.com').split(',').map((s) => s.trim()).filter(Boolean);
    if (!key) { out.errors.push('no_resend_key'); return out; }
    const { Resend } = await import('resend');
    const resend = new Resend(key);
    const attempt = async (flag, payload, idem) => {
      try {
        const { error } = await resend.emails.send(payload, { idempotencyKey: idem });
        if (error) out.errors.push(`${flag}: ${(error.name || 'resend_error')} ${error.message || ''}`.slice(0, 200));
        else out[flag] = true;
      } catch (e) { out.errors.push(`${flag}: threw ${(e && e.message) || e}`.slice(0, 200)); }
    };
    const n = notifyEmail(row);
    await attempt('notified', { from: FROM_ADDRESS, to, replyTo: row.email, ...n }, `partner-enquiry/${row.id}/notify`);
    const c = customerEmail(row);
    await attempt('customerEmailed', { from: FROM_ADDRESS, to: [row.email], replyTo: CUSTOMER_REPLY_TO, ...c }, `partner-enquiry/${row.id}/customer`);
    if (out.errors.length) console.error('[partner-enquiry] mail', out.errors);
    return out;
  };
}

// ---------------------------------------------------------------- handlers

const readBody = (req) => (req.body && typeof req.body === 'object' ? req.body : (() => { try { return JSON.parse(req.body || '{}'); } catch { return {}; } })());

/** POST /api/partner-enquiry */
export function makePublicHandler({ store, sendMail, whoIs, now = () => Date.now(), rand }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    if (!store.configured()) { console.error('[partner-enquiry] SUPABASE_SERVICE_KEY not configured'); return res.status(500).json({ error: 'not_configured' }); }

    const b = readBody(req);
    const partner = typeof b.partner === 'string' ? b.partner : 'jaked';
    if (!PARTNERS[partner]) return res.status(400).json({ error: 'bad_partner' });

    // Bots fill every field they find; a person never sees this one. Pretend it worked, store nothing.
    if (typeof b.website === 'string' && b.website.trim()) return res.status(200).json({ ok: true, reference: makeReference(PARTNERS[partner].refPrefix, rand) });

    const v = validateEnquiry(b, { partner });
    if (v.error) return res.status(400).json({ error: v.error });
    const row = v.row;

    const ip_hash = hashIp(clientIp(req));
    try {
      const day = new Date(now() - 86400000).toISOString(), hour = new Date(now() - 3600000).toISOString();
      if (await store.countRecent({ field: 'email', value: row.email, sinceIso: day }) >= LIMITS.perEmailPerDay) return res.status(429).json({ error: 'too_many' });
      if (ip_hash && await store.countRecent({ field: 'ip_hash', value: ip_hash, sinceIso: hour }) >= LIMITS.perIpPerHour) return res.status(429).json({ error: 'too_many' });
    } catch (e) {
      console.error('[partner-enquiry] rate check failed', e.message); // fail open: a lost lead is worse than one extra row
    }

    row.ip_hash = ip_hash;
    row.user_id = whoIs ? await whoIs(req) : null;

    let saved = null;
    for (let i = 0; i < 4 && !saved; i++) {
      row.reference = makeReference(PARTNERS[partner].refPrefix, rand);
      try { saved = await store.insert(row); }
      catch (e) { if (e.status !== 409) { console.error('[partner-enquiry] insert failed', e.message); return res.status(500).json({ error: 'insert_failed' }); } }
    }
    if (!saved) return res.status(500).json({ error: 'insert_failed' });

    let mail = { notified: false, customerEmailed: false };
    try { mail = await sendMail(saved); } catch (e) { console.error('[partner-enquiry] mail threw', e); }

    // Only the reference goes back. Never echo the row: nothing about the customer leaves through this endpoint.
    return res.status(200).json({ ok: true, reference: saved.reference, emailed: !!mail.customerEmailed });
  };
}

/** GET /api/partner-enquiries?partner=jaked[&format=csv]   PATCH /api/partner-enquiries { id, status?, internal_notes? } */
export function makeAdminHandler({ store, auth, now = () => Date.now() }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'PATCH'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
    if (!store.configured()) return res.status(500).json({ error: 'Server not configured' });

    const who = await auth(req);
    if (!who || !who.userId) return res.status((who && who.status) || 401).json({ error: (who && who.error) || 'Sign in first' });

    try {
      if (req.method === 'PATCH') {
        const b = readBody(req);
        if (typeof b.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.id)) return res.status(400).json({ error: 'bad_id' });
        const v = validatePatch(b);
        if (v.error) return res.status(400).json({ error: v.error });
        const stamp = new Date(now()).toISOString();
        const patch = { ...v.patch, updated_at: stamp, updated_by: who.userId };
        if (v.patch.status) patch.status_changed_at = stamp;
        const row = await store.update(b.id, patch);
        if (!row) return res.status(404).json({ error: 'not_found' });
        return res.status(200).json({ ok: true, row: { id: row.id, status: row.status, internal_notes: row.internal_notes, updated_at: row.updated_at, status_changed_at: row.status_changed_at } });
      }

      const partner = String((req.query && req.query.partner) || 'jaked');
      if (!PARTNERS[partner]) return res.status(400).json({ error: 'bad_partner' });
      const rows = await store.list(partner);
      if (req.query && req.query.format === 'csv') {
        const day = new Date(now()).toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${partner}-enquiries-${day}.csv"`);
        return res.status(200).send(toCsv(rows));
      }
      return res.status(200).json({ partner, statuses: STATUSES, categories: CATEGORIES, fits: FITS, summary: summarise(rows), rows });
    } catch (e) {
      console.error('[partner-enquiries]', e.message);
      return res.status(500).json({ error: 'Could not load enquiries' });
    }
  };
}
