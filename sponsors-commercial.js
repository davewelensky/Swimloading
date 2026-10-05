// /Sponsors commercial layer: brand detail drawer (?brand=<id>), relationship
// history, commercial ledger, Rate Card and Deal Builder.
//
// Plain global script, loaded by sponsor-pipeline.html AFTER its inline script,
// so it can use that page's globals: sb, SPONSORS, currentUserEmail, escapeHtml,
// showToast, render, formatDate, isOverdue. Maths lives in sponsors-core.js.
//
// Money is Dave-only: the sponsor_ledger / sponsor_rate_card / sponsor_deal_lines
// tables are protected by RLS. IS_DAVE below only decides whether to SHOW those
// panels; it is not the security boundary.

const DAVE_EMAIL = 'dave.welensky@gmail.com';
const C = SponsorsCore;
let IS_DAVE = false;
let RATE_CARD = [];
let DRAWER = { id: null, contacts: [], history: [], ledger: [], deals: [], page: null };
let DEAL = { sponsorId: null, label: null, lines: [], ledger: [] };

const $ = (id) => document.getElementById(id);
const esc = (v) => escapeHtml(v);
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const KIND_LABEL = { cash: 'Cash', product: 'Product', other_contribution: 'Other contribution', inventory: 'SwimLoading inventory', athlete_cost: 'Athlete / talent cost' };
const CATEGORY_LABEL = { newsletter: 'Newsletter', campaign: 'Campaign', event: 'Event', athlete_content: 'Athlete content', exclusivity: 'Exclusivity', other: 'Other' };

// ── Boot (called by loadSponsors once data is in) ──────────────────────────
function initCommercial() {
  IS_DAVE = (currentUserEmail || '').toLowerCase() === DAVE_EMAIL;
  document.querySelectorAll('[data-dave-only]').forEach((n) => n.classList.toggle('hidden', !IS_DAVE));
  const brand = new URLSearchParams(location.search).get('brand');
  if (brand && SPONSORS.some((s) => s.id === brand)) openBrand(brand);
}

function showView(name) {
  ['pipeline', 'ratecard', 'deal'].forEach((v) => {
    $('view-' + v).classList.toggle('hidden', v !== name);
    document.querySelector(`[data-view="${v}"]`).classList.toggle('active', v === name);
  });
  if (name === 'ratecard') loadRateCard();
  if (name === 'deal') loadDealBuilder();
}

function dbError(error, what) {
  if (!error) return false;
  showToast((what || 'Save failed') + ': ' + error.message, true);
  return true;
}

// ── Brand drawer ───────────────────────────────────────────────────────────
async function openBrand(id) {
  const s = SPONSORS.find((x) => x.id === id);
  if (!s) return;
  DRAWER = { id, contacts: [], history: [], ledger: [], deals: [], page: null };
  history.replaceState(null, '', '?brand=' + encodeURIComponent(id));
  $('brandDrawer').classList.add('open');
  $('brandDrawerBody').innerHTML = '<div class="d-loading">Loading ' + esc(s.sponsor_name) + '…</div>';

  const q = [
    sb.from('sponsor_contacts').select('*').eq('growth_sponsor_id', id).order('created_at'),
    sb.from('sponsor_interactions').select('*').eq('growth_sponsor_id', id),
    s.partner_page_id ? sb.from('partner_pages').select('name,hero_page').eq('id', s.partner_page_id).maybeSingle() : Promise.resolve({ data: null }),
  ];
  if (IS_DAVE) {
    q.push(sb.from('sponsor_ledger').select('*').eq('growth_sponsor_id', id).order('occurred_on', { ascending: false, nullsFirst: false }));
    q.push(sb.from('sponsor_deal_lines').select('*').eq('growth_sponsor_id', id));
  }
  const [contacts, history_, page, ledger, deals] = await Promise.all(q);
  if (DRAWER.id !== id) return; // user moved on
  [contacts, history_, ledger, deals].forEach((r) => r && r.error && dbError(r.error, 'Load failed'));
  DRAWER.contacts = (contacts.data || []);
  DRAWER.history = C.sortHistory(history_.data || []);
  DRAWER.page = page.data || null;
  DRAWER.ledger = ledger ? (ledger.data || []) : [];
  DRAWER.deals = deals ? (deals.data || []) : [];
  renderDrawer();
}

