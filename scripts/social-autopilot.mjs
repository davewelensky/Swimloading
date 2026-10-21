// Weekly autopilot for the Social Content Engine: builds the next 2 weeks of Tue/Thu/Sat posts from real data.
//
//   node scripts/social-autopilot.mjs --dry-run [--snapshot file.json]   print the plan, write NOTHING (default)
//   node scripts/social-autopilot.mjs --write                            render + upload + insert (needs SUPABASE_SERVICE_KEY, local Chrome)
//
// Never switches publishing on and never touches .env.local. Rules: api/_lib/social/autopilot.js, docs/social-engine/AUTOPILOT.md.
import { readFileSync } from 'node:fs';
import { runWeekly, formatPlan } from '../api/_lib/social/autopilot-run.js';
import { createStore } from '../api/_lib/social/store.js';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const write = flag('write') && !flag('dry-run');
const snapshot = val('snapshot') ? JSON.parse(readFileSync(val('snapshot'), 'utf8')) : null;
const now = val('now') ? new Date(val('now')) : new Date();
if (write) process.env.LAB_CHROME_PATH ||= '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let store = null;
if (process.env.SUPABASE_SERVICE_KEY) store = createStore();
else if (write) { console.error('--write needs SUPABASE_SERVICE_KEY in the environment.'); process.exit(1); }
else if (!snapshot) console.warn('No SUPABASE_SERVICE_KEY and no --snapshot: partner_pages and social_posts cannot be read, so the dry run will stop there.');

const r = await runWeekly({ store, snapshot, dry: !write, now, log: console.log });
console.log(formatPlan(r));
