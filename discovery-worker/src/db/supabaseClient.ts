import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service-role Supabase client. This key bypasses RLS entirely, which is
// exactly why the worker is a server-side Railway process and never
// browser code. It must never be logged, echoed, or written to out/.
//
// Fails closed: if either variable is missing the process gets an error,
// never a half-configured client that silently writes nowhere.
export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  const missing: string[] = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!serviceKey) missing.push('SUPABASE_SERVICE_KEY');
  if (missing.length > 0) {
    throw new Error(
      `Cannot create the Supabase client: ${missing.join(' and ')} not set. ` +
        'Write mode requires both. Set them in discovery-worker/.env (never commit it).'
    );
  }

  return createClient(url as string, serviceKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