function closeBrand() {
  $('brandDrawer').classList.remove('open');
  DRAWER.id = null;
  history.replaceState(null, '', location.pathname);
}

function fieldBlock(label, field, value, { rows = 2, placeholder = '' } = {}) {
  return `<div class="d-field"><label>${esc(label)}</label>
    <textarea rows="${rows}" placeholder="${esc(placeholder)}" onblur="saveBrandField('${field}', this.value)">${esc(value)}</textarea></div>`;
}

function renderDrawer() {
  const s = SPONSORS.find((x) => x.id === DRAWER.id);
  if (!s) return;
  const statusOpts = C.STATUSES.map((o) => `<option ${C.canonicalStatus(s.status) === o ? 'selected' : ''}>${o}</option>`).join('');
  const pageLink = DRAWER.page && DRAWER.page.hero_page
    ? `<a class="d-link" href="${esc(DRAWER.page.hero_page)}" target="_blank" rel="noopener">Partner page</a>` : '';
  const links = [s.website && `<a class="d-link" href="${esc(s.website)}" target="_blank" rel="noopener">Website</a>`,
    s.instagram && `<a class="d-link" href="${esc(s.instagram)}" target="_blank" rel="noopener">Instagram</a>`,
    s.linkedin && `<a class="d-link" href="${esc(s.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>`, pageLink].filter(Boolean).join('');

  const primary = (s.contact_name || s.contact_email)
    ? `<div class="d-contact"><strong>${esc(s.contact_name || '')}</strong> <span class="d-dim">primary</span>
         ${s.contact_email ? `<a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a>` : ''}</div>` : '';
  const extra = DRAWER.contacts.map((c) => `<div class="d-contact"><strong>${esc(c.name)}</strong>
      ${c.role ? `<span class="d-dim">${esc(c.role)}</span>` : ''}
      ${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}${c.phone ? `<span>${esc(c.phone)}</span>` : ''}
      <button class="d-x" title="Remove contact" onclick="removeContact('${c.id}')">&times;</button></div>`).join('');

  $('brandDrawerBody').innerHTML = `
  <div class="d-head">
    <div>
      <div class="d-title">${esc(s.sponsor_name)}</div>
      <div class="d-sub">${esc(s.category || 'Uncategorised')} · ${esc(s.country || 'country not set')}${s.owner ? ' · ' + esc(s.owner) : ''}</div>
      <div class="d-links">${links}</div>
    </div>
    <div class="d-head-right">
      <select class="status-select" data-status="${esc(C.canonicalStatus(s.status) || '')}" onchange="saveBrandStatus(this)">${statusOpts}</select>
      <button class="d-close" onclick="closeBrand()" aria-label="Close">&times;</button>
    </div>
  </div>

  <div class="d-next">
    <div class="d-field"><label>Next action</label><input value="${esc(s.next_action || '')}" onblur="saveBrandField('next_action', this.value)" placeholder="What happens next"></div>
    <div class="d-field d-narrow"><label>Follow up</label><input type="date" value="${esc(s.follow_up_date || '')}" onblur="saveBrandField('follow_up_date', this.value)"></div>
    <div class="d-field d-narrow"><label>Owner</label><input value="${esc(s.owner || '')}" onblur="saveBrandField('owner', this.value)" placeholder="Dave / Lindi"></div>
  </div>

  <div class="d-grid">
    ${fieldBlock('Proposed offer / what they give', 'proposed_offer', s.proposed_offer, { rows: 3 })}
    ${fieldBlock('Member benefit', 'member_benefit', s.member_benefit, { rows: 3, placeholder: 'What SwimLoading members get' })}
    ${fieldBlock('Exclusivity', 'exclusivity', s.exclusivity, { placeholder: 'Whether there is any, and its scope (terms go in the ledger)' })}
    ${fieldBlock('Athlete involvement', 'athlete_involvement', s.athlete_involvement, { placeholder: 'Who is involved and how (fees go in the ledger)' })}
  </div>

  <div class="d-section">
    <div class="d-h">Contacts</div>
    ${primary}${extra || (primary ? '' : '<div class="d-empty">No contacts yet.</div>')}
    <form class="d-inline" onsubmit="addContact(event)">
      <input name="name" placeholder="Name" required><input name="role" placeholder="Role"><input name="email" type="email" placeholder="Email"><input name="phone" placeholder="Phone">
      <button class="btn btn-ghost">Add contact</button>
    </form>
  </div>

  ${IS_DAVE ? commercialSection(s) : ''}

  <div class="d-section">
    <div class="d-h">Relationship history <span class="d-count">${DRAWER.history.length}</span></div>
    <form class="d-add-history" onsubmit="addInteraction(event)">
      <div class="d-inline">
        <select name="interaction_type"><option value="note">Note</option><option value="email">Email</option><option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="meeting">Meeting</option><option value="other">Other</option></select>
        <select name="direction"><option value="">No direction</option><option value="outbound">We sent</option><option value="inbound">They sent</option></select>
        <input name="counterpart" placeholder="With (name / address)">
      </div>
      <input name="subject" placeholder="Subject (optional)">
      <textarea name="body" rows="2" placeholder="What was said or agreed" required></textarea>
      <button class="btn btn-primary">Add to history</button>
    </form>
    ${DRAWER.history.map(historyEntry).join('') || '<div class="d-empty">No history recorded yet.</div>'}
  </div>

  <div class="d-section">
    <div class="d-h">Notes</div>
    <textarea class="d-notes" rows="6" onblur="saveBrandField('notes', this.value)">${esc(s.notes || '')}</textarea>
  </div>`;
}

