// app-strava.js — Strava import UI
// Depends on: app.js globals (currentUser, supabaseClient, showToast, spots, initIcons)

let _stravaActivitiesCache = null;   // cache per session
let _stravaFetchedAt       = 0;
let _selectedStravaActivity = null;  // activity being imported
const STRAVA_CACHE_MS = 3 * 60 * 1000; // 3 minutes (manual refresh available)

// ─── Dashboard Banner ────────────────────────────────────────────────────────

async function checkStravaBanner() {
    const banner = document.getElementById('stravaBanner');
    if (!banner || !currentUser) return;

    // Check if connected
    const { data: conn } = await supabaseClient
        .from('strava_connections')
        .select('strava_athlete_id')
        .eq('user_id', currentUser.id)
        .maybeSingle();

    if (!conn) {
        // Not connected — show connect prompt unless they've dismissed it
        const dismissedKey = `strava_connect_dismissed_${currentUser.id}`;
        if (localStorage.getItem(dismissedKey)) return;

        banner.style.display = 'block';
        banner.innerHTML = `
            <div style="background:rgba(252,76,2,0.07);border:1px solid rgba(252,76,2,0.25);border-radius:14px;padding:14px 16px;display:flex;align-items:center;gap:14px;margin-bottom:4px;">
                <div style="width:38px;height:38px;background:#fc4c02;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <svg width="21" height="21" viewBox="0 0 24 24" fill="white"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:14px;color:var(--text-primary);margin-bottom:2px;">Swim with Strava?</div>
                    <div style="font-size:12px;color:var(--text-secondary);line-height:1.45;">Import your swims directly — we add the water conditions Strava doesn't capture.</div>
                </div>
                <div style="display:flex;gap:8px;flex-shrink:0;">
                    <button onclick="connectStravaFromBanner()"
                        style="background:#fc4c02;color:white;border:none;border-radius:8px;padding:8px 13px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">
                        Connect
                    </button>
                    <button onclick="dismissStravaBanner()"
                        style="background:transparent;color:var(--text-secondary);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 10px;font-size:13px;cursor:pointer;line-height:1;">
                        ✕
                    </button>
                </div>
            </div>`;
        return;
    }

    // Connected — look for an unimported swim in the last 24 hours
    const activities = await fetchStravaActivities();
    if (!activities || activities === 'reconnect_required') return;

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = activities.find(a =>
        !a.already_imported &&
        a.start_date_local &&
        new Date(a.start_date_local).getTime() > cutoff
    );

    if (!recent) return;

    const spotText = recent.matched_spot_name
        ? `at <strong>${recent.matched_spot_name}</strong>`
        : '';
    const distKm = recent.distance_m ? (recent.distance_m / 1000).toFixed(1) + ' km' : '';
    const subtitle = [distKm, 'Add the water conditions.'].filter(Boolean).join(' · ');

    banner.style.display = 'block';
    banner.innerHTML = `
        <div style="background:rgba(252,76,2,0.08);border:1px solid rgba(252,76,2,0.3);border-radius:14px;padding:14px 16px;display:flex;align-items:center;gap:14px;">
            <div style="width:36px;height:36px;background:#fc4c02;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>
            </div>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:14px;color:var(--text-primary);">You swam today ${spotText}</div>
                <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${subtitle}</div>
            </div>
            <div style="display:flex;gap:8px;flex-shrink:0;">
                <button onclick="openStravaImportModal()"
                    style="background:#fc4c02;color:white;border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;">
                    Import
                </button>
                <button onclick="dismissStravaBanner()"
                    style="background:transparent;color:var(--text-secondary);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 10px;font-size:13px;cursor:pointer;">
                    ✕
                </button>
            </div>
        </div>`;
}

function dismissStravaBanner() {
    const banner = document.getElementById('stravaBanner');
    if (banner) banner.style.display = 'none';
    // Remember the dismissal so it doesn't reappear every session
    if (currentUser) {
        localStorage.setItem(`strava_connect_dismissed_${currentUser.id}`, '1');
    }
}

