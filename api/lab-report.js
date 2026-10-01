// POST /api/lab-report   (Aquasharks Lab SwimBETTER report workflow: admin actions)
//   parse | save | get | list | readiness | publish | unpublish
// Auth: Supabase bearer token of an Aquasharks club admin. Needs the 2026-10-01 swim-lab-assessments migration.
// Club: Aquasharks only. See api/_lib/lab-report/ for the workflow, store and handlers.
import { makeAdminHandler, supabaseAdminAuth } from './_lib/lab-report/handlers.js';
import { supabaseStore } from './_lib/lab-report/store.js';
import { claude } from './_lib/lab-report/service.js';

export const config = { maxDuration: 120 };
const origin = (req) => `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
export default makeAdminHandler({ store: supabaseStore(), auth: supabaseAdminAuth(), callModel: ({ system, tool, content }) => claude({ system, tool, content, maxTokens: 3000 }), publicBase: origin });