function historyEntry(h) {
  const meta = [fmtDateTime(h.occurred_at), h.interaction_type, h.direction === 'inbound' ? 'they sent' : h.direction === 'outbound' ? 'we sent' : null,
    h.counterpart, h.author].filter(Boolean).map(esc).join(' · ');
  const body = h.body || '';
  const bodyHtml = body.length > 320
    ? `<details><summary>${esc(body.slice(0, 200))}…</summary><div class="d-body">${esc(body)}</div></details>`
    : `<div class="d-body">${esc(body)}</div>`;
  return `<div class="d-hist${h.is_draft ? ' is-draft' : ''}">
    <div class="d-hist-meta">${meta}${h.is_draft ? ' <span class="d-pill">Draft, not sent</span>' : ''}</div>
    ${h.subject ? `<div class="d-hist-subject">${esc(h.subject)}</div>` : ''}${bodyHtml}</div>`;
}

// ── Saving brand fields ────────────────────────────────────────────────────
async function saveBrandField(field, raw) {
  const s = SPONSORS.find((x) => x.id === DRAWER.id);
  if (!s) return;
  let value = String(raw == null ? '' : raw).trim() || null;
  if (field === 'category') value = C.canonicalCategory(value, C.categoryChoices(SPONSORS));
  if ((s[field] || null) === value) return;
  const { error } = await sb.from('growth_sponsors').update({ [field]: value }).eq('id', s.id);
  if (dbError(error)) return;
  s[field] = value;
  showToast('Saved');
  render();
}

async function saveBrandStatus(sel) {
  const s = SPONSORS.find((x) => x.id === DRAWER.id);
  const status = C.canonicalStatus(sel.value);
  if (!s || !status || C.canonicalStatus(s.status) === status) return;   // unchanged: no write
  const { error } = await sb.from('growth_sponsors').update({ status }).eq('id', s.id);
  if (dbError(error)) return;
  s.status = status; sel.dataset.status = status;
  showToast('Status updated');
  render();
}

// ── Contacts & history ─────────────────────────────────────────────────────
async function addContact(ev) {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const row = { growth_sponsor_id: DRAWER.id, name: String(f.get('name')).trim(),
    role: String(f.get('role')).trim() || null, email: String(f.get('email')).trim() || null, phone: String(f.get('phone')).trim() || null };
  if (!row.name) return;
  const { data, error } = await sb.from('sponsor_contacts').insert(row).select().single();
  if (dbError(error, 'Could not add contact')) return;
  DRAWER.contacts.push(data); renderDrawer();
}

async function removeContact(id) {
  if (!confirm('Remove this contact?')) return;
  const { error } = await sb.from('sponsor_contacts').delete().eq('id', id);
  if (dbError(error)) return;
  DRAWER.contacts = DRAWER.contacts.filter((c) => c.id !== id); renderDrawer();
}