async function connectStravaFromBanner() {
    // Reuse the profile connect flow
    if (!currentUser) return;
    const btn = event.target;
    btn.textContent = 'Connecting…';
    btn.disabled = true;
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) throw new Error('No session');
        const res = await fetch('/api/strava/connect-url', {
            headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
        if (!res.ok) throw new Error('Could not get connect URL');
        const { url } = await res.json();
        window.location.href = url;
    } catch (err) {
        console.error('[strava] connectStravaFromBanner error:', err);
        showToast('Could not connect to Strava. Please try again.', 'error');
        btn.textContent = 'Connect';
        btn.disabled = false;
    }
}

// ─── Log Conditions Entry Point ──────────────────────────────────────────────
// Called whenever the Log Conditions page is shown.
// Shows "Import from Strava" if connected, or a subtle connect prompt if not.

async function checkStravaLogEntry() {
    const el = document.getElementById('stravaLogEntry');
    if (!el || !currentUser) return;

    try {
        const { data: conn } = await supabaseClient
            .from('strava_connections')
            .select('strava_athlete_id')
            .eq('user_id', currentUser.id)
            .maybeSingle();

        if (conn) {
            // Connected — show prominent import button + "or log manually" divider
            el.style.display = 'block';
            el.innerHTML = `
                <button onclick="openStravaImportModal()"
                    style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:rgba(252,76,2,0.10);border:1.5px solid rgba(252,76,2,0.35);border-radius:12px;padding:13px 16px;cursor:pointer;transition:background 0.15s;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="#fc4c02"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>
                    <span style="font-size:14px;font-weight:600;color:#fc4c02;">Import from Strava</span>
                </button>
                <div style="display:flex;align-items:center;gap:10px;margin:14px 4px 4px;">
                    <div style="flex:1;height:1px;background:rgba(255,255,255,0.07);"></div>
                    <span style="font-size:11px;color:var(--text-secondary);white-space:nowrap;letter-spacing:0.03em;">or log manually below</span>
                    <div style="flex:1;height:1px;background:rgba(255,255,255,0.07);"></div>
                </div>`;
        } else {
            // Not connected — soft prompt, doesn't dominate the form
            el.style.display = 'block';
            el.innerHTML = `
                <div style="background:rgba(252,76,2,0.05);border:1px solid rgba(252,76,2,0.15);border-radius:10px;padding:10px 14px;display:flex;align-items:center;gap:10px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="rgba(252,76,2,0.55)" style="flex-shrink:0;"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>
                    <span style="font-size:12px;color:var(--text-secondary);">Already swam? <button onclick="showPage('profile')" style="background:none;border:none;color:#fc4c02;font-size:12px;font-weight:600;cursor:pointer;padding:0;">Connect Strava</button> to import your swim directly.</span>
                </div>`;
        }
    } catch (err) {
        // Silently ignore — don't break the form if this check fails
        console.warn('[strava] checkStravaLogEntry error:', err.message);
        el.style.display = 'none';
    }
}

// ─── Activities Fetch (cached) ───────────────────────────────────────────────

async function fetchStravaActivities() {
    if (_stravaActivitiesCache && Date.now() - _stravaFetchedAt < STRAVA_CACHE_MS) {
        return _stravaActivitiesCache;
    }

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) return null;

        const res = await fetch('/api/strava/activities', {
            headers: { 'Authorization': `Bearer ${session.access_token}` }
        });

        if (res.status === 429) {
            showToast('Strava is limiting requests right now. Try again later.', 'error');
            return null;
        }

        if (!res.ok) {
            const { error } = await res.json().catch(() => ({}));
            if (error === 'strava_not_connected') {
                // Token expired and refresh failed — user needs to reconnect
                return 'reconnect_required';
            }
            console.error('[strava] fetchStravaActivities error:', error);
            return null;
        }

        const { activities } = await res.json();
        _stravaActivitiesCache = activities;
        _stravaFetchedAt = Date.now();
        return activities;
    } catch (err) {
        console.error('[strava] fetchStravaActivities exception:', err);
        return null;
    }
}

// ─── Import Modal ────────────────────────────────────────────────────────────

async function openStravaImportModal() {
    // Always fetch fresh when opening the modal
    _stravaActivitiesCache = null;
    _stravaFetchedAt = 0;
    await loadStravaImportList();
}

async function refreshStravaImportList() {
    _stravaActivitiesCache = null;
    _stravaFetchedAt = 0;
    await loadStravaImportList();
}

