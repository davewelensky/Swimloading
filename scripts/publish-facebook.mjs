// Facebook publishing CLI for the Social Content Engine. SAFE BY DEFAULT: every command is read-only or a dry run
// unless you pass --confirm AND SOCIAL_PUBLISH_ENABLED=true.
//
//   node scripts/publish-facebook.mjs verify                       checks the token and Page (read-only)
//   node scripts/publish-facebook.mjs post <post-id>               dry run: shows exactly what would be posted
//   SOCIAL_PUBLISH_ENABLED=true node scripts/publish-facebook.mjs post <post-id> --confirm [--approve-review]
//
// Credentials come from the environment or .env.local (gitignored): META_PAGE_ID, META_PAGE_TOKEN.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { publishToFacebook, verifyPage, publishingEnabled, PublishError } from '../api/_lib/social/facebook.js';

if (existsSync('.env.local')) for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const [cmd, id] = process.argv.slice(2);
const flag = (n) => process.argv.includes(`--${n}`);
const { META_PAGE_ID: pageId, META_PAGE_TOKEN: token } = process.env;
const LEDGER = 'social-poc/publish-ledger.json';
const store = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};
const ledger = { get: (k) => store[k], set: (k, v) => { store[k] = v; writeFileSync(LEDGER, JSON.stringify(store, null, 2)); } };

try {
  if (cmd === 'verify') {
    if (!pageId || !token) throw new PublishError('config', 'Set META_PAGE_ID and META_PAGE_TOKEN (see docs/social-engine/FACEBOOK_SETUP.md)');
    const v = await verifyPage({ pageId, token });
    console.log(v.ok ? `OK: token works for Page "${v.name}" (${v.id}).` : `MISMATCH: token belongs to ${v.name} (${v.id}), expected ${v.expected}.`);
    process.exit(v.ok ? 0 : 1);
  }
  if (cmd === 'post' && id) {
    const posts = JSON.parse(readFileSync('social-poc/posts.json', 'utf8')).posts;
    const p = posts.find((x) => x.id === id || x.id.startsWith(id));
    if (!p || p.status !== 'GENERATED') throw new PublishError('invalid', `No generated post matching "${id}". Ids: ${posts.map((x) => x.id).join(', ')}`);
    const risk = p.eligibility.risk;
    if (risk === 'BLOCKED') throw new PublishError('blocked', `Post is BLOCKED: ${p.eligibility.reasons.join('; ')}`);
    if (risk === 'REVIEW_REQUIRED' && !flag('approve-review')) throw new PublishError('review', `Post needs review: ${p.eligibility.reasons.join('; ')}. Re-run with --approve-review once you have approved it.`);
    const images = p.images.map((f) => ({ name: f.split('/').pop(), bytes: readFileSync(`social-poc/${f}`), mime: 'image/jpeg' }));
    const dryRun = !flag('confirm');
    const r = await publishToFacebook({ key: `fb:${p.id}`, caption: p.facebookCaption, images, pageId, token, ledger, dryRun });
    console.log(dryRun ? `DRY RUN (nothing sent). Would post ${images.length} image(s) to Page ${pageId || '(META_PAGE_ID unset)'}:\n\n${p.facebookCaption}\n\n${JSON.stringify(r.request)}\nPublishing enabled: ${publishingEnabled()}` : `${r.status}: ${r.facebookId}`);
    process.exit(0);
  }
  console.log('usage: publish-facebook.mjs verify | post <post-id> [--confirm] [--approve-review]');
  process.exit(1);
} catch (e) { console.error(`${e.kind || 'error'}: ${e.message}`); process.exit(2); }
