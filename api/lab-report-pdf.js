// GET /api/lab-report-pdf?t=:token   PDF download of a published report (rendered by headless Chromium from its public page)
import { makePdfHandler } from './_lib/lab-report/handlers.js';
import { supabaseStore } from './_lib/lab-report/store.js';
export const config = { maxDuration: 60 };
export default makePdfHandler({ store: supabaseStore(), baseUrl: (req) => `https://${req.headers['x-forwarded-host'] || req.headers.host}` });