async function loadStravaImportList() {
    const modal = document.getElementById('stravaImportModal');
    if (!modal) return;
    modal.style.display = 'block';
    initIcons();

    const list = document.getElementById('stravaImportList');
    list.innerHTML = `
        <div style="text-align:center;padding:40px;color:var(--text-secondary);">
            <i data-lucide="loader" style="width:24px;height:24px;animation:spin 1s linear infinite;display:block;margin:0 auto 12px;"></i>
            Loading your swims…
        </div>`;
    initIcons();

    const activities = await fetchStravaActivities();

    if (activities === 'reconnect_required') {
        list.innerHTML = `
            <div style="text-align:center;padding:40px 20px;">
                <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:6px;">Strava connection needs refreshing</div>
                <div style="font-size:13px;color:var(--text-secondary);margin-bottom:20px;">Your connection expired. Disconnect and reconnect Strava to fetch your latest swims.</div>
                <button onclick="closeStravaImportModal();showPage('profile');"
                    style="background:#fc4c02;color:white;border:none;border-radius:8px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;">
                    Go to Profile to reconnect
                </button>
            </div>`;
        return;
    }

    if (!activities || activities.length === 0) {
        list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-secondary);font-size:14px;">No recent swims found. Sync your watch, then try again.</div>`;
        return;
    }

    list.innerHTML = activities.map(a => renderActivityRow(a)).join('');
    initIcons();
}

function closeStravaImportModal() {
    const modal = document.getElementById('stravaImportModal');
    if (modal) modal.style.display = 'none';
}

function renderActivityRow(a) {
    const date     = a.start_date_local ? new Date(a.start_date_local).toLocaleDateString('en-ZA', { weekday:'short', day:'numeric', month:'short' }) : '—';
    const distKm   = a.distance_m ? (a.distance_m / 1000).toFixed(1) + ' km' : '—';
    const duration = a.elapsed_time_seconds ? formatDuration(a.elapsed_time_seconds) : '—';
    const isPool   = !a.has_gps;
    const spot     = a.matched_spot_name
        ? `<span style="color:#fc4c02;font-size:11px;">● ${a.matched_spot_name}</span>`
        : isPool
            ? `<span style="font-size:11px;color:var(--text-secondary);display:inline-flex;align-items:center;gap:4px;"><i data-lucide="waves" style="width:11px;height:11px;"></i> Pool · pick a location to log temp</span>`
            : `<span style="font-size:11px;color:var(--text-secondary);display:inline-flex;align-items:center;gap:4px;"><i data-lucide="map-pin-off" style="width:11px;height:11px;"></i> Open water · no spot matched</span>`;

    if (a.already_imported) {
        return `
            <div style="padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:12px;opacity:0.5;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:14px;color:var(--text-primary);margin-bottom:2px;">${escapeHtml(a.name || 'Swim')}</div>
                    <div style="font-size:12px;color:var(--text-secondary);">${date} · ${distKm} · ${duration}</div>
                    <div style="margin-top:3px;">${spot}</div>
                </div>
                <div style="font-size:12px;color:var(--text-secondary);flex-shrink:0;">Imported</div>
            </div>`;
    }

    return `
        <div style="padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:12px;">
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:14px;color:var(--text-primary);margin-bottom:2px;">${escapeHtml(a.name || 'Swim')}</div>
                <div style="font-size:12px;color:var(--text-secondary);">${date} · ${distKm} · ${duration}</div>
                <div style="margin-top:3px;">${spot}</div>
            </div>
            <button onclick='openStravaLogForm(${JSON.stringify(a).replace(/'/g, "\\'")})'
                style="background:#fc4c02;color:white;border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0;">
                Log
            </button>
        </div>`;
}

// ─── Prefill Log Form ────────────────────────────────────────────────────────

function openStravaLogForm(activity) {
    _selectedStravaActivity = activity;
    _selectedCondition = null;
    _selectedHazards.clear();
    closeStravaImportModal();

    const modal = document.getElementById('stravaLogModal');
    if (!modal) return;
    modal.style.display = 'block';

    renderStravaLogForm(activity);
    initIcons();
}

function closeStravaLogModal() {
    const modal = document.getElementById('stravaLogModal');
    if (modal) modal.style.display = 'none';
    _selectedStravaActivity = null;
}

