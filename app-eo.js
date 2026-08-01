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

// ── Board tab section ────────────────────────────────────────────────────────
// A 3-month challenge can't lean on "you're close to winning" this early —
// almost nobody will be. So this view leans on momentum instead: how many
// people are already building toward it, a live feed of it happening right
// now, and a "week X of Y" framing so the 30-day bar reads as a journey
// already in motion, not a hole to climb out of.

async function eoLoadBoardSection() {
    const el = document.getElementById('eoBoardSection');
    if (!el) return;
    await eoInit();
    if (!eoConfig || !eoIsActive()) { el.innerHTML = ''; return; }

    el.innerHTML = `<div style="text-align:center;padding:14px;color:var(--text-secondary);font-size:13px;">Loading eo SwimBETTER Challenge…</div>`;

    try {
        const [{ data: leaders }, { data: activity }] = await Promise.all([
            supabaseClient.rpc('get_eo_challenge_leaders'),
            supabaseClient.rpc('get_eo_challenge_activity', { p_limit: 6 }),
        ]);

        const rows = leaders || [];
        const feed = activity || [];
        const qualifyAt = eoConfig.qualify_min_active_days || 30;
        const cap = eoConfig.draw_pool_cap || 20;
        const qualifiedCount = rows.filter(r => r.total_active_days >= qualifyAt).length;

        const launch = new Date(eoConfig.launch_date + 'T00:00:00');
        const end = new Date(eoConfig.end_date + 'T00:00:00');
        const now = new Date();
        const totalWeeks = Math.max(1, Math.ceil((end - launch) / (7 * 86400000)));
        const weekNum = Math.min(totalWeeks, Math.max(1, Math.floor((now - launch) / (7 * 86400000)) + 1));
        const daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));

        const mine = currentUser ? rows.find(r => r.user_id === currentUser.id) : null;
        const myDays = mine?.total_active_days || 0;
        const myStreak = mine?.longest_streak || 0;
        const myQualified = myDays >= qualifyAt;

        // 1. My status — the reachable personal goal, framed as weeks not a raw count
        let mine_html = '';
        if (myQualified) {
            mine_html = `<div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);border-radius:12px;padding:14px 16px;margin-bottom:14px;">
              <div style="font-size:15px;font-weight:800;color:#10b981;display:flex;align-items:center;gap:5px;"><i data-lucide="check-circle" style="width:15px;height:15px;"></i>You're locked in for the draw</div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;line-height:1.5;">${myDays} active days logged${myStreak > 1 ? ` · ${myStreak}-day best streak` : ''}. Keep logging — every finalist under the cap gets an equal shot regardless of days beyond the bar.</div>
            </div>`;
        } else if (currentUser) {
            const toGo = Math.max(0, qualifyAt - myDays);
            const pct = Math.min(100, Math.round((myDays / qualifyAt) * 100));
            mine_html = `<div style="background:rgba(249,115,22,0.08);border:1px solid rgba(249,115,22,0.28);border-radius:12px;padding:14px 16px;margin-bottom:14px;">
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
                <div style="font-size:14px;font-weight:800;color:var(--text);">Week ${weekNum} of ${totalWeeks}</div>
                <div style="font-size:12px;color:#f97316;font-weight:700;">${myDays}/${qualifyAt} active days</div>
              </div>
              <div style="height:7px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;margin-bottom:6px;"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#f97316,#10b981);border-radius:4px;"></div></div>
              <div style="font-size:12px;color:#f97316;font-weight:600;">${toGo > 0 ? toGo + ' more active ' + (toGo === 1 ? 'day' : 'days') + ' and you\\'re locked in' : "You're in!"}</div>
            </div>`;
        }

        // 2. Momentum — how many people are already on this journey
        const momentum = `<div style="text-align:center;padding:2px 0 12px;">
          <div style="font-size:13px;color:var(--text);"><strong style="color:#f97316;font-size:16px;">${rows.length}</strong> ${rows.length === 1 ? 'swimmer' : 'swimmers'} building toward the draw &middot; <strong style="color:#10b981;">${qualifiedCount}</strong> already locked in</div>
          <div style="font-size:11px;color:var(--text-secondary);margin-top:4px;line-height:1.5;">Top ${cap} most consistent swimmers who clear ${qualifyAt} active days enter an equal-chance draw at the end.</div>
        </div>`;

        // 3. Live feed — proof it's happening right now
        const FEED_SPOT = e => e.spot_name ? `${e.display_name} logged an active day at ${e.spot_name}` : `${e.display_name} logged an active day`;
        const feedHtml = feed.length
            ? `<div style="margin-bottom:14px;">
                ${feed.map(f => `<div style="display:flex;align-items:center;gap:9px;padding:8px 12px;background:rgba(249,115,22,0.05);border:1px solid rgba(249,115,22,0.12);border-radius:10px;margin-bottom:5px;">
                    <div style="width:6px;height:6px;border-radius:50%;background:#f97316;flex-shrink:0;box-shadow:0 0 8px rgba(249,115,22,0.7);"></div>
                    <div style="font-size:12px;color:#94a3b8;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${FEED_SPOT(f)}</div>
                    <div style="font-size:11px;color:#334155;flex-shrink:0;">${typeof jcTimeAgo === 'function' ? jcTimeAgo(new Date(f.created_at)) : ''}</div>
                   </div>`).join('')}
              </div>`
            : '';

        // 4. Who's building toward it — avatar wall, belonging not ranking
        let wall;
        if (rows.length) {
            const avatars = rows.slice(0, 40).map(r => {
                const c = typeof jcFeedAvatarColor === 'function' ? jcFeedAvatarColor(r.user_id) : '249,115,22';
                const isMe = currentUser && r.user_id === currentUser.id;
                const initials = typeof jcInitials === 'function' ? jcInitials(r.display_name).toUpperCase() : (r.display_name || '?').slice(0, 2).toUpperCase();
                return `<div title="${(r.display_name || 'Swimmer').replace(/"/g, '')} · ${r.total_active_days} active days" style="width:36px;height:36px;border-radius:50%;background:rgba(${c},0.16);border:${isMe ? '2px solid #f97316' : '1px solid rgba(' + c + ',0.3)'};display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:rgb(${c});">${initials}</div>`;
            }).join('');
            wall = `<div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.7px;margin:4px 0 10px;">Building toward it</div>
              <div style="display:flex;flex-wrap:wrap;gap:7px;">${avatars}</div>`;
        } else {
            wall = `<div style="padding:20px 16px;text-align:center;font-size:13px;color:var(--text-secondary);line-height:1.6;">No active days logged yet.<br>Be the first swimmer building toward the eo draw.</div>`;
        }

        el.innerHTML = `
        <div style="background:linear-gradient(135deg,rgba(249,115,22,0.08),rgba(16,185,129,0.05));border:1px solid rgba(249,115,22,0.3);border-radius:14px;padding:18px;margin-bottom:4px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
            <div>
              <div style="font-size:10px;color:#f97316;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:3px;">eo SwimBETTER Performance Challenge</div>
              <div style="font-weight:800;font-size:17px;color:var(--text);line-height:1.2;">A 3-month commitment. One winner.</div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;line-height:1.4;">Every real swim you log between 1 Aug and 31 Oct counts as an active day. Show up consistently — this one rewards the long game.</div>
            </div>
            <div style="background:rgba(249,115,22,0.15);color:#f97316;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap;flex-shrink:0;">${daysLeft}d left</div>
          </div>

          <!-- Prize -->
          <div style="margin-bottom:14px;">
            <div style="background:linear-gradient(135deg,rgba(249,115,22,0.12),rgba(16,185,129,0.07));border:1px solid rgba(249,115,22,0.3);border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">
              <div>
                <div style="font-size:12px;font-weight:700;color:#f97316;">Grand Prize — eo SwimBETTER90</div>
                <div style="font-size:11px;color:#10b981;margin-top:2px;">Handset + 1yr Gold Membership + 1-on-1 session · US$1,349</div>
              </div>
              <div style="font-size:11px;font-weight:700;color:#f97316;white-space:nowrap;margin-left:12px;">1 winner</div>
            </div>
          </div>

          ${mine_html}
          ${feedHtml}

          <div style="background:rgba(15,23,42,0.5);border-radius:10px;padding:12px;">
            ${momentum}
            ${wall}
          </div>

          <!-- How it works (collapsible) -->
          <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-top:12px;">
            <div onclick="const b=this.nextElementSibling;b.style.display=b.style.display==='block'?'none':'block';this.querySelector('i').style.transform=b.style.display==='block'?'rotate(180deg)':'';"
                 style="cursor:pointer;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;background:rgba(15,23,42,0.4);">
              <div style="font-size:13px;font-weight:700;color:var(--text);">How it works</div>
              <i data-lucide="chevron-down" style="width:15px;height:15px;color:var(--text-secondary);transition:transform 0.2s;"></i>
            </div>
            <div style="display:none;padding:12px 14px;background:rgba(15,23,42,0.3);border-top:1px solid var(--border);font-size:12px;color:var(--text-secondary);line-height:1.7;">
              Open to every SwimLoading member, no opt-in needed — every real temp log during the window counts. Log at least ${qualifyAt} active days across the 3 months to qualify (roughly 2-3 swims a week). Up to ${cap} of the most consistent swimmers who clear that bar enter an equal-chance draw — logging more than ${qualifyAt} days doesn't buy extra odds, it's about showing up, not stacking. Winner drawn after 31 October.<br><br>
              <a href="/partners/eolab" style="color:#f97316;text-decoration:none;font-weight:700;">Full details on the challenge page →</a>
            </div>
          </div>
        </div>`;
        initIcons();
    } catch (e) {
        console.warn('eoLoadBoardSection error:', e);
        el.innerHTML = `<div style="text-align:center;color:var(--text-secondary);padding:16px;">Could not load eo SwimBETTER Challenge</div>`;
    }
}
