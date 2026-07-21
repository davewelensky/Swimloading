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
    let html = header + summaryLine + _ppHero(allSpots) + filterBar;
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

// "Your water" hero — the swimmer's whole temperature range as a
// spectrum bar (violet-cold → amber-warm), with the coldest and warmest
// spots named. This is what makes the passport feel like a temperature
// map of your swimming rather than a list. Computed from the swimmer's
// own spots (already loaded); omitted only if no spot has a temperature.
function _ppHero(allSpots) {
    const withTemp = (allSpots || []).filter(s => s.coldest_temp_c !== null && s.coldest_temp_c !== undefined);
    if (!withTemp.length) return '';

    let coldSpot = withTemp[0], warmSpot = withTemp[0];
    const warmOf = s => (s.warmest_temp_c !== null && s.warmest_temp_c !== undefined) ? s.warmest_temp_c : s.coldest_temp_c;
    withTemp.forEach(s => {
        if (s.coldest_temp_c < coldSpot.coldest_temp_c) coldSpot = s;
        if (warmOf(s) > warmOf(warmSpot)) warmSpot = s;
    });
    const gCold = coldSpot.coldest_temp_c;
    const gWarm = warmOf(warmSpot);
    const spanTxt = (gWarm - gCold).toFixed(1).replace(/\.0$/, '');

    return `
      <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:16px; margin-bottom:20px;">
        <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-secondary); margin-bottom:12px;">Your water</div>
        <div style="height:10px; border-radius:5px; background:linear-gradient(90deg, ${_ppTempColour(gCold)}, ${_ppTempColour((gCold + gWarm) / 2)}, ${_ppTempColour(gWarm)});"></div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
          <span style="font-size:17px; font-weight:800; color:${_ppTempTextColour(gCold)};">${gCold}&deg;C</span>
          ${gWarm > gCold ? `<span style="font-size:12px; color:var(--text-secondary);">${spanTxt}&deg; range</span>` : ''}
          <span style="font-size:17px; font-weight:800; color:${_ppTempTextColour(gWarm)};">${gWarm}&deg;C</span>
        </div>
        <div style="font-size:12px; color:var(--text-secondary); margin-top:12px; line-height:1.6;">
          Coldest at <span style="color:#f1f5f9; font-weight:600;">${_ppEscape(coldSpot.spot_name)}</span> &middot; warmest at <span style="color:#f1f5f9; font-weight:600;">${_ppEscape(warmSpot.spot_name)}</span>
        </div>
      </div>`;
}

function _ppSpotCard(s) {
    const cold = s.coldest_temp_c;
    const warm = s.warmest_temp_c;
    const hasTemp = cold !== null && cold !== undefined;
    // Left edge + faint wash in the coldest temp's colour, so a cold spot
    // reads cold and a warm spot reads warm at a glance.
    const edge = hasTemp ? _ppTempColour(cold) : 'var(--border)';
    const wash = hasTemp ? _ppTempColour(cold) + '14' : 'rgba(255,255,255,0.03)'; // ~8% alpha

    let tempRow = '';
    if (hasTemp && warm !== null && warm !== undefined && warm > cold) {
        // A gradient range bar from coldest colour to warmest colour, with
        // the two values coloured to match — "colours on the temps" + range.
        tempRow = `
        <div style="margin-top:10px;">
          <div style="height:6px; border-radius:3px; background:linear-gradient(90deg, ${_ppTempColour(cold)}, ${_ppTempColour(warm)});"></div>
          <div style="display:flex; justify-content:space-between; margin-top:6px; font-size:12px; font-weight:700;">
            <span style="color:${_ppTempTextColour(cold)};">${cold}&deg;C coldest</span>
            <span style="color:${_ppTempTextColour(warm)};">${warm}&deg;C warmest</span>
          </div>
        </div>`;
    } else if (hasTemp) {
        // Single recorded temperature (or coldest === warmest): one dot + value.
        tempRow = `
        <div style="margin-top:10px; display:flex; align-items:center; gap:8px;">
          <span style="width:9px; height:9px; border-radius:50%; background:${_ppTempColour(cold)};"></span>
          <span style="font-size:13px; font-weight:700; color:${_ppTempTextColour(cold)};">${cold}&deg;C</span>
        </div>`;
    }

    return `
      <div style="background:${wash}; border:1px solid var(--border); border-left:3px solid ${edge}; border-radius:14px; padding:14px 16px; margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; gap:12px;">
          <div style="font-size:14px; font-weight:800; color:#f1f5f9; min-width:0;">${_ppEscape(s.spot_name)}</div>
          <div style="font-size:12px; color:var(--text-secondary); white-space:nowrap;">${s.total_swims}${s.total_swims === 1 ? ' swim' : ' swims'}</div>
        </div>
        <div style="font-size:12px; color:var(--text-secondary); margin-top:6px;">${_ppDate(s.first_swim_date)} &ndash; ${_ppDate(s.last_swim_date)}</div>
        ${tempRow}
      </div>`;
}

