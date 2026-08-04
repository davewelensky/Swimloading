import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service-role Supabase client. This key bypasses RLS entirely, which is
// exactly why the worker is a server-side Railway process and never
// browser code. It must never be logged, echoed, or written to out/.
//
// Fails closed: if either variable is missing the process gets an error,
// never a half-configured client that silently writes nowhere.
export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_KEY?.trim();

  const missing: string[] = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!serviceKey) missing.push('SUPABASE_SERVICE_KEY');
  if (missing.length > 0) {
    throw new Error(
      `Cannot create the Supabase client: ${missing.join(' and ')} not set. ` +
        'Set them in discovery-worker/.env locally, or the service environment on Railway.'
    );
  }

  // Validated here rather than left to supabase-js, whose "Invalid
  // supabaseUrl" says nothing about WHICH variable or what it actually
  // received. A set-but-wrong value is the common deployment failure —
  // typically an unresolved platform variable reference (`${{...}}`),
  // surrounding quotes, or a bare host with no scheme. The URL is public
  // (it ships in the browser app), so echoing it is safe; the service key
  // is NEVER echoed, only shape-checked.
  let parsed: URL;
  try {
    parsed = new URL(url as string);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('bad protocol');
  } catch {
    throw new Error(
      `SUPABASE_URL is set but is not a valid http(s) URL — received: ${JSON.stringify(url)}\n` +
        '  Expected something like https://<project-ref>.supabase.co\n' +
        '  If that value looks like ${{...}}, a platform variable reference did not resolve —\n' +
        '  set the variable directly on the service rather than as a shared/linked variable.'
    );
  }
  // A JWT service key has three dot-separated parts; anything else is a
  // paste error worth catching before it becomes a confusing 401.
  if ((serviceKey as string).split('.').length !== 3) {
    throw new Error(
      'SUPABASE_SERVICE_KEY does not look like a JWT (expected three dot-separated parts). ' +
        'Its value is not echoed here. Re-copy it from the Supabase dashboard (Settings → API → service_role).'
    );
  }

  return createClient(url as string, serviceKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
