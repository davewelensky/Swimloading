// ============================================================
// STORY TIMELINE V1 — private, authenticated-only timeline UI (Phase 2.2)
// Feature-flagged: story_timeline_v1 (Dave-only at launch). SEPARATE flag
// from story_engine_v1 — the engine keeps generating events regardless of
// whether this UI is visible to any given user.
//
// Depends on: app.js globals (supabaseClient, currentUser, analytics),
// and is wired into the tab bar app-identity.js renders inside
// #identityViewModal (see app-identity.js's _icEnsureIdentityView /
// showIdentityView — those files call switchIdentityTab() and
// storyTimelineEnabled() from here; this file never reaches into
// app-identity.js's internals beyond that contract).
//
// SCOPE (Phase 2.2 only): read-only display of swimmer_story_events via
// get_my_story_timeline_v1. Never computes a milestone client-side, never
// writes to swimmer_story_events, never touches story-generation logic
// (app-story.js, evaluate_swim_story_events_v1). No Personal Records,
// Monthly Recap, Explorer, Passport, Memories, public story profile, AI
// insights, notifications, or backfill — all deferred to later phases.
//
// PRIVACY: this file is loaded only by index.html (the authenticated PWA
// shell). The public profile page (/swimmer/:id) is rendered server-side
// by api/swimmer.js, a completely separate code path that does not load
// this file or any other PWA script — so there is no route through which
// a public profile view could ever reach this timeline, independent of
// the flag.
//
// SCHEMA DEPENDENCY: targets get_my_story_timeline_v1(p_limit, p_cursor,
// p_story_types) from sql/2026-07-20_story-timeline-v1.sql. That
// migration has NOT been applied yet — do not deploy this file until it
// has been, and until Dave has explicitly approved the pairing.
// ============================================================

const ST_CATEGORY_FILTERS = [
    { key: 'all', label: 'All', types: null },
    { key: 'milestones', label: 'Milestones', types: ['first_swim', 'swim_count_milestone'] },
    { key: 'exploration', label: 'Exploration', types: ['first_spot_visit', 'spots_explored_milestone', 'spot_visit_milestone'] },
    { key: 'temperature', label: 'Temperature', types: ['new_coldest_swim', 'new_warmest_swim', 'first_sub_16', 'first_sub_13', 'first_sub_10', 'first_sub_7', 'first_sub_5'] },
    { key: 'environment', label: 'Environment', types: ['first_pool_swim', 'first_open_water_swim'] },
    { key: 'consistency', label: 'Consistency', types: ['streak_milestone'] }
];

// story_type -> restrained category label shown on each card (not the
// filter's own label object, so a card never needs to re-derive which
// filter bucket it belongs to).
const ST_CATEGORY_LABEL_BY_TYPE = {};
ST_CATEGORY_FILTERS.forEach(f => {
    if (!f.types) return;
    f.types.forEach(t => { ST_CATEGORY_LABEL_BY_TYPE[t] = f.label; });
});

const ST_PAGE_SIZE = 20;

let _stFlagPromise = null;
let _st = null; // lazily initialised per modal-open session, see _stResetState()

function _stResetState() {
    _st = {
        filter: 'all',
        cursor: null,
        hasMore: false,
        loading: false,
        pageNumber: 0,
        eventCountLoaded: 0,
        requestToken: 0,
        firstLoadTracked: false
    };
}

async function storyTimelineEnabled() {
    if (typeof currentUser === 'undefined' || !currentUser) return false;
    if (!_stFlagPromise) {
        _stFlagPromise = (async () => {
            try {
                const { data, error } = await supabaseClient
                    .from('feature_flags')
                    .select('enabled_global, allowed_user_ids')
                    .eq('key', 'story_timeline_v1')
                    .maybeSingle();
                if (error || !data) return false;
                return !!data.enabled_global ||
                    (data.allowed_user_ids || []).includes(currentUser.id);
            } catch (e) {
                return false;
            }
        })();
    }
    return _stFlagPromise;
}

// ── Tab switching (called from the tab bar app-identity.js renders) ──
function switchIdentityTab(tab) {
    const tabOverviewBtn = document.getElementById('identityTabOverview');
    const tabStoryBtn = document.getElementById('identityTabStory');
    const panelOverview = document.getElementById('identityPanelOverview');
    const panelStory = document.getElementById('identityPanelStory');
    if (!tabOverviewBtn || !tabStoryBtn || !panelOverview || !panelStory) return;

    const showStory = tab === 'story';
    tabOverviewBtn.setAttribute('aria-selected', showStory ? 'false' : 'true');
    tabStoryBtn.setAttribute('aria-selected', showStory ? 'true' : 'false');
    tabOverviewBtn.style.borderBottomColor = showStory ? 'transparent' : '#38bdf8';
    tabOverviewBtn.style.color = showStory ? 'var(--text-secondary)' : '#38bdf8';
    tabStoryBtn.style.borderBottomColor = showStory ? '#38bdf8' : 'transparent';
    tabStoryBtn.style.color = showStory ? '#38bdf8' : 'var(--text-secondary)';
    panelOverview.hidden = showStory;
    panelStory.hidden = !showStory;

    if (showStory && !(_st && _st.firstLoadTracked)) {
        initStoryTimeline();
    }
}

