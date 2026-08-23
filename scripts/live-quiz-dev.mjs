#!/usr/bin/env node
// Local harness for the CLDSA live quiz — the whole thing (player page,
// projector screen, admin page, API) against the in-memory store with fake
// users. Production Supabase is never contacted.
//
//   node scripts/live-quiz-dev.mjs            # http://localhost:3009
//   PORT=4000 node scripts/live-quiz-dev.mjs
//
// Pick a user per tab with ?as=alice|bob|carol|admin (sticks via cookie):
//   /live/cldsa2026?as=alice         player
//   /live/cldsa2026/screen           projector
//   /admin/live-quiz?as=admin        admin (activate → open → start → finish)
//
// Run the scripted acceptance walkthrough instead (no browser):
//   node scripts/live-quiz-dev.mjs --walkthrough
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { createService, MIDWAY_AFTER } from '../api/_lib/live-quiz/service.js';
import { createMemoryStore } from '../api/_lib/live-quiz/store-memory.js';
import { createHandler } from '../api/_lib/live-quiz/http.js';
import { FIXTURE_USERS } from '../api/_lib/live-quiz/fixture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3009;
const SLUG = 'cldsa2026';

const store = createMemoryStore();
const service = createService(store);
const qrSvg = (text) => QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#080f1a', light: '#ffffff' } });
// Fake auth: "Bearer dev:<name>" → fixture user id.
const resolveDev = (who) => FIXTURE_USERS[who]?.id || store.db.profiles.find((p) => p.email === who)?.id || null;
const getUserId = async (h) => { const m = /^Bearer dev:(.+)$/.exec(h || ''); return m ? resolveDev(m[1]) : null; };
const apiHandler = createHandler({ service, getUserId, qrSvg });

// ── scripted acceptance walkthrough ───────────────────────────────────
async function walkthrough() {
  const { admin, alice, bob } = FIXTURE_USERS;
  const log = (...a) => console.log(...a);
  log('1. Screen (lobby):', JSON.stringify((await service.getPublicState(SLUG)).event.status), '| QR URL: https://www.swimloading.com/live/' + SLUG);
  await service.adminSetActive(admin.id, SLUG, true);
  await service.adminSetStatus(admin.id, SLUG, 'open');
  log('2. QR svg bytes:', (await qrSvg('https://www.swimloading.com/live/' + SLUG)).length);
  await service.join(SLUG, alice.id); await service.join(SLUG, bob.id);
  const dup = await service.join(SLUG, alice.id);
  log('3. Two users joined; Alice re-join created=', dup.created, '| players =', (await service.getPublicState(SLUG)).player_count);
  await service.adminSetStatus(admin.id, SLUG, 'live');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function play(user, delayMs, wrongOn) {
    for (;;) {
      const nq = await service.nextQuestion(SLUG, user.id);
      if (nq.done) return;
      const key = (await service.adminGetEvent(admin.id, SLUG)).questions.find((q) => q.id === nq.question.id).correct_answer;
      await sleep(delayMs);
      const r = await service.answer(SLUG, user.id, nq.question.id, wrongOn.includes(nq.index) ? (key === 'A' ? 'B' : 'A') : key);
      // 9. refresh → duplicate answer rejected
      const again = await service.answer(SLUG, user.id, nq.question.id, key).catch((e) => e.code);
      log(`   ${r.is_correct ? 'ok ' : 'no '} ${user.full_name.split(' ')[0]} Q${nq.index} +${r.points} (${r.response_ms}ms)${r.rank ? ` → midway rank ${r.rank}/${r.player_count}` : ''} | resubmit: ${again}`);
      if (nq.index === MIDWAY_AFTER) log('6. Screen after Q3 shows board:', JSON.stringify((await service.getPublicState(SLUG)).leaderboard));
    }
  }
  log('4/5. Both answer all 6 (Alice fast, Bob slower + one wrong):');
  await play(alice, 300, []);
  await play(bob, 900, [5]);
  await service.adminSetStatus(admin.id, SLUG, 'finished');
  const s = await service.getPublicState(SLUG);
  log('7/8. Final leaderboard:'); s.leaderboard.forEach((r) => log(`   ${r.rank}. ${r.name} — ${r.score}${r.rank === 1 ? '   <-- WINNER' : ''}`));
  const json = JSON.stringify(s);
  log('10. Public payload contains email/user_id/correct_answer?', /@|user_id|correct_answer|0000-4000/.test(json));
  log('   analytics:', store.db.analytics.map((a) => `${a.event_name}${a.properties?.new_member != null ? ' (new_member=' + a.properties.new_member + ')' : ''}`).join(', '));
}

if (process.argv.includes('--walkthrough')) { await walkthrough(); process.exit(0); }

// ── dev server ──────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg' };
const devAuth = (who) => `<script>window.SL_LIVE_AUTH={token:async()=>${who ? `'dev:${who}'` : 'null'},signIn:async(e)=>{document.cookie='as='+encodeURIComponent(e)+';path=/';location.reload();return null}};</script>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let who = url.searchParams.get('as') || decodeURIComponent((/(?:^|; )as=([^;]+)/.exec(req.headers.cookie || '') || [])[1] || '');
  if (!resolveDev(who)) who = '';
  if (url.searchParams.get('as')) res.setHeader('Set-Cookie', `as=${who};path=/`);

  if (url.pathname.startsWith('/api/live-quiz')) {
    const action = url.pathname.split('/')[3];
    let body = ''; for await (const c of req) body += c;
    const fake = {
      method: req.method, url: `/api/live-quiz?action=${action}&${url.searchParams}`, headers: req.headers, body: body ? JSON.parse(body) : {},
    };
    const r = { status(c) { res.statusCode = c; return r; }, setHeader: (k, v) => res.setHeader(k, v),
      json(o) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); }, send(s) { res.end(s); } };
    return apiHandler(fake, r);
  }

  let file = null;
  if (/^\/live\/[a-z0-9-]+\/screen$/.test(url.pathname)) file = 'live-screen.html';
  else if (/^\/live\/[a-z0-9-]+$/.test(url.pathname)) file = 'live.html';
  else if (url.pathname === '/admin/live-quiz') file = 'live-quiz-admin.html';
  else if (url.pathname === '/app') { res.writeHead(302, { Location: `/live/${SLUG}?as=carol` }); return res.end(); } // stand-in for the real login → return hop
  else file = url.pathname.slice(1);
  try {
    const abs = path.join(ROOT, file);
    if (!abs.startsWith(ROOT)) throw new Error('nope');
    let data = await readFile(abs);
    res.setHeader('Content-Type', MIME[path.extname(abs)] || 'application/octet-stream');
    if (file.endsWith('.html') && file.startsWith('live')) data = data.toString().replace('<script>', devAuth(who) + '<script>');
    res.end(data);
  } catch { res.statusCode = 404; res.end('not found'); }
});

server.listen(PORT, () => {
  console.log(`live quiz dev harness → http://localhost:${PORT}/live/${SLUG}/screen`);
  console.log(`  admin:  http://localhost:${PORT}/admin/live-quiz?as=admin`);
  console.log(`  player: http://localhost:${PORT}/live/${SLUG}?as=alice   (bob, carol; omit ?as= for the logged-out view)`);
});
