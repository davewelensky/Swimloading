// Seal bite / rabies guidance in the Report a Hazard form and the Safety page.
//
// The browser code is plain global scripts, so these tests lift the real
// function bodies out of app.js and the real markup out of index.html and run
// them against a small fake DOM. Nothing here talks to Supabase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const APP = readFileSync('app.js', 'utf8');
const HTML = readFileSync('index.html', 'utf8');

// A top-level function in app.js is indented 8 spaces and closes with "        }".
function fnSource(name) {
  const lines = APP.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`        function ${name}(`) || l.startsWith(`        async function ${name}(`));
  assert.ok(start >= 0, `function ${name} not found in app.js`);
  let end = start;
  while (lines[end] !== '        }') end++;
  return lines.slice(start, end + 1).join('\n');
}

// Initial `hidden` / inline display of an element, read from the real markup.
function initialState(id) {
  const m = HTML.match(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(m, `#${id} not found in index.html`);
  const tag = m[0];
  const display = (tag.match(/display:\s*(\w+)/) || [])[1] || '';
  return { hidden: /\shidden[\s>=]/.test(tag), display };
}

function makeEnv({ regionCode = '', typeValue = 'seal_aggression', homeDomain = '', safetyValue = '' } = {}) {
  const els = new Map();
  const toasts = [];
  const pages = [];
  const selects = [];
  const scrolled = [];
  function el(id) {
    if (!els.has(id)) {
      let init = { hidden: false, display: '' };
      try { init = initialState(id); } catch { /* dynamic element, defaults are fine */ }
      const classes = new Set();
      els.set(id, {
        id, hidden: init.hidden, value: '', innerHTML: '', textContent: '', innerText: '',
        style: { display: init.display },
        classList: {
          toggle: (c, on) => { (on === undefined ? !classes.has(c) : on) ? classes.add(c) : classes.delete(c); },
          add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
        },
        dataset: {}, querySelectorAll: () => [], querySelector: () => null, setAttribute() {}, remove() {}, insertAdjacentHTML() {}, scrollIntoView: () => scrolled.push(id),
      });
    }
    return els.get(id);
  }
  el('hazardType').value = typeValue;
  el('hazardRegion').value = regionCode;
  el('hazardTitle').value = 'Aggressive seal at the jetty';
  el('hazardDescription').value = 'Two swimmers out of the water';

  const sandbox = {
    document: { getElementById: el, querySelectorAll: () => [], querySelector: () => null },
    window: {}, console, setTimeout: (fn) => { fn(); return 0; },
    domains: [{ code: 'NAMIBIA', display_name: 'Namibia' }, { code: 'ATLANTIC', display_name: 'Atlantic Seaboard' }],
    currentUserProfile: { home_domain: homeDomain },
    showPage: (p) => pages.push(p),
    fdSafetySelect: (v, label) => { selects.push([v, label]); sandbox._fdSafetyValue = v; sandbox.renderSafetyRegionalContent(); },
    showToast: (m) => toasts.push(m),
    _fdSafetyValue: safetyValue,
    isDemo: false,
  };
  vm.createContext(sandbox);
  const names = ['onHazardTypeChange', 'selectHazardBite', 'viewEmergencyContactsFromHazard', 'renderActiveHazards', 'renderSafetyRegionalContent'];
  for (const n of names) vm.runInContext(fnSource(n), sandbox, { filename: `app.js:${n}` });
  return { sandbox, el, pages, selects, scrolled, toasts };
}

const biteState = (env) => ({
  question: !env.el('hazardBiteGroup').hidden,
  panel: !env.el('hazardBitePanel').hidden,
});

// ── Markup ────────────────────────────────────────────────────────────────

test('bite/scratch question and panel ship hidden, so no other hazard type shows them', () => {
  assert.equal(initialState('hazardBiteGroup').hidden, true);
  assert.equal(initialState('hazardBitePanel').hidden, true);
  assert.match(HTML, /id="hazardBiteGroup"/);
  assert.match(HTML, /Was anyone bitten or scratched\?/);
});

test('the question offers exactly Yes / No / Unknown and is not a required field', () => {
  for (const [id, label] of [['biteYes', 'Yes'], ['biteNo', 'No'], ['biteUnknown', 'Unknown']]) {
    assert.match(HTML, new RegExp(`id="${id}"[^>]*>${label}<`));
  }
  const group = HTML.slice(HTML.indexOf('id="hazardBiteGroup"'), HTML.indexOf('<!-- Suggest Spot Modal -->'));
  assert.doesNotMatch(group.slice(0, group.indexOf('Severity')), /\brequired\b/);
});

test('every existing hazard type is still offered', () => {
  const sel = HTML.match(/<select id="hazardType"[^>]*>([\s\S]*?)<\/select>/)[1];
  const values = [...sel.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(values, ['seal_aggression', 'shark_sighting', 'jellyfish', 'sewage', 'rip_current', 'beach_closure', 'other']);
});

test('the report insert is unchanged: no new column, so no migration is needed', () => {
  const insert = fnSource('submitHazardReport').match(/from\('hazard_reports'\)\.insert\(\{([\s\S]*?)\}\)/)[1];
  const keys = [...insert.matchAll(/^\s*(\w+)[:,]/gm)].map((m) => m[1]);
  assert.deepEqual(keys, ['user_id', 'spot_id', 'hazard_type', 'severity', 'title', 'description', 'photo_url', 'active_until']);
});

// ── Question visibility, Yes/No/Unknown, switching ────────────────────────

test('Seal Aggression / Bite shows the question; other types do not', () => {
  const env = makeEnv({ typeValue: 'seal_aggression' });
  env.sandbox.onHazardTypeChange();
  assert.deepEqual(biteState(env), { question: true, panel: false });
  for (const type of ['shark_sighting', 'jellyfish', 'sewage', 'rip_current', 'beach_closure', 'other']) {
    env.el('hazardType').value = type;
    env.sandbox.onHazardTypeChange();
    assert.deepEqual(biteState(env), { question: false, panel: false }, type);
  }
});

test('Yes shows the emergency panel immediately; No and Unknown do not', () => {
  const env = makeEnv();
  env.sandbox.onHazardTypeChange();
  env.sandbox.selectHazardBite('yes');
  assert.deepEqual(biteState(env), { question: true, panel: true });
  env.sandbox.selectHazardBite('no');
  assert.deepEqual(biteState(env), { question: true, panel: false });
  env.sandbox.selectHazardBite('unknown');
  assert.deepEqual(biteState(env), { question: true, panel: false });
  env.sandbox.selectHazardBite('yes');
  assert.equal(env.el('biteYes').classList.contains('active'), true);
  assert.equal(env.el('biteNo').classList.contains('active'), false);
});

test('Unknown never states or implies that the situation is safe', () => {
  const panel = HTML.slice(HTML.indexOf('id="hazardBitePanel"'), HTML.indexOf('id="hazardBitePanel"') + 1500);
  assert.doesNotMatch(panel, /\bsafe\b|all clear|no risk/i);
  // Unknown has no copy of its own: it only leaves the panel closed.
  assert.doesNotMatch(fnSource('selectHazardBite'), /unknown.*(safe|clear)/i);
});

test('switching away from seals and back clears a previous Yes', () => {
  const env = makeEnv();
  env.sandbox.onHazardTypeChange();
  env.sandbox.selectHazardBite('yes');
  env.el('hazardType').value = 'shark_sighting';
  env.sandbox.onHazardTypeChange();
  assert.deepEqual(biteState(env), { question: false, panel: false });
  env.el('hazardType').value = 'seal_aggression';
  env.sandbox.onHazardTypeChange();
  assert.deepEqual(biteState(env), { question: true, panel: false });
  for (const id of ['biteYes', 'biteNo', 'biteUnknown']) assert.equal(env.el(id).classList.contains('active'), false);
});

test('the panel carries the approved wording and the contacts button', () => {
  assert.match(HTML, /Seal bite or scratch\? Seek urgent medical care\./);
  assert.match(HTML, /Wash the wound with running water and soap for at least 15 minutes and seek immediate medical assessment for possible rabies exposure\./);
  assert.match(HTML, /Do not wait for symptoms\./);
  assert.match(HTML, /onclick="viewEmergencyContactsFromHazard\(\)"[^>]*>View emergency contacts</);
});

// ── Emergency-contact navigation ──────────────────────────────────────────

test('"View emergency contacts" opens the Safety page on the existing contacts card', () => {
  const env = makeEnv({ regionCode: 'ATLANTIC' });
  env.sandbox.viewEmergencyContactsFromHazard();
  assert.deepEqual(env.pages, ['safety']);
  assert.deepEqual(env.selects, [['ATLANTIC', 'Atlantic Seaboard']]);
  assert.deepEqual(env.scrolled, ['safetyEmergencyContacts']);
  assert.match(HTML, /id="safetyEmergencyContacts"/);
  assert.equal(env.el('hazardReportModal').style.display, 'none');
});

test('navigating to contacts does not discard the report being written', () => {
  const env = makeEnv({ regionCode: 'ATLANTIC' });
  env.sandbox.viewEmergencyContactsFromHazard();
  assert.equal(env.el('hazardTitle').value, 'Aggressive seal at the jetty');
  assert.equal(env.el('hazardDescription').value, 'Two swimmers out of the water');
});

test('with no region chosen it still opens the Safety page (national contacts always show)', () => {
  const env = makeEnv({ regionCode: '' });
  env.sandbox.viewEmergencyContactsFromHazard();
  assert.deepEqual(env.pages, ['safety']);
  assert.deepEqual(env.selects, []);
});

test('Western Cape: the City of Cape Town and Cape of Good Hope SPCA contacts are rendered', () => {
  const env = makeEnv({ safetyValue: 'ATLANTIC' });
  env.sandbox.renderSafetyRegionalContent();
  const contacts = env.el('safetyRegionalContacts').innerHTML;
  const reporting = env.el('safetyRegionalReporting').innerHTML;
  assert.match(contacts, /City of Cape Town/);
  assert.match(contacts, /021 480 7700/);
  assert.match(reporting, /Reporting \(Western Cape\)/);
  assert.match(reporting, /Cape of Good Hope SPCA/);
  assert.match(reporting, /021 700 4158/);
  assert.match(reporting, /City WhatsApp Line/);
});

test('every Cape-group domain reaches the same Western Cape contacts', () => {
  for (const d of ['ATLANTIC', 'FALSE_BAY', 'WEST_COAST', 'SOUTH_COAST']) {
    const env = makeEnv({ safetyValue: d });
    env.sandbox.renderSafetyRegionalContent();
    assert.match(env.el('safetyRegionalReporting').innerHTML, /Cape of Good Hope SPCA/, d);
  }
});

// ── South African wording is not shown as Namibian guidance ───────────────

test('Western Cape shows the South African rabies line and City / SPCA reporting step', () => {
  const env = makeEnv({ safetyValue: 'ATLANTIC' });
  env.sandbox.renderSafetyRegionalContent();
  assert.equal(env.el('sealBiteSection').style.display, '');
  assert.equal(env.el('sealRabiesLineZA').style.display, '');
  assert.equal(env.el('sealReportZA').style.display, '');
  assert.equal(env.el('sealRabiesLineGeneral').style.display, 'none');
  assert.equal(env.el('sealReportGeneral').style.display, 'none');
});

test('Namibia keeps general seal and emergency advice but no South African claims or contacts', () => {
  const env = makeEnv({ safetyValue: 'NAMIBIA' });
  env.sandbox.renderSafetyRegionalContent();
  assert.equal(env.el('sealBiteSection').style.display, '');
  assert.equal(env.el('sealRabiesLineZA').style.display, 'none');
  assert.equal(env.el('sealReportZA').style.display, 'none');
  assert.equal(env.el('sealRabiesLineGeneral').style.display, '');
  assert.equal(env.el('sealReportGeneral').style.display, '');
  assert.doesNotMatch(env.el('safetyRegionalReporting').innerHTML, /SPCA|Cape Town/);
  assert.match(env.el('safetyRegionalReporting').innerHTML, /Reporting \(Namibia\)/);
  // The general lines contain no South African claim.
  const general = HTML.match(/id="sealRabiesLineGeneral"[^>]*>([^<]*)</)[1] + HTML.match(/id="sealReportGeneral"[^>]*>([^<]*)</)[1];
  assert.doesNotMatch(general, /South Africa|Cape Town|SPCA|Western Cape/);
});

test('regions with no seal exposure hide the whole seal warning', () => {
  const env = makeEnv({ safetyValue: 'KZN' });
  env.sandbox.renderSafetyRegionalContent();
  assert.equal(env.el('sealBiteSection').style.display, 'none');
});

// ── Medical wording guards ────────────────────────────────────────────────

test('seal warning and vaccination panel keep the approved safeguards', () => {
  const warning = HTML.slice(HTML.indexOf('id="sealBiteSection"'), HTML.indexOf('HYPOTHERMIA: MEDICAL EMERGENCY'));
  assert.match(warning, /SEAL BITES &amp; RABIES: MEDICAL EMERGENCY/);
  assert.match(warning, /Do not wait for symptoms or confirmation that the animal was infected\./);
  assert.match(warning, /A healthcare professional must assess the need for rabies vaccination and immunoglobulin/);
  assert.doesNotMatch(warning, /all (aggressive )?seals (have|carry) rabies/i);

  // Final wording decisions
  assert.match(warning, /Wash the affected area thoroughly with running water and soap for at least 15 minutes\./);
  assert.match(warning, /Avoid causing further injury\./);
  assert.doesNotMatch(warning, /scrub/i);
  assert.match(warning, /Use povidone-iodine or chlorhexidine if available\. Do not delay medical treatment to obtain antiseptic\./);
  assert.match(warning, /Rabies has been confirmed in Cape fur seals along the Western Cape and Northern Cape coastlines\./);
  assert.doesNotMatch(HTML, /along the South African coastline/);
  assert.match(warning, /taking previous vaccination and the nature of exposure into account/);

  const tip = HTML.slice(HTML.indexOf('id="sealVaccineTip"'), HTML.indexOf('<!-- Critical Risks -->'));
  assert.match(tip, /Preventative Rabies Vaccination/);
  assert.match(tip, /urgent medical assessment remains essential/);
  assert.doesNotMatch(tip, /Eliminates the need|booster|one week apart/i);
  assert.doesNotMatch(HTML, /Eliminates the need for post-bite immunoglobulin/);
});

// ── Empty hazard state ────────────────────────────────────────────────────

test('no active hazards: neutral wording, never "all clear", no green safe dot', () => {
  const env = makeEnv();
  env.sandbox.renderActiveHazards([]);
  const html = env.el('activeHazardsList').innerHTML;
  assert.match(html, /No active community hazard reports/);
  assert.match(html, /Conditions can change\. Always remain alert\./);
  assert.doesNotMatch(html, /all clear|#10b981/i);
  assert.doesNotMatch(APP, /all clear/i);
});
