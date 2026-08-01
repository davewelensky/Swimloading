// ══════════════════════════════════════════════════════════════════════════════
// EO SWIMBETTER PERFORMANCE CHALLENGE  (Aug–Oct 2026)
// ══════════════════════════════════════════════════════════════════════════════
// Entirely separate from the monthly draw challenge in app-june.js and from the
// UK Swim Spot Challenge in app-uk-challenge.js — own table (eo_challenge_config
// / eo_challenge_active_days), own RPCs, no shared points. Open to every member
// automatically, no opt-in: every real temp log already calls
// record_eo_active_day() (see app.js submitTempLog), which records that day as
// "active" for this challenge if it falls inside the config window.
//
// Mechanic (see partners/eolab.html for the full public copy):
//   Log at least 30 active days across 1 Aug – 31 Oct 2026 to qualify. Up to
//   eo_challenge_config.draw_pool_cap (20) of the most-consistent swimmers who
//   clear that bar enter an equal-chance draw. Prize: eo SwimBETTER90 handset +
//   1-year Gold Membership + 1-on-1 data session with an eo expert, US$1,349.
// ══════════════════════════════════════════════════════════════════════════════

let eoConfig = null;
let eoConfigLoaded = false;

async function eoInit() {
    if (eoConfigLoaded) return eoConfig;
    try {
        const { data } = await supabaseClient
            .from('eo_challenge_config')
            .select('*')
            .eq('id', 1)
            .single();
        eoConfig = data;
    } catch (e) {
        eoConfig = null;
    }
    eoConfigLoaded = true;
    return eoConfig;
}

function eoIsActive() {
    if (!eoConfig || !eoConfig.enabled) return false;
    if (eoConfig.test_mode) {
        return Array.isArray(eoConfig.tester_ids) && currentUser && eoConfig.tester_ids.includes(currentUser.id);
    }
    const today = new Date().toISOString().slice(0, 10);
    return today >= eoConfig.launch_date && today <= eoConfig.end_date;
}

async function eoLoadDashboardCard() {
    const el = document.getElementById('dashEoChallenge');
    if (!el || !currentUser) return;
    await eoInit();
    if (!eoConfig) return;

    if (!eoIsActive()) {
        // Pre-launch teaser only in the 14 days before launch — avoids noise
        // while dates are still provisional (mirrors app-uk-challenge.js).
        const launch = eoConfig.launch_date ? new Date(eoConfig.launch_date + 'T00:00:00') : null;
        const daysAway = launch ? Math.ceil((launch - new Date()) / 86400000) : null;
        if (daysAway !== null && daysAway > 0 && daysAway <= 14) {
            el.innerHTML = `
            <a href="/partners/eolab" style="display:block;text-decoration:none;cursor:pointer;background:linear-gradient(135deg,#1a0f08,#080f1a);border:2px solid rgba(249,115,22,0.4);border-radius:16px;overflow:hidden;">
              <div style="height:3px;background:linear-gradient(90deg,#f97316,#10b981);"></div>
              <div style="padding:16px;">
                <div style="font-size:11px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">eo SwimBETTER Performance Challenge</div>
                <div style="font-weight:800;font-size:18px;color:#f1f5f9;">Starts in ${daysAway} day${daysAway !== 1 ? 's' : ''}</div>
                <div style="font-size:12px;color:#64748b;margin-top:4px;">3 months · US$1,349 prize — the handset used by Olympic swimmers</div>
              </div>
            </a>`;
            initIcons();
        } else {
            el.innerHTML = '';
        }
        return;
    }

    try {
        const { data: leaders } = await supabaseClient.rpc('get_eo_challenge_leaders');
        const mine = (leaders || []).find(r => r.user_id === currentUser.id);
        const activeDays = mine?.total_active_days || 0;
        const streak = mine?.longest_streak || 0;
        const qualifyAt = eoConfig.qualify_min_active_days || 30;
        const qualified = activeDays >= qualifyAt;
        const pct = Math.min(100, Math.round((activeDays / qualifyAt) * 100));

        const end = new Date(eoConfig.end_date + 'T00:00:00');
        const daysLeft = Math.max(0, Math.ceil((end - new Date()) / 86400000));

        const statusLine = qualified
            ? `<div style="font-size:12px;color:#10b981;font-weight:700;margin-top:6px;display:flex;align-items:center;gap:5px;"><i data-lucide="check-circle" style="width:13px;height:13px;"></i>In the running — top ${eoConfig.draw_pool_cap || 20} most consistent enter the draw</div>`
            : `<div style="font-size:12px;color:#f97316;font-weight:600;margin-top:6px;">${qualifyAt - activeDays} more active day${qualifyAt - activeDays !== 1 ? 's' : ''} to qualify</div>`;

        el.innerHTML = `
        <a href="/partners/eolab" style="display:block;text-decoration:none;background:linear-gradient(135deg,#1a0f08,#080f1a);border:2px solid rgba(249,115,22,0.4);border-radius:16px;overflow:hidden;">
          <div style="height:3px;background:linear-gradient(90deg,#f97316,#10b981);"></div>
          <div style="padding:16px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;">
              <div>
                <div style="font-size:11px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;">eo SwimBETTER Performance Challenge</div>
                <div style="font-weight:800;font-size:17px;color:#f1f5f9;line-height:1.2;">US$1,349 · handset + 1yr Gold + 1-on-1 session</div>
              </div>
              <div style="text-align:right;flex-shrink:0;">
                <div style="font-size:20px;font-weight:900;color:#f97316;line-height:1;">${daysLeft}</div>
                <div style="font-size:9px;color:rgba(249,115,22,0.7);text-transform:uppercase;letter-spacing:0.5px;">days left</div>
              </div>
            </div>
            <div style="background:rgba(255,255,255,0.06);border-radius:20px;height:6px;overflow:hidden;margin-bottom:6px;">
              <div style="background:linear-gradient(90deg,#f97316,#10b981);height:100%;width:${pct}%;border-radius:20px;"></div>
            </div>
            <div style="font-size:12px;color:#94a3b8;">${activeDays}/${qualifyAt} active days${streak > 1 ? ` · ${streak}-day best streak` : ''}</div>
            ${statusLine}
          </div>
        </a>`;
        initIcons();
    } catch (e) {
        console.warn('eoLoadDashboardCard error:', e);
    }
}
