// ============================================================
// STORY CARDS V1 — post-log lead-story surfacing (Phase 2.3)
// Feature-flagged: story_cards_v1 (Dave-only at launch). SEPARATE flag
// from story_engine_v1 / story_timeline_v1 / identity_layer_v1 — each is
// independently controllable.
//
// Depends on: app.js globals (supabaseClient, currentUser, analytics),
// and optionally app-story-timeline.js (showIdentityView, switchIdentityTab,
// storyTimelineEnabled) for the "View in Story" deep link — all reached
// through typeof guards, never a hard dependency.
//
// ARCHITECTURE DECISION (documented per the brief's requirement — see the
// Phase 2.3 review package for the full discovery/rationale): this module
// renders a SEPARATE, SEQUENTIAL card — Story Card first, then Continue
// hands off to the existing identity Swim Card — rather than merging into
// app-identity.js's card. Story data (swimmer_story_events, this file)
// and identity data (swimmer_achievements, app-identity.js) stay
// architecturally separate: two independently flagged, independently
// evolving systems, composed only at the two call sites in app.js /
// app-strava.js via a `continueFn` callback. This file never reaches into
// app-identity.js's internals beyond calling its public functions.
//
// WHY NOT evaluate_swim_story_events_v1: that function's `events` array
// only contains rows THAT SPECIFIC CALL inserted. Because the AFTER
// INSERT trigger already creates the real events synchronously inside
// the same transaction as the temp_logs insert — before this file's code
// ever runs — a naive call from here would almost always see them
// reported back as `suppressed`, not `events`, and never show a card for
// the swims that most deserve one. get_my_story_events_for_log_v1 (this
// file's data source) is a plain read scoped to (user, temp_log_id) that
// returns whatever is actually stored, regardless of which caller
// created it, pre-ordered by card-selection priority — so this file
// never recomputes milestone significance, it only picks events[0].
//
// SCOPE (Phase 2.3 only): one private, in-app, dismissible card per log.
// No public story cards, no social feed, no notifications, no sharing
// beyond what the existing Swim Card already does, no story editing or
// deletion, no backfill.
// ============================================================

const SC_CATEGORY_LABEL_BY_TYPE = {
    first_swim: 'Milestone',
    swim_count_milestone: 'Milestone',
    first_spot_visit: 'Exploration',
    spots_explored_milestone: 'Exploration',
    spot_visit_milestone: 'Exploration',
    new_coldest_swim: 'Temperature',
    new_warmest_swim: 'Temperature',
    first_sub_16: 'Temperature',
    first_sub_13: 'Temperature',
    first_sub_10: 'Temperature',
    first_sub_7: 'Temperature',
    first_sub_5: 'Temperature',
    first_pool_swim: 'Environment',
    first_open_water_swim: 'Environment',
    streak_milestone: 'Consistency'
};

let _scFlagPromise = null;

async function storyCardsEnabled() {
    if (typeof currentUser === 'undefined' || !currentUser) return false;
    if (!_scFlagPromise) {
        _scFlagPromise = (async () => {
            try {
                const { data, error } = await supabaseClient
                    .from('feature_flags')
                    .select('enabled_global, allowed_user_ids')
                    .eq('key', 'story_cards_v1')
                    .maybeSingle();
                if (error || !data) return false;
                return !!data.enabled_global ||
                    (data.allowed_user_ids || []).includes(currentUser.id);
            } catch (e) {
                return false;
            }
        })();
    }
    return _scFlagPromise;
}

// Deep-link hand-off to app-story-timeline.js — set right before opening
// the Story tab; that file clears it after attempting the highlight.
// Module-scoped (not window-scoped) but reachable by name since all app
// scripts share global scope, same convention as every other cross-file
// call in this codebase.
let _scPendingHighlightEventId = null;