// ── Entry point — called once per modal-open when the Story tab is first
//    activated. Renders the filter bar + list container, then loads page 1.
function initStoryTimeline() {
    _stResetState();
    const panel = document.getElementById('identityPanelStory');
    if (!panel) return;

    panel.innerHTML = `
      <div style="margin-bottom:14px;">
        <div style="font-size:16px; font-weight:800; color:#f1f5f9; margin-bottom:4px;">Your swimming story</div>
        <div style="font-size:12px; color:var(--text-secondary); line-height:1.5;">
          A private, chronological record of meaningful moments from your logged swims — visible only to you.
        </div>
      </div>
      <div id="stFilterBar" role="group" aria-label="Filter story events" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px;"></div>
      <div id="stListContainer" aria-live="polite"></div>
      <div id="stLoadMoreWrap" style="margin-top:14px; text-align:center;"></div>
    `;

    const filterBar = document.getElementById('stFilterBar');
    filterBar.innerHTML = ST_CATEGORY_FILTERS.map(f => `
      <button type="button"
        id="stFilter_${f.key}"
        aria-pressed="${f.key === 'all' ? 'true' : 'false'}"
        onclick="switchStoryFilter('${f.key}')"
        style="padding:7px 13px; border-radius:50px; border:1px solid ${f.key === 'all' ? 'rgba(56,189,248,0.5)' : 'var(--border)'}; background:${f.key === 'all' ? 'rgba(56,189,248,0.12)' : 'transparent'}; color:${f.key === 'all' ? '#38bdf8' : 'var(--text-secondary)'}; font-size:12px; font-weight:600; cursor:pointer;">
        ${f.label}
      </button>
    `).join('');

    _stLoadPage({ isLoadMore: false, source: 'initial' });
}

function switchStoryFilter(filterKey) {
    if (!_st || _st.filter === filterKey) return;
    _st.filter = filterKey;

    ST_CATEGORY_FILTERS.forEach(f => {
        const btn = document.getElementById('stFilter_' + f.key);
        if (!btn) return;
        const active = f.key === filterKey;
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.style.borderColor = active ? 'rgba(56,189,248,0.5)' : 'var(--border)';
        btn.style.background = active ? 'rgba(56,189,248,0.12)' : 'transparent';
        btn.style.color = active ? '#38bdf8' : 'var(--text-secondary)';
    });

    try {
        analytics.track('story_timeline_filter_changed', { filter_category: filterKey });
    } catch (_) {}

    // Filter change clears prior results and reloads from page 1 — never
    // appends onto a now-inconsistent filtered set.
    _st.cursor = null;
    _st.hasMore = false;
    _st.pageNumber = 0;
    _stLoadPage({ isLoadMore: false, source: 'filter_change' });
}

function _stCurrentFilterTypes() {
    const f = ST_CATEGORY_FILTERS.find(f => f.key === _st.filter);
    return f ? f.types : null;
}

function loadMoreStoryEvents() {
    if (!_st || _st.loading || !_st.hasMore) return;
    _stLoadPage({ isLoadMore: true, source: 'load_more' });
}

function retryStoryTimeline() {
    if (!_st) return;
    _stLoadPage({ isLoadMore: false, source: 'retry', preserveEvents: _st.pageNumber > 0 });
}

