        // ── June Community Challenge ────────────────────────────────────────────────
        // Feature-flagged via june_challenge_config table (id=1)
        // test_mode=true  → visible to all logged-in users, labelled TEST
        // test_mode=false → live publicly, 1 Jun – 30 Jun 2026
        //
        // Hooks in app.js call jcAwardPoints() after each scoring action.
        // This file owns: config loading, scoring, feed, leaderboard, overlay UI.
        // ────────────────────────────────────────────────────────────────────────────

        let jcConfig = null;
        let jcConfigLoaded = false;
        let jcMyScore = null; // { points, rank, personAboveName, personAbovePts }

        const JC_POINTS = {
            temp_log:       10,
            create_swim:    25,
            attend_swim:    20,
            new_spot:       15,
            hazard_report:  15,
            whatsapp_share:  5,
            streak_3day:    20,
            dormant_spot:   30,
            group_bonus:    10,
        };

        const JC_ACTION_LABELS = {
            temp_log:       'Log conditions',
            create_swim:    'Create a community swim',
            attend_swim:    'Attend a swim',
            new_spot:       'Log a new spot first',
            hazard_report:  'Report a hazard',
            whatsapp_share: 'Share to WhatsApp',
            streak_3day:    '3-day logging streak',
            dormant_spot:   'Activate dormant spot (30+ days)',
            group_bonus:    '3+ swimmers at a swim',
        };

        // ── Init & config ───────────────────────────────────────────────────────────

        async function jcInit() {
            if (jcConfigLoaded) return jcConfig;
            try {
                const { data } = await supabaseClient
                    .from('june_challenge_config')
                    .select('*')
                    .eq('id', 1)
                    .single();
                jcConfig = data;
            } catch (e) {
                jcConfig = null;
            }
            jcConfigLoaded = true;
            return jcConfig;
        }

        function jcIsActive() {
            if (!jcConfig || !jcConfig.enabled) return false;
            if (jcConfig.test_mode) {
                // Test mode: only show to whitelisted testers
                if (!currentUser) return false;
                const ids = jcConfig.tester_ids || [];
                return ids.includes(currentUser.id);
            }
            // Live mode: anyone, within the challenge window
            const now = new Date();
            const start = new Date(jcConfig.launch_date + 'T00:00:00');
            const end   = new Date(jcConfig.end_date   + 'T23:59:59');
            return now >= start && now <= end;
        }

        function jcDateRange() {
            const launch = jcConfig?.launch_date || '2026-06-01';
            const close  = jcConfig?.end_date    || '2026-06-30';
            return {
                start: new Date(launch + 'T00:00:00'),
                end:   new Date(close  + 'T23:59:59'),
            };
        }

        // ── Award points (called from app.js after each action) ─────────────────────

        async function jcAwardPoints(actionType, opts = {}) {
            // opts: { spotId, spotName, refId, temp, metadata }
            await jcInit(); // ensure config is loaded before checking isActive
            if (!jcIsActive()) return;
            if (!currentUser) return;

            const pts = JC_POINTS[actionType];
            if (!pts) return;

            const displayName = currentUserProfile?.display_name || 'Swimmer';

            try {
                const { error } = await supabaseClient.from('june_challenge_events').insert({
                    user_id:      currentUser.id,
                    display_name: displayName,
                    action_type:  actionType,
                    points:       pts,
                    spot_id:      opts.spotId   || null,
                    spot_name:    opts.spotName || null,
                    ref_id:       opts.refId    || null,
                    metadata:     opts.metadata || {},
                });
                if (error) { console.warn('jcAwardPoints insert error:', error); return; }

                // Check for automatic bonus events
                const bonuses = [];
                if (actionType === 'temp_log') {
                    const [streakBonus, dormantBonus] = await Promise.all([
                        jcCheckStreak3Day(),
                        opts.spotId ? jcCheckDormantSpot(opts.spotId) : Promise.resolve(false),
                    ]);
                    if (streakBonus) bonuses.push({ type: 'streak_3day' });
                    if (dormantBonus) bonuses.push({ type: 'dormant_spot' });
                }

                for (const b of bonuses) {
                    await supabaseClient.from('june_challenge_events').insert({
                        user_id:      currentUser.id,
                        display_name: displayName,
                        action_type:  b.type,
                        points:       JC_POINTS[b.type],
                        spot_id:      opts.spotId   || null,
                        spot_name:    opts.spotName || null,
                        metadata:     {},
                    });
                }

                // Reload my score then show feedback
                const score = await jcGetMyScore();
                const totalPts = pts + bonuses.reduce((s, b) => s + JC_POINTS[b.type], 0);
                jcShowPostActionFeedback(actionType, totalPts, score, bonuses, opts);

                // Refresh dashboard card non-blocking
                jcLoadDashboardCard();

            } catch (e) {
                console.warn('jcAwardPoints error:', e);
            }
        }

        // ── Streak & dormant bonus checks ────────────────────────────────────────────

        async function jcCheckStreak3Day() {
            try {
                const today     = new Date(); today.setHours(0, 0, 0, 0);
                const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
                const dayBefore = new Date(today); dayBefore.setDate(dayBefore.getDate() - 2);
                const threeDaysAgo = new Date(today); threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

                const { data: logs } = await supabaseClient
                    .from('temp_logs')
                    .select('logged_at, created_at')
                    .eq('user_id', currentUser.id)
                    .gte('created_at', threeDaysAgo.toISOString())
                    .order('created_at', { ascending: false });

                if (!logs || logs.length < 3) return false;

                const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
                const logDays = new Set(logs.map(l => {
                    const d = new Date(l.logged_at || l.created_at);
                    return dayKey(d);
                }));
                if (!logDays.has(dayKey(today)) || !logDays.has(dayKey(yesterday)) || !logDays.has(dayKey(dayBefore))) return false;

                // Already awarded today?
                const { data: existing } = await supabaseClient
                    .from('june_challenge_events')
                    .select('id')
                    .eq('user_id', currentUser.id)
                    .eq('action_type', 'streak_3day')
                    .gte('created_at', today.toISOString())
                    .limit(1);
                return !existing || existing.length === 0;
            } catch (e) { return false; }
        }

        async function jcCheckDormantSpot(spotId) {
            try {
                const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                // Get the last 2 logs at this spot — first is current, second is previous
                const { data: logs } = await supabaseClient
                    .from('temp_logs')
                    .select('created_at')
                    .eq('spot_id', spotId)
                    .order('created_at', { ascending: false })
                    .limit(2);
                if (!logs || logs.length === 0) return false;
                if (logs.length === 1) return false; // Only this log — never dormant
                const prevLog = new Date(logs[1].created_at);
                return prevLog < thirtyDaysAgo;
            } catch (e) { return false; }
        }

        // ── Post-action feedback ─────────────────────────────────────────────────────

        function jcShowPostActionFeedback(actionType, totalPts, score, bonuses, opts) {
            let toastParts = [`+${totalPts} pts`];

            if (bonuses.find(b => b.type === 'streak_3day'))  toastParts.push('3-day streak!');
            if (bonuses.find(b => b.type === 'dormant_spot')) toastParts.push('Spot reactivated!');

            if (score?.rank) toastParts.push(`You're #${score.rank}`);

            showToast(toastParts.join(' · '), 'success');

            // Offer WhatsApp share for meaningful actions
            if (['temp_log', 'create_swim', 'attend_swim'].includes(actionType)) {
                setTimeout(() => jcShowSharePrompt(actionType, opts, score), 1400);
            }
        }

        // ── WhatsApp share ───────────────────────────────────────────────────────────

        function jcBuildShareText(actionType, opts, score) {
            const base = 'https://swimloading.com/app';
            switch (actionType) {
                case 'temp_log':
                    return opts.spotName
                        ? `I just logged ${opts.temp ? opts.temp + '°C at ' : 'conditions at '}${opts.spotName} on SwimLoading. June Challenge is live! ${base}`
                        : `Just shared swim conditions on SwimLoading. June Challenge is live! ${base}`;
                case 'create_swim':
                    return `I just created a community swim${opts.spotName ? ' at ' + opts.spotName : ''} on SwimLoading. Come join! ${base}`;
                case 'attend_swim':
                    return `I'm swimming${opts.spotName ? ' at ' + opts.spotName : ''} this June. Join the SwimLoading Community Challenge! ${base}`;
                default:
                    return score?.rank && score.rank <= 10
                        ? `I'm #${score.rank} on the June Challenge leaderboard on SwimLoading! ${base}`
                        : `June Community Challenge is live on SwimLoading! ${base}`;
            }
        }

        function jcShowSharePrompt(actionType, opts, score) {
            const el = document.getElementById('jcSharePrompt');
            if (!el) return;

            const text  = jcBuildShareText(actionType, opts, score);
            const waUrl = 'https://wa.me/?text=' + encodeURIComponent(text);

            el.innerHTML = `
            <div onclick="jcDoWhatsAppShare('${encodeURIComponent(waUrl)}')"
                 style="display:flex;align-items:center;gap:10px;padding:11px 14px;background:rgba(37,211,102,0.1);border:1px solid rgba(37,211,102,0.28);border-radius:12px;cursor:pointer;margin-top:8px;">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="#25d366" style="flex-shrink:0;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              <span style="font-size:13px;font-weight:600;color:#25d366;flex:1;">Share to WhatsApp</span>
              <span style="font-size:11px;color:var(--text-secondary);">+${JC_POINTS.whatsapp_share} pts</span>
              <button onclick="event.stopPropagation();this.closest('[onclick]').remove();"
                style="background:none;border:none;color:var(--text-secondary);font-size:16px;cursor:pointer;padding:0;line-height:1;margin-left:4px;">&times;</button>
            </div>`;
            el.style.display = 'block';
            setTimeout(() => { if (el) el.style.display = 'none'; }, 10000);
        }

        async function jcDoWhatsAppShare(encodedUrl) {
            const el = document.getElementById('jcSharePrompt');
            if (el) el.style.display = 'none';
            window.open(decodeURIComponent(encodedUrl), '_blank');
            // Award share points — max 3 per day
            await jcAwardSharePoints();
        }

        async function jcAwardSharePoints() {
            if (!currentUser) return;
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const { data: todayShares } = await supabaseClient
                .from('june_challenge_events')
                .select('id')
                .eq('user_id', currentUser.id)
                .eq('action_type', 'whatsapp_share')
                .gte('created_at', today.toISOString())
                .limit(3);
            if (todayShares && todayShares.length >= 3) return;
            await supabaseClient.from('june_challenge_events').insert({
                user_id:      currentUser.id,
                display_name: currentUserProfile?.display_name || 'Swimmer',
                action_type:  'whatsapp_share',
                points:       JC_POINTS.whatsapp_share,
                metadata:     {},
            });
            jcLoadDashboardCard();
        }

        // ── My score ────────────────────────────────────────────────────────────────

        async function jcGetMyScore() {
            if (!currentUser || !jcIsActive()) return null;
            try {
                const { start, end } = jcDateRange();

                const { data: all } = await supabaseClient
                    .from('june_challenge_events')
                    .select('user_id, display_name, points')
                    .gte('created_at', start.toISOString())
                    .lte('created_at', end.toISOString());

                const byUser = {};
                for (const row of (all || [])) {
                    if (!byUser[row.user_id]) byUser[row.user_id] = { display_name: row.display_name, points: 0 };
                    byUser[row.user_id].points += row.points;
                }
                const sorted = Object.entries(byUser).sort((a, b) => b[1].points - a[1].points);
                const myIdx  = sorted.findIndex(([uid]) => uid === currentUser.id);
                const myPts  = myIdx >= 0 ? sorted[myIdx][1].points : 0;
                const myRank = myIdx >= 0 ? myIdx + 1 : null;

                let personAboveName = null, personAbovePts = null;
                if (myIdx > 0) {
                    personAboveName = sorted[myIdx - 1][1].display_name;
                    personAbovePts  = sorted[myIdx - 1][1].points;
                }

                jcMyScore = { points: myPts, rank: myRank, personAboveName, personAbovePts };
                return jcMyScore;
            } catch (e) { return null; }
        }

        // ── Dashboard card ───────────────────────────────────────────────────────────

        async function jcLoadDashboardCard() {
            const el = document.getElementById('dashMonthlyChallenge');
            if (!el) return;
            await jcInit();

            if (!jcIsActive()) {
                // Show "coming soon" ribbon if June is within 14 days
                const now = new Date();
                const juneStart = jcConfig?.launch_date
                    ? new Date(jcConfig.launch_date + 'T00:00:00')
                    : new Date('2026-06-01');
                const daysAway = Math.ceil((juneStart - now) / 86400000);
                if (daysAway > 0 && daysAway <= 14) {
                    el.innerHTML = `
                    <div onclick="showPage('leaderboard')" style="cursor:pointer;background:linear-gradient(135deg,rgba(56,189,248,0.08),rgba(2,132,199,0.06));border:1px solid rgba(56,189,248,0.2);border-radius:14px;padding:14px 16px;">
                      <div style="font-size:10px;font-weight:700;color:var(--ocean-light);text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;">June Community Challenge</div>
                      <div style="font-weight:800;font-size:15px;color:var(--text);">Starts in ${daysAway} day${daysAway !== 1 ? 's' : ''}</div>
                      <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">Custom THEMAGIC5 goggles · Maurten · Blu Smooth</div>
                    </div>`;
                    initIcons();
                }
                return;
            }

            try {
                const score = await jcGetMyScore();
                const { end } = jcDateRange();
                const daysLeft = Math.max(0, Math.ceil((end - new Date()) / 86400000));

                const testBadge = jcConfig?.test_mode
                    ? `<span style="background:rgba(245,158,11,0.2);color:#f59e0b;font-size:9px;font-weight:700;padding:2px 7px;border-radius:10px;text-transform:uppercase;letter-spacing:0.5px;margin-left:6px;">TEST</span>`
                    : '';

                let scoreLine;
                if (score?.rank && score.points > 0) {
                    const gapLine = score.personAboveName
                        ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${score.personAbovePts - score.points} pts behind ${score.personAboveName}</div>`
                        : `<div style="font-size:11px;color:#10b981;margin-top:2px;">You're leading — hold on!</div>`;
                    scoreLine = `<div style="font-size:17px;font-weight:800;color:var(--text);line-height:1.2;">#${score.rank} &middot; ${score.points} pts</div>${gapLine}`;
                } else {
                    scoreLine = `<div style="font-size:13px;color:var(--text-secondary);">Log or join a swim to earn points</div>`;
                }

                el.innerHTML = `
                <div onclick="jcOpenOverlay()" style="cursor:pointer;background:linear-gradient(135deg,rgba(14,116,144,0.12),rgba(2,132,199,0.08));border:1px solid rgba(56,189,248,0.3);border-radius:14px;padding:16px;">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:11px;">
                    <div style="flex:1;min-width:0;">
                      <div style="font-size:10px;font-weight:700;color:var(--ocean-light);text-transform:uppercase;letter-spacing:0.7px;margin-bottom:3px;">June Challenge · Live${testBadge}</div>
                      ${scoreLine}
                    </div>
                    <div style="flex-shrink:0;margin-left:12px;">
                      <div style="background:rgba(56,189,248,0.15);color:var(--ocean-light);font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap;">${daysLeft}d left</div>
                    </div>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;padding:8px 11px;background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.14);border-radius:10px;margin-bottom:11px;">
                    <i data-lucide="trophy" style="width:14px;height:14px;color:var(--ocean-light);flex-shrink:0;"></i>
                    <div style="font-size:12px;color:var(--text);font-weight:600;">Custom THEMAGIC5 goggles</div>
                    <div style="font-size:11px;color:var(--text-secondary);margin-left:auto;">Grand prize</div>
                  </div>
                  <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ocean-light);font-weight:600;">
                    <i data-lucide="activity" style="width:13px;height:13px;"></i>
                    View live feed + leaderboard
                    <i data-lucide="chevron-right" style="width:13px;height:13px;margin-left:auto;"></i>
                  </div>
                </div>
                <div id="jcSharePrompt" style="display:none;"></div>`;
                initIcons();
            } catch (e) {
                console.warn('jcLoadDashboardCard error:', e);
            }
        }

        // ── Board tab section (shown inside monthlyChallenge div) ────────────────────

        async function jcLoadBoardSection() {
            const el = document.getElementById('monthlyChallenge');
            if (!el) return;
            await jcInit();
            if (!jcIsActive()) return;

            el.innerHTML = `<div style="text-align:center;padding:14px;color:var(--text-secondary);font-size:13px;">Loading June Challenge…</div>`;

            try {
                const { start, end } = jcDateRange();
                const now = new Date();
                const daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));

                const [lbRes, myRes] = await Promise.all([
                    supabaseClient
                        .from('june_challenge_events')
                        .select('user_id, display_name, points')
                        .gte('created_at', start.toISOString())
                        .lte('created_at', end.toISOString()),
                    currentUser
                        ? supabaseClient
                            .from('june_challenge_events')
                            .select('points')
                            .eq('user_id', currentUser.id)
                            .gte('created_at', start.toISOString())
                            .lte('created_at', end.toISOString())
                        : Promise.resolve({ data: [] }),
                ]);

                const byUser = {};
                for (const r of (lbRes.data || [])) {
                    if (!byUser[r.user_id]) byUser[r.user_id] = { display_name: r.display_name, points: 0 };
                    byUser[r.user_id].points += r.points;
                }
                const sorted = Object.entries(byUser).sort((a, b) => b[1].points - a[1].points);
                const myPts  = (myRes.data || []).reduce((s, r) => s + r.points, 0);
                const myIdx  = sorted.findIndex(([uid]) => uid === currentUser?.id);

                const testBadge = jcConfig?.test_mode
                    ? `<span style="background:rgba(245,158,11,0.2);color:#f59e0b;font-size:9px;font-weight:700;padding:2px 7px;border-radius:10px;text-transform:uppercase;letter-spacing:0.5px;margin-left:6px;">TEST</span>`
                    : '';

                let myPositionCard = '';
                if (myIdx >= 0 && myPts > 0) {
                    const above = myIdx > 0 ? sorted[myIdx - 1] : null;
                    const gapLine = above
                        ? `${above[1].points - myPts} pts behind ${above[1].display_name}`
                        : "You're leading!";
                    myPositionCard = `
                    <div style="background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);border-radius:10px;padding:12px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;">
                      <div>
                        <div style="font-size:13px;font-weight:700;color:var(--text);">You're #${myIdx+1} &middot; ${myPts} pts</div>
                        <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${gapLine}</div>
                      </div>
                      <div style="font-size:15px;font-weight:800;color:${myIdx<3?'#fbbf24':'var(--text-secondary)'};">#${myIdx+1}</div>
                    </div>`;
                }

                el.innerHTML = `
                <div style="background:linear-gradient(135deg,rgba(14,116,144,0.1),rgba(125,211,252,0.06));border:1px solid rgba(125,211,252,0.3);border-radius:14px;padding:18px;margin-bottom:4px;">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
                    <div>
                      <div style="font-size:10px;color:#7dd3fc;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:3px;">June Community Challenge${testBadge}</div>
                      <div style="font-weight:800;font-size:17px;color:var(--text);line-height:1.2;">Log &middot; Swim &middot; Win THEMAGIC5</div>
                    </div>
                    <div style="background:rgba(125,211,252,0.15);color:#7dd3fc;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap;flex-shrink:0;">${daysLeft}d left</div>
                  </div>

                  <!-- Prizes -->
                  <div style="display:flex;gap:6px;margin-bottom:14px;">
                    <div style="background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.22);border-radius:8px;padding:8px 10px;font-size:11px;font-weight:700;color:var(--ocean-light);flex:1;text-align:center;">
                      <div>Custom Goggles</div><div style="font-weight:400;color:var(--text-secondary);margin-top:1px;">THEMAGIC5</div>
                    </div>
                    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:8px 10px;font-size:11px;font-weight:600;color:var(--text);flex:1;text-align:center;">
                      <div>Maurten Pack</div><div style="font-weight:400;color:var(--text-secondary);margin-top:1px;">2nd</div>
                    </div>
                    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:8px 10px;font-size:11px;font-weight:600;color:var(--text);flex:1;text-align:center;">
                      <div>Blu Smooth</div><div style="font-weight:400;color:var(--text-secondary);margin-top:1px;">3rd</div>
                    </div>
                  </div>

                  ${myPositionCard}

                  <div style="display:flex;align-items:center;gap:6px;font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.7px;margin-bottom:8px;">
                    <i data-lucide="trophy" style="width:12px;height:12px;color:#7dd3fc;"></i>Leaderboard
                  </div>
                  <div style="background:rgba(15,23,42,0.5);border-radius:10px;padding:10px;">
                    ${jcRenderLeaderboard(sorted.slice(0, 20), myIdx, myPts)}
                  </div>

                  <!-- How to earn (collapsible) -->
                  <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-top:12px;">
                    <div onclick="const b=this.nextElementSibling;b.style.display=b.style.display==='block'?'none':'block';this.querySelector('i').style.transform=b.style.display==='block'?'rotate(180deg)':'';"
                         style="cursor:pointer;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;background:rgba(15,23,42,0.4);">
                      <div style="font-size:13px;font-weight:700;color:var(--text);">How to earn points</div>
                      <i data-lucide="chevron-down" style="width:15px;height:15px;color:var(--text-secondary);transition:transform 0.2s;"></i>
                    </div>
                    <div style="display:none;padding:12px 14px;background:rgba(15,23,42,0.3);border-top:1px solid var(--border);">
                      ${Object.entries(JC_ACTION_LABELS).map(([k, label]) => `
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                          <span style="font-size:13px;color:var(--text);">${label}</span>
                          <span style="font-size:13px;font-weight:700;color:var(--ocean-light);white-space:nowrap;margin-left:12px;">+${JC_POINTS[k]}</span>
                        </div>`).join('')}
                      <div style="font-size:11px;color:var(--text-secondary);margin-top:10px;line-height:1.5;">
                        Every point is also a raffle entry — so every swimmer has a chance to win the THEMAGIC5 goggles.
                      </div>
                    </div>
                  </div>

                  <!-- Live feed button -->
                  <button onclick="jcOpenOverlay()" style="width:100%;margin-top:12px;padding:11px;border-radius:24px;border:1px solid rgba(56,189,248,0.3);background:rgba(56,189,248,0.06);color:var(--ocean-light);font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
                    <i data-lucide="activity" style="width:15px;height:15px;"></i>Live Activity Feed
                  </button>
                </div>`;

                initIcons();
            } catch (e) {
                console.warn('jcLoadBoardSection error:', e);
                el.innerHTML = `<div style="text-align:center;color:var(--text-secondary);padding:16px;">Could not load June Challenge</div>`;
            }
        }

        // ── Leaderboard renderer (shared) ────────────────────────────────────────────

        function jcRenderLeaderboard(sorted, myIdx, myPts) {
            if (!sorted.length) {
                return '<div style="text-align:center;color:var(--text-secondary);padding:16px;font-size:13px;">No entries yet — be the first!</div>';
            }
            const MEDALS = ['#fbbf24', '#94a3b8', '#cd7c2f'];
            const rows = sorted.map(([uid, data], i) => {
                const isMe   = currentUser && uid === currentUser.id;
                const isTop3 = i < 3;
                const iconEl = i === 0
                    ? `<i data-lucide="crown"  style="width:15px;height:15px;color:${MEDALS[0]};flex-shrink:0;"></i>`
                    : isTop3
                    ? `<i data-lucide="medal"  style="width:15px;height:15px;color:${MEDALS[i]};flex-shrink:0;"></i>`
                    : `<span style="font-size:11px;font-weight:700;width:15px;text-align:center;color:var(--text-secondary);flex-shrink:0;">${i+1}</span>`;
                const bg     = isTop3 ? `rgba(${['251,191,36','148,163,184','205,124,47'][i]},0.08)` : isMe ? 'rgba(56,189,248,0.08)' : 'transparent';
                const border = isTop3 ? `rgba(${['251,191,36','148,163,184','205,124,47'][i]},0.22)` : isMe ? 'rgba(56,189,248,0.22)' : 'transparent';
                const ptColor = isTop3 ? MEDALS[i] : 'var(--ocean-light)';
                return `<div style="display:flex;align-items:center;gap:9px;padding:${isTop3?'11px 12px':'8px 10px'};background:${bg};border:1px solid ${border};border-radius:10px;margin-bottom:5px;">
                  ${iconEl}
                  <span style="font-size:${isTop3?'14px':'13px'};font-weight:${isMe||isTop3?'700':'400'};color:${isMe?'var(--ocean-light)':'var(--text)'};flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${data.display_name || 'Swimmer'}${isMe?' <span style="font-size:10px;color:var(--text-secondary);font-weight:400;">(you)</span>':''}</span>
                  <span style="font-size:${isTop3?'14px':'13px'};font-weight:700;color:${ptColor};flex-shrink:0;">${data.points}</span>
                </div>`;
            }).join('');

            const fallback = myIdx < 0 && currentUser
                ? `<div style="text-align:center;font-size:12px;color:var(--text-secondary);margin-top:8px;">${myPts > 0 ? `You have ${myPts} pts` : 'Log conditions to get on the board!'}</div>`
                : '';
            return rows + fallback;
        }

        // ── Overlay (full-screen panel) ──────────────────────────────────────────────

        function jcOpenOverlay() {
            const overlay = document.getElementById('jcOverlay');
            if (!overlay) return;
            overlay.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            jcLoadOverlayContent();
        }

        function jcCloseOverlay() {
            const overlay = document.getElementById('jcOverlay');
            if (overlay) overlay.style.display = 'none';
            document.body.style.overflow = '';
        }

        async function jcLoadOverlayContent() {
            const lbEl   = document.getElementById('jcOverlayLb');
            const feedEl = document.getElementById('jcOverlayFeed');
            if (!lbEl || !feedEl) return;

            lbEl.innerHTML   = '<div style="text-align:center;color:var(--text-secondary);padding:16px;font-size:13px;">Loading…</div>';
            feedEl.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:16px;font-size:13px;">Loading…</div>';

            const { start, end } = jcDateRange();
            try {
                const [lbRes, feedRes] = await Promise.all([
                    supabaseClient
                        .from('june_challenge_events')
                        .select('user_id, display_name, points')
                        .gte('created_at', start.toISOString())
                        .lte('created_at', end.toISOString()),
                    supabaseClient
                        .from('june_challenge_events')
                        .select('user_id, display_name, action_type, points, spot_name, created_at')
                        .gte('created_at', start.toISOString())
                        .lte('created_at', end.toISOString())
                        .order('created_at', { ascending: false })
                        .limit(60),
                ]);

                const byUser = {};
                for (const r of (lbRes.data || [])) {
                    if (!byUser[r.user_id]) byUser[r.user_id] = { display_name: r.display_name, points: 0 };
                    byUser[r.user_id].points += r.points;
                }
                const sorted = Object.entries(byUser).sort((a, b) => b[1].points - a[1].points);
                const myPts  = byUser[currentUser?.id]?.points || 0;
                const myIdx  = sorted.findIndex(([uid]) => uid === currentUser?.id);

                lbEl.innerHTML   = jcRenderLeaderboard(sorted.slice(0, 20), myIdx, myPts);
                feedEl.innerHTML = jcRenderFeed(feedRes.data || []);
                initIcons();
            } catch (e) {
                lbEl.innerHTML   = '<div style="text-align:center;color:var(--text-secondary);padding:16px;">Could not load</div>';
                feedEl.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:16px;">Could not load</div>';
            }
        }

        // ── Feed renderer ────────────────────────────────────────────────────────────

        function jcRenderFeed(events) {
            if (!events.length) {
                return '<div style="text-align:center;color:var(--text-secondary);padding:20px;font-size:13px;">No activity yet — be the first!</div>';
            }

            const ICONS = {
                temp_log:       { icon: 'thermometer',    bg: '56,189,248' },
                create_swim:    { icon: 'calendar-plus',  bg: '16,185,129' },
                attend_swim:    { icon: 'check-circle',   bg: '16,185,129' },
                hazard_report:  { icon: 'alert-triangle', bg: '239,68,68'  },
                new_spot:       { icon: 'map-pin',        bg: '245,158,11' },
                whatsapp_share: { icon: 'share-2',        bg: '37,211,102' },
                streak_3day:    { icon: 'zap',            bg: '245,158,11' },
                dormant_spot:   { icon: 'sunrise',        bg: '167,139,250'},
                group_bonus:    { icon: 'users',          bg: '16,185,129' },
            };

            const TEMPLATES = {
                temp_log:       e => e.spot_name ? `${e.display_name} logged temp at ${e.spot_name}` : `${e.display_name} logged conditions`,
                create_swim:    e => e.spot_name ? `${e.display_name} created a swim at ${e.spot_name}` : `${e.display_name} created a community swim`,
                attend_swim:    e => e.spot_name ? `${e.display_name} joined a swim at ${e.spot_name}` : `${e.display_name} joined a swim`,
                hazard_report:  e => e.spot_name ? `${e.display_name} reported a hazard at ${e.spot_name}` : `${e.display_name} reported a hazard`,
                new_spot:       e => e.spot_name ? `${e.display_name} logged ${e.spot_name} for the first time` : `${e.display_name} logged a new spot`,
                whatsapp_share: e => `${e.display_name} shared to WhatsApp`,
                streak_3day:    e => `${e.display_name} hit a 3-day streak`,
                dormant_spot:   e => e.spot_name ? `${e.display_name} activated ${e.spot_name} after 30+ days` : `${e.display_name} activated a dormant spot`,
                group_bonus:    () => 'Community swim bonus — 3+ swimmers!',
            };

            return events.slice(0, 40).map(e => {
                const cfg    = ICONS[e.action_type] || { icon: 'activity', bg: '56,189,248' };
                const label  = (TEMPLATES[e.action_type] || (ev => ev.action_type))(e);
                const timeAgo = jcTimeAgo(new Date(e.created_at));
                const isMe   = currentUser && e.user_id === currentUser.id;
                return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                  <div style="width:28px;height:28px;border-radius:8px;background:rgba(${cfg.bg},0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;">
                    <i data-lucide="${cfg.icon}" style="width:14px;height:14px;color:rgb(${cfg.bg});"></i>
                  </div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;color:${isMe ? 'var(--ocean-light)' : 'var(--text)'};font-weight:${isMe ? '600' : '400'};line-height:1.4;">${label}</div>
                    <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${timeAgo} &middot; +${e.points} pts</div>
                  </div>
                </div>`;
            }).join('');
        }

        function jcTimeAgo(date) {
            const secs = Math.floor((Date.now() - date) / 1000);
            if (secs < 60)    return 'just now';
            if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
            if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
            return `${Math.floor(secs / 86400)}d ago`;
        }

        // ── Test mode: seed data ─────────────────────────────────────────────────────

        async function jcSeedTestData() {
            if (!jcConfig?.test_mode) { showToast('Not in test mode', 'error'); return; }
            if (!currentUser) { showToast('Must be logged in', 'error'); return; }

            const displayName = currentUserProfile?.display_name || 'Test User';
            const demoSpots   = ['Clifton 4th', 'Big Bay', 'Sea Point Tidal Pool', 'Camps Bay', 'Muizenberg'];
            const actions     = [
                { type: 'temp_log',    pts: 10, spot: demoSpots[0], hoursAgo: 0 },
                { type: 'temp_log',    pts: 10, spot: demoSpots[1], hoursAgo: 2 },
                { type: 'create_swim', pts: 25, spot: demoSpots[2], hoursAgo: 4 },
                { type: 'attend_swim', pts: 20, spot: demoSpots[3], hoursAgo: 6 },
                { type: 'streak_3day', pts: 20, spot: demoSpots[0], hoursAgo: 1 },
                { type: 'dormant_spot',pts: 30, spot: demoSpots[4], hoursAgo: 3 },
            ];

            const rows = actions.map(a => ({
                user_id:      currentUser.id,
                display_name: displayName,
                action_type:  a.type,
                points:       a.pts,
                spot_name:    a.spot,
                metadata:     {},
                created_at:   new Date(Date.now() - a.hoursAgo * 3600000).toISOString(),
            }));

            const { error } = await supabaseClient.from('june_challenge_events').insert(rows);
            if (error) { showToast('Seed failed: ' + error.message, 'error'); return; }
            showToast(`Seeded ${rows.length} test events`, 'success');
            jcLoadDashboardCard();
            if (document.getElementById('jcOverlay')?.style.display === 'flex') {
                jcLoadOverlayContent();
            }
        }

        // ── Admin debug panel ────────────────────────────────────────────────────────

        async function jcLoadAdminDebug(containerId) {
            const el = document.getElementById(containerId || 'jcAdminDebug');
            if (!el) return;
            await jcInit();

            const { start, end } = jcDateRange();
            const { data } = await supabaseClient
                .from('june_challenge_events')
                .select('action_type, points, user_id, display_name, created_at, spot_name')
                .gte('created_at', start.toISOString())
                .lte('created_at', end.toISOString())
                .order('created_at', { ascending: false })
                .limit(200);

            if (!data?.length) {
                el.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;text-align:center;padding:16px;">No events yet</div>
                <button onclick="jcSeedTestData()" style="display:block;margin:8px auto;padding:8px 16px;border-radius:8px;border:1px solid rgba(245,158,11,0.3);background:rgba(245,158,11,0.1);color:#f59e0b;font-size:12px;cursor:pointer;">Seed Test Data</button>`;
                return;
            }

            const byAction  = {};
            data.forEach(r => { byAction[r.action_type] = (byAction[r.action_type] || 0) + 1; });
            const totalPts   = data.reduce((s, r) => s + r.points, 0);
            const uniqueUsers = new Set(data.map(r => r.user_id)).size;

            el.innerHTML = `
            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">
              Events: <strong style="color:var(--text);">${data.length}</strong> &middot;
              Users: <strong style="color:var(--text);">${uniqueUsers}</strong> &middot;
              Total pts: <strong style="color:var(--ocean-light);">${totalPts}</strong>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;">
              ${Object.entries(byAction).map(([k,v]) => `<span style="background:rgba(56,189,248,0.1);color:var(--ocean-light);font-size:11px;padding:3px 8px;border-radius:6px;">${k}: ${v}</span>`).join('')}
            </div>
            <div style="max-height:280px;overflow-y:auto;font-size:12px;">
              ${data.slice(0, 60).map(r => `<div style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                <span style="color:var(--ocean-light);">${r.display_name || '?'}</span>
                <span style="color:var(--text-secondary);"> &middot; ${r.action_type} &middot; +${r.points}pts</span>
                ${r.spot_name ? `<span style="color:rgba(255,255,255,0.4);"> &middot; ${r.spot_name}</span>` : ''}
                <span style="color:rgba(255,255,255,0.25);"> &middot; ${jcTimeAgo(new Date(r.created_at))}</span>
              </div>`).join('')}
            </div>
            <div style="display:flex;gap:8px;margin-top:10px;">
              <button onclick="jcSeedTestData()" style="padding:8px 14px;border-radius:8px;border:1px solid rgba(245,158,11,0.3);background:rgba(245,158,11,0.1);color:#f59e0b;font-size:12px;cursor:pointer;flex:1;">Seed Test Data</button>
              <button onclick="jcLoadAdminDebug('${containerId || 'jcAdminDebug'}')" style="padding:8px 14px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text-secondary);font-size:12px;cursor:pointer;flex:1;">Refresh</button>
            </div>`;
        }

        // ── Group bonus detection (call after swim attendance updates) ───────────────

        // ── Overlay tab switcher ─────────────────────────────────────────────────────

        function jcSetTab(tab) {
            const feedPanel = document.getElementById('jcOverlayFeedPanel');
            const lbPanel   = document.getElementById('jcOverlayLbPanel');
            const feedBtn   = document.getElementById('jcTabFeed');
            const lbBtn     = document.getElementById('jcTabLb');
            if (!feedPanel || !lbPanel) return;

            const active   = 'border:1px solid rgba(56,189,248,0.35);background:rgba(56,189,248,0.12);color:var(--ocean-light);font-size:13px;font-weight:700;cursor:pointer;flex:1;padding:9px;border-radius:10px;';
            const inactive = 'border:1px solid rgba(255,255,255,0.08);background:transparent;color:var(--text-secondary);font-size:13px;font-weight:600;cursor:pointer;flex:1;padding:9px;border-radius:10px;';

            if (tab === 'feed') {
                feedPanel.style.display = 'block';
                lbPanel.style.display   = 'none';
                if (feedBtn) feedBtn.style.cssText = active;
                if (lbBtn)   lbBtn.style.cssText   = inactive;
            } else {
                feedPanel.style.display = 'none';
                lbPanel.style.display   = 'block';
                if (feedBtn) feedBtn.style.cssText = inactive;
                if (lbBtn)   lbBtn.style.cssText   = active;
            }
        }

        // ── Group bonus detection ────────────────────────────────────────────────────

        async function jcCheckGroupBonus(swimEventId) {
            if (!jcIsActive() || !swimEventId) return;
            try {
                const { count } = await supabaseClient
                    .from('swim_participants')
                    .select('*', { count: 'exact', head: true })
                    .eq('swim_event_id', swimEventId)
                    .in('status', ['approved']);

                if (count < 3) return;

                // Check if group bonus already awarded for this event
                const { data: existing } = await supabaseClient
                    .from('june_challenge_events')
                    .select('id')
                    .eq('action_type', 'group_bonus')
                    .eq('ref_id', swimEventId)
                    .limit(1);
                if (existing && existing.length > 0) return;

                // Award to current user only (they triggered it)
                await supabaseClient.from('june_challenge_events').insert({
                    user_id:      currentUser.id,
                    display_name: currentUserProfile?.display_name || 'Swimmer',
                    action_type:  'group_bonus',
                    points:       JC_POINTS.group_bonus,
                    ref_id:       swimEventId,
                    metadata:     { participant_count: count },
                });
                showToast(`+${JC_POINTS.group_bonus} pts · 3+ swimmers at this swim!`, 'success');
            } catch (e) { console.warn('jcCheckGroupBonus error:', e); }
        }