// ── Public API ────────────────────────────────────────────────
// storyCardPostLog({ logId, source, continueFn })
// Returns a promise that resolves once the post-log flow has fully
// handed off — either because there was no story, the card failed, or
// the user clicked Continue. If the user instead clicks "View in Story",
// the promise resolves without ever calling continueFn (an alternate,
// terminal choice — see the interaction-model note in the review package).
async function storyCardPostLog({ logId, source, continueFn }) {
    let continued = false;
    const safeContinue = async () => {
        if (continued) return;
        continued = true;
        try {
            if (typeof continueFn === 'function') await continueFn();
        } catch (e) {
            console.error('[story-card] continueFn failed', e);
        }
    };

    if (!logId) {
        await safeContinue();
        return;
    }

    const startedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    let enabled = false;
    try { enabled = await storyCardsEnabled(); } catch (e) { enabled = false; }
    if (!enabled) {
        await safeContinue();
        return;
    }

    let events;
    try {
        const { data, error } = await supabaseClient.rpc('get_my_story_events_for_log_v1', {
            p_temp_log_id: logId
        });
        if (error) throw error;
        events = Array.isArray(data) ? data : [];
    } catch (e) {
        console.error('[story-card] retrieval failed', e);
        try {
            analytics.track('story_card_load_failed', { source: source || null, failure_stage: 'retrieval' });
        } catch (_) {}
        await safeContinue();
        return;
    }

    try {
        analytics.track('story_card_eligible', { source: source || null, event_count: events.length });
    } catch (_) {}

    if (events.length === 0) {
        // Normal swim, no story — retain the current post-save experience exactly.
        await safeContinue();
        return;
    }

    const leadEvent = events[0];
    const extraCount = events.length - 1;

    // Duplicate-display guard — order is retrieve -> select -> check guard
    // -> render -> set guard, NOT check -> set -> render. Setting the
    // final "shown" marker only AFTER a successful render means a render
    // failure never permanently suppresses a legitimate later attempt for
    // the same log+event. The narrow window between "check" and "render"
    // (both synchronous, no await between them) is closed by an interim
    // "opening" marker set immediately before the synchronous render call
    // — the only real concurrency risk is two overlapping
    // storyCardPostLog() calls for the same log racing past the RPC
    // await, and each independently reaching "check guard"; the "opening"
    // marker catches that case too, and is removed (not left stuck) if
    // rendering then fails.
    const guardKey = 'storyCardShown:' + logId + ':' + leadEvent.id;
    let guardState = null;
    try { guardState = sessionStorage.getItem(guardKey); } catch (e) { /* storage unavailable — fail open, show the card */ }
    if (guardState) {
        try {
            analytics.track('story_card_duplicate_display_suppressed', { source: source || null, story_type: leadEvent.story_type });
        } catch (_) {}
        await safeContinue();
        return;
    }

    let timelineEnabled = false;
    try { timelineEnabled = typeof storyTimelineEnabled === 'function' && await storyTimelineEnabled(); } catch (e) { timelineEnabled = false; }

    try { sessionStorage.setItem(guardKey, 'opening'); } catch (e) { /* best effort only */ }

    // Two separate concerns, two separate promises: whether the render
    // itself (a synchronous DOM operation) succeeded, and — independently
    // — when the user finishes interacting with an already-visible card.
    // Tracking "shown" and setting the final guard state must happen right
    // after the FIRST succeeds, not after the second — the card is
    // genuinely on screen the moment _scRenderCard returns; waiting for
    // Continue/View-in-Story before marking it "shown" would fire that
    // analytics event, and release the duplicate-display guard, only
    // after the user has already dismissed it.
    let interactionResolve, interactionReject;
    const interactionPromise = new Promise((res, rej) => { interactionResolve = res; interactionReject = rej; });
    const settle = (fn) => async () => {
        try { await fn(); interactionResolve(); }
        catch (err) { interactionReject(err); }
    };

    try {
        _scRenderCard({
            leadEvent, extraCount, logId, source, timelineEnabled,
            onContinue: settle(async () => { _scDismiss(); await safeContinue(); }),
            onViewStory: settle(async () => { _scDismiss(); _scOpenTimeline(leadEvent.id); })
        });
    } catch (e) {
        console.error('[story-card] render failed', e);
        try { sessionStorage.removeItem(guardKey); } catch (_) {} // never leave a failed render permanently suppressed
        try {
            analytics.track('story_card_load_failed', { source: source || null, failure_stage: 'render' });
        } catch (_) {}
        _scDismiss();
        await safeContinue();
        return;
    }

    // Render succeeded — the card is genuinely visible now.
    try { sessionStorage.setItem(guardKey, 'shown'); } catch (e) { /* best effort only */ }
    const durationMs = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - startedAt);
    try {
        analytics.track('story_card_shown', {
            source: source || null,
            story_type: leadEvent.story_type,
            event_count: events.length,
            has_spot: !!leadEvent.spot_name,
            has_primary_value: leadEvent.primary_value !== null && leadEvent.primary_value !== undefined,
            timeline_enabled: timelineEnabled,
            load_duration_ms: durationMs
        });
    } catch (_) {}

    try {
        await interactionPromise;
    } catch (e) {
        // An onContinue/onViewStory handler itself threw unexpectedly
        // after the card was already shown — the guard stays "shown"
        // (the card genuinely was displayed; this isn't a render failure
        // to retry), but the post-save flow must still be allowed through.
        console.error('[story-card] interaction handling failed', e);
        try {
            analytics.track('story_card_load_failed', { source: source || null, failure_stage: 'render' });
        } catch (_) {}
        _scDismiss();
        await safeContinue();
    }
}

