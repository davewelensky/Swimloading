// ============================================================
// SWIM PASSPORT V1 (Phase 2.5)
// Feature-flagged: passport_v1 (Dave, Johan "tunnan", Carina — off
// globally). Independent of overview_v2 / story_* — a swimmer may have
// any combination.
//
// A private, permanent record of the places a swimmer has experienced.
// NOT a challenge system and NOT gamification: no badges, no locked
// stamps, no completion percentages, no unvisited spots, no map, no
// sharing. Everything shown is a place the swimmer has actually been.
//
// One RPC call per modal-open: get_my_swim_passport_v1() returns
// summary + countries + spots already grouped and sorted server-side.
// This file never sorts, re-groups or recomputes a statistic — if the
// display order looks wrong, the fix belongs in the RPC.
//
// Depends on: app.js globals (supabaseClient, currentUser, analytics)
// and switchIdentityTab from app-story-timeline.js, via typeof guards.
// ============================================================

let _ppLoaded = false;      // panel rendered once per modal-open
let _ppData = null;         // last RPC payload, for client-side filtering
let _ppFilter = 'ALL';
let _ppFlagPromise = null;

// Water types present in the DB: OCEAN, POOL, LAGOON, LAKE, DAM, RIVER.
// Deliberately NOT the brief's "Lido" — no spot has that type, so the
// chip could never match anything. "Other" catches any type added later
// without this map needing an edit.
const _PP_WATER_LABELS = {
    OCEAN: 'Ocean', POOL: 'Pool', LAGOON: 'Lagoon',
    LAKE: 'Lake', DAM: 'Dam', RIVER: 'River'
};

function _ppWaterLabel(code) {
    return _PP_WATER_LABELS[code] || 'Other';
}

// Flag read, cached per page load — the tab bar and the Overview card
// both ask, and neither should trigger a second round trip.
async function passportEnabled() {
    if (typeof currentUser === 'undefined' || !currentUser) return false;
    if (_ppFlagPromise) return _ppFlagPromise;
    _ppFlagPromise = (async () => {
        try {
            const { data, error } = await supabaseClient
                .from('feature_flags')
                .select('enabled_global, allowed_user_ids')
                .eq('key', 'passport_v1')
                .maybeSingle();
            if (error || !data) return false;
            return !!data.enabled_global || (data.allowed_user_ids || []).includes(currentUser.id);
        } catch (e) {
            return false;
        }
    })();
    return _ppFlagPromise;
}

// Called on modal close so a fresh open re-reads the passport — a swim
// logged mid-session should appear without a page reload.
function resetPassportTab() {
    _ppLoaded = false;
    _ppData = null;
    _ppFilter = 'ALL';
}