async function addInteraction(ev) {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const row = { growth_sponsor_id: DRAWER.id, occurred_at: new Date().toISOString(),
    interaction_type: f.get('interaction_type') || null, direction: f.get('direction') || null,
    subject: String(f.get('subject')).trim() || null, body: String(f.get('body')).trim(),
    counterpart: String(f.get('counterpart')).trim() || null, author: (currentUserEmail || '').split('@')[0] || null, source: 'app' };
  if (!row.body) return;
  const { data, error } = await sb.from('sponsor_interactions').insert(row).select().single();
  if (dbError(error, 'Could not add entry')) return;
  DRAWER.history = C.sortHistory(DRAWER.history.concat(data)); renderDrawer();
}

// ── Commercial section (Dave only) ─────────────────────────────────────────
function balanceTiles(entries) {
  const bal = C.ledgerBalance(entries);
  const cur = Object.keys(bal).sort();
  if (!cur.length) return '<div class="d-empty">No ledger entries yet. Nothing is assumed.</div>';
  const row = (label, v, c, cls = '') => `<div class="bal-row ${cls}"><span>${esc(label)}</span><b>${esc(C.fmtMoney(v, c))}</b></div>`;
  return cur.map((c) => {
    const b = bal[c];
    return `<div class="bal-card"><div class="bal-cur">${esc(c)}</div>
      <div class="bal-col"><div class="bal-h">Sponsor contributes</div>
        ${row('Cash received', b.cash.received, c, 'is-cash')}${row('Cash agreed, not yet received', b.cash.agreed, c)}
        ${row('Product value (not cash)', b.product, c, 'is-product')}${row('Other contribution value', b.other, c)}</div>
      <div class="bal-col"><div class="bal-h">SwimLoading commits</div>
        ${row('Commercial inventory', b.inventory, c)}${row('Athlete / talent cost', b.athlete, c)}</div>
      <div class="bal-total">${row('Indicative value balance', b.indicative, c, b.indicative < 0 ? 'neg' : 'pos')}
        <div class="d-dim">Indicative only: product and agreed-but-unreceived cash count as value. ${b.proposed ? b.proposed + ' proposed entr' + (b.proposed === 1 ? 'y' : 'ies') + ' not counted.' : ''}</div></div>
    </div>`;
  }).join('');
}