// ============================================================
// PASSPORT MOMENT + DOOR (Phase 2.5.1)
// Separately flag-gated: passport_moment_v1. Turns the post-log tail
// (points toast -> story/swim card -> share sheet) into ONE screen that
// stamps the swim into the passport, coloured by water temperature, and
// makes "Open my Passport" the primary action. Also renders a persistent
// dashboard door so the passport is reachable without logging first.
//
// Reuses get_my_swim_passport_v1 for the moment's numbers — no new RPC.
// Describing, not gamifying: real facts (total spots, Nth swim here,
// coldest here), never badges or completion bars.
// ============================================================

let _ppMomentFlagPromise = null;
let _ppMomentResolve = null;
let _ppMomentCtx = null;   // last moment's context, for the Share button

async function passportMomentEnabled() {
    if (typeof currentUser === 'undefined' || !currentUser) return false;
    if (_ppMomentFlagPromise) return _ppMomentFlagPromise;
    _ppMomentFlagPromise = (async () => {
        try {
            const { data, error } = await supabaseClient
                .from('feature_flags')
                .select('enabled_global, allowed_user_ids')
                .eq('key', 'passport_moment_v1')
                .maybeSingle();
            if (error || !data) return false;
            return !!data.enabled_global || (data.allowed_user_ids || []).includes(currentUser.id);
        } catch (e) { return false; }
    })();
    return _ppMomentFlagPromise;
}

// Water temperature -> colour. Cold reads deep/violet, warm reads amber.
// Bands chosen for South African + cold-water swimming: a 15C Cape winter
// sea and a 26C pool should look obviously different. temp is the value
// the swimmer just logged.
const _PP_TEMP_BANDS = [
    { below: 8,        colour: '#7c3aed' }, // ice violet
    { below: 12,       colour: '#2563eb' }, // deep blue
    { below: 16,       colour: '#0891b2' }, // cold cyan
    { below: 20,       colour: '#0d9488' }, // teal
    { below: 24,       colour: '#16a34a' }, // mild green
    { below: Infinity, colour: '#f59e0b' }  // warm amber
];
function _ppTempColour(t) {
    if (t === null || t === undefined || isNaN(t)) return '#38bdf8';
    for (let i = 0; i < _PP_TEMP_BANDS.length; i++) {
        if (t < _PP_TEMP_BANDS[i].below) return _PP_TEMP_BANDS[i].colour;
    }
    return '#f59e0b';
}

// A lighter tint of the band colour for text on the dark stamp.
function _ppTempTextColour(t) {
    const map = { '#7c3aed':'#c4b5fd','#2563eb':'#93c5fd','#0891b2':'#67e8f9','#0d9488':'#5eead4','#16a34a':'#86efac','#f59e0b':'#fcd34d','#38bdf8':'#7dd3fc' };
    return map[_ppTempColour(t)] || '#7dd3fc';
}

// Compass icon, defined here rather than borrowed from app-overview.js —
// the door must not depend on another file's constant or its load order.
const _PP_ICON_COMPASS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg>';

