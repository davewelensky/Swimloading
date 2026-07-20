// ============================================================
// MY SWIMMING OVERVIEW V2 (Release 2.4)
// Feature-flagged: overview_v2 (Dave, Johan "tunnan", Carina — off
// globally). Separate flag from story_engine_v1 / story_timeline_v1 /
// story_cards_v1 / identity_layer_v1.
//
// Renders the NEW Overview panel content when enabled; app-identity.js
// falls back to its existing statistics-first render when disabled — no
// behavioural change for anyone not on the flag.
//
// Depends on: app.js globals (supabaseClient, currentUser, analytics),
// app-story-timeline.js (storyTimelineEnabled, switchIdentityTab) and
// app-story-card.js's deep-link convention (_scSetPendingHighlight) for
// "View Story", all through typeof guards. Never recomputes a milestone
// or story fact client-side — EVERY number, latest story included, comes
// from the single get_my_swimming_overview_v1 call.
// ============================================================

async function overviewV2Enabled() {
    if (typeof currentUser === 'undefined' || !currentUser) return false;
    try {
        const { data, error } = await supabaseClient
            .from('feature_flags')
            .select('enabled_global, allowed_user_ids')
            .eq('key', 'overview_v2')
            .maybeSingle();
        if (error || !data) return false;
        return !!data.enabled_global || (data.allowed_user_ids || []).includes(currentUser.id);
    } catch (e) {
        return false;
    }
}