// ── Rendering ────────────────────────────────────────────────
let _scPreviouslyFocused = null;
let _scKeydownHandler = null;

function _scDismiss() {
    const el = document.getElementById('storyCardModal');
    if (el) el.remove();
    if (_scKeydownHandler) {
        document.removeEventListener('keydown', _scKeydownHandler);
        _scKeydownHandler = null;
    }
    if (_scPreviouslyFocused && typeof _scPreviouslyFocused.focus === 'function') {
        try { _scPreviouslyFocused.focus(); } catch (e) { /* element may be gone */ }
    }
    _scPreviouslyFocused = null;
}

function _scFormatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function _scEscape(s) {
    if (s === null || s === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
}

function _scRenderCard({ leadEvent, extraCount, timelineEnabled, onContinue, onViewStory }) {
    _scPreviouslyFocused = document.activeElement;

    const category = SC_CATEGORY_LABEL_BY_TYPE[leadEvent.story_type] || 'Story moment';
    const dateStr = _scFormatDate(leadEvent.story_date);
    const hasValue = leadEvent.primary_value !== null && leadEvent.primary_value !== undefined && leadEvent.unit;

    const div = document.createElement('div');
    div.id = 'storyCardModal';
    div.setAttribute('role', 'dialog');
    div.setAttribute('aria-modal', 'true');
    div.setAttribute('aria-labelledby', 'storyCardTitle');
    div.style.cssText = 'position:fixed; inset:0; z-index:10007; background:rgba(0,0,0,0.85); display:flex; align-items:flex-end; justify-content:center; padding:0;';

    div.innerHTML = `
      <div style="background:#0d1728; border-top:1px solid rgba(56,189,248,0.25); border-radius:20px 20px 0 0; padding:28px 22px calc(24px + env(safe-area-inset-bottom, 0px)); width:100%; max-width:480px; max-height:88vh; overflow-y:auto;">
        <div style="font-size:11px; font-weight:700; color:#38bdf8; text-transform:uppercase; letter-spacing:0.12em; margin-bottom:6px;">Story moment · ${_scEscape(category)}</div>
        <div id="storyCardTitle" style="font-size:22px; font-weight:800; color:#f1f5f9; line-height:1.25; margin-bottom:${leadEvent.summary ? '8px' : '18px'};">${_scEscape(leadEvent.title)}</div>
        ${leadEvent.summary ? `<div style="font-size:14px; color:var(--text-secondary); line-height:1.5; margin-bottom:18px;">${_scEscape(leadEvent.summary)}</div>` : ''}
        ${hasValue ? `<div style="font-size:34px; font-weight:800; color:#38bdf8; margin-bottom:6px;">${leadEvent.primary_value}${leadEvent.unit}</div>` : ''}
        <div style="font-size:13px; color:var(--text-secondary); margin-bottom:${extraCount > 0 ? '10px' : '20px'};">
          ${leadEvent.spot_name ? _scEscape(leadEvent.spot_name) + (dateStr ? ' · ' : '') : ''}${dateStr}
        </div>
        ${extraCount > 0 ? `<div style="font-size:12px; color:var(--text-secondary); margin-bottom:20px;">${extraCount} more story ${extraCount === 1 ? 'moment was' : 'moments were'} added to your timeline.</div>` : ''}
        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:20px;">This moment has been added to your swimming story.</div>
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${timelineEnabled ? `<button type="button" id="storyCardViewStoryBtn" style="padding:14px; background:linear-gradient(135deg,#0284c7,#0ea5e9); border:none; border-radius:50px; color:white; font-size:14px; font-weight:700; cursor:pointer;">View in Story</button>` : ''}
          <button type="button" id="storyCardContinueBtn" style="padding:14px; background:${timelineEnabled ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg,#0284c7,#0ea5e9)'}; border:${timelineEnabled ? '1px solid var(--border)' : 'none'}; border-radius:50px; color:${timelineEnabled ? 'var(--text-primary)' : 'white'}; font-size:14px; font-weight:700; cursor:pointer;">Continue</button>
        </div>
      </div>`;

    document.body.appendChild(div);

    const continueBtn = document.getElementById('storyCardContinueBtn');
    const viewStoryBtn = document.getElementById('storyCardViewStoryBtn');
    continueBtn.addEventListener('click', onContinue);
    if (viewStoryBtn) viewStoryBtn.addEventListener('click', onViewStory);

    // Focus management: move focus into the dialog (the primary action if
    // present, else Continue), trap Tab between the two buttons, Escape
    // activates Continue rather than abandoning the flow silently.
    const focusables = [viewStoryBtn, continueBtn].filter(Boolean);
    focusables[0].focus();

    _scKeydownHandler = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onContinue();
            return;
        }
        if (e.key === 'Tab' && focusables.length > 1) {
            const first = focusables[0], last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault(); first.focus();
            }
        }
    };
    document.addEventListener('keydown', _scKeydownHandler);
}

