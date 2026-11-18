// GET   /api/partner-enquiries?partner=jaked            list + summary (JSON)
// GET   /api/partner-enquiries?partner=jaked&format=csv CSV export for coordinating orders with JAKED
// PATCH /api/partner-enquiries  { id, status?, internal_notes? }
// JAKED TEAM ONLY: the caller sends their Supabase session token and must be profiles.is_admin, or hold the
// JAKED team role in user_roles (platform_admin, or partner_manager on JAKED). Was admin-only (same check as
// /api/partner-stats). Used by /partner-enquiries. See api/_lib/partner-enquiries/core.js.
import { makeAdminHandler, supabaseStore, supabaseAdminAuth } from './_lib/partner-enquiries/core.js';

export default makeAdminHandler({ store: supabaseStore(), auth: supabaseAdminAuth() });
