// Renders a spot page through the real handler, locally, against the real
// database — the check that was missing when increment 5 first shipped.
//
// WHY THIS EXISTS. The crossing work had scripts/render-crossing.mjs, so
// every template change was executed before it was deployed. The spot
// handler had no equivalent, so a reordering mistake — a const used three
// lines above its own declaration — passed `node --check`, passed the unit
// tests (which never call the handler), and took every /spots/* page to a
// 500 in production. Syntax checking is not running the code.
//
//   node scripts/render-spot.mjs tooting-bec-lido
//   node scripts/render-spot.mjs --smoke     # a spread of freshness states
import handler from '../api/spots-handler.js';

const SMOKE = [
  ['tooting-bec-lido',  'live reading, UK pool, sensor venue'],
  ['brockwell-lido',    'live reading, UK pool'],
  ['clifton-4th-beach', 'recent reading, ZA ocean'],
  ['simons-town',       'stale reading, ZA ocean'],
  ['boulders-beach',    'very stale reading, ZA ocean'],
  ['muizenberg',        'no reading, modelled estimate only'],
  ['atlantic',          'REGION page — must not regress'],
];

function mockRes() {
  return {
    statusCode: 200, body: '', headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    send(b) { this.body = String(b ?? ''); return this; },
    writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); },
    end() {},
  };
}

async function render(slug) {
  const res = mockRes();
  const errors = [];
  const realError = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  try {
    await handler({ url: `/spots/${slug}` }, res);
  } finally {
    console.error = realError;
  }
  return { res, errors };
}

const args = process.argv.slice(2);
const targets = args.includes('--smoke') || args.length === 0
  ? SMOKE
  : [[args[0], 'requested']];

let failed = 0;
for (const [slug, note] of targets) {
  const { res, errors } = await render(slug);
  const html = res.body;
  const grab = (re) => (html.match(re) || [, ''])[1].trim();
  const title = grab(/<title>([\s\S]*?)<\/title>/i);
  const desc = grab(/name="description" content="([^"]*)"/i);
  const ok = res.statusCode === 200 && !errors.length;
  if (!ok) failed++;

  console.log(`${ok ? 'ok  ' : 'FAIL'} ${slug.padEnd(20)} ${res.statusCode}  ${String(html.length).padStart(6)}b  (${note})`);
  if (title) console.log(`       title: ${title.slice(0, 88)}`);
  if (desc) console.log(`       desc : ${desc.slice(0, 88)}`);
  errors.forEach((e) => console.log(`       ERROR: ${e.slice(0, 200)}`));

  // The rule this increment exists to enforce, checked on real output:
  // the title and the description must make the SAME freshness claim.
  // (Sensor venues render a different body, so the check is on the two
  // metadata strings, not on any markup that only one layout emits.)
  const titleToday = /Temperature Today/i.test(title);
  const descToday = /Today&#39;s|Today's/i.test(desc);
  if (titleToday !== descToday) {
    console.log('       FAIL: title and description disagree about freshness');
    failed++;
  }
}

if (failed) {
  console.error(`\n${failed} page(s) failed to render — do NOT deploy.`);
  process.exitCode = 1;
} else {
  console.log('\nAll pages rendered.');
}
