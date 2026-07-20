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

// Relative date for the Latest Story card. story_date is a plain
// 'YYYY-MM-DD' — parsed into local Y/M/D parts rather than through
// Date.parse of the bare string, which would treat it as UTC and shift
// it a day back for SAST readers (established project rule: never let a
// date cross a timezone boundary on the way to the screen).
// Falls back to the full date beyond a month, where "5 weeks ago" stops
// being more useful than "20 July 2026".
function _ovRelativeDate(dateStr) {
    if (!dateStr) return '';
    const parts = String(dateStr).slice(0, 10).split('-');
    if (parts.length !== 3) return '';
    const y = +parts[0], m = +parts[1], d = +parts[2];
    if (!y || !m || !d) return '';

    const then = new Date(y, m - 1, d);
    if (isNaN(then.getTime())) return '';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((today - then) / 86400000);

    if (days < 0) return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return days + ' days ago';
    if (days < 14) return 'Last week';
    if (days < 31) return Math.floor(days / 7) + ' weeks ago';
    return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
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

    // Two SEPARATE flags, neither of which costs an extra query here:
    // both helpers cache their flag read for the page. Story Timeline off
    // -> still show the latest story, just omit the deep-link button.
    // Passport off -> the Passport card stays "Coming soon".
    const [timelineEnabled, passportOn] = await Promise.all([
        typeof storyTimelineEnabled === 'function' ? storyTimelineEnabled() : false,
        typeof passportEnabled === 'function' ? passportEnabled() : false
    ]);

    container.innerHTML = _ovBuildHtml({ participationLabel, stats, latestStory, timelineEnabled, passportOn });
    try {
        analytics.track('overview_v2_viewed', {
            has_latest_story: !!latestStory,
            next_milestone_type: stats && stats.next_milestone ? stats.next_milestone.type : null
        });
    } catch (_) {}
}

// Shared section-label opening tag — every section header in the panel
// uses identical type and rhythm, so it lives in one place rather than
// being retyped (and drifting) six times.
// An <h3> rather than a <div>: these are genuine section headings, so a
// screen reader should be able to jump between them. The modal's own
// swimmer name is the h2 above, giving a clean h2 -> h3 order with no
// skipped level. Callers append their own text plus the closing tag.
const _OV_SECTION_LABEL = '<h3 style="font-size:11px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.1em; margin:0 0 10px;">';

// Lucide "compass" (no emoji, per brand guidelines). Inlined rather than
// pulled from the Lucide CDN because the Overview renders inside an
// already-open modal — a network round trip here would pop the icon in
// late. currentColor so it inherits the cyan set on its wrapper.
const _OV_ICON_COMPASS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg>';

