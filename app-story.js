// ============================================================
// STORY ENGINE V1 — client-side retry / retrieval / analytics layer
// (Phase 2.1). Feature-flagged: story_engine_v1 (Dave-only at launch).
// Depends on: app.js globals (supabaseClient, currentUser, analytics)
//
// NON-AUTHORITATIVE: story events are actually generated server-side by
// trg_zz_evaluate_swim_story_events_v1, an AFTER INSERT trigger on
// temp_logs that fires with or without this file running at all (a
// dropped connection, a JS error before this loads, a log inserted by
// some future non-browser path — none of them lose story events). This
// file's ONLY job is to call the public RPC afterwards — which shares the
// server trigger's own evaluator, so it is safe to call redundantly — so
// that: (a) any events the trigger somehow failed to create get a second
// (client-visible) attempt, and (b) the client can report what happened
// through analytics. In the normal case the trigger already created
// everything by the time this runs, so most calls here report their
// events back as `suppressed` (already existed) rather than `generated` —
// that is expected, not a bug.
//
// SCOPE (Phase 2.1 only): renders NOTHING — no timeline, no card changes,
// no new UI. Display of stored story events (Swim Card lead story,
// timeline, recaps, public profile) is explicitly deferred to a later
// phase per the Release 2 plan.
//
// SCHEMA DEPENDENCY: targets swimmer_story_events + evaluate_swim_story_
// events_v1(p_user_id, p_temp_log_id) from
// sql/2026-07-20_story-engine-v1.sql. That migration has NOT been applied
// yet — do not deploy this file until it has been, and until Dave has
// explicitly approved the deployment pairing.
//
// Contract:
// - Fire-and-forget from the post-log flow. Never blocks the save, never
//   blocks the identity Swim Card, never shown to the user in any form.
// - Flag OFF (default) → no-op, no RPC call, no analytics.
// - RPC failure of any kind → swallowed here; only 'story_event_
//   generation_failed' is tracked. The swim is already saved (and, for
//   story purposes, the server trigger already had its own independent
//   attempt) regardless of what happens in this file.
// ============================================================

let _storyFlagPromise = null;

async function storyEngineEnabled() {
    if (typeof currentUser === 'undefined' || !currentUser) return false;
    if (!_storyFlagPromise) {
        _storyFlagPromise = (async () => {
            try {
                const { data, error } = await supabaseClient
                    .from('feature_flags')
                    .select('enabled_global, allowed_user_ids')
                    .eq('key', 'story_engine_v1')
                    .maybeSingle();
                if (error || !data) return false;
                return !!data.enabled_global ||
                    (data.allowed_user_ids || []).includes(currentUser.id);
            } catch (e) {
                return false;
            }
        })();
    }
    return _storyFlagPromise;
}

// ctx: { logId, source: 'native'|'strava' }
// Call this AFTER the temp_logs insert has already succeeded — it never
// participates in whether the save itself succeeds or fails.
async function storyEnginePostLog(ctx) {
    if (!ctx || !ctx.logId) return;

    let enabled = false;
    try { enabled = await storyEngineEnabled(); } catch (e) { enabled = false; }
    if (!enabled) return;

    const startedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    try {
        const { data, error } = await supabaseClient.rpc('evaluate_swim_story_events_v1', {
            p_user_id: currentUser.id,
            p_temp_log_id: ctx.logId
        });

        const durationMs = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - startedAt);

        if (error || !data || data.error) {
            try {
                analytics.track('story_event_generation_failed', {
                    temp_log_id: ctx.logId,
                    source: ctx.source || null,
                    generation_duration_ms: durationMs
                });
            } catch (_) {}
            if (error) console.error('[story] evaluate_swim_story_events_v1 failed', error);
            return;
        }

        const events = Array.isArray(data.events) ? data.events : [];
        // Each suppressed entry is {story_type, dedupe_key} — a story_type
        // the server explicitly reports as already present under that
        // dedupe key. A routine swim with nothing eligible yields an empty
        // array here, not a suppression — never synthesize a suppressed
        // entry client-side for "nothing happened".
        const suppressed = Array.isArray(data.suppressed) ? data.suppressed : [];

        events.forEach(evt => {
            try {
                analytics.track('story_event_generated', {
                    story_type: evt.story_type,
                    temp_log_id: ctx.logId,
                    source: ctx.source || null,
                    generation_duration_ms: durationMs
                });
            } catch (_) {}
        });

        suppressed.forEach(s => {
            try {
                analytics.track('story_event_duplicate_suppressed', {
                    story_type: s && s.story_type,
                    temp_log_id: ctx.logId,
                    source: ctx.source || null,
                    generation_duration_ms: durationMs
                });
            } catch (_) {}
        });
    } catch (e) {
        console.error('[story] storyEnginePostLog failed', e);
        try {
            analytics.track('story_event_generation_failed', {
                temp_log_id: ctx.logId,
                source: ctx.source || null
            });
        } catch (_) {}
    }
}
