// POST /api/partner-enquiry
// "Register your interest" form on /partners/jaked. Validates, rate-limits (3 per email per day, 5 per IP per hour),
// stores the enquiry with the service key, emails Dave (reply-to the customer) and sends the customer a
// confirmation with their reference. Returns { ok, reference, emailed } and nothing about the customer.
//
// Not a shop: no price, stock, payment or shipping logic. See api/_lib/partner-enquiries/core.js.
// Needs the 2026-11-16 partner-enquiries migration.
//
// Environment (Vercel, Production):
//   SUPABASE_SERVICE_KEY        required
//   RESEND_API_KEY              required for both emails (shared with lab-enquiry and the welcome email)
//   PARTNER_ENQUIRY_NOTIFY_TO   optional, comma separated. Defaults to Dave alone.
import { makePublicHandler, supabaseStore, resendMailer, supabaseWhoIs } from './_lib/partner-enquiries/core.js';

export default makePublicHandler({ store: supabaseStore(), sendMail: resendMailer(), whoIs: supabaseWhoIs() });