// ── Timeline deep link ──────────────────────────────────────────
function _scOpenTimeline(leadEventId) {
    try {
        analytics.track('story_card_view_story', { story_type: null });
    } catch (_) {}

    if (typeof showIdentityView !== 'function' || typeof switchIdentityTab !== 'function') return;

    _scPendingHighlightEventId = leadEventId;
    showIdentityView().then(() => {
        switchIdentityTab('story');
    });
}

// Clears pending deep-link highlight state without attempting to apply
// it. Called from app-story-timeline.js on a timeline load failure, and
// from app-identity.js's dismissIdentityView() on modal close — both
// paths where a stale pending id must not carry over into some later,
// unrelated Story tab visit.
function _scClearPendingHighlight() {
    _scPendingHighlightEventId = null;
}

// Called by app-story-timeline.js after rendering a page of events —
// attempts to scroll to + briefly highlight the lead event if it's on
// the loaded page (preferred). Clears the pending id unconditionally
// before attempting the lookup, so both a successful highlight and a
// loaded-but-not-found result leave no stale state behind.
function _scTryHighlightPendingEvent() {
    if (!_scPendingHighlightEventId) return;
    const id = _scPendingHighlightEventId;
    _scClearPendingHighlight();

    const el = document.querySelector('[data-story-event-id="' + id + '"]');
    if (!el) return; // minimum acceptable behaviour: Story tab is already open with latest events visible

    try {
        const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center' });
        el.style.transition = prefersReducedMotion ? '' : 'background-color 0.3s ease';
        el.style.backgroundColor = 'rgba(56,189,248,0.14)';
        el.style.borderColor = 'rgba(56,189,248,0.6)';
        setTimeout(() => {
            el.style.backgroundColor = '';
            el.style.borderColor = '';
        }, 2600);
    } catch (e) { /* highlight is a nice-to-have, never fatal */ }
}