function _ppOrdinal(n) {
    if (n === null || n === undefined) return '';
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Open the Passport tab in the Identity modal from anywhere. showIdentityView
// resets to the Overview tab as it opens, so switch to Passport once it has.
function openMyPassport(source) {
    try { analytics.track('overview_passport_clicked', { source: source || 'door' }); } catch (_) {}
    if (typeof showIdentityView !== 'function' || typeof switchIdentityTab !== 'function') return;
    const p = showIdentityView();
    if (p && typeof p.then === 'function') p.then(() => switchIdentityTab('passport'));
    else switchIdentityTab('passport');
}

// ── The post-log moment ──────────────────────────────────────────
// Resolves when dismissed (like showShareSheet), so submitTempLog can
// continue to the dashboard transition afterwards.
async function showPassportMoment(ctx) {
    return new Promise(resolve => {
        _ppMomentResolve = resolve;
        _ppMomentCtx = ctx;

        let ov = document.getElementById('passportMomentOverlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'passportMomentOverlay';
            ov.style.cssText = 'position:fixed; inset:0; z-index:10050; background:rgba(3,8,16,0.86); display:flex; align-items:center; justify-content:center; padding:20px;';
            document.body.appendChild(ov);
        }
        ov.innerHTML = '<div role="status" style="color:var(--text-secondary); font-size:13px;">Stamping your swim…</div>';
        ov.style.display = 'flex';

        (async () => {
            let spot = null, totalSpots = null;
            try {
                const { data, error } = await supabaseClient.rpc('get_my_swim_passport_v1');
                if (!error && data) {
                    totalSpots = (data.summary || {}).total_spots_explored ?? null;
                    spot = (data.spots || []).find(s => s.spot_id === ctx.spotId) || null;
                }
            } catch (_) { /* fall through to a simpler moment */ }

            ov.innerHTML = _ppMomentHtml(ctx, spot, totalSpots);
        })();
    });
}

function _ppMomentHtml(ctx, spot, totalSpots) {
    const colour = _ppTempColour(ctx.temp);
    const textColour = _ppTempTextColour(ctx.temp);
    const nthHere = spot ? spot.total_swims : null;
    const coldestHere = spot ? spot.coldest_temp_c : null;
    const region = spot ? spot.region : null;
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const cond = ctx.conditions ? ctx.conditions.charAt(0).toUpperCase() + ctx.conditions.slice(1) : '';

    // "Coldest here yet" only when this swim set (or tied) the minimum and
    // it isn't their first visit — coldestHere already includes this swim.
    const newColdest = (nthHere && nthHere > 1 && coldestHere !== null && ctx.temp <= coldestHere);

    const sub = [region, today, cond].filter(Boolean).join(' · ');

    const chips = [];
    if (totalSpots !== null) chips.push({ n: totalSpots, k: totalSpots === 1 ? 'Spot' : 'Spots' });
    if (nthHere !== null) chips.push({ n: _ppOrdinal(nthHere), k: 'Here' });
    if (coldestHere !== null) chips.push({ n: coldestHere + '&deg;', k: 'Coldest here', colour: textColour });

    const chipHtml = chips.length ? `
      <div style="display:flex; gap:8px; margin-top:16px;">
        ${chips.map(c => `
          <div style="flex:1; background:rgba(255,255,255,0.04); border:1px solid var(--border); border-radius:12px; padding:10px 8px; text-align:center;">
            <div style="font-size:19px; font-weight:800; ${c.colour ? 'color:' + c.colour + ';' : ''}">${c.n}</div>
            <div style="font-size:9px; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--text-secondary); margin-top:3px;">${c.k}</div>
          </div>`).join('')}
      </div>` : '';

    return `
      <div style="width:100%; max-width:400px; background:#0d1728; border:1px solid var(--border); border-radius:22px; padding:22px 20px;">
        <div style="display:flex; align-items:center; gap:7px; font-size:12px; font-weight:700; color:#16a34a; margin-bottom:16px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>Swim logged
        </div>
        <div style="border-radius:18px; padding:22px 20px; position:relative; overflow:hidden; border:1px solid var(--border);
             background:radial-gradient(120% 120% at 20% 0%, ${colour}33, transparent 60%), #0d1728;">
          ${newColdest ? `<div style="position:absolute; top:16px; right:16px; font-size:10px; font-weight:800; letter-spacing:0.08em; text-transform:uppercase; color:${textColour}; border:1px solid ${colour}88; border-radius:50px; padding:4px 10px;">Coldest here yet</div>` : ''}
          <div style="font-size:46px; font-weight:800; line-height:1; letter-spacing:-1px; color:${textColour};">${_ovEscapeMoment(ctx.temp)}<span style="font-size:20px; color:var(--text-secondary); font-weight:700;">&deg;C</span></div>
          <div style="font-size:17px; font-weight:800; color:#f1f5f9; margin-top:8px;">${_ppEscape(ctx.spotName)}</div>
          ${sub ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:3px;">${_ppEscape(sub)}</div>` : ''}
          ${chipHtml}
        </div>
        <button type="button" onclick="_ppMomentOpenPassport()"
          onfocus="this.style.outline='2px solid #38bdf8'; this.style.outlineOffset='2px';" onblur="this.style.outline='none';"
          style="width:100%; padding:14px; border-radius:50px; border:none; background:#38bdf8; color:#08131f; font-size:14px; font-weight:800; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; margin-top:16px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#08131f" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>Open my Passport
        </button>
        <button type="button" onclick="_ppMomentShare()"
          onfocus="this.style.outline='2px solid #38bdf8'; this.style.outlineOffset='2px';" onblur="this.style.outline='none';"
          style="width:100%; padding:12px; border-radius:50px; background:transparent; border:1px solid var(--border); color:var(--text-secondary); font-size:13px; font-weight:700; cursor:pointer; margin-top:8px;">Share this swim</button>
        <button type="button" onclick="_ppMomentDismiss()"
          style="width:100%; padding:10px; background:transparent; border:none; color:var(--text-secondary); font-size:12px; font-weight:600; cursor:pointer; margin-top:6px;">Done</button>
      </div>`;
}

// Small numeric passthrough so a stray non-number can't inject markup.
function _ovEscapeMoment(v) { const n = Number(v); return isNaN(n) ? '' : String(n); }

function _ppMomentDismiss() {
    const ov = document.getElementById('passportMomentOverlay');
    if (ov) ov.style.display = 'none';
    if (_ppMomentResolve) { _ppMomentResolve(); _ppMomentResolve = null; }
}

function _ppMomentOpenPassport() {
    _ppMomentDismiss();
    openMyPassport('post_log_moment');
}

function _ppMomentShare() {
    const c = _ppMomentCtx;
    if (!c) return;
    const cond = c.conditions ? c.conditions.charAt(0).toUpperCase() + c.conditions.slice(1) : '';
    const msg = `${c.spotName}: ${c.temp}°C${cond ? ' • ' + cond : ''}\nLogged on SwimLoading — swimloading.com`;
    try { window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank'); } catch (_) {}
    try { analytics.track('whatsapp_shared', { source: 'passport_moment' }); } catch (_) {}
}

// ── The persistent dashboard door ────────────────────────────────
// Self-initialising, mirroring the identity entry-point pattern: waits
// for currentUser, renders the door when passport_moment_v1 is on.
(function _ppInitDoor() {
    let tries = 0;
    const timer = setInterval(async () => {
        tries++;
        if (typeof currentUser !== 'undefined' && currentUser) {
            clearInterval(timer);
            try {
                if (!(await passportMomentEnabled())) return;
                const el = document.getElementById('passportDoor');
                if (!el) return;
                el.style.display = 'block';
                el.innerHTML = `
                  <button type="button" onclick="openMyPassport('dashboard_door')"
                    style="width:100%; text-align:left; background:linear-gradient(135deg, rgba(56,189,248,0.10), rgba(13,148,136,0.10)); border:1px solid rgba(56,189,248,0.28); border-radius:16px; padding:16px 18px; cursor:pointer; display:flex; align-items:center; gap:14px; color:#f1f5f9;">
                    <span style="flex:0 0 auto; color:#38bdf8;">${_PP_ICON_COMPASS}</span>
                    <span style="flex:1; min-width:0;">
                      <span style="display:block; font-size:15px; font-weight:800;">Swim Passport</span>
                      <span style="display:block; font-size:12px; color:var(--text-secondary); margin-top:2px;">Every place you've swum, coloured by the water</span>
                    </span>
                    <span style="flex:0 0 auto; color:#38bdf8; font-size:18px; font-weight:800;">&rarr;</span>
                  </button>`;
            } catch (e) { /* door is optional */ }
        } else if (tries > 120) {
            clearInterval(timer);
        }
    }, 500);
})();

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
