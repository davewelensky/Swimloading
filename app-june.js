        // ── June Community Challenge v2 ──────────────────────────────────────────────
        // Feature-flagged via june_challenge_config table (id=1)
        // test_mode=true  → visible to tester_ids only, labelled TEST
        // test_mode=false → live publicly, 1 Jun – 30 Jun 2026
        //
        // All scoring goes through award_challenge_points RPC (Postgres SECURITY DEFINER).
        // The RPC inserts into challenge_points_audit (audit trail) and
        // june_challenge_events (live feed). No direct client inserts.
        //
        // Hooks in app.js call jcAwardPoints() after each scoring action.
        // ────────────────────────────────────────────────────────────────────────────

        let jcConfig = null;
        let jcConfigLoaded = false;
        let jcMyScore = null;

        // Points and labels come from the DB (june_challenge_config columns).
        // These JS constants are display-only — the authoritative values are in the DB.
        const JC_POINTS = {
            temp_log:       15,
            create_swim:    15,
            join_swim:      20,
            creator_bonus:  10,
            whatsapp_share:  5,
            streak_3day:    20,
            streak_7day:    50,
        };

        const JC_ACTION_LABELS = {
            temp_log:       'Log a temp',
            create_swim:    'Create a swim',
            join_swim:      'Join a swim',
            creator_bonus:  'Someone joins your swim',
            whatsapp_share: 'Share to WhatsApp',
            streak_3day:    '3-day logging streak',
            streak_7day:    '7-day logging streak',
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
                if (!currentUser) return false;
                const ids = jcConfig.tester_ids || [];
                return ids.includes(currentUser.id);
            }
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

        // ── Award points (calls server-side RPC) ─────────────────────────────────────
        // opts: { spotId, spotName, refId, temp, metadata }
        // Returns the RPC result: { awarded, points, total_points, draw_entries, reason }

        async function jcAwardPoints(actionType, opts = {}) {
            await jcInit();
            if (!jcIsActive()) return null;
            if (!currentUser) return null;

            const sourceTableMap = {
                temp_log:       'temp_logs',
                create_swim:    'swim_events',
                join_swim:      'swim_participants',
                creator_bonus:  'swim_events',
                whatsapp_share: 'share_conversions',
                streak_3day:    null,
                streak_7day:    null,
            };

            const metadata = {};
            if (opts.spotId)   metadata.spot_id   = opts.spotId;
            if (opts.spotName) metadata.spot_name = opts.spotName;
            if (opts.temp)     metadata.temp       = opts.temp;
            if (opts.metadata) Object.assign(metadata, opts.metadata);

            try {
                const { data: result, error } = await supabaseClient.rpc('award_challenge_points', {
                    p_user_id:          currentUser.id,
                    p_action_type:      actionType,
                    p_source_table:     sourceTableMap[actionType] || null,
                    p_source_record_id: opts.refId || null,
                    p_metadata:         metadata,
                });

                if (error) {
                    console.warn('jcAwardPoints RPC error:', error);
                    return null;
                }

                if (result?.awarded) {
                    const score = await jcGetMyScore();
                    jcShowPostActionFeedback(actionType, result.points, result.draw_entries, score, opts);
                    jcLoadDashboardCard();
                } else if (result?.reason === 'already_earned_today') {
                    // Silent — user already knows they logged today
                } else if (result?.reason === 'own_swim') {
                    // Silent — expected when creator joins own swim
                }

                return result;
            } catch (e) {
                console.warn('jcAwardPoints error:', e);
                return null;
            }
        }

        // ── Post-action feedback ─────────────────────────────────────────────────────

        function jcShowPostActionFeedback(actionType, pts, drawEntries, score, opts) {
            const parts = [`+${pts} pts`];
            if (drawEntries != null) parts.push(`${drawEntries} draw entries`);
            if (score?.rank)         parts.push(`#${score.rank}`);
            showToast(parts.join(' · '), 'success');

            if (['temp_log', 'create_swim', 'join_swim'].includes(actionType)) {
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
                    return `I just created a community swim${opts.spotName ? ' at ' + opts.spotName : ''} on SwimLoading. Join me! ${base}`;
                case 'join_swim':
                    return `I joined a community swim${opts.spotName ? ' at ' + opts.spotName : ''} on SwimLoading. Join the June Challenge! ${base}`;
                default:
                    return score?.rank && score.rank <= 10
                        ? `I'm #${score.rank} on the June Challenge leaderboard on SwimLoading! ${base}`
                        : `June Community Challenge is live on SwimLoading! Log. Swim. Share. Win. ${base}`;
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
            // Award share points via RPC (1 per day limit enforced server-side)
            await jcAwardPoints('whatsapp_share', {});
        }

        // ── My score (quick rank from june_challenge_events) ─────────────────────────

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
                const now = new Date();
                const juneStart = jcConfig?.launch_date
                    ? new Date(jcConfig.launch_date + 'T00:00:00')
                    : new Date('2026-06-01');
                const daysAway = Math.ceil((juneStart - now) / 86400000);
                if (daysAway > 0 && daysAway <= 14) {
                    el.innerHTML = `
                    <div onclick="showPage('leaderboard')" style="cursor:pointer;background:linear-gradient(135deg,#0c1520,#080f1a);border:1px solid rgba(251,191,36,0.3);border-radius:16px;overflow:hidden;">
                      <div style="height:3px;background:linear-gradient(90deg,#f59e0b,#fbbf24,#38bdf8);"></div>
                      <div style="padding:16px;">
                        <div style="font-size:11px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">June Community Challenge</div>
                        <div style="font-weight:800;font-size:18px;color:#f1f5f9;">Starts in ${daysAway} day${daysAway !== 1 ? 's' : ''}</div>
                        <div style="font-size:12px;color:#64748b;margin-top:4px;">Custom THEMAGIC5 goggles · R3,000 value</div>
                      </div>
                    </div>`;
                    initIcons();
                }
                return;
            }

            try {
                const { start, end } = jcDateRange();
                const daysLeft = Math.max(0, Math.ceil((end - new Date()) / 86400000));

                const [score, recentRes] = await Promise.all([
                    jcGetMyScore(),
                    supabaseClient
                        .from('june_challenge_events')
                        .select('display_name, action_type, spot_name, created_at, points')
                        .gte('created_at', start.toISOString())
                        .order('created_at', { ascending: false })
                        .limit(1),
                ]);

                const recent = recentRes.data?.[0] || null;
                el.innerHTML = jcRenderDashboardCard(score, daysLeft, recent);
                initIcons();
            } catch (e) {
                console.warn('jcLoadDashboardCard error:', e);
            }
        }

        function jcRenderDashboardCard(score, daysLeft, recent) {
            const testBadge = jcConfig?.test_mode
                ? `<span style="background:rgba(245,158,11,0.25);color:#f59e0b;font-size:9px;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:0.5px;margin-left:6px;vertical-align:middle;">TEST</span>`
                : '';

            let rankBlock;
            if (score?.rank && score.points > 0) {
                const isLeading = !score.personAboveName;
                const gap = isLeading ? 0 : score.personAbovePts - score.points;
                rankBlock = `
                <div style="background:linear-gradient(135deg,rgba(56,189,248,0.08),rgba(14,116,144,0.06));border:1px solid rgba(56,189,248,0.22);border-radius:12px;padding:14px 16px;margin-bottom:12px;display:flex;align-items:center;gap:12px;">
                  <div style="flex:1;">
                    <div style="font-size:34px;font-weight:900;color:#f1f5f9;line-height:1;letter-spacing:-1px;">#${score.rank}</div>
                    <div style="font-size:13px;color:#64748b;margin-top:4px;">${isLeading ? '<span style="color:#10b981;font-weight:700;">You\'re leading</span>' : `<span style="color:#f59e0b;font-weight:600;">${gap} pts behind ${score.personAboveName}</span>`}</div>
                  </div>
                  <div style="text-align:right;">
                    <div style="font-size:24px;font-weight:900;color:#38bdf8;line-height:1;">${score.points}</div>
                    <div style="font-size:11px;color:#475569;margin-top:2px;">points</div>
                  </div>
                </div>`;
            } else {
                rankBlock = `
                <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:13px 16px;margin-bottom:12px;">
                  <div style="font-size:13px;color:#475569;line-height:1.5;">Log a temp or join a swim to get on the board and enter the prize draw</div>
                </div>`;
            }

            const FEED_COPY = {
                temp_log:      e => e.spot_name ? `${e.display_name} logged ${e.spot_name}` : `${e.display_name} logged conditions`,
                create_swim:   e => `${e.display_name} created a swim`,
                join_swim:     e => `${e.display_name} joined a swim`,
                creator_bonus: e => `${e.display_name} got a creator bonus`,
                streak_3day:   e => `${e.display_name} hit a 3-day streak`,
                streak_7day:   e => `${e.display_name} hit a 7-day streak`,
                whatsapp_share:e => `${e.display_name} shared to WhatsApp`,
            };
            const liveRow = recent
                ? `<div style="display:flex;align-items:center;gap:9px;padding:9px 12px;background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.12);border-radius:10px;margin-bottom:12px;">
                    <div style="width:6px;height:6px;border-radius:50%;background:#ef4444;flex-shrink:0;box-shadow:0 0 8px rgba(239,68,68,0.7);"></div>
                    <div style="font-size:12px;color:#94a3b8;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${(FEED_COPY[recent.action_type] || (e => e.display_name))(recent)}</div>
                    <div style="font-size:11px;color:#334155;flex-shrink:0;">${jcTimeAgo(new Date(recent.created_at))}</div>
                   </div>`
                : '';

            return `
            <div onclick="jcOpenOverlay()" style="cursor:pointer;background:linear-gradient(160deg,#0c1520 0%,#070e18 100%);border:1px solid rgba(251,191,36,0.28);border-radius:16px;overflow:hidden;position:relative;">
              <div style="height:3px;background:linear-gradient(90deg,#b45309 0%,#f59e0b 40%,#fbbf24 60%,#38bdf8 100%);"></div>

              <div style="padding:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                  <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;">
                    <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;margin-right:5px;vertical-align:middle;box-shadow:0 0 6px rgba(16,185,129,0.6);"></span>June Challenge · Live${testBadge}
                  </div>
                  <div style="font-size:12px;font-weight:700;color:#f59e0b;">${daysLeft}d left</div>
                </div>

                <div style="border:1px solid rgba(251,191,36,0.3);border-radius:12px;overflow:hidden;margin-bottom:14px;">
                  <div style="position:relative;height:130px;overflow:hidden;">
                    <img src="/icons/tm5-hero.jpg" alt="" style="width:100%;height:100%;object-fit:cover;object-position:center 55%;display:block;" onerror="this.parentElement.style.background='linear-gradient(135deg,#1a0a00,#0d1728)'">
                    <div style="position:absolute;inset:0;background:linear-gradient(0deg,rgba(0,0,0,0.82) 0%,rgba(0,0,0,0.35) 55%,rgba(0,0,0,0) 100%);"></div>
                    <div style="position:absolute;inset:0;padding:10px 14px;display:flex;align-items:flex-end;justify-content:space-between;">
                      <div>
                        <div style="font-size:13px;font-weight:900;color:#fbbf24;letter-spacing:-0.2px;text-shadow:0 1px 4px rgba(0,0,0,0.9);">THEMAGIC5 Custom Goggles</div>
                        <div style="font-size:11px;color:#fde68a;font-weight:600;margin-top:2px;text-shadow:0 1px 3px rgba(0,0,0,0.9);">AI-fitted · R3,000 value · Grand prize</div>
                        <div style="font-size:10px;color:rgba(253,230,138,0.7);margin-top:2px;text-shadow:0 1px 3px rgba(0,0,0,0.9);">Every valid point = 1 prize draw entry</div>
                      </div>
                      <i data-lucide="trophy" style="width:22px;height:22px;color:#f59e0b;flex-shrink:0;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.9));margin-bottom:2px;"></i>
                    </div>
                  </div>
                </div>

                ${rankBlock}

                ${liveRow}

                <div style="display:flex;align-items:center;gap:8px;padding:11px 14px;border-radius:10px;background:rgba(251,191,36,0.07);border:1px solid rgba(251,191,36,0.25);">
                  <i data-lucide="activity" style="width:15px;height:15px;color:#f59e0b;"></i>
                  <span style="font-size:13px;font-weight:700;color:#f59e0b;">View live feed + leaderboard</span>
                  <i data-lucide="chevron-right" style="width:14px;height:14px;color:#f59e0b;margin-left:auto;"></i>
                </div>
              </div>
            </div>
            <div id="jcSharePrompt" style="display:none;"></div>`;
        }

        // ── Board tab section ────────────────────────────────────────────────────────

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

                // Use get_challenge_leaders RPC for authoritative leaderboard
                const { data: leaders, error: lbErr } = await supabaseClient.rpc('get_challenge_leaders');
                if (lbErr) throw lbErr;

                const sorted = (leaders || []);
                const myData = sorted.find(r => r.user_id === currentUser?.id);
                const myIdx  = sorted.findIndex(r => r.user_id === currentUser?.id);

                const testBadge = jcConfig?.test_mode
                    ? `<span style="background:rgba(245,158,11,0.2);color:#f59e0b;font-size:9px;font-weight:700;padding:2px 7px;border-radius:10px;text-transform:uppercase;letter-spacing:0.5px;margin-left:6px;">TEST</span>`
                    : '';

                let myPositionCard = '';
                if (myData && myData.total_points > 0) {
                    const above = myIdx > 0 ? sorted[myIdx - 1] : null;
                    const gapLine = above
                        ? `${above.total_points - myData.total_points} pts behind ${above.display_name}`
                        : "You're leading!";
                    const qualBadge = myData.qualified_for_draw
                        ? `<span style="font-size:10px;color:#10b981;font-weight:700;margin-left:6px;">Draw eligible</span>`
                        : '';
                    myPositionCard = `
                    <div style="background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);border-radius:10px;padding:12px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;">
                      <div>
                        <div style="font-size:13px;font-weight:700;color:var(--text);">You're #${myIdx+1} &middot; ${myData.total_points} pts${qualBadge}</div>
                        <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${gapLine} &middot; ${myData.draw_entries} draw entries</div>
                      </div>
                      <div style="font-size:15px;font-weight:800;color:${myIdx<3?'#fbbf24':'var(--text-secondary)'};">#${myIdx+1}</div>
                    </div>`;
                }

                el.innerHTML = `
                <div style="background:linear-gradient(135deg,rgba(14,116,144,0.1),rgba(125,211,252,0.06));border:1px solid rgba(125,211,252,0.3);border-radius:14px;padding:18px;margin-bottom:4px;">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
                    <div>
                      <div style="font-size:10px;color:#7dd3fc;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:3px;">June Community Challenge${testBadge}</div>
                      <div style="font-weight:800;font-size:17px;color:var(--text);line-height:1.2;">Log. Swim. Share. Win.</div>
                      <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;line-height:1.4;">Every valid point becomes a prize draw entry. The more you participate, the better your odds.</div>
                    </div>
                    <div style="background:rgba(125,211,252,0.15);color:#7dd3fc;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap;flex-shrink:0;">${daysLeft}d left</div>
                  </div>

                  <!-- Prize -->
                  <div style="margin-bottom:14px;">
                    <div style="background:linear-gradient(135deg,rgba(251,191,36,0.12),rgba(180,83,9,0.07));border:1px solid rgba(251,191,36,0.3);border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">
                      <div>
                        <div style="font-size:12px;font-weight:700;color:#fbbf24;">Grand Prize — THEMAGIC5</div>
                        <div style="font-size:11px;color:#d97706;margin-top:2px;">Custom Vector goggles · AI-fitted to your face · R3,000 value</div>
                      </div>
                      <div style="font-size:11px;font-weight:700;color:#fbbf24;white-space:nowrap;margin-left:12px;">1 winner</div>
                    </div>
                  </div>

                  ${myPositionCard}

                  <div style="display:flex;align-items:center;gap:6px;font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.7px;margin-bottom:8px;">
                    <i data-lucide="trophy" style="width:12px;height:12px;color:#7dd3fc;"></i>Leaderboard
                  </div>
                  <div style="background:rgba(15,23,42,0.5);border-radius:10px;padding:10px;">
                    ${jcRenderLeaderboard(sorted.slice(0, 20), myIdx, myData?.total_points || 0)}
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
                      <div style="margin-top:10px;font-size:11px;color:var(--text-secondary);line-height:1.6;">
                        The Magic5 winner will be drawn from qualified participants.<br>
                        <span style="color:rgba(100,116,139,0.7);">Fair play rules apply. Prize draw eligibility requires genuine participation.</span>
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

        // ── Leaderboard renderer ─────────────────────────────────────────────────────
        // Accepts array from get_challenge_leaders (objects) or old sorted array

        function jcRenderLeaderboard(sorted, myIdx, myPts) {
            if (!sorted.length) {
                return `<div style="padding:36px 16px;text-align:center;">
                  <div style="width:52px;height:52px;border-radius:50%;background:rgba(251,191,36,0.07);border:1px solid rgba(251,191,36,0.15);margin:0 auto 14px;display:flex;align-items:center;justify-content:center;">
                    <i data-lucide="trophy" style="width:22px;height:22px;color:rgba(251,191,36,0.45);"></i>
                  </div>
                  <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px;">No entries yet</div>
                  <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">Log a temp or join a swim<br>to get on the board.</div>
                </div>`;
            }

            // Normalise: supports both {user_id, display_name, total_points} objects
            // and legacy [[uid, {display_name, points}]] tuples
            const rows = sorted.map((item, i) => {
                let uid, name, pts, drawEntries, qualified, isDisq;
                if (Array.isArray(item)) {
                    uid = item[0]; name = item[1].display_name; pts = item[1].points;
                    drawEntries = null; qualified = null; isDisq = false;
                } else {
                    uid = item.user_id; name = item.display_name; pts = item.total_points;
                    drawEntries = item.draw_entries; qualified = item.qualified_for_draw; isDisq = item.disqualified;
                }

                const isMe   = currentUser && uid === currentUser.id;
                const maxPts = (Array.isArray(sorted[0]) ? sorted[0][1].points : sorted[0].total_points) || 1;
                const pct    = Math.max(4, Math.round((pts / maxPts) * 100));
                const aColor = jcFeedAvatarColor(uid);
                const ini    = jcInitials(name);

                const PODIUM = [
                    { border:'rgba(251,191,36,0.5)',  bg:'linear-gradient(135deg,rgba(251,191,36,0.12),rgba(180,83,9,0.07))',   color:'#fbbf24', icon:'crown', nameSize:'15px' },
                    { border:'rgba(148,163,184,0.4)', bg:'linear-gradient(135deg,rgba(148,163,184,0.09),rgba(100,116,139,0.05))', color:'#94a3b8', icon:'medal', nameSize:'14px' },
                    { border:'rgba(205,124,47,0.4)',  bg:'linear-gradient(135deg,rgba(205,124,47,0.09),rgba(154,88,22,0.05))',   color:'#cd7c2f', icon:'award', nameSize:'14px' },
                ];

                if (i < 3) {
                    const p = PODIUM[i];
                    const above = i > 0 ? (Array.isArray(sorted[i-1]) ? sorted[i-1][1].points : sorted[i-1].total_points) - pts : 0;
                    return `<div style="background:${p.bg};border:1px solid ${p.border};border-radius:13px;padding:13px 14px;margin-bottom:8px;${isDisq?'opacity:0.4;':''}">
                      <div style="display:flex;align-items:center;gap:11px;">
                        <div style="width:40px;height:40px;border-radius:50%;background:rgba(${aColor},0.15);border:2px solid ${p.border};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px;font-weight:800;color:rgb(${aColor});">${ini.toUpperCase()}</div>
                        <div style="flex:1;min-width:0;">
                          <div style="font-size:${p.nameSize};font-weight:800;color:${isMe ? 'var(--ocean-light)' : 'var(--text)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name || 'Swimmer'}${isMe ? ' <span style="font-size:10px;color:' + p.color + ';font-weight:600;">(you)</span>' : ''}${qualified ? ' <span style="font-size:9px;color:#10b981;">✓</span>' : ''}</div>
                          <div style="margin-top:6px;height:3px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
                            <div style="height:100%;width:${pct}%;background:${p.color};border-radius:2px;"></div>
                          </div>
                          ${above > 0 ? `<div style="font-size:10px;color:var(--text-secondary);margin-top:3px;">${above} pts to move up</div>` : i === 0 ? '<div style="font-size:10px;color:' + p.color + ';font-weight:700;margin-top:3px;">Leading</div>' : ''}
                        </div>
                        <div style="text-align:right;flex-shrink:0;">
                          <div style="font-size:${i === 0 ? '26px' : '20px'};font-weight:900;color:${p.color};line-height:1;letter-spacing:-1px;">${pts}</div>
                          <div style="font-size:10px;color:var(--text-secondary);margin-top:2px;">pts</div>
                        </div>
                        <i data-lucide="${p.icon}" style="width:${i === 0 ? '20px' : '17px'};height:${i === 0 ? '20px' : '17px'};color:${p.color};flex-shrink:0;"></i>
                      </div>
                    </div>`;
                }

                return `<div style="display:flex;align-items:center;gap:9px;padding:8px 10px;background:${isMe ? 'rgba(56,189,248,0.07)' : 'transparent'};border:1px solid ${isMe ? 'rgba(56,189,248,0.2)' : 'transparent'};border-radius:9px;margin-bottom:3px;${isDisq?'opacity:0.4;':''}">
                  <span style="font-size:11px;font-weight:700;color:var(--text-secondary);width:18px;text-align:center;flex-shrink:0;">${i + 1}</span>
                  <div style="width:30px;height:30px;border-radius:50%;background:rgba(${aColor},0.12);border:1px solid rgba(${aColor},0.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;font-weight:800;color:rgb(${aColor});">${ini.toUpperCase()}</div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:${isMe ? '700' : '500'};color:${isMe ? 'var(--ocean-light)' : 'var(--text)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name || 'Swimmer'}${isMe ? ' <span style="font-size:10px;color:var(--text-secondary);font-weight:400;">(you)</span>' : ''}</div>
                    <div style="margin-top:3px;height:2px;background:rgba(255,255,255,0.05);border-radius:1px;overflow:hidden;">
                      <div style="height:100%;width:${pct}%;background:rgba(${aColor},0.45);border-radius:1px;"></div>
                    </div>
                  </div>
                  <span style="font-size:13px;font-weight:700;color:${isMe ? 'var(--ocean-light)' : '#64748b'};flex-shrink:0;">${pts}</span>
                </div>`;
            }).join('');

            const fallback = myIdx < 0 && currentUser
                ? `<div style="padding:12px 10px;background:rgba(56,189,248,0.05);border:1px solid rgba(56,189,248,0.14);border-radius:9px;margin-top:6px;font-size:13px;color:var(--text-secondary);">${myPts > 0 ? `You have ${myPts} pts` : 'Log conditions to get on the board!'}</div>`
                : '';
            return rows + fallback;
        }

        // ── Overlay ──────────────────────────────────────────────────────────────────

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
                const [lbResult, feedRes] = await Promise.all([
                    supabaseClient.rpc('get_challenge_leaders'),
                    supabaseClient
                        .from('june_challenge_events')
                        .select('user_id, display_name, action_type, points, spot_name, created_at')
                        .gte('created_at', start.toISOString())
                        .lte('created_at', end.toISOString())
                        .order('created_at', { ascending: false })
                        .limit(60),
                ]);

                const leaders = lbResult.data || [];
                const myIdx   = leaders.findIndex(r => r.user_id === currentUser?.id);
                const myPts   = leaders[myIdx]?.total_points || 0;

                lbEl.innerHTML   = jcRenderLeaderboard(leaders.slice(0, 20), myIdx, myPts);
                feedEl.innerHTML = jcRenderFeed(feedRes.data || []);
                initIcons();
            } catch (e) {
                lbEl.innerHTML   = '<div style="text-align:center;color:var(--text-secondary);padding:16px;">Could not load</div>';
                feedEl.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:16px;">Could not load</div>';
            }
        }

        // ── Feed renderer ────────────────────────────────────────────────────────────

        function jcFeedAvatarColor(userId) {
            const colors = ['56,189,248','16,185,129','245,158,11','167,139,250','239,68,68','37,211,102','251,113,133','96,165,250'];
            let h = 0;
            for (let i = 0; i < (userId || '').length; i++) h = ((h << 5) - h) + userId.charCodeAt(i);
            return colors[Math.abs(h) % colors.length];
        }

        function jcInitials(name) {
            if (!name) return '?';
            const p = name.trim().split(' ');
            return p.length >= 2 ? p[0][0] + p[p.length - 1][0] : p[0].slice(0, 2);
        }

        function jcRenderFeed(events) {
            if (!events.length) {
                return `<div style="padding:36px 16px;text-align:center;">
                  <div style="width:52px;height:52px;border-radius:50%;background:rgba(56,189,248,0.07);border:1px solid rgba(56,189,248,0.15);margin:0 auto 14px;display:flex;align-items:center;justify-content:center;">
                    <i data-lucide="activity" style="width:22px;height:22px;color:rgba(56,189,248,0.45);"></i>
                  </div>
                  <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px;">No activity yet</div>
                  <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">Log a temperature or join a swim<br>to be first on the live feed.</div>
                </div>`;
            }

            const ACTION_CFG = {
                temp_log:       { r:'56,189,248',  action: e => e.spot_name ? `logged temp at <strong>${e.spot_name}</strong>` : 'logged conditions' },
                create_swim:    { r:'16,185,129',  action: e => e.spot_name ? `created a swim at <strong>${e.spot_name}</strong>` : 'created a community swim' },
                join_swim:      { r:'16,185,129',  action: e => e.spot_name ? `joined a swim at <strong>${e.spot_name}</strong>` : 'joined a swim' },
                creator_bonus:  { r:'245,158,11',  action: () => 'got a <strong>creator bonus</strong>' },
                whatsapp_share: { r:'37,211,102',  action: () => 'shared to WhatsApp' },
                streak_3day:    { r:'245,158,11',  action: () => 'hit a <strong>3-day streak</strong>' },
                streak_7day:    { r:'167,139,250', action: () => 'hit a <strong>7-day streak</strong>' },
            };

            return events.slice(0, 40).map(e => {
                const cfg     = ACTION_CFG[e.action_type] || { r:'56,189,248', action: ev => ev.action_type };
                const action  = cfg.action(e);
                const timeAgo = jcTimeAgo(new Date(e.created_at));
                const isMe    = currentUser && e.user_id === currentUser.id;
                const isNew   = (Date.now() - new Date(e.created_at)) < 300000;
                const aColor  = jcFeedAvatarColor(e.user_id || 'x');
                const ini     = jcInitials(e.display_name);

                return `<div style="display:flex;align-items:flex-start;gap:11px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                  <div style="width:38px;height:38px;border-radius:50%;background:rgba(${aColor},0.14);border:${isMe ? '2px solid rgba('+aColor+',0.55)' : '1px solid rgba('+aColor+',0.2)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px;font-weight:800;color:rgb(${aColor});letter-spacing:-0.3px;">${ini.toUpperCase()}</div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;line-height:1.45;color:var(--text);">
                      <span style="font-weight:800;color:${isMe ? 'rgb('+aColor+')' : 'var(--text)'};">${e.display_name || 'Swimmer'}</span>
                      <span style="font-weight:400;color:var(--text-secondary);"> ${action}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:7px;margin-top:4px;">
                      ${isNew ? '<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#ef4444;box-shadow:0 0 6px rgba(239,68,68,0.7);flex-shrink:0;"></span>' : ''}
                      <span style="font-size:11px;color:var(--text-secondary);">${timeAgo}</span>
                    </div>
                  </div>
                  <div style="flex-shrink:0;background:rgba(${cfg.r},0.12);border:1px solid rgba(${cfg.r},0.28);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:800;color:rgb(${cfg.r});white-space:nowrap;margin-top:2px;">+${e.points}</div>
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

        // ── Test mode: seed data ─────────────────────────────────────────────────────

        async function jcSeedTestData() {
            if (!jcConfig?.test_mode) { showToast('Not in test mode', 'error'); return; }
            if (!currentUser) { showToast('Must be logged in', 'error'); return; }

            const displayName = currentUserProfile?.display_name || 'Test User';
            const demoSpots   = ['Clifton 4th', 'Big Bay', 'Sea Point Tidal Pool', 'Camps Bay', 'Muizenberg'];

            // Seed directly into june_challenge_events for feed display (test only)
            const rows = [
                { type: 'temp_log',       pts: JC_POINTS.temp_log,      spot: demoSpots[0], hoursAgo: 0 },
                { type: 'join_swim',       pts: JC_POINTS.join_swim,     spot: demoSpots[1], hoursAgo: 2 },
                { type: 'create_swim',    pts: JC_POINTS.create_swim,   spot: demoSpots[2], hoursAgo: 4 },
                { type: 'creator_bonus',  pts: JC_POINTS.creator_bonus,  spot: null,         hoursAgo: 3 },
                { type: 'streak_3day',    pts: JC_POINTS.streak_3day,   spot: demoSpots[0], hoursAgo: 1 },
                { type: 'whatsapp_share', pts: JC_POINTS.whatsapp_share, spot: null,         hoursAgo: 5 },
            ].map(a => ({
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

            el.innerHTML = '<div style="color:var(--text-secondary);font-size:12px;padding:8px;">Loading…</div>';

            const { start, end } = jcDateRange();

            try {
                const [feedRes, leadersRes, flagsRes] = await Promise.all([
                    supabaseClient
                        .from('june_challenge_events')
                        .select('action_type, points, user_id, display_name, created_at, spot_name')
                        .gte('created_at', start.toISOString())
                        .lte('created_at', end.toISOString())
                        .order('created_at', { ascending: false })
                        .limit(200),
                    supabaseClient.rpc('get_challenge_leaders'),
                    supabaseClient
                        .from('challenge_admin_flags')
                        .select('*')
                        .eq('challenge_id', 1)
                        .order('created_at', { ascending: false }),
                ]);

                const data      = feedRes.data || [];
                const leaders   = leadersRes.data || [];
                const flags     = flagsRes.data || [];
                const totalPts  = data.reduce((s, r) => s + r.points, 0);
                const uniqueUsers = new Set(data.map(r => r.user_id)).size;
                const byAction  = {};
                data.forEach(r => { byAction[r.action_type] = (byAction[r.action_type] || 0) + 1; });

                const openFlags = flags.filter(f => f.status === 'open');

                el.innerHTML = `
                <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">
                  Feed events: <strong style="color:var(--text);">${data.length}</strong> &middot;
                  Users: <strong style="color:var(--text);">${uniqueUsers}</strong> &middot;
                  Total pts: <strong style="color:var(--ocean-light);">${totalPts}</strong> &middot;
                  Open flags: <strong style="color:${openFlags.length > 0 ? '#f59e0b' : 'var(--text)'};">${openFlags.length}</strong>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;">
                  ${Object.entries(byAction).map(([k,v]) => `<span style="background:rgba(56,189,248,0.1);color:var(--ocean-light);font-size:11px;padding:3px 8px;border-radius:6px;">${k}: ${v}</span>`).join('')}
                </div>

                ${openFlags.length > 0 ? `
                <div style="margin-bottom:12px;">
                  <div style="font-size:11px;font-weight:700;color:#f59e0b;text-transform:uppercase;margin-bottom:6px;">Open Flags</div>
                  ${openFlags.map(f => `
                  <div style="padding:8px 10px;background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.2);border-radius:8px;margin-bottom:4px;font-size:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                      <span style="color:var(--text);font-weight:600;">${f.flag_type}</span>
                      <span style="background:rgba(245,158,11,0.2);color:#f59e0b;padding:1px 6px;border-radius:4px;font-size:10px;">${f.severity}</span>
                    </div>
                    <div style="color:var(--text-secondary);margin-top:2px;">${f.description || ''}</div>
                    <div style="display:flex;gap:6px;margin-top:6px;">
                      <button onclick="jcAdminDismissFlag('${f.id}', '${containerId || 'jcAdminDebug'}')" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(16,185,129,0.3);background:rgba(16,185,129,0.1);color:#10b981;font-size:11px;cursor:pointer;">Dismiss</button>
                      <button onclick="jcAdminConfirmFlag('${f.id}', '${containerId || 'jcAdminDebug'}')" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.1);color:#ef4444;font-size:11px;cursor:pointer;">Confirm</button>
                    </div>
                  </div>`).join('')}
                </div>` : ''}

                <div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;margin-bottom:6px;">Top Leaders</div>
                <div style="max-height:160px;overflow-y:auto;margin-bottom:10px;">
                  ${leaders.slice(0, 10).map((r, i) => `
                  <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:12px;">
                    <span style="color:var(--text-secondary);width:16px;">${i+1}</span>
                    <span style="flex:1;color:${r.disqualified ? '#ef4444' : 'var(--text)'};">${r.display_name || '?'}${r.disqualified ? ' [DQ]' : ''}${r.qualified_for_draw ? ' ✓' : ''}</span>
                    <span style="color:var(--ocean-light);font-weight:700;">${r.total_points}</span>
                    <span style="color:rgba(100,116,139,0.7);">${r.draw_entries}e</span>
                    ${r.suspicious_flags > 0 ? `<span style="color:#f59e0b;">⚑${r.suspicious_flags}</span>` : ''}
                  </div>`).join('')}
                </div>

                <div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;margin-bottom:6px;">Recent Feed</div>
                <div style="max-height:180px;overflow-y:auto;font-size:12px;margin-bottom:10px;">
                  ${data.slice(0, 40).map(r => `<div style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                    <span style="color:var(--ocean-light);">${r.display_name || '?'}</span>
                    <span style="color:var(--text-secondary);"> &middot; ${r.action_type} &middot; +${r.points}pts</span>
                    ${r.spot_name ? `<span style="color:rgba(255,255,255,0.4);"> &middot; ${r.spot_name}</span>` : ''}
                    <span style="color:rgba(255,255,255,0.25);"> &middot; ${jcTimeAgo(new Date(r.created_at))}</span>
                  </div>`).join('')}
                </div>

                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  <button onclick="jcDetectFlags('${containerId || 'jcAdminDebug'}')" style="padding:8px 14px;border-radius:8px;border:1px solid rgba(245,158,11,0.3);background:rgba(245,158,11,0.1);color:#f59e0b;font-size:12px;cursor:pointer;">Detect Flags</button>
                  <button onclick="jcSeedTestData()" style="padding:8px 14px;border-radius:8px;border:1px solid rgba(56,189,248,0.3);background:rgba(56,189,248,0.1);color:var(--ocean-light);font-size:12px;cursor:pointer;">Seed Test</button>
                  <button onclick="jcLoadAdminDebug('${containerId || 'jcAdminDebug'}')" style="padding:8px 14px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text-secondary);font-size:12px;cursor:pointer;">Refresh</button>
                </div>`;
            } catch (e) {
                el.innerHTML = `<div style="color:#ef4444;font-size:12px;">Admin load failed: ${e.message}</div>`;
            }
        }

        async function jcDetectFlags(containerId) {
            try {
                const { data, error } = await supabaseClient.rpc('detect_challenge_flags');
                if (error) throw error;
                showToast(`Flag detection complete: ${data} patterns found`, 'success');
                jcLoadAdminDebug(containerId);
            } catch (e) {
                showToast('Flag detection failed: ' + e.message, 'error');
            }
        }

        async function jcAdminDismissFlag(flagId, containerId) {
            try {
                const { error } = await supabaseClient.rpc('admin_dismiss_flag', { p_flag_id: flagId });
                if (error) throw error;
                showToast('Flag dismissed', 'success');
                jcLoadAdminDebug(containerId);
            } catch (e) {
                showToast('Failed: ' + e.message, 'error');
            }
        }

        async function jcAdminConfirmFlag(flagId, containerId) {
            try {
                const { error } = await supabaseClient.rpc('admin_confirm_flag', { p_flag_id: flagId });
                if (error) throw error;
                showToast('Flag confirmed', 'success');
                jcLoadAdminDebug(containerId);
            } catch (e) {
                showToast('Failed: ' + e.message, 'error');
            }
        }
