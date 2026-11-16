// GET   /api/partner-enquiries?partner=jaked            list + summary (JSON)
// GET   /api/partner-enquiries?partner=jaked&format=csv CSV export for coordinating orders with JAKED
// PATCH /api/partner-enquiries  { id, status?, internal_notes? }
// ADMIN ONLY: the caller sends their Supabase session token and must be profiles.is_admin (same check as
// /api/partner-stats). Used by /partner-enquiries. See api/_lib/partner-enquiries/core.js.
import { makeAdminHandler, supabaseStore, supabaseAdminAuth } from './_lib/partner-enquiries/core.js';

export default makeAdminHandler({ store: supabaseStore(), auth: supabaseAdminAuth() });
