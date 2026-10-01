// GET /aquasharks-lab/report/:token  ->  /api/lab-report-public?t=:token   (public, token is the credential)
import { makePublicHandler } from './_lib/lab-report/handlers.js';
import { supabaseStore } from './_lib/lab-report/store.js';
export default makePublicHandler({ store: supabaseStore() });