function commercialSection(s) {
  const rows = DRAWER.ledger.map((e) => `<tr class="${e.status === 'cancelled' ? 'is-cancelled' : ''}">
    <td>${esc(e.occurred_on || '')}</td><td>${esc(KIND_LABEL[e.kind] || e.kind)}</td>
    <td>${esc(e.description)}${e.athlete_name ? ` <span class="d-dim">(${esc(e.athlete_name)})</span>` : ''}${e.campaign_ref || e.event_ref ? ` <span class="d-dim">${esc([e.campaign_ref, e.event_ref].filter(Boolean).join(' / '))}</span>` : ''}</td>
    <td class="num">${esc(C.fmtMoney(e.amount, e.currency))}</td>
    <td><select onchange="setLedgerStatus('${e.id}', this.value)">${['proposed', 'agreed', 'delivered', 'cancelled'].map((o) => `<option ${e.status === o ? 'selected' : ''}>${o}</option>`).join('')}</select></td>
    <td><button class="d-x" onclick="removeLedger('${e.id}')" title="Delete entry">&times;</button></td></tr>`).join('');
  const deals = DRAWER.deals.length
    ? `<div class="d-dim">${DRAWER.deals.length} deal line${DRAWER.deals.length === 1 ? '' : 's'} saved. </div>` : '';
  return `<div class="d-section d-commercial">
    <div class="d-h">Commercial <span class="d-dim">Dave only</span></div>
    ${balanceTiles(DRAWER.ledger)}
    ${rows ? `<table class="d-table"><thead><tr><th>Date</th><th>Type</th><th>What</th><th class="num">Value</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : ''}
    <form class="d-ledger-form" onsubmit="addLedger(event)">
      <select name="kind">${C.LEDGER_KINDS.map((k) => `<option value="${k}">${esc(KIND_LABEL[k])}</option>`).join('')}</select>
      <input name="description" placeholder="What (e.g. 12 months of prize product)" required>
      <input name="amount" type="number" step="0.01" min="0" placeholder="Value" required>
      <input name="currency" list="currency-codes" placeholder="ZAR" maxlength="3" required>
      <select name="status"><option>agreed</option><option>proposed</option><option>delivered</option></select>
      <input name="occurred_on" type="date">
      <input name="campaign_ref" placeholder="Campaign (optional)"><input name="event_ref" placeholder="Event (optional)"><input name="athlete_name" placeholder="Athlete (optional)">
      <button class="btn btn-ghost">Add ledger entry</button>
    </form>
    ${deals}<button class="btn btn-ghost" onclick="buildDealFor('${s.id}')">Build / view deal</button>
  </div>`;
}

async function addLedger(ev) {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const currency = C.currencyCode(f.get('currency'));
  if (!currency) { showToast('Currency must be a 3-letter code, e.g. ZAR', true); return; }
  const row = { growth_sponsor_id: DRAWER.id, kind: f.get('kind'), description: String(f.get('description')).trim(),
    amount: Number(f.get('amount')), currency, status: f.get('status'), occurred_on: f.get('occurred_on') || null,
    campaign_ref: String(f.get('campaign_ref')).trim() || null, event_ref: String(f.get('event_ref')).trim() || null,
    athlete_name: String(f.get('athlete_name')).trim() || null };
  const { data, error } = await sb.from('sponsor_ledger').insert(row).select().single();
  if (dbError(error, 'Could not add entry')) return;
  DRAWER.ledger.unshift(data); renderDrawer();
}

async function setLedgerStatus(id, status) {
  const { error } = await sb.from('sponsor_ledger').update({ status }).eq('id', id);
  if (dbError(error)) return;
  DRAWER.ledger.find((e) => e.id === id).status = status; renderDrawer();
}

async function removeLedger(id) {
  if (!confirm('Delete this ledger entry? (Set it to "cancelled" instead if you want to keep a record.)')) return;
  const { error } = await sb.from('sponsor_ledger').delete().eq('id', id);
  if (dbError(error)) return;
  DRAWER.ledger = DRAWER.ledger.filter((e) => e.id !== id); renderDrawer();
}

// ── Rate card (Dave only) ──────────────────────────────────────────────────
async function loadRateCard() {
  if (!IS_DAVE) return;
  const { data, error } = await sb.from('sponsor_rate_card').select('*').order('sort_order').order('created_at');
  if (dbError(error, 'Could not load rate card')) return;
  RATE_CARD = data || [];
  renderRateCard();
}

function renderRateCard() {
  const cats = Object.keys(CATEGORY_LABEL);
  $('ratecard-body').innerHTML = `<table class="d-table rc-table"><thead><tr><th>Item</th><th>Type</th><th>Unit</th><th class="num">Price</th><th>Currency</th><th>Counts as</th><th>Active</th><th></th></tr></thead><tbody>
  ${RATE_CARD.map((r) => `<tr class="${r.is_active ? '' : 'is-cancelled'}" data-id="${r.id}">
    <td><input data-f="name" value="${esc(r.name)}" onchange="saveRateCard('${r.id}')"></td>
    <td><select data-f="category" onchange="saveRateCard('${r.id}')">${cats.map((c) => `<option value="${c}" ${r.category === c ? 'selected' : ''}>${CATEGORY_LABEL[c]}</option>`).join('')}</select></td>
    <td><input data-f="unit_label" value="${esc(r.unit_label || '')}" onchange="saveRateCard('${r.id}')"></td>
    <td><input data-f="unit_price" type="number" step="0.01" min="0" value="${r.unit_price == null ? '' : esc(r.unit_price)}" placeholder="not priced" onchange="saveRateCard('${r.id}')"></td>
    <td><input data-f="currency" list="currency-codes" maxlength="3" value="${esc(r.currency || '')}" onchange="saveRateCard('${r.id}')"></td>
    <td><select data-f="ledger_kind" onchange="saveRateCard('${r.id}')"><option value="inventory" ${r.ledger_kind === 'inventory' ? 'selected' : ''}>Inventory</option><option value="athlete_cost" ${r.ledger_kind === 'athlete_cost' ? 'selected' : ''}>Athlete cost</option></select></td>
    <td><input data-f="is_active" type="checkbox" ${r.is_active ? 'checked' : ''} onchange="saveRateCard('${r.id}')"></td>
    <td><button class="d-x" onclick="removeRateCard('${r.id}')" title="Remove">&times;</button></td></tr>`).join('')}
  </tbody></table>`;
}

async function saveRateCard(id) {
  const tr = document.querySelector(`#ratecard-body tr[data-id="${id}"]`);
  const g = (f) => tr.querySelector(`[data-f="${f}"]`);
  const priceRaw = g('unit_price').value.trim();
  const currency = C.currencyCode(g('currency').value);
  if (priceRaw !== '' && !currency) { showToast('A price needs a 3-letter currency, e.g. ZAR', true); return; }
  const row = { name: g('name').value.trim() || 'Untitled', category: g('category').value, unit_label: g('unit_label').value.trim() || null,
    unit_price: priceRaw === '' ? null : Number(priceRaw), currency: priceRaw === '' ? null : currency,
    ledger_kind: g('ledger_kind').value, is_active: g('is_active').checked };
  const { error } = await sb.from('sponsor_rate_card').update(row).eq('id', id);
  if (dbError(error)) return;
  Object.assign(RATE_CARD.find((r) => r.id === id), row);
  showToast('Rate card saved');
}