function _ppEscape(s) {
    if (s === null || s === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
}

// 'YYYY-MM-DD' -> '14 May 2025'. Split into parts rather than parsed as
// a string: Date.parse of a bare date treats it as UTC and renders a day
// early for SAST readers, which on a permanent record would be wrong
// forever. Same approach as _ovRelativeDate in app-overview.js.
function _ppDate(dateStr) {
    if (!dateStr) return '';
    const p = String(dateStr).slice(0, 10).split('-');
    if (p.length !== 3) return '';
    const d = new Date(+p[0], +p[1] - 1, +p[2]);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Coarse bucket for analytics — never the exact count, never a name.
function _ppBucket(n) {
    if (!n) return '0';
    if (n < 10) return '1-9';
    if (n < 25) return '10-24';
    if (n < 50) return '25-49';
    return '50+';
}

// ── Entry point — first activation of the Passport tab ───────────
async function initPassportTab() {
    if (_ppLoaded) return;
    _ppLoaded = true;

    const panel = document.getElementById('identityPanelPassport');
    if (!panel) return;

    panel.innerHTML = '<div role="status" style="text-align:center; color:var(--text-secondary); font-size:13px; padding:32px;">Loading your passport…</div>';

    try {
        const { data, error } = await supabaseClient.rpc('get_my_swim_passport_v1');
        if (error) throw error;
        _ppData = data || {};
        _ppFilter = 'ALL';
        _ppRender();
        try {
            analytics.track('identity_passport_opened', {
                total_spots_bucket: _ppBucket((_ppData.summary || {}).total_spots_explored),
                source: 'identity_tab'
            });
        } catch (_) {}
    } catch (e) {
        console.error('[passport] load failed', e);
        // Unlike Overview there is no legacy render to fall back to, so
        // this panel owns its own error state — with a retry rather than
        // a dead end.
        _ppLoaded = false;
        panel.innerHTML = `
          <div role="alert" style="text-align:center; padding:32px 16px;">
            <div style="font-size:13px; color:var(--danger); margin-bottom:14px;">Could not load your passport right now.</div>
            <button type="button" onclick="initPassportTab()" style="padding:10px 22px; border-radius:50px; border:1px solid rgba(56,189,248,0.4); background:transparent; color:#38bdf8; font-size:13px; font-weight:700; cursor:pointer;">Retry</button>
          </div>`;
    }
}

function setPassportFilter(waterType) {
    _ppFilter = waterType;
    try {
        analytics.track('passport_filter_selected', {
            filter_type: waterType,
            total_spots_bucket: _ppBucket((( _ppData || {}).summary || {}).total_spots_explored)
        });
    } catch (_) {}
    _ppRender();
}

function _ppRender() {
    const panel = document.getElementById('identityPanelPassport');
    if (!panel) return;
    panel.innerHTML = _ppBuildHtml(_ppData || {}, _ppFilter);
}

function _ppBuildHtml(data, filter) {
    const summary = data.summary || {};
    const allSpots = data.spots || [];

    const header = `
      <div style="margin-bottom:18px;">
        <h3 style="font-size:16px; font-weight:800; color:#f1f5f9; margin:0 0 6px;">Swim Passport</h3>
        <div style="font-size:13px; color:var(--text-secondary); line-height:1.5;">A private record of the places you have experienced through swimming.</div>
      </div>`;

    if (!allSpots.length) {
        // Empty state: no statistic tiles at all, per the brief — a row
        // of zeroes is a worse welcome than a sentence.
        return header + `
      <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:20px;">
        <div style="font-size:15px; font-weight:800; color:#f1f5f9; margin-bottom:6px;">Your Swim Passport is ready</div>
        <div style="font-size:13px; color:var(--text-secondary); line-height:1.55;">Log a swim at a recognised spot and it will become part of your personal swimming history.</div>
      </div>`;
    }

    // Summary line. Every value here is > 0 (we returned early on an
    // empty passport), so nothing is a zero-value tile.
    const bits = [
        summary.total_spots_explored + (summary.total_spots_explored === 1 ? ' spot explored' : ' spots explored'),
        summary.total_countries + (summary.total_countries === 1 ? ' country' : ' countries'),
        summary.total_regions + (summary.total_regions === 1 ? ' region' : ' regions')
    ];
    const summaryLine = `
      <div style="font-size:13px; color:#cbd5e1; margin-bottom:16px;">${bits.join(' &middot; ')}</div>`;

    // Filter chips — only water types actually present, in the order the
    // RPC returned them. A chip that can never match is worse than no
    // chip, which is why "Lido" from the brief is absent (no such spot).
    const presentTypes = [];
    allSpots.forEach(s => {
        if (s.water_type && presentTypes.indexOf(s.water_type) === -1) presentTypes.push(s.water_type);
    });
    presentTypes.sort((a, b) => _ppWaterLabel(a).localeCompare(_ppWaterLabel(b)));

    const chip = (value, label) => {
        const on = filter === value;
        return `<button type="button" role="button" aria-pressed="${on ? 'true' : 'false'}"
          onclick="setPassportFilter('${value}')"
          onfocus="this.style.outline='2px solid #38bdf8'; this.style.outlineOffset='2px';"
          onblur="this.style.outline='none';"
          style="padding:6px 14px; border-radius:50px; font-size:12px; font-weight:700; cursor:pointer;
                 border:1px solid ${on ? '#38bdf8' : 'var(--border)'};
                 background:${on ? 'rgba(56,189,248,0.12)' : 'transparent'};
                 color:${on ? '#38bdf8' : 'var(--text-secondary)'};">${label}</button>`;
    };

    const filterBar = presentTypes.length > 1 ? `
      <div role="group" aria-label="Filter spots by water type" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:20px;">
        ${chip('ALL', 'All')}
        ${presentTypes.map(t => chip(t, _ppWaterLabel(t))).join('')}
      </div>` : '';

    const spots = filter === 'ALL' ? allSpots : allSpots.filter(s => s.water_type === filter);

    if (!spots.length) {
        return header + summaryLine + filterBar + `
      <div role="status" style="font-size:13px; color:var(--text-secondary); text-align:center; padding:24px;">No ${_ppWaterLabel(filter).toLowerCase()} spots in your passport yet.</div>`;
    }

    // Group country -> region, preserving RPC order throughout. The
    // region heading is SUPPRESSED when it repeats the country name:
    // ten of the domains are country-level, so without this an
    // international swimmer reads "United Kingdom / United Kingdom /
    // Brighton Beach". Genuine sub-regions (Croatia / Dalmatia, and all
    // the South African ones) still show.
    let html = header + summaryLine + filterBar;
    let lastCountry = null;
    let lastRegion = null;

    spots.forEach(s => {
        if (s.country !== lastCountry) {
            html += `<h4 style="font-size:13px; font-weight:800; color:#38bdf8; text-transform:uppercase; letter-spacing:0.08em; margin:22px 0 10px;">${_ppEscape(s.country)}</h4>`;
            lastCountry = s.country;
            lastRegion = null;
        }
        const sameAsCountry = s.region && s.country &&
            s.region.toLowerCase() === s.country.toLowerCase();
        if (s.region !== lastRegion) {
            if (!sameAsCountry) {
                html += `<h5 style="font-size:11px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.08em; margin:14px 0 8px;">${_ppEscape(s.region)}</h5>`;
            }
            lastRegion = s.region;
        }
        html += _ppSpotCard(s);
    });

    return html;
}

function _ppSpotCard(s) {
    const temps = [];
    if (s.coldest_temp_c !== null && s.coldest_temp_c !== undefined) temps.push(s.coldest_temp_c + '&deg;C coldest');
    if (s.warmest_temp_c !== null && s.warmest_temp_c !== undefined) temps.push(s.warmest_temp_c + '&deg;C warmest');

    return `
      <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:14px 16px; margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; gap:12px;">
          <div style="font-size:14px; font-weight:800; color:#f1f5f9; min-width:0;">${_ppEscape(s.spot_name)}</div>
          <div style="font-size:12px; color:var(--text-secondary); white-space:nowrap;">${s.total_swims}${s.total_swims === 1 ? ' swim' : ' swims'}</div>
        </div>
        <div style="font-size:12px; color:var(--text-secondary); margin-top:6px; line-height:1.6;">
          First: ${_ppDate(s.first_swim_date)}<br>Last: ${_ppDate(s.last_swim_date)}
        </div>
        ${temps.length ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">${temps.join(' &middot; ')}</div>` : ''}
      </div>`;
}

// ── Overview -> Passport deep link ───────────────────────────────
// Called by the Overview card's "View Passport" button. Switching the
// tab is all that is needed; initPassportTab runs off the switch and
// moves focus to the panel for keyboard and screen-reader users.
function overviewOpenPassport() {
    try { analytics.track('overview_passport_clicked', { source: 'overview_card' }); } catch (_) {}
    if (typeof switchIdentityTab !== 'function') return;
    switchIdentityTab('passport');
    const panel = document.getElementById('identityPanelPassport');
    if (panel && typeof panel.focus === 'function') panel.focus();
}