async function _stLoadPage({ isLoadMore, source, preserveEvents }) {
    if (!_st || _st.loading) return; // guards duplicate rapid Load More clicks
    _st.loading = true;

    const listEl = document.getElementById('stListContainer');
    const loadMoreWrap = document.getElementById('stLoadMoreWrap');
    const token = ++_st.requestToken;
    const startedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    if (!isLoadMore && !preserveEvents) {
        listEl.innerHTML = '<div role="status" style="padding:32px 16px; text-align:center; color:var(--text-secondary); font-size:13px;">Loading your story…</div>';
        loadMoreWrap.innerHTML = '';
    } else if (isLoadMore) {
        const btn = document.getElementById('stLoadMoreBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    }

    try {
        const { data, error } = await supabaseClient.rpc('get_my_story_timeline_v1', {
            p_limit: ST_PAGE_SIZE,
            p_cursor: isLoadMore ? _st.cursor : null,
            p_story_types: _stCurrentFilterTypes()
        });

        if (token !== _st.requestToken) return; // superseded by a newer filter/reload call

        if (error) throw error;

        const events = (data && data.events) || [];
        _st.cursor = (data && data.next_cursor) || null;
        _st.hasMore = !!(data && data.has_more);
        _st.pageNumber += 1;

        if (isLoadMore) {
            _stAppendEvents(events);
            try {
                analytics.track('story_timeline_load_more', {
                    filter_category: _st.filter,
                    page_number: _st.pageNumber,
                    has_more: _st.hasMore
                });
            } catch (_) {}
        } else if (events.length === 0) {
            listEl.innerHTML = `
              <div style="text-align:center; padding:40px 20px;">
                <div style="font-size:15px; font-weight:700; color:#f1f5f9; margin-bottom:8px;">Your swimming story starts here</div>
                <div style="font-size:13px; color:var(--text-secondary); line-height:1.6;">
                  New milestones and records will appear as you log future swims. Your previous swims remain part of your statistics, but historical story events have not been reconstructed.
                </div>
              </div>`;
            try {
                analytics.track('story_timeline_empty_state_viewed', { filter_category: _st.filter });
            } catch (_) {}
        } else {
            listEl.innerHTML = '';
            _stAppendEvents(events);
        }

        _stRenderLoadMore();

        // Story Card deep link (Phase 2.3, app-story-card.js) — attempts a
        // scroll+highlight if the requested event is on this loaded page.
        // No-op if app-story-card.js isn't loaded or nothing is pending.
        if (typeof _scTryHighlightPendingEvent === 'function') _scTryHighlightPendingEvent();

        if (!_st.firstLoadTracked) {
            _st.firstLoadTracked = true;
            const durationMs = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - startedAt);
            try {
                analytics.track('story_timeline_viewed', {
                    event_count: events.length,
                    has_more: _st.hasMore,
                    source: 'identity_modal',
                    load_duration_ms: durationMs
                });
            } catch (_) {}
        }
    } catch (e) {
        if (token !== _st.requestToken) return;
        console.error('[story-timeline] load failed', e);
        // A Story Card deep link (Phase 2.3) may have set a pending
        // highlight before this load started — a failed load must not
        // leave it pending for some later, unrelated Story tab visit.
        if (typeof _scClearPendingHighlight === 'function') _scClearPendingHighlight();
        try {
            analytics.track('story_timeline_load_failed', { filter_category: _st ? _st.filter : null, source: source || null });
        } catch (_) {}
        if (!isLoadMore) {
            listEl.innerHTML = `
              <div role="alert" style="text-align:center; padding:32px 16px;">
                <div style="font-size:13px; color:var(--danger); margin-bottom:14px;">Could not load your story right now.</div>
                <button type="button" onclick="retryStoryTimeline()" style="padding:10px 22px; border-radius:50px; border:1px solid rgba(56,189,248,0.4); background:transparent; color:#38bdf8; font-size:13px; font-weight:700; cursor:pointer;">Retry</button>
              </div>`;
            loadMoreWrap.innerHTML = '';
        } else {
            const btn = document.getElementById('stLoadMoreBtn');
            if (btn) { btn.disabled = false; btn.textContent = 'Load more'; }
        }
    } finally {
        _st.loading = false;
    }
}

function _stRenderLoadMore() {
    const wrap = document.getElementById('stLoadMoreWrap');
    if (!wrap) return;
    if (!_st.hasMore) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = `
      <button type="button" id="stLoadMoreBtn" onclick="loadMoreStoryEvents()"
        style="padding:11px 26px; border-radius:50px; border:1px solid var(--border); background:rgba(255,255,255,0.04); color:var(--text-primary); font-size:13px; font-weight:700; cursor:pointer;">
        Load more
      </button>`;
}

function _stAppendEvents(events) {
    const listEl = document.getElementById('stListContainer');
    const html = events.map(_stRenderCard).join('');
    listEl.insertAdjacentHTML('beforeend', html);
}

function _stFormatDate(dateStr) {
    if (!dateStr) return '';
    // story_date is a plain date (no time) — parse as local to avoid a
    // timezone-driven off-by-one day, consistent with this project's
    // date-handling convention (never toISOString() for a bare date).
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function _stRenderCard(evt) {
    const category = ST_CATEGORY_LABEL_BY_TYPE[evt.story_type] || '';
    const dateStr = _stFormatDate(evt.story_date);
    const hasValue = evt.primary_value !== null && evt.primary_value !== undefined && evt.unit;
    const showVerification = evt.verification_status && evt.verification_status !== 'corroborated';

    return `
      <article data-story-event-id="${evt.id}" style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:16px; margin-bottom:10px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
          <span style="font-size:11px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.06em;">${category}</span>
          <span style="font-size:11px; color:var(--text-secondary);">${dateStr}</span>
        </div>
        <div style="font-size:15px; font-weight:700; color:#f1f5f9; margin-bottom:${evt.summary ? '4px' : '0'};">${_stEscape(evt.title)}</div>
        ${evt.summary ? `<div style="font-size:13px; color:var(--text-secondary); line-height:1.5;">${_stEscape(evt.summary)}</div>` : ''}
        ${(hasValue || evt.spot_name || showVerification) ? `
        <div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:10px; font-size:12px; color:var(--text-secondary);">
          ${hasValue ? `<span>${evt.primary_value}${evt.unit}</span>` : ''}
          ${evt.spot_name ? `<span>${_stEscape(evt.spot_name)}</span>` : ''}
          ${showVerification ? `<span style="color:#f59e0b;">${evt.verification_status === 'pending_verification' ? 'Pending verification' : ''}</span>` : ''}
        </div>` : ''}
      </article>`;
}

function _stEscape(s) {
    if (s === null || s === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
}
