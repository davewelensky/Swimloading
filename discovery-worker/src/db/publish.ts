import type { SupabaseClient } from '@supabase/supabase-js';

export interface PublishedEvent {
  candidate_id: string;
  edition_id: string;
  event_name: string;
}

// Runs the database-side publish sweep. Eligibility lives in SQL, not
// here, on purpose: it is a safety policy, so it is enforced in one place
// that a worker bug cannot widen. The worker's only job is to invoke it
// with the service-role key — the function refuses any other caller, so a
// browser (even an admin's) can never trigger a bulk publish.
//
// Each publish still goes through approve_discovery_candidate, so it is
// atomic, provenance-linked, and appears in the review audit trail marked
// as automatic (decided_by NULL).
export async function publishEligibleCandidates(db: SupabaseClient, limit = 200): Promise<PublishedEvent[]> {
  const { data, error } = await db.rpc('auto_publish_eligible_candidates', { p_limit: limit });
  if (error) throw new Error(`auto_publish_eligible_candidates: ${error.message}`);
  return (data ?? []) as PublishedEvent[];
}
