// ══════════════════════════════════════════════════════════════════════════════
// THE GREAT UK SWIM SPOT CHALLENGE  (× TRI HARD)
// ══════════════════════════════════════════════════════════════════════════════
// Entirely separate from the monthly draw challenge in app-june.js — different
// tables (campaigns / campaign_participants / campaign_location_credits /
// campaign_events / campaign_admin_flags / campaign_location_proposals), no
// shared code, no shared points. A UK swim earns points here independently of
// whatever the monthly challenge is doing.
//
// Scoring is 10 points per UNIQUE UK location logged (not distance/speed).
// All scoring goes through award_campaign_location (Postgres SECURITY DEFINER) —
// the UNIQUE(campaign_id,user_id,spot_id) constraint on campaign_location_credits
// is what actually enforces "unique location", not this client code.
//
// Live on/off comes from the DB row `campaigns` (slug='uk_swim_spot_challenge'):
//   test_mode=true  → date window is bypassed (still requires enabled=true)
//   enabled=false   → hidden entirely except a pre-launch "coming soon" teaser
// ══════════════════════════════════════════════════════════════════════════════

const UK_CHALLENGE_SLUG = 'uk_swim_spot_challenge';
let ukConfig = null;
let ukConfigLoaded = false;

// ── Init ─────────────────────────────────────────────────────────────────────

async function ukInit() {
    if (ukConfigLoaded) return ukConfig;
    try {
        const { data } = await supabaseClient
            .from('campaigns')
            .select('*')
            .eq('slug', UK_CHALLENGE_SLUG)
            .single();
        ukConfig = data;
    } catch (e) {
        ukConfig = null;
    }
    ukConfigLoaded = true;
    return ukConfig;
}

function ukIsActive() {
    if (!ukConfig || !ukConfig.enabled) return false;
    if (ukConfig.test_mode) {
        return Array.isArray(ukConfig.tester_ids) && currentUser && ukConfig.tester_ids.includes(currentUser.id);
    }
    const today = new Date().toISOString().slice(0, 10);
    return today >= ukConfig.launch_date && today <= ukConfig.end_date;
}

async function ukHasJoined() {
    if (!ukConfig || !currentUser) return false;
    const { data } = await supabaseClient
        .from('campaign_participants')
        .select('id')
        .eq('campaign_id', ukConfig.id)
        .eq('user_id', currentUser.id)
        .maybeSingle();
    return !!data;
}

// ── Dashboard card ───────────────────────────────────────────────────────────

async function ukLoadDashboardCard() {
    const el = document.getElementById('dashUkChallenge');
    if (!el || !currentUser) return;
    await ukInit();

    if (!ukConfig) return;

    if (!ukIsActive()) {
        // Pre-launch teaser only in the 14 days before launch — avoids noise
        // while dates are still provisional.
        const launch = ukConfig.launch_date ? new Date(ukConfig.launch_date + 'T00:00:00') : null;
        const daysAway = launch ? Math.ceil((launch - new Date()) / 86400000) : null;
        if (daysAway !== null && daysAway > 0 && daysAway <= 14) {
            el.innerHTML = `
            <a href="/uk-challenge" style="display:block;text-decoration:none;cursor:pointer;background:linear-gradient(135deg,#0c1520,#080f1a);border:1px solid rgba(56,189,248,0.3);border-radius:16px;overflow:hidden;">
              <div style="height:3px;background:linear-gradient(90deg,#0284c7,#38bdf8,#7dd3fc);"></div>
              <div style="padding:16px;">
                <div style="font-size:11px;font-weight:700;color:#38bdf8;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">The Great UK Swim Spot Challenge</div>
                <div style="font-weight:800;font-size:18px;color:#f1f5f9;">Starts in ${daysAway} day${daysAway !== 1 ? 's' : ''}</div>
                <div style="font-size:12px;color:#64748b;margin-top:4px;">Presented by TRI HARD — 10 points per unique UK swim spot</div>
              </div>
            </a>`;
            initIcons();
        } else {
            el.innerHTML = '';
        }
        return;
    }

    try {
        const joined = await ukHasJoined();

        if (!joined) {
            el.innerHTML = `
            <div style="background:linear-gradient(135deg,#0c1520,#080f1a);border:1px solid rgba(56,189,248,0.3);border-radius:16px;overflow:hidden;">
              <div style="height:3px;background:linear-gradient(90deg,#0284c7,#38bdf8,#7dd3fc);"></div>
              <div style="padding:16px;">
                <div style="font-size:11px;font-weight:700;color:#38bdf8;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">The Great UK Swim Spot Challenge</div>
                <div style="font-weight:800;font-size:17px;color:#f1f5f9;margin-bottom:6px;">Explore UK swim spots. Earn points.</div>
                <div style="font-size:12px;color:#64748b;margin-bottom:14px;">10 points per unique outdoor UK location — presented by TRI HARD</div>
                <button class="btn" onclick="ukShowJoinModal()" style="width:100%;background:linear-gradient(135deg,#0284c7,#0ea5e9);color:white;font-weight:700;font-size:14px;padding:12px;border-radius:50px;border:none;">Join the Challenge</button>
              </div>
            </div>`;
            initIcons();
            return;
        }

        const { data: leaders } = await supabaseClient.rpc('get_campaign_leaders', { p_campaign_id: ukConfig.id });
        const mine = (leaders || []).find(r => r.user_id === currentUser.id);
        const uniqueLocations = mine?.unique_locations || 0;
        const totalPoints = mine?.total_points || 0;

        el.innerHTML = `
        <a href="/uk-challenge" style="display:block;text-decoration:none;background:linear-gradient(135deg,#0c1520,#080f1a);border:1px solid rgba(56,189,248,0.3);border-radius:16px;overflow:hidden;">
          <div style="height:3px;background:linear-gradient(90deg,#0284c7,#38bdf8,#7dd3fc);"></div>
          <div style="padding:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div>
              <div style="font-size:11px;font-weight:700;color:#38bdf8;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">UK Swim Spot Challenge</div>
              <div style="font-weight:800;font-size:18px;color:#f1f5f9;">${uniqueLocations} location${uniqueLocations !== 1 ? 's' : ''} · ${totalPoints} pts</div>
              <div style="font-size:12px;color:#64748b;margin-top:2px;">Tap to view the leaderboard &amp; map</div>
            </div>
            <i data-lucide="map-pin" style="width:22px;height:22px;color:#38bdf8;flex-shrink:0;"></i>
          </div>
        </a>`;
        initIcons();
    } catch (e) {
        console.warn('ukLoadDashboardCard error:', e);
    }
}