function _ovBuildHtml({ participationLabel, stats, latestStory, timelineEnabled, passportOn }) {
    const s = stats || {};
    const month = s.current_month || {};
    const milestone = s.next_milestone;

    // Featured-content hierarchy for a populated card: label, title,
    // optional summary, then spot / primary value / date as three
    // distinct rows rather than one run-on meta line. Threshold
    // milestones store the crossed threshold in primary_value;
    // temperature events store the recorded temp — the unit comes from
    // the event itself, so nothing is inferred or recomputed here.
    const storyValue = latestStory && latestStory.primary_value !== null && latestStory.primary_value !== undefined
        ? _ovEscape(latestStory.primary_value + (latestStory.unit ? (latestStory.unit === 'C' ? '°C' : ' ' + latestStory.unit) : ''))
        : '';

    const latestStorySection = latestStory ? `
      <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:18px; margin-bottom:22px;">
        <h3 style="font-size:11px; font-weight:700; color:#38bdf8; text-transform:uppercase; letter-spacing:0.1em; margin:0 0 10px;">Latest Story</h3>
        <div style="font-size:16px; font-weight:800; color:#f1f5f9;">${_ovEscape(latestStory.title)}</div>
        ${latestStory.summary ? `<div style="font-size:13px; color:var(--text-secondary); line-height:1.5; margin-top:4px;">${_ovEscape(latestStory.summary)}</div>` : ''}
        ${latestStory.spot_name ? `<div style="font-size:13px; color:#cbd5e1; margin-top:8px;">${_ovEscape(latestStory.spot_name)}</div>` : ''}
        ${storyValue ? `<div style="font-size:15px; font-weight:700; color:#f1f5f9; margin-top:2px;">${storyValue}</div>` : ''}
        ${latestStory.story_date ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:6px;">${_ovEscape(_ovRelativeDate(latestStory.story_date))}</div>` : ''}
        ${timelineEnabled ? `<button type="button" onclick="overviewViewStory('${latestStory.id}')" onfocus="this.style.outline='2px solid #38bdf8'; this.style.outlineOffset='2px';" onblur="this.style.outline='none';" aria-label="View ${_ovEscape(latestStory.title)} in your story timeline" style="margin-top:14px; padding:10px 20px; border-radius:50px; border:1px solid rgba(56,189,248,0.4); background:transparent; color:#38bdf8; font-size:12px; font-weight:700; cursor:pointer;">View Story &rarr;</button>` : ''}
      </div>` : `
      <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:18px; margin-bottom:22px;">
        <h3 style="font-size:11px; font-weight:700; color:#38bdf8; text-transform:uppercase; letter-spacing:0.1em; margin:0 0 10px;">Latest Story</h3>
        <div style="font-size:16px; font-weight:800; color:#f1f5f9; margin-bottom:6px;">Your story is ready to begin.</div>
        <div style="font-size:13px; color:var(--text-secondary); line-height:1.5;">Every milestone, memorable swim and new discovery will become part of your personal swimming journey.</div>
        <div style="font-size:13px; color:var(--text-secondary); line-height:1.5; margin-top:8px;">Story events begin from today.</div>
      </div>`;

    const journeyTile = (label, value) => `
      <div style="flex:1; min-width:44%; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:14px; text-align:center;">
        <div style="font-size:22px; font-weight:800; color:#f1f5f9;">${value}</div>
        <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px; margin-top:2px;">${label}</div>
      </div>`;

    // Supporting stat lines under the participation label, below a rule.
    // Uses only data already in memory — total_swims / spots_explored from
    // the overview response, and currentUser.created_at from the auth
    // session — so it costs no extra query. A swimmer with neither yet
    // gets "Member since …" rather than a deflating pair of zeroes.
    const headerSupportLines = (() => {
        const lines = [];
        if (s.total_swims) {
            lines.push(s.total_swims + (s.total_swims === 1 ? ' Lifetime Swim' : ' Lifetime Swims'));
        }
        if (s.spots_explored) {
            lines.push(s.spots_explored + (s.spots_explored === 1 ? ' Spot Explored' : ' Spots Explored'));
        }
        if (lines.length) return lines;

        const joined = (typeof currentUser !== 'undefined' && currentUser && currentUser.created_at) || null;
        if (!joined) return [];
        const d = new Date(joined);
        if (isNaN(d.getTime())) return [];
        return ['Member since ' + d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })];
    })();

    const milestoneLabel = milestone ? ({
        swim_count: `${milestone.target} Swims`,
        spots_explored: `${milestone.target} Spots`,
        streak: `${milestone.target}-Day Streak`
    }[milestone.type] || `${milestone.target}`) : null;

    // "3 swims to go" / "1 spot to go" / "12 days to go". Unit follows the
    // milestone TYPE, singular/plural follows the remaining count.
    const milestoneUnit = (n) => {
        const one = n === 1;
        return milestone.type === 'streak' ? (one ? 'day' : 'days')
             : milestone.type === 'spots_explored' ? (one ? 'spot' : 'spots')
             : (one ? 'swim' : 'swims');
    };
    const milestoneRemaining = milestone ? `${milestone.remaining} ${milestoneUnit(milestone.remaining)} to go` : '';

    // "4 / 7 days" — the numerator is derived from the values the RPC
    // already returned (target minus remaining), NOT recalculated from
    // the raw stats, so this line can never disagree with the bar.
    const milestoneProgressLine = milestone
        ? `${milestone.target - milestone.remaining} / ${milestone.target} ${milestoneUnit(milestone.target)}`
        : '';

    return `
      <div style="text-align:center; margin-bottom:24px;">
        <div style="font-size:11px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.1em; margin-bottom:4px;">Swimmer</div>
        <div style="font-size:24px; font-weight:800; color:#38bdf8;">${_ovEscape((typeof currentUserProfile !== 'undefined' && currentUserProfile && currentUserProfile.display_name) || 'Swimmer')}</div>
        <div style="font-size:13px; color:var(--text-secondary); margin-top:2px;">${_ovEscape(participationLabel || 'Swimmer')}</div>
        <div role="presentation" style="height:1px; background:var(--border); margin:14px auto 12px; max-width:176px;"></div>
        ${headerSupportLines.map(l => `<div style="font-size:13px; color:var(--text-secondary); line-height:1.6;">${l}</div>`).join('')}
      </div>

      ${latestStorySection}

      ${_OV_SECTION_LABEL}Journey</h3>
      <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:22px;">
        ${journeyTile('Swims', s.total_swims ?? '—')}
        ${journeyTile('Current Streak', (s.current_streak ?? 0) + (s.current_streak === 1 ? ' day' : ' days'))}
        ${journeyTile('Spots Explored', s.spots_explored ?? '—')}
        ${journeyTile('Avg Temp', s.avg_temp_c !== null && s.avg_temp_c !== undefined ? s.avg_temp_c + '°C' : '—')}
      </div>

      ${_OV_SECTION_LABEL}Swim Passport</h3>
      <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:18px 18px 18px 20px; margin-bottom:22px; display:flex; gap:14px; align-items:flex-start;">
        <div style="flex:0 0 auto; margin-top:1px; color:#38bdf8;">${_OV_ICON_COMPASS}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:14px; font-weight:800; color:#f1f5f9;">${s.spots_explored ?? 0} spots explored</div>
          ${passportOn
            ? `<button type="button" onclick="overviewOpenPassport()"
                 onfocus="this.style.outline='2px solid #38bdf8'; this.style.outlineOffset='2px';"
                 onblur="this.style.outline='none';"
                 aria-label="View your Swim Passport"
                 style="margin-top:10px; padding:8px 18px; border-radius:50px; border:1px solid rgba(56,189,248,0.4); background:transparent; color:#38bdf8; font-size:12px; font-weight:700; cursor:pointer;">View Passport &rarr;</button>`
            : `<div style="font-size:12px; color:var(--text-secondary); margin-top:8px;">Coming soon</div>`}
        </div>
      </div>

      ${_OV_SECTION_LABEL}Current Month</h3>
      <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:22px;">
        ${journeyTile('Swims', month.swims ?? 0)}
        ${journeyTile('Avg Temp', month.avg_temp_c !== null && month.avg_temp_c !== undefined ? month.avg_temp_c + '°C' : '—')}
        ${journeyTile('Coldest', month.coldest !== null && month.coldest !== undefined ? month.coldest + '°C' : '—')}
        ${journeyTile('Warmest', month.warmest !== null && month.warmest !== undefined ? month.warmest + '°C' : '—')}
      </div>

      ${milestone ? `
      ${_OV_SECTION_LABEL}Next Milestone</h3>
      <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:18px; margin-bottom:22px;">
        <div style="font-size:14px; font-weight:700; color:#f1f5f9; margin-bottom:4px;">${milestoneLabel}</div>
        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:10px;">${milestoneProgressLine}</div>
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