async function addRateCardItem() {
  const { data, error } = await sb.from('sponsor_rate_card').insert({ name: 'New item', sort_order: (RATE_CARD.length + 1) * 10 }).select().single();
  if (dbError(error)) return;
  RATE_CARD.push(data); renderRateCard();
}

async function removeRateCard(id) {
  if (!confirm('Remove this rate card item? Existing ledger entries and deal lines keep their own values.')) return;
  const { error } = await sb.from('sponsor_rate_card').delete().eq('id', id);
  if (dbError(error)) return;
  RATE_CARD = RATE_CARD.filter((r) => r.id !== id); renderRateCard();
}

// ── Deal builder (Dave only) ───────────────────────────────────────────────
function buildDealFor(sponsorId) {
  closeBrand();
  DEAL.sponsorId = sponsorId; DEAL.label = null;
  showView('deal');
}

async function loadDealBuilder() {
  if (!IS_DAVE) return;
  if (!RATE_CARD.length) {
    const { data } = await sb.from('sponsor_rate_card').select('*').order('sort_order');
    RATE_CARD = data || [];
  }
  const sel = $('deal-brand');
  sel.innerHTML = '<option value="">Choose a brand…</option>' + SPONSORS.slice().sort((a, b) => a.sponsor_name.localeCompare(b.sponsor_name))
    .map((s) => `<option value="${s.id}">${esc(s.sponsor_name)}</option>`).join('');
  if (DEAL.sponsorId) sel.value = DEAL.sponsorId;
  await loadDealLines();
}

async function loadDealLines() {
  const id = $('deal-brand').value || null;
  DEAL.sponsorId = id;
  if (!id) { $('deal-body').innerHTML = '<div class="d-empty">Pick a brand to price a request against the rate card.</div>'; return; }
  const [lines, ledger] = await Promise.all([
    sb.from('sponsor_deal_lines').select('*').eq('growth_sponsor_id', id).order('created_at'),
    sb.from('sponsor_ledger').select('*').eq('growth_sponsor_id', id)]);
  if (dbError(lines.error, 'Could not load deal') || dbError(ledger.error, 'Could not load ledger')) return;
  DEAL.lines = lines.data || []; DEAL.ledger = ledger.data || [];
  const labels = [...new Set(DEAL.lines.map((l) => l.deal_label))];
  if (!DEAL.label || (!labels.includes(DEAL.label) && labels.length)) DEAL.label = labels[0] || 'Draft deal';
  renderDeal();
}

