// JAKED Business — Overview status board logic (pure functions; rendered by app.js, tested in test/jaked-business.test.js).
// No supplier prices or personal data live in this file.

// The two JAKED team accounts (auth user ids; not secret — access is enforced in the database by user_roles).
export const TEAM = {
  'df137255-3add-4153-b368-32e06e2be188': { name: 'Dave', role: 'Admin', key: 'd' },
  'cff2fc33-4a55-451b-8c7f-20f12c1898ce': { name: 'Carina', role: 'JAKED manager', key: 'c' },
};

// Enquiry-to-delivery columns shared by website/WhatsApp enquiries and workspace orders.
export const PIPELINE = [
  { key: 'enquiry', label: 'Enquiry' },
  { key: 'quoted', label: 'Quoted' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'ordered', label: 'Ordered from JAKED' },
  { key: 'transit', label: 'In transit · received' },
  { key: 'delivered', label: 'Delivered' },
];

const ENQUIRY_STAGE = { new: 'enquiry', contacted: 'enquiry', awaiting_pricing: 'enquiry', quoted: 'quoted', confirmed: 'confirmed', ordered_from_jaked: 'ordered', shipped: 'transit', completed: 'delivered', cancelled: null };
const ORDER_STAGE = { 'Enquiry': 'enquiry', 'Quoted': 'quoted', 'Customer confirmed': 'confirmed', 'Supplier ordered': 'ordered', 'In transit': 'transit', 'Received': 'transit', 'Delivered': 'delivered', 'Cancelled': null };
export const enquiryStage = (status) => (status in ENQUIRY_STAGE ? ENQUIRY_STAGE[status] : 'enquiry');
export const orderStage = (stage) => (stage in ORDER_STAGE ? ORDER_STAGE[stage] : 'enquiry');

const CATEGORY = { open_water_wetsuit: 'Wetsuit', racing_swimsuit: 'Racing swimsuit', training_swimwear: 'Training swimwear' };
const STATUS_LABEL = { new: 'New', contacted: 'Contacted', awaiting_pricing: 'Awaiting pricing', quoted: 'Quoted', confirmed: 'Confirmed', ordered_from_jaked: 'Ordered', shipped: 'Shipped', completed: 'Completed', cancelled: 'Cancelled' };
const CHANNEL = { website: 'Website', whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook', email: 'Email', phone: 'Phone', in_person: 'In person', event: 'Event', referral: 'Referral', other: 'Other' };

export function enquiryChannel(e) { return e && e.entry_method === 'manual' ? (CHANNEL[e.channel] || 'Manual') : 'Website'; }
export function daysSince(iso, now = Date.now()) {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86400000));
}
export const isOpenEnquiry = (e) => !['completed', 'cancelled'].includes(e && e.status);
export const isOpenOrder = (o) => !['Delivered', 'Cancelled'].includes(o && o.stage);

/** Pipeline columns with cards. unitsOf(order) -> number. Cancelled items are left out. */
export function buildPipeline(enquiries = [], orders = [], unitsOf = () => 0) {
  const cols = PIPELINE.map((c) => ({ ...c, cards: [] }));
  const at = (k) => cols.find((c) => c.key === k);
  for (const e of enquiries) {
    const k = enquiryStage(e.status); if (!k) continue;
    const what = CATEGORY[e.product_category] || 'Product';
    at(k).cards.push({ kind: 'enquiry', id: e.id, title: `${enquiryChannel(e)} enquiry${e.preferred_model ? ' · ' + e.preferred_model : ''}`,
      meta: [what, e.size_help ? 'sizing help' : e.size].filter(Boolean).join(' · '), tag: STATUS_LABEL[e.status] || e.status, tone: e.status === 'new' ? 'red' : 'gold', ref: e.reference });
  }
  for (const o of orders) {
    const k = orderStage(o.stage); if (!k) continue;
    const u = unitsOf(o);
    at(k).cards.push({ kind: 'order', id: o.id, title: o.name || 'Order', meta: `${u} unit${u === 1 ? '' : 's'} · ${o.customer ? o.customer : 'customer to confirm'}`, tag: 'Order', tone: 'gold' });
  }
  return cols;
}