function _ovFormatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr.length <= 10 ? dateStr + 'T00:00:00' : dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function _ovEscape(s) {
    if (s === null || s === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
}

// Renders into #identityViewBody, replacing the old statistics-first
// markup for flagged users. ONE read: get_my_swimming_overview_v1 returns
// the stats AND the latest story together, so there is no second round
// trip and no way for the two halves to disagree. Throws on failure —
// app-identity.js catches and falls back to the legacy Overview render,
// so a swimmer never sees an error card in place of their statistics.
async function renderOverviewV2(container, { participationLabel }) {
    container.innerHTML = '<div role="status" style="text-align:center; color:var(--text-secondary); font-size:13px; padding:24px;">Loading your overview…</div>';

    const { data: stats, error } = await supabaseClient.rpc('get_my_swimming_overview_v1');
    if (error) {
        try { analytics.track('overview_v2_load_failed', { failure_stage: 'stats' }); } catch (_) {}
        throw error;
    }

    const latestStory = (stats && stats.latest_story) || null;

    // Story Timeline is a SEPARATE flag: when it is off for this viewer we
    // still show their latest story here, we just omit the button that
    // would deep-link into a tab they cannot open.
    const timelineEnabled = typeof storyTimelineEnabled === 'function' && await storyTimelineEnabled();

    container.innerHTML = _ovBuildHtml({ participationLabel, stats, latestStory, timelineEnabled });
    try {
        analytics.track('overview_v2_viewed', {
            has_latest_story: !!latestStory,
            next_milestone_type: stats && stats.next_milestone ? stats.next_milestone.type : null
        });
    } catch (_) {}
}

function _ovBuildHtml({ participationLabel, stats, latestStory, timelineEnabled }) {
    const s = stats || {};
    const month = s.current_month || {};
    const milestone = s.next_milestone;

    const latestStorySection = latestStory ? `
      <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:16px; margin-bottom:14px;">
        <div style="font-size:11px; font-weight:700; color:#38bdf8; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:8px;">Latest Story</div>
        <div style="font-size:16px; font-weight:800; color:#f1f5f9; margin-bottom:4px;">${_ovEscape(latestStory.title)}</div>
        ${latestStory.summary ? `<div style="font-size:13px; color:var(--text-secondary); margin-bottom:12px;">${_ovEscape(latestStory.summary)}</div>` : ''}
        ${timelineEnabled ? `<button type="button" onclick="overviewViewStory('${latestStory.id}')" style="padding:10px 20px; border-radius:50px; border:1px solid rgba(56,189,248,0.4); background:transparent; color:#38bdf8; font-size:12px; font-weight:700; cursor:pointer;">View Story</button>` : ''}
      </div>` : `
      <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:16px; margin-bottom:14px; text-align:center;">
        <div style="font-size:13px; color:var(--text-secondary);">Your swimming story has started.</div>
      </div>`;

    const journeyTile = (label, value) => `
      <div style="flex:1; min-width:44%; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:14px; text-align:center;">
        <div style="font-size:22px; font-weight:800; color:#f1f5f9;">${value}</div>
        <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px; margin-top:2px;">${label}</div>
      </div>`;

    const milestoneLabel = milestone ? ({
        swim_count: `${milestone.target} Swims`,
        spots_explored: `${milestone.target} Spots`,
        streak: `${milestone.target}-Day Streak`
    }[milestone.type] || `${milestone.target}`) : null;

    // "3 swims to go" / "1 spot to go" / "12 days to go". Unit follows the
    // milestone TYPE, singular/plural follows the remaining count.
    const milestoneRemaining = (() => {
        if (!milestone) return '';
        const n = milestone.remaining;
        const one = n === 1;
        const unit = milestone.type === 'streak' ? (one ? 'day' : 'days')
                   : milestone.type === 'spots_explored' ? (one ? 'spot' : 'spots')
                   : (one ? 'swim' : 'swims');
        return `${n} ${unit} to go`;
    })();

    return `
      <div style="text-align:center; margin-bottom:18px;">
        <div style="font-size:11px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.1em; margin-bottom:4px;">Swimmer</div>
        <div style="font-size:24px; font-weight:800; color:#38bdf8;">${_ovEscape((typeof currentUserProfile !== 'undefined' && currentUserProfile && currentUserProfile.display_name) || 'Swimmer')}</div>
        <div style="font-size:13px; color:var(--text-secondary); margin-top:2px;">${_ovEscape(participationLabel || 'Swimmer')}</div>
      </div>

      ${latestStorySection}

      <div style="font-size:11px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.1em; margin:18px 0 8px;">Journey</div>
      <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px;">
        ${journeyTile('Swims', s.total_swims ?? '—')}
        ${journeyTile('Current Streak', (s.current_streak ?? 0) + (s.current_streak === 1 ? ' day' : ' days'))}
        ${journeyTile('Spots', s.spots_explored ?? '—')}
        ${journeyTile('Avg Temp', s.avg_temp_c !== null && s.avg_temp_c !== undefined ? s.avg_temp_c + '°C' : '—')}
      </div>

      <div style="font-size:11px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.1em; margin:18px 0 8px;">Passport Preview</div>
      <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:16px; margin-bottom:14px;">
        <div style="font-size:14px; font-weight:800; color:#f1f5f9;">Swim Passport</div>
        <div style="font-size:13px; color:var(--text-secondary); margin-top:4px;">${s.spots_explored ?? 0} spots explored</div>
        <div style="font-size:12px; color:var(--text-secondary); margin-top:10px;">Coming soon</div>
      </div>

      <div style="font-size:11px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.1em; margin:18px 0 8px;">Current Month</div>
      <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px;">
        ${journeyTile('Swims', month.swims ?? 0)}
        ${journeyTile('Avg Temp', month.avg_temp_c !== null && month.avg_temp_c !== undefined ? month.avg_temp_c + '°C' : '—')}
        ${journeyTile('Coldest', month.coldest !== null && month.coldest !== undefined ? month.coldest + '°C' : '—')}
        ${journeyTile('Warmest', month.warmest !== null && month.warmest !== undefined ? month.warmest + '°C' : '—')}
      </div>

      ${milestone ? `
      <div style="font-size:11px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.1em; margin:18px 0 8px;">Next Milestone</div>
      <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:16px; margin-bottom:14px;">
        <div style="font-size:14px; font-weight:700; color:#f1f5f9; margin-bottom:8px;">${milestoneLabel}</div>
        <div style="height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden; margin-bottom:8px;">
          <div style="height:100%; width:${Math.round((milestone.progress || 0) * 100)}%; background:#38bdf8;"></div>
        </div>
        <div style="font-size:12px; color:var(--text-secondary);">${milestoneRemaining}</div>
      </div>` : ''}
    `;
}

// "View Story" from the Latest Story card — same deep-link mechanism as
// app-story-card.js's "View in Story" (Phase 2.3): switch to the Story
// tab and let app-story-timeline.js's own highlight hook
// (_scTryHighlightPendingEvent) take it from there. Reuses
// app-story-card.js's _scSetPendingHighlight setter rather than growing
// a second, parallel deep-link mechanism.
function overviewViewStory(eventId) {
    try { analytics.track('overview_v2_view_story', {}); } catch (_) {}
    if (typeof switchIdentityTab !== 'function') return;
    if (typeof _scSetPendingHighlight === 'function') _scSetPendingHighlight(eventId);
    switchIdentityTab('story');
}