function renderStravaLogForm(a) {
    const formEl = document.getElementById('stravaLogForm');
    if (!formEl) return;

    const date    = a.start_date_local ? new Date(a.start_date_local).toLocaleDateString('en-ZA', { weekday:'long', day:'numeric', month:'long' }) : '—';
    const distKm  = a.distance_m ? (a.distance_m / 1000).toFixed(1) : '';
    const dur     = a.elapsed_time_seconds ? formatDuration(a.elapsed_time_seconds) : '';

    // Build spot options — prefer matched spot at top
    const spotOptions = (spots || []).map(s => {
        const selected = s.id === a.matched_spot_id ? 'selected' : '';
        return `<option value="${s.id}" ${selected}>${escapeHtml(s.name)}</option>`;
    }).join('');

    const CONDITIONS = ['Calm', 'Slight chop', 'Choppy', 'Rough', 'Dangerous'];
    const HAZARDS    = ['Jellyfish', 'Seaweed', 'Strong current', 'Poor visibility', 'Sharks', 'Boats'];

    formEl.innerHTML = `
        <!-- Activity summary -->
        <div style="background:rgba(252,76,2,0.06);border:1px solid rgba(252,76,2,0.15);border-radius:10px;padding:12px 14px;margin-bottom:20px;">
            <div style="font-weight:600;font-size:14px;color:var(--text-primary);">${escapeHtml(a.name || 'Swim')}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">${date}${distKm ? ' · ' + distKm + ' km' : ''}${dur ? ' · ' + dur : ''}</div>
        </div>

        <!-- Spot -->
        <div class="form-group">
            <div class="form-label">Location <span style="color:var(--danger);">*</span></div>
            <select id="stravaSpotId" onchange="stravaApplyPoolMode(this.value)">
                <option value="">Select location…</option>
                ${spotOptions}
            </select>
            ${a.matched_spot_name ? `<div style="font-size:11px;color:#fc4c02;margin-top:4px;">Matched from GPS: ${escapeHtml(a.matched_spot_name)}</div>` : ''}
        </div>

        <!-- Temperature -->
        <div class="form-group">
            <div class="form-label">Water temperature (°C) <span style="color:var(--danger);">*</span></div>
            <input type="number" id="stravaTemp" placeholder="e.g. 16" step="0.5" min="0" max="40">
        </div>

        <!-- Conditions -->
        <div class="form-group" id="stravaConditionsGroup">
            <div class="form-label">Conditions <span style="color:var(--danger);">*</span></div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;">
                ${CONDITIONS.map(c => `
                    <button type="button" onclick="stravaToggleCondition(this, '${c}')"
                        data-condition="${c}"
                        style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:var(--text-secondary);border-radius:20px;padding:7px 14px;font-size:13px;cursor:pointer;">
                        ${c}
                    </button>`).join('')}
            </div>
            <input type="hidden" id="stravaConditions">
        </div>

        <!-- Hazards -->
        <div class="form-group" id="stravaHazardsGroup">
            <div class="form-label">Hazards <span style="color:var(--text-secondary);font-weight:400;">(optional)</span></div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;">
                ${HAZARDS.map(h => `
                    <button type="button" onclick="stravaToggleHazard(this, '${h}')"
                        data-hazard="${h}"
                        style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:var(--text-secondary);border-radius:20px;padding:7px 14px;font-size:13px;cursor:pointer;">
                        ${h}
                    </button>`).join('')}
            </div>
        </div>

        <!-- Notes -->
        <div class="form-group">
            <div class="form-label">Notes <span style="color:var(--text-secondary);font-weight:400;">(optional)</span></div>
            <textarea id="stravaNotes" rows="3" placeholder="Anything else worth sharing with the community?" style="resize:vertical;"></textarea>
        </div>

        <button onclick="submitStravaLog()"
            style="width:100%;background:linear-gradient(135deg,#0284c7,#0ea5e9);color:white;border:none;border-radius:12px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;margin-top:4px;">
            Save SwimLoading Log
        </button>`;

    // Apply pool mode if the matched spot is a pool
    if (a.matched_spot_id) stravaApplyPoolMode(a.matched_spot_id);
}

let _selectedCondition = null;
const _selectedHazards = new Set();