/** What needs attention, most urgent first. */
/** Field labels without their unit suffix ('Shipment freight · ZAR' -> 'Shipment freight'). */
export const plainLabel = (l) => String(l).replace(/\s*·\s*(ZAR|%)$/, '');
/** '2026-11-17' -> '17 Nov' */
export function dayLabel(ymd) { const d = new Date(String(ymd) + 'T12:00:00Z'); return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(d) : String(ymd || ''); }

export function buildAttention({ enquiries = [], orders = [], tasks = [], pricingIssues = [], today = new Date().toISOString().slice(0, 10), now = Date.now() } = {}) {
  const items = [];
  for (const e of enquiries.filter((x) => x.status === 'new')) {
    const d = daysSince(e.created_at, now);
    items.push({ tone: d >= 1 ? 'red' : 'gold', title: `${enquiryChannel(e)} enquiry waiting ${d === 0 ? 'since today' : d === 1 ? '1 day' : d + ' days'}`,
      detail: [CATEGORY[e.product_category], e.preferred_model, e.size_help ? 'asked for sizing help' : null].filter(Boolean).join(' · ') + (e.assigned_to ? '' : '. Nobody owns it yet.'),
      action: { label: 'Open', href: '/partner-enquiries' } });
  }
  for (const t of tasks.filter((x) => x.due_date && x.due_date < today && !['done', 'cancelled'].includes(x.status))) {
    items.push({ tone: 'red', title: `Overdue: ${t.title}`, detail: `Was due ${dayLabel(t.due_date)}${t.owner_id && TEAM[t.owner_id] ? ' · ' + TEAM[t.owner_id].name : ' · no owner'}`, action: { label: 'Tasks', href: '#overview-tasks' } });
  }
  if (orders.some(isOpenOrder) && pricingIssues.length) {
    items.push({ tone: 'gold', title: 'Pricing inputs missing', detail: `${pricingIssues.slice(0, 4).map(plainLabel).join(', ')}${pricingIssues.length > 4 ? ' and more' : ''}. No landed cost until they are in.`, action: { label: 'Add inputs', href: '#pricing' } });
  }
  const unowned = tasks.filter((x) => !x.owner_id && !['done', 'cancelled'].includes(x.status)).length;
  if (unowned) items.push({ tone: 'gold', title: `${unowned} task${unowned === 1 ? ' has' : 's have'} no owner`, detail: 'Give each one to Dave or Carina so nothing falls between you.', action: { label: 'Tasks', href: '#overview-tasks' } });
  return items;
}

/** One readable activity line from a jaked_activity_log row. */
export function activityLine(a) {
  const who = a.actor_id && TEAM[a.actor_id] ? TEAM[a.actor_id] : a.entity === 'enquiry' && !a.actor_id ? { name: 'Website', key: 'w' } : { name: 'System', key: 'w' };
  let title = String(a.summary || '').replace(/\s*\((partner_manager|platform_admin)\)$/, '').replace(/^Workspace v\d+:\s*/, '').replace(/ -> /g, ' → ');
  if (/^JAKED access granted/.test(title) && a.changes && TEAM[a.changes.user_id]) title = `${TEAM[a.changes.user_id].name} given JAKED access`;
  return { who, title: title || 'Change', detail: { enquiry: 'Enquiry', task: 'Task', role: 'Access', workspace: 'Workspace' }[a.entity] || '', when: a.occurred_at };
}

/** SAST greeting and labels. */
export function sastParts(d = new Date()) {
  const f = (o) => new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', ...o }).format(d);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', hourCycle: 'h23' }).format(d));
  return { greeting: hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening', date: f({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(d) };
}
export function whenLabel(iso, now = new Date()) {
  const d = new Date(iso); if (!Number.isFinite(d.getTime())) return '';
  const day = (x) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(x);
  if (day(d) === day(now)) return 'Today ' + new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }).format(d);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short' }).format(d);
}

export const TASK_AREAS = ['launch', 'sales', 'marketing', 'fulfilment', 'finance', 'legal', 'supplier', 'operations'];
export const TASK_STATUSES = [['todo', 'To do'], ['in_progress', 'In progress'], ['waiting', 'Waiting'], ['done', 'Done'], ['cancelled', 'Cancelled']];
