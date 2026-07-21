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

// story_type -> category KEY (as opposed to the label above) — used only
// to decide a card's colour treatment below.
const ST_CATEGORY_KEY_BY_TYPE = {};
ST_CATEGORY_FILTERS.forEach(f => {
    if (!f.types) return;
    f.types.forEach(t => { ST_CATEGORY_KEY_BY_TYPE[t] = f.key; });
});

// Local copy of the Passport's temperature colour scale (app-passport.js's
// _ppTempColour). Duplicated rather than depended on: this file loads
// before app-passport.js in index.html, and per this project's own
// convention (see _PP_ICON_COMPASS in app-passport.js) a module shouldn't
// rely on another optional module's constant existing. Keep the bands in
// sync if the Passport's scale ever changes.
const _ST_TEMP_BANDS = [
    { below: 8,        colour: '#7c3aed' },
    { below: 12,       colour: '#2563eb' },
    { below: 16,       colour: '#0891b2' },
    { below: 20,       colour: '#0d9488' },
    { below: 24,       colour: '#16a34a' },
    { below: Infinity, colour: '#f59e0b' }
];
function _stTempColour(t) {
    if (t === null || t === undefined || isNaN(t)) return '#38bdf8';
    for (let i = 0; i < _ST_TEMP_BANDS.length; i++) {
        if (t < _ST_TEMP_BANDS[i].below) return _ST_TEMP_BANDS[i].colour;
    }
    return '#f59e0b';
}
const _ST_TEMP_TEXT = { '#7c3aed':'#c4b5fd','#2563eb':'#93c5fd','#0891b2':'#67e8f9','#0d9488':'#5eead4','#16a34a':'#86efac','#f59e0b':'#fcd34d','#38bdf8':'#7dd3fc' };
function _stTempTextColour(t) { return _ST_TEMP_TEXT[_stTempColour(t)] || '#7dd3fc'; }

// Non-temperature category accents. 'temperature' is deliberately absent —
// those events colour by their own recorded value via _stTempColour
// instead, so a sub-7C badge reads the same violet-cold as a Passport
// stamp rather than a generic category colour.
const ST_CATEGORY_ACCENT = {
    milestones:  '#38bdf8',
    exploration: '#10b981',
    environment: '#f59e0b',
    consistency: '#a78bfa'
};

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
// Generalised to N tabs in Phase 2.5 (Overview / Story / Passport).
// Overview is the one always-present anchor; Story and Passport are each
// gated on their own feature flag and may be absent, so both are handled
// defensively — a missing button or panel is skipped, and lazy init is
// typeof-guarded in case the owning script is not loaded.
const IC_TABS = ['overview', 'story', 'passport'];

function switchIdentityTab(tab) {
    const btns = {
        overview: document.getElementById('identityTabOverview'),
        story:    document.getElementById('identityTabStory'),
        passport: document.getElementById('identityTabPassport')
    };
    const panels = {
        overview: document.getElementById('identityPanelOverview'),
        story:    document.getElementById('identityPanelStory'),
        passport: document.getElementById('identityPanelPassport')
    };
    if (!btns.overview || !panels.overview) return;

    IC_TABS.forEach(t => {
        const active = t === tab;
        if (btns[t]) {
            btns[t].setAttribute('aria-selected', active ? 'true' : 'false');
            // Roving tabindex: only the selected tab sits in the Tab
            // order, per the ARIA tabs pattern — arrows move between tabs.
            btns[t].setAttribute('tabindex', active ? '0' : '-1');
            btns[t].style.borderBottomColor = active ? '#38bdf8' : 'transparent';
            btns[t].style.color = active ? '#38bdf8' : 'var(--text-secondary)';
        }
        if (panels[t]) panels[t].hidden = !active;
    });

    if (tab === 'story' && !(_st && _st.firstLoadTracked) && typeof initStoryTimeline === 'function') {
        initStoryTimeline();
    }
    if (tab === 'passport' && typeof initPassportTab === 'function') {
        initPassportTab();
    }
}

// Arrow-key navigation across the tab bar. The buttons were reachable by
// Tab before but not navigable with Left/Right, which the ARIA tabs
// pattern expects; with the roving tabindex above, the bar is now a
// single Tab stop and arrows move between tabs. Home/End jump to the
// ends. Only VISIBLE tabs participate — a swimmer without the Passport
// flag must not be able to arrow onto a hidden tab.
function _icTabBarKeydown(e) {
    if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].indexOf(e.key) === -1) return;
    const bar = document.getElementById('identityTabBar');
    if (!bar || bar.style.display === 'none') return;

    const visible = IC_TABS
        .map(t => ({ t: t, el: document.getElementById('identityTab' + t.charAt(0).toUpperCase() + t.slice(1)) }))
        .filter(x => x.el && x.el.style.display !== 'none');
    if (visible.length < 2) return;

    const current = visible.findIndex(x => x.el.getAttribute('aria-selected') === 'true');
    if (current === -1) return;

    let next;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = visible.length - 1;
    else next = (current + (e.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length;

    e.preventDefault();
    switchIdentityTab(visible[next].t);
    visible[next].el.focus();
}

document.addEventListener('keydown', function (e) {
    const bar = document.getElementById('identityTabBar');
    if (bar && e.target && bar.contains(e.target)) _icTabBarKeydown(e);
});

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
    const categoryKey = ST_CATEGORY_KEY_BY_TYPE[evt.story_type];
    const dateStr = _stFormatDate(evt.story_date);
    const hasValue = evt.primary_value !== null && evt.primary_value !== undefined && evt.unit;
    const showVerification = evt.verification_status && evt.verification_status !== 'corroborated';

    // Temperature-category events colour by their OWN recorded value
    // (same scale as the Passport); every other category gets a fixed
    // accent. Falls back to muted grey for anything unmapped rather than
    // guessing a colour for a story_type this file doesn't recognise.
    const isTemp = categoryKey === 'temperature' && hasValue;
    const accent = isTemp ? _stTempColour(evt.primary_value) : (ST_CATEGORY_ACCENT[categoryKey] || '#64748b');
    const valueColour = isTemp ? _stTempTextColour(evt.primary_value) : accent;

    return `
      <article data-story-event-id="${evt.id}" style="background:${accent}14; border:1px solid var(--border); border-left:3px solid ${accent}; border-radius:14px; padding:16px; margin-bottom:10px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
          <span style="font-size:11px; font-weight:700; color:${accent}; text-transform:uppercase; letter-spacing:0.06em;">${category}</span>
          <span style="font-size:11px; color:var(--text-secondary);">${dateStr}</span>
        </div>
        <div style="font-size:15px; font-weight:700; color:#f1f5f9; margin-bottom:${evt.summary ? '4px' : '0'};">${_stEscape(evt.title)}</div>
        ${evt.summary ? `<div style="font-size:13px; color:var(--text-secondary); line-height:1.5;">${_stEscape(evt.summary)}</div>` : ''}
        ${(hasValue || evt.spot_name || showVerification) ? `
        <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-top:10px; font-size:12px;">
          ${hasValue ? `<span style="font-weight:700; font-size:13px; color:${valueColour};">${evt.primary_value}${/^[a-z]/i.test(evt.unit) ? ' ' + evt.unit : evt.unit}</span>` : ''}
          ${evt.spot_name ? `<span style="color:var(--text-secondary);">${_stEscape(evt.spot_name)}</span>` : ''}
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