function stravaApplyPoolMode(spotId) {
    const spot = (spots || []).find(s => String(s.id) === String(spotId));
    const isPool = spot && (spot.water_type === 'POOL' || spot.water_type === 'TIDAL_POOL');
    const condGroup  = document.getElementById('stravaConditionsGroup');
    const hazGroup   = document.getElementById('stravaHazardsGroup');
    const condInput  = document.getElementById('stravaConditions');
    if (!condGroup) return;
    if (isPool) {
        condGroup.style.display = 'none';
        hazGroup && (hazGroup.style.display = 'none');
        // Auto-set Calm silently
        _selectedCondition = 'Calm';
        if (condInput) condInput.value = 'Calm';
    } else {
        condGroup.style.display = '';
        hazGroup && (hazGroup.style.display = '');
    }
}

function stravaToggleCondition(btn, condition) {
    // Single-select conditions
    document.querySelectorAll('#stravaLogForm [data-condition]').forEach(b => {
        b.style.background    = 'rgba(255,255,255,0.06)';
        b.style.borderColor   = 'rgba(255,255,255,0.12)';
        b.style.color         = 'var(--text-secondary)';
    });
    btn.style.background  = 'rgba(56,189,248,0.2)';
    btn.style.borderColor = 'var(--ocean-light)';
    btn.style.color       = 'var(--ocean-light)';
    _selectedCondition = condition;
    document.getElementById('stravaConditions').value = condition;
}

function stravaToggleHazard(btn, hazard) {
    if (_selectedHazards.has(hazard)) {
        _selectedHazards.delete(hazard);
        btn.style.background  = 'rgba(255,255,255,0.06)';
        btn.style.borderColor = 'rgba(255,255,255,0.12)';
        btn.style.color       = 'var(--text-secondary)';
    } else {
        _selectedHazards.add(hazard);
        btn.style.background  = 'rgba(239,68,68,0.15)';
        btn.style.borderColor = 'rgba(239,68,68,0.5)';
        btn.style.color       = '#ef4444';
    }
}

async function submitStravaLog() {
    const activity = _selectedStravaActivity;
    if (!activity) return;

    const spotId     = document.getElementById('stravaSpotId')?.value?.trim();
    const temp       = document.getElementById('stravaTemp')?.value?.trim();
    const conditions = document.getElementById('stravaConditions')?.value?.trim();
    const notes      = document.getElementById('stravaNotes')?.value?.trim();

    if (!spotId)     { showToast('Please select a location.', 'error'); return; }
    if (!temp)       { showToast('Water temperature is required.', 'error'); return; }
    const selectedSpot = (spots || []).find(s => String(s.id) === String(spotId));
    const isPool = selectedSpot && (selectedSpot.water_type === 'POOL' || selectedSpot.water_type === 'TIDAL_POOL');
    if (!conditions && !isPool) { showToast('Please select conditions.', 'error'); return; }

    const btn = document.querySelector('#stravaLogForm button[onclick="submitStravaLog()"]');
    if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) throw new Error('No session');

        const res = await fetch('/api/strava/import-activity', {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
                strava_activity_id: activity.strava_activity_id,
                spot_id:            spotId,
                temperature:        parseFloat(temp),
                conditions,
                hazards:            [..._selectedHazards],
                notes,
                activity_name:      activity.name,
                start_date_local:   activity.start_date_local,
            }),
        });

        const data = await res.json();

        if (!res.ok) {
            if (data.error === 'already_imported') {
                showToast('This swim has already been imported.', 'info');
                closeStravaLogModal();
                return;
            }
            throw new Error(data.error || 'import_failed');
        }

        // Success
        closeStravaLogModal();
        dismissStravaBanner();
        _stravaActivitiesCache = null; // Invalidate cache

        // Mark the activity as imported in cached list
        showStravaSuccessModal();

        // Refresh dashboard so new log appears
        if (typeof loadDashboard === 'function') loadDashboard();

    } catch (err) {
        console.error('[strava] submitStravaLog error:', err);
        showToast('Could not save log. Please try again.', 'error');
        if (btn) { btn.textContent = 'Save SwimLoading Log'; btn.disabled = false; }
    }
}

function showStravaSuccessModal() {
    showToast('Swim logged from Strava! +10 points', 'success');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