// ── Join flow (explicit consent — no silent auto-join) ──────────────────────

function ukShowJoinModal() {
    if (document.getElementById('ukJoinOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'ukJoinOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10020;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:#0d1728;border:1px solid rgba(56,189,248,0.25);border-radius:16px;max-width:420px;width:100%;padding:24px;">
        <div style="font-size:11px;font-weight:700;color:#38bdf8;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;">Join the Challenge</div>
        <div style="font-size:16px;font-weight:800;color:#f1f5f9;margin-bottom:12px;">The Great UK Swim Spot Challenge</div>
        <div style="font-size:13px;color:#94a3b8;line-height:1.6;margin-bottom:16px;">
          Earn 10 points for every unique outdoor UK swim location you log — from a quick dip to a long crossing, every spot counts.
          Prize and winner-selection details will be announced before the challenge ends.
        </div>
        <label style="display:flex;align-items:flex-start;gap:10px;font-size:12.5px;color:#94a3b8;line-height:1.5;margin-bottom:18px;cursor:pointer;">
          <input type="checkbox" id="ukConsentCheck" style="margin-top:2px;flex-shrink:0;">
          <span>I agree to the challenge rules and understand my swim locations may be shown (display name only) on the public leaderboard and live feed.</span>
        </label>
        <div style="display:flex;gap:10px;">
          <button class="btn" onclick="ukCloseJoinModal()" style="flex:1;background:transparent;border:1px solid rgba(255,255,255,0.15);color:#f1f5f9;font-weight:600;padding:12px;border-radius:50px;">Cancel</button>
          <button class="btn" id="ukJoinConfirmBtn" onclick="ukConfirmJoin()" style="flex:1;background:linear-gradient(135deg,#0284c7,#0ea5e9);color:white;font-weight:700;padding:12px;border-radius:50px;border:none;">Join</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
}

function ukCloseJoinModal() {
    const overlay = document.getElementById('ukJoinOverlay');
    if (overlay) overlay.remove();
}

async function ukConfirmJoin() {
    const consent = document.getElementById('ukConsentCheck');
    if (!consent || !consent.checked) {
        showToast('Please agree to the challenge rules first', 'error');
        return;
    }
    const btn = document.getElementById('ukJoinConfirmBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Joining...'; }

    try {
        await ukInit();
        const { data, error } = await supabaseClient.rpc('join_campaign', {
            p_campaign_id: ukConfig.id,
            p_user_id: currentUser.id,
        });
        if (error || !data?.joined) {
            showToast('Could not join right now — try again shortly', 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Join'; }
            return;
        }
        ukCloseJoinModal();
        showToast('You\'re in! Log a UK swim to start earning points.', 'success');
        if (typeof analytics !== 'undefined') analytics.track('uk_challenge_joined');
        ukLoadDashboardCard();
    } catch (e) {
        console.warn('ukConfirmJoin error:', e);
        showToast('Could not join right now — try again shortly', 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Join'; }
    }
}

// ── Scoring hook — called from app.js right after a temp_logs insert ────────
// Independent of jcAwardPoints (June system) — both fire off the same log event.
async function ukChallengeAwardLocation(logId) {
    if (!logId || !currentUser) return;
    try {
        await ukInit();
        if (!ukConfig || !ukIsActive()) return;

        const { data, error } = await supabaseClient.rpc('award_campaign_location', {
            p_campaign_id: ukConfig.id,
            p_user_id: currentUser.id,
            p_log_id: logId,
        });
        if (error) { console.warn('ukChallengeAwardLocation error:', error); return; }

        if (data?.awarded) {
            showToast(`+${data.points} points — new UK spot: ${data.spot_name}!`, 'success');
            if (typeof analytics !== 'undefined') analytics.track('uk_challenge_location_earned', { spot_name: data.spot_name });
            ukLoadDashboardCard();
        } else if (data?.reason === 'already_credited_this_spot') {
            if (typeof analytics !== 'undefined') analytics.track('uk_challenge_swim_logged', { spot_name: data.spot_name, repeat: true });
        }
        // Silent no-op for not-joined / not-eligible / outside-window — the swim
        // still logs normally either way, this is purely additive.
    } catch (e) {
        console.warn('ukChallengeAwardLocation error:', e);
    }
}