function renderDeal() {
  const labels = [...new Set(DEAL.lines.map((l) => l.deal_label))];
  if (!labels.includes(DEAL.label)) labels.push(DEAL.label);
  const lines = DEAL.lines.filter((l) => l.deal_label === DEAL.label);
  const { totals, unpriced } = C.dealTotals(lines);
  const bal = C.ledgerBalance(DEAL.ledger);
  const items = RATE_CARD.filter((r) => r.is_active);
  const cur = [...new Set(Object.keys(totals).concat(Object.keys(bal)))].sort();
  const summary = cur.length ? cur.map((c) => {
    const b = bal[c] || { cash: { received: 0, agreed: 0 }, product: 0, other: 0, inventory: 0, athlete: 0 };
    const contributes = b.cash.received + b.cash.agreed + b.product + b.other;
    const committed = b.inventory + b.athlete;
    const asked = totals[c] || 0;
    return `<div class="bal-card"><div class="bal-cur">${esc(c)}</div>
      <div class="bal-col"><div class="bal-h">Sponsor contributes (ledger)</div><div class="bal-row"><span>Cash + product + other</span><b>${esc(C.fmtMoney(contributes, c))}</b></div>
        <div class="d-dim">Cash received ${esc(C.fmtMoney(b.cash.received, c))}; product ${esc(C.fmtMoney(b.product, c))} (not cash)</div></div>
      <div class="bal-col"><div class="bal-h">SwimLoading gives</div><div class="bal-row"><span>Already committed (ledger)</span><b>${esc(C.fmtMoney(committed, c))}</b></div>
        <div class="bal-row"><span>This deal, at rate card</span><b>${esc(C.fmtMoney(asked, c))}</b></div></div>
      <div class="bal-total"><div class="bal-row ${contributes - committed - asked < 0 ? 'neg' : 'pos'}"><span>Indicative balance if agreed</span><b>${esc(C.fmtMoney(contributes - committed - asked, c))}</b></div></div></div>`;
  }).join('') : '<div class="d-empty">Add priced lines to see the value balance.</div>';

  $('deal-body').innerHTML = `
  <div class="deal-top">
    <select id="deal-label" onchange="DEAL.label=this.value;renderDeal()">${labels.map((l) => `<option ${l === DEAL.label ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    <button class="btn btn-ghost" onclick="newDealLabel()">New deal</button>
  </div>
  <table class="d-table"><thead><tr><th>Line</th><th class="num">Qty</th><th class="num">Unit price</th><th>Currency</th><th class="num">Line total</th><th>Status</th><th></th></tr></thead><tbody>
  ${lines.map((l) => {
    const total = l.unit_price == null ? null : Number(l.quantity) * Number(l.unit_price);
    const inLedger = DEAL.ledger.some((e) => e.notes === 'deal-line:' + l.id);
    return `<tr class="${l.status === 'declined' ? 'is-cancelled' : ''}">
      <td>${esc(l.description)}${l.unit_price == null ? ' <span class="d-pill">not priced</span>' : ''}</td>
      <td class="num"><input class="in-s" type="number" step="0.01" min="0.01" value="${esc(l.quantity)}" onchange="saveDealLine('${l.id}', {quantity: Number(this.value)})"></td>
      <td class="num"><input class="in-s" type="number" step="0.01" min="0" value="${l.unit_price == null ? '' : esc(l.unit_price)}" onchange="saveDealPrice('${l.id}', this)"></td>
      <td><input class="in-s" list="currency-codes" maxlength="3" value="${esc(l.currency || '')}" onchange="saveDealPrice('${l.id}', this)"></td>
      <td class="num">${total == null ? '–' : esc(C.fmtMoney(total, l.currency))}</td>
      <td><select onchange="saveDealLine('${l.id}', {status: this.value})">${['draft', 'proposed', 'agreed', 'declined'].map((o) => `<option ${l.status === o ? 'selected' : ''}>${o}</option>`).join('')}</select></td>
      <td>${l.status === 'agreed' && total != null ? (inLedger ? '<span class="d-dim">in ledger</span>' : `<button class="btn btn-ghost" onclick="dealLineToLedger('${l.id}')">Add to ledger</button>`) : ''}
          <button class="d-x" onclick="removeDealLine('${l.id}')" title="Remove line">&times;</button></td></tr>`;
  }).join('') || '<tr><td colspan="7" class="d-empty">No lines yet.</td></tr>'}
  </tbody></table>
  <form class="d-ledger-form" onsubmit="addDealLine(event)">
    <select name="rate" onchange="fillFromRate(this.form)"><option value="">Custom line</option>${items.map((r) => `<option value="${r.id}">${esc(r.name)}${r.unit_price == null ? ' (not priced)' : ''}</option>`).join('')}</select>
    <input name="description" placeholder="Description" required>
    <input name="quantity" type="number" step="0.01" min="0.01" value="1" required>
    <input name="unit_price" type="number" step="0.01" min="0" placeholder="Unit price">
    <input name="currency" list="currency-codes" maxlength="3" placeholder="ZAR">
    <button class="btn btn-primary">Add line</button>
  </form>
  ${unpriced ? `<div class="d-warn">${unpriced} line${unpriced === 1 ? ' is' : 's are'} not priced and not in the totals. Price the item on the Rate Card or enter a price here.</div>` : ''}
  <div class="d-h" style="margin-top:18px">Value balance <span class="d-dim">per currency, no conversion</span></div>${summary}`;
}

function fillFromRate(form) {
  const r = RATE_CARD.find((x) => x.id === form.rate.value);
  if (!r) return;
  form.description.value = r.name;
  form.unit_price.value = r.unit_price == null ? '' : r.unit_price;
  form.currency.value = r.currency || '';
}

function newDealLabel() {
  const name = prompt('Name this deal (e.g. "2027 season package")');
  if (!name || !name.trim()) return;
  DEAL.label = name.trim(); renderDeal();
}

async function addDealLine(ev) {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const priceRaw = String(f.get('unit_price')).trim();
  const currency = C.currencyCode(f.get('currency'));
  if (priceRaw !== '' && !currency) { showToast('A price needs a 3-letter currency, e.g. ZAR', true); return; }
  const rate = RATE_CARD.find((r) => r.id === f.get('rate'));
  const row = { growth_sponsor_id: DEAL.sponsorId, deal_label: DEAL.label, rate_card_id: rate ? rate.id : null,
    description: String(f.get('description')).trim(), quantity: Number(f.get('quantity')) || 1,
    unit_price: priceRaw === '' ? null : Number(priceRaw), currency: priceRaw === '' ? null : currency,
    ledger_kind: rate ? rate.ledger_kind : 'inventory' };
  const { data, error } = await sb.from('sponsor_deal_lines').insert(row).select().single();
  if (dbError(error, 'Could not add line')) return;
  DEAL.lines.push(data); renderDeal();
}

async function saveDealLine(id, patch) {
  const { error } = await sb.from('sponsor_deal_lines').update(patch).eq('id', id);
  if (dbError(error)) return;
  Object.assign(DEAL.lines.find((l) => l.id === id), patch); renderDeal();
}

async function saveDealPrice(id, input) {
  const tr = input.closest('tr');
  const [, priceEl, curEl] = tr.querySelectorAll('input');
  const priceRaw = priceEl.value.trim(); const currency = C.currencyCode(curEl.value);
  if (priceRaw !== '' && !currency) { showToast('A price needs a 3-letter currency, e.g. ZAR', true); return; }
  await saveDealLine(id, { unit_price: priceRaw === '' ? null : Number(priceRaw), currency: priceRaw === '' ? null : currency });
}

async function removeDealLine(id) {
  if (!confirm('Remove this line?')) return;
  const { error } = await sb.from('sponsor_deal_lines').delete().eq('id', id);
  if (dbError(error)) return;
  DEAL.lines = DEAL.lines.filter((l) => l.id !== id); renderDeal();
}

// An agreed, priced line becomes a SwimLoading commitment in the ledger — once.
async function dealLineToLedger(id) {
  const l = DEAL.lines.find((x) => x.id === id);
  if (!l || l.unit_price == null || DEAL.ledger.some((e) => e.notes === 'deal-line:' + id)) return;
  const row = { growth_sponsor_id: l.growth_sponsor_id, kind: l.ledger_kind, description: `${l.description} x${l.quantity} (${l.deal_label})`,
    amount: Number(l.quantity) * Number(l.unit_price), currency: l.currency, status: 'agreed', rate_card_id: l.rate_card_id, notes: 'deal-line:' + id };
  const { data, error } = await sb.from('sponsor_ledger').insert(row).select().single();
  if (dbError(error, 'Could not add to ledger')) return;
  DEAL.ledger.push(data); renderDeal(); showToast('Added to ledger as a commitment');
}

// The pipeline may finish loading before this script has executed (fast cache, fast network), in which case
// its own initCommercial() call was skipped. Run it now if data is already there.
if (typeof SPONSORS !== 'undefined' && SPONSORS.length) initCommercial();

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && DRAWER.id) closeBrand(); });
