        // ══════════════════════════════════════════════════════════════════════════════
        // MONTHLY CHALLENGE ENGINE  (⚠️ MISNAMED — this file is NOT June-only)
        // ══════════════════════════════════════════════════════════════════════════════
        // This is the GENERIC in-app challenge engine. It runs the CURRENT month's
        // challenge — its copy (title/prize/share text/draw date) is edited IN PLACE
        // each month. Do NOT create app-july.js / app-august.js. Do NOT assume the
        // content is stale just because the month changed — read what it serves now.
        //
        //   CURRENTLY SERVING: The 12 Swims of Christmas · FORM Smart Swim 2 · 1 Dec 2026 to 6 Jan 2027
        //   (JC_EDITION_MAURTEN below is the fallback copy, last used for October 2026)
        //   (September 2026 winner: Deon Odendaal — replacement draw, verified and approved 1 Oct 2026.
        //   August 2026 was Maurten too — winner: see site-config.js challenges['2026-08'], not yet recorded there.
        //   July 2026 was Blu Smooth MK2 Comp — winner: rodhols (later re-drawn: Rod Holshausen, see site-config.js).
        //   June 2026 was THEMAGIC5 Vector goggles — winner: Tunnan The Swede)
        //
        // Live on/off + dates come from the DB row `june_challenge_config` (id=1):
        //   test_mode=true  → visible to tester_ids only, labelled TEST
        //   test_mode=false → live publicly, within [launch_date, end_date]
        //
        // The challenge lives in FOUR places that must stay in step every month —
        // see CLAUDE.md → "Site Sync" → "the monthly challenge lives in FOUR places".
        //
        // EDITIONS (added Nov 2026): the copy lives in jcEd(). An edition with its own
        // date window (The 12 Swims of Christmas · FORM · 1 Dec 2026 to 6 Jan 2027)
        // takes over at 00:00 SAST on its first day with no deploy, and counts swim
        // days straight from temp_logs (get_form_challenge_standings), so a missed
        // client call can never lose a day. Preview before launch, testers only:
        // /app?preview=form
        //
        // All scoring goes through award_challenge_points RPC (Postgres SECURITY DEFINER).
        // The RPC inserts into challenge_points_audit (audit trail) and
        // june_challenge_events (live feed). No direct client inserts.
        // Hooks in app.js call jcAwardPoints() after each scoring action.
        // ══════════════════════════════════════════════════════════════════════════════

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

        // ── Editions ────────────────────────────────────────────────────────────────

        const JC_FORM_WINDOW = { start: '2026-12-01', end: '2027-01-06' };
        const JC_PREVIEW_FORM = /[?&]preview=form(&|$)/.test(window.location.search);
        const JC_APP_URL = 'https://swimloading.com/app';

        const JC_EDITION_MAURTEN = {
            key: 'maurten',
            rpc: 'get_challenge_leaders',
            name: 'October Challenge',
            sponsor: 'Maurten',
            target: 10,
            todayPrompt: 'Log 10 times this month to enter',
            logo: '<img src="/icons/Maurten%20logo.jpg" alt="Maurten" style="max-width:100%;max-height:100%;object-fit:contain;display:block;">',
            countdownSub: 'Box of Maurten Gel 100s · supplied by Art of Endurance',
            prizeTitle: 'Maurten Gel 100 3-pack',
            prizeSupplier: 'Supplied by Art of Endurance',
            prizeRule: 'Log 10 to enter · every 10 logs = another entry',
            unit: n => n === 1 ? 'log' : 'logs',
            entryWord: n => n === 1 ? 'ticket' : 'tickets',
            inDrawSub: 'Keep logging to add tickets',
            emptyText: 'Log 10 swims this month to enter the draw, and every 10 logs is another entry',
            boardHeadline: 'Log. Swim. Share. Win.',
            boardIntro: 'Log 10 swims to enter the draw. Every 10 logs, group swim, and 7-day streak earns another entry. The more you swim, the better your odds.',
            boardPrize: 'Grand Prize: Maurten Gel 100s',
            boardPrizeSub: 'Box of Gel 100s · supplied by Art of Endurance',
            rulesTitle: 'How to earn points',
            showPoints: true,
            rulesHtml: `<span style="color:#7dd3fc;font-weight:700;">Winning the Gel 100s:</span> points set your rank here, but the prize is a draw. Log 10 swims to enter, then every 10 logs, group swim, and 7-day streak adds another entry. Winner drawn 1 October.<br>
                        <span style="color:rgba(100,116,139,0.7);">Fair play rules apply. Draw eligibility requires genuine participation.</span>`,
            inDrawTitle: "You're in the October draw",
            inDrawDetail: n => `You have <strong style="color:var(--text);">${n} ${n === 1 ? 'ticket' : 'tickets'}</strong> in the hat. Every 10 more logs, group swim, or 7-day streak adds another.`,
            poolLine: (swimmers, tickets) => `<strong style="color:#7dd3fc;font-size:16px;">${swimmers}</strong> ${swimmers === 1 ? 'swimmer' : 'swimmers'} in the draw &middot; <strong style="color:#7dd3fc;">${tickets}</strong> ${tickets === 1 ? 'ticket' : 'tickets'} in the hat`,
            poolNote: "It's a random draw for the Gel 100s, and every ticket has an equal shot at each pick.",
            emptyWall: "No one's crossed 10 logs yet.<br>Be the first swimmer in the October draw.",
            share: {
                tempAt: where => `I just logged ${where} on SwimLoading. October Challenge is live! ${JC_APP_URL}`,
                temp: `Just shared swim conditions on SwimLoading. October Challenge is live! ${JC_APP_URL}`,
                joined: spot => `I joined a community swim${spot} on SwimLoading. Join the October Challenge! ${JC_APP_URL}`,
                inDraw: `I'm in the October draw for Maurten Gel 100s on SwimLoading! Log 10 swims and you're in too. ${JC_APP_URL}`,
                open: `October Challenge is live on SwimLoading! Log. Swim. Win Maurten Gel 100s. ${JC_APP_URL}`,
            },
        };

        const JC_EDITION_FORM = {
            key: 'form',
            rpc: 'get_form_challenge_standings',
            window: JC_FORM_WINDOW,
            name: '12 Swims of Christmas',
            label: '12 Swims of Christmas',
            sponsor: 'FORM',
            target: 12,
            todayPrompt: 'Swim on 12 days by 6 January to enter',
            logo: '<span style="font-family:\'Bebas Neue\',sans-serif;font-size:17px;letter-spacing:1.5px;color:#080f1a;line-height:1;">FORM</span>',
            countdownSub: 'FORM Smart Swim 2 goggles',
            prizeTitle: 'FORM Smart Swim 2 goggles',
            prizeSupplier: 'Supplied by FORM · 1 winner',
            prizeRule: 'Swim on 12 days to enter · bonus entries for Christmas and New Year',
            unit: n => n === 1 ? 'swim day' : 'swim days',
            entryWord: n => n === 1 ? 'entry' : 'entries',
            inDrawSub: "Christmas Day and New Year's Day swims add an entry each",
            emptyText: 'Swim on 12 different days from 1 December to 6 January to enter the draw',
            boardHeadline: '12 swim days. One pair of smart goggles.',
            boardIntro: "Swim on 12 different days between 1 December and 6 January, log each one, and you are in the draw for a pair of FORM Smart Swim 2 goggles. Swim on Christmas Day or New Year's Day for bonus entries.",
            boardPrize: 'Prize: FORM Smart Swim 2 goggles',
            boardPrizeSub: 'One pair · delivered to a South African address',
            rulesTitle: 'Rules',
            showPoints: false,
            rulesHtml: `Swim on 12 different days from 1 December 2026 to 6 January 2027 (South African time) and log each swim on SwimLoading.<br>
                        A swim you log yourself counts only if you log it the day you swam. A Strava swim counts on the day of the activity, and can be imported for up to 48 hours.<br>
                        Every swim must be logged by midnight on 6 January.<br>
                        12 days gives you 1 entry. A swim on Christmas Day adds 1, and a swim on New Year's Day adds 1: 3 entries at most. Bonus entries count once you have 12 days.<br>
                        The prize is one pair of FORM Smart Swim 2 goggles, delivered to a South African address.<br>
                        The organiser and their household cannot win. The winner is drawn at random on 7 January 2027.<br>
                        <span style="color:rgba(100,116,139,0.7);">Fair play rules apply. Only genuine swims count.</span>`,
            inDrawTitle: "You're in the FORM draw",
            inDrawDetail: n => n >= 3
                ? 'You have <strong style="color:var(--text);">3 entries</strong>, the most anyone can have.'
                : `You have <strong style="color:var(--text);">${n} ${n === 1 ? 'entry' : 'entries'}</strong>. A Christmas Day or New Year's Day swim adds one.`,
            poolLine: (swimmers, entries) => `<strong style="color:#7dd3fc;font-size:16px;">${swimmers}</strong> ${swimmers === 1 ? 'swimmer' : 'swimmers'} in the draw &middot; <strong style="color:#7dd3fc;">${entries}</strong> ${entries === 1 ? 'entry' : 'entries'}`,
            poolNote: 'One random draw on 7 January for one pair of goggles.',
            emptyWall: 'No one has reached 12 swim days yet.<br>Be the first swimmer in the draw.',
            tracker: jcFormTracker,
            share: {
                tempAt: where => `I just logged ${where} on SwimLoading. The 12 Swims of Christmas is on! ${JC_APP_URL}`,
                temp: `Just shared swim conditions on SwimLoading. The 12 Swims of Christmas is on! ${JC_APP_URL}`,
                joined: spot => `I joined a community swim${spot} on SwimLoading. Take on the 12 Swims of Christmas! ${JC_APP_URL}`,
                inDraw: `I've done my 12 Swims of Christmas and I'm in the draw for FORM Smart Swim 2 goggles on SwimLoading. ${JC_APP_URL}`,
                open: `The 12 Swims of Christmas: swim on 12 days from 1 December to 6 January to be in the draw for FORM Smart Swim 2 goggles. ${JC_APP_URL}`,
            },
        };

        // Twelve boxes to tick off, plus the two bonus days.
        function jcFormTracker(score) {
            const days = score?.logs || 0;
            const boxes = Array.from({ length: 12 }, (_, i) => {
                const done = i < days;
                return `<div style="height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;${done
                    ? 'background:linear-gradient(135deg,#38bdf8,#0284c7);color:#080f1a;border:1px solid #38bdf8;'
                    : 'background:rgba(255,255,255,0.03);color:#475569;border:1px dashed rgba(125,211,252,0.28);'}">${done ? '<i data-lucide="check" style="width:15px;height:15px;"></i>' : i + 1}</div>`;
            }).join('');
            const bonus = (done, icon, label) => `<div style="flex:1;display:flex;align-items:center;gap:7px;padding:8px 10px;border-radius:10px;font-size:11px;font-weight:700;line-height:1.3;${done
                ? 'background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.4);color:#10b981;'
                : 'background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.09);color:#94a3b8;'}"><i data-lucide="${done ? 'check-circle' : icon}" style="width:15px;height:15px;flex-shrink:0;"></i><span>${label}</span></div>`;
            return `<div class="jc-tracker" style="margin-bottom:12px;">
              <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:8px;">${boxes}</div>
              <div style="display:flex;gap:6px;">
                ${bonus(score?.christmas, 'gift', 'Christmas Day<br>+1 entry')}
                ${bonus(score?.newYear, 'sparkles', "New Year's Day<br>+1 entry")}
              </div>
            </div>`;
        }

        function jcSastDate(now = new Date()) {
            // en-CA formats as YYYY-MM-DD
            return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
        }

        function jcIsTester() {
            return !!(currentUser && (jcConfig?.tester_ids || []).includes(currentUser.id));
        }

        function jcEd() {
            const today = jcSastDate();
            if (today >= JC_FORM_WINDOW.start && today <= JC_FORM_WINDOW.end) return JC_EDITION_FORM;
            if (JC_PREVIEW_FORM && jcIsTester()) return JC_EDITION_FORM;
            return JC_EDITION_MAURTEN;
        }

        // The overlay header is static HTML in index.html; keep it on the same edition.
        function jcStampOverlayHeader() {
            const ed = jcEd();
            const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
            set('jcOverlayLogo', ed.logo);
            set('jcOverlayPrize', ed.prizeTitle);
            set('jcOverlaySupplier', ed.prizeSupplier);
            set('jcOverlayRule', ed.prizeRule);
        }

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
                // Only latch "loaded" on success — a transient fetch failure (network
                // blip, auth-token race right after page load) must not permanently
                // blank the whole challenge board for the rest of the session.
                jcConfigLoaded = true;
            } catch (e) {
                jcConfig = null;
            }
            return jcConfig;
        }

        function jcIsActive() {
            if (!jcConfig || !jcConfig.enabled) return false;
            // A windowed edition carries its own dates (jcEd already checked them).
            if (jcEd().window) return true;
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
            const win = jcEd().window;
            if (win) {
                return {
                    start: new Date(win.start + 'T00:00:00+02:00'),
                    end:   new Date(win.end   + 'T23:59:59+02:00'),
                };
            }
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
                } else if (jcEd().window && actionType === 'temp_log') {
                    // Swim days come from temp_logs, so a second log in a day (no points) still gets progress.
                    const score = await jcGetMyScore();
                    jcShowPostActionFeedback(actionType, null, null, score, opts);
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
            const ed = jcEd();
            const parts = ed.showPoints && pts != null ? [`+${pts} pts`] : [];
            if (score?.inDraw)            parts.push(`In the draw · ${score.entries} ${ed.entryWord(score.entries)}`);
            else if (score?.logs != null) parts.push(`${score.logs}/${ed.target} ${ed.unit(ed.target)} to enter`);
            if (parts.length) showToast(parts.join(' · '), 'success');

            if (['temp_log', 'create_swim', 'join_swim'].includes(actionType)) {
                setTimeout(() => jcShowSharePrompt(actionType, opts, score), 1400);
            }
        }

        // ── WhatsApp share ───────────────────────────────────────────────────────────

        function jcBuildShareText(actionType, opts, score) {
            const share = jcEd().share;
            switch (actionType) {
                case 'temp_log':
                    return opts.spotName
                        ? share.tempAt(`${opts.temp ? opts.temp + '°C at ' : 'conditions at '}${opts.spotName}`)
                        : share.temp;
                case 'create_swim':
                    return `I just created a community swim${opts.spotName ? ' at ' + opts.spotName : ''} on SwimLoading. Join me! ${JC_APP_URL}`;
                case 'join_swim':
                    return share.joined(opts.spotName ? ' at ' + opts.spotName : '');
                default:
                    return score?.inDraw ? share.inDraw : share.open;
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
              ${jcEd().showPoints ? `<span style="font-size:11px;color:var(--text-secondary);">+${JC_POINTS.whatsapp_share} pts</span>` : ''}
              <button onclick="event.stopPropagation();this.closest('[onclick]').remove();"
                aria-label="Dismiss" style="background:none;border:none;color:var(--text-secondary);font-size:16px;cursor:pointer;padding:0;line-height:1;margin-left:4px;">&times;</button>
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

        // ── My draw status (logs, entries, pool) ─────────────────────────────────────
        // Draw-focused, not a rank — the prize is a random draw, not a top-scorer race.

        async function jcGetMyScore() {
            if (!currentUser || !jcIsActive()) return null;
            try {
                const { data } = await supabaseClient.rpc(jcEd().rpc);
                const rows = data || [];
                const me   = rows.find(r => r.user_id === currentUser.id) || null;
                const pool = rows.filter(r => r.qualified_for_draw && !r.disqualified).length;

                jcMyScore = {
                    points:    me?.total_points || 0,
                    logs:      me?.temp_logs_rewarded || 0,
                    christmas: !!me?.christmas_swim,
                    newYear:   !!me?.new_year_swim,
                    entries:   me?.draw_entries || 0,
                    inDraw:    !!(me && me.qualified_for_draw && !me.disqualified),
                    poolCount: pool,
                };
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
                    <div onclick="showPage('leaderboard')" style="cursor:pointer;background:linear-gradient(135deg,#0c1520,#080f1a);border:1px solid rgba(56,189,248,0.3);border-radius:16px;overflow:hidden;">
                      <div style="height:3px;background:linear-gradient(90deg,#0284c7,#38bdf8,#7dd3fc);"></div>
                      <div style="padding:16px;">
                        <div style="font-size:11px;font-weight:700;color:#38bdf8;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">${jcEd().name}</div>
                        <div style="font-weight:800;font-size:18px;color:#f1f5f9;">Starts in ${daysAway} day${daysAway !== 1 ? 's' : ''}</div>
                        <div style="font-size:12px;color:#64748b;margin-top:4px;">${jcEd().countdownSub}</div>
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
            const ed = jcEd();
            const testBadge = jcConfig?.test_mode
                ? `<span style="background:rgba(245,158,11,0.25);color:#f59e0b;font-size:9px;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:0.5px;margin-left:6px;vertical-align:middle;">TEST</span>`
                : '';

            // Draw status — your reachable goal, never a rank
            let rankBlock;
            const myLogs = score?.logs || 0;
            if (score?.inDraw) {
                const tix = score.entries || 0;
                rankBlock = `
                <div style="background:linear-gradient(135deg,rgba(16,185,129,0.1),rgba(6,95,70,0.06));border:1px solid rgba(16,185,129,0.3);border-radius:12px;padding:14px 16px;margin-bottom:12px;display:flex;align-items:center;gap:12px;">
                  <div style="flex:1;">
                    <div style="font-size:17px;font-weight:900;color:#10b981;line-height:1.1;display:flex;align-items:center;gap:5px;"><i data-lucide="check-circle" style="width:16px;height:16px;"></i>You're in the draw</div>
                    <div style="font-size:12px;color:#64748b;margin-top:4px;">${ed.inDrawSub}</div>
                  </div>
                  <div style="text-align:right;">
                    <div style="font-size:26px;font-weight:900;color:#38bdf8;line-height:1;">${tix}</div>
                    <div style="font-size:11px;color:#475569;margin-top:2px;">${ed.entryWord(tix)}</div>
                  </div>
                </div>`;
            } else if (myLogs > 0) {
                const toGo = Math.max(0, ed.target - myLogs);
                const pct  = Math.min(100, Math.round(myLogs * 100 / ed.target));
                rankBlock = `
                <div style="background:linear-gradient(135deg,rgba(56,189,248,0.08),rgba(14,116,144,0.06));border:1px solid rgba(56,189,248,0.22);border-radius:12px;padding:14px 16px;margin-bottom:12px;">
                  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
                    <div style="font-size:15px;font-weight:800;color:#f1f5f9;">${myLogs}/${ed.target} ${ed.unit(ed.target)}</div>
                    <div style="font-size:12px;color:#38bdf8;font-weight:700;">${toGo} to enter the draw</div>
                  </div>
                  ${ed.tracker ? '' : `<div style="height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#0284c7,#38bdf8);border-radius:4px;"></div></div>`}
                </div>`;
            } else {
                rankBlock = `
                <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:13px 16px;margin-bottom:12px;">
                  <div style="font-size:13px;color:#475569;line-height:1.5;">${ed.emptyText}</div>
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
            <div onclick="jcOpenOverlay()" style="cursor:pointer;background:linear-gradient(160deg,#0c1520 0%,#070e18 100%);border:1px solid rgba(56,189,248,0.28);border-radius:16px;overflow:hidden;position:relative;">
              <div style="height:3px;background:linear-gradient(90deg,#0284c7 0%,#38bdf8 50%,#7dd3fc 100%);"></div>

              <div style="padding:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                  <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;">
                    <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;margin-right:5px;vertical-align:middle;box-shadow:0 0 6px rgba(16,185,129,0.6);"></span>${ed.name} · Live${testBadge}
                  </div>
                  <div style="font-size:12px;font-weight:700;color:#38bdf8;">${daysLeft}d left</div>
                </div>

                <div style="border:1px solid rgba(56,189,248,0.3);border-radius:12px;overflow:hidden;margin-bottom:14px;background:linear-gradient(135deg,#04263b,#0d1728);">
                  <div style="padding:14px;display:flex;align-items:center;gap:14px;">
                    <div style="flex-shrink:0;width:52px;height:52px;border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:center;padding:8px;">
                      ${ed.logo}
                    </div>
                    <div style="flex:1;min-width:0;">
                      <div style="font-size:13px;font-weight:900;color:#7dd3fc;letter-spacing:-0.2px;">${ed.prizeTitle}</div>
                      <div style="font-size:11px;color:#bae6fd;font-weight:600;margin-top:2px;">${ed.prizeSupplier}</div>
                      <div style="font-size:10px;color:rgba(186,230,253,0.75);margin-top:2px;">${ed.prizeRule}</div>
                    </div>
                    <i data-lucide="trophy" style="width:20px;height:20px;color:#38bdf8;flex-shrink:0;"></i>
                  </div>
                </div>

                ${rankBlock}
                ${ed.tracker ? ed.tracker(score) : ''}

                ${liveRow}

                <div style="display:flex;align-items:center;gap:8px;padding:11px 14px;border-radius:10px;background:rgba(56,189,248,0.07);border:1px solid rgba(56,189,248,0.25);">
                  <i data-lucide="activity" style="width:15px;height:15px;color:#38bdf8;"></i>
                  <span style="font-size:13px;font-weight:700;color:#38bdf8;">${ed.window ? 'View live feed + who is in' : 'View live feed + leaderboard'}</span>
                  <i data-lucide="chevron-right" style="width:14px;height:14px;color:#38bdf8;margin-left:auto;"></i>
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
            const ed = jcEd();

            el.innerHTML = `<div style="text-align:center;padding:14px;color:var(--text-secondary);font-size:13px;">Loading ${ed.name}…</div>`;

            try {
                const { start, end } = jcDateRange();
                const now = new Date();
                const daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));

                // Use get_challenge_leaders RPC for authoritative leaderboard
                const { data: leaders, error: lbErr } = await supabaseClient.rpc(jcEd().rpc);
                if (lbErr) throw lbErr;

                const sorted = (leaders || []);
                const myData = sorted.find(r => r.user_id === currentUser?.id);
                const myIdx  = sorted.findIndex(r => r.user_id === currentUser?.id);

                const testBadge = jcConfig?.test_mode
                    ? `<span style="background:rgba(245,158,11,0.2);color:#f59e0b;font-size:9px;font-weight:700;padding:2px 7px;border-radius:10px;text-transform:uppercase;letter-spacing:0.5px;margin-left:6px;">TEST</span>`
                    : '';


                el.innerHTML = `
                <div style="background:linear-gradient(135deg,rgba(14,116,144,0.1),rgba(125,211,252,0.06));border:1px solid rgba(125,211,252,0.3);border-radius:14px;padding:18px;margin-bottom:4px;">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
                    <div>
                      <div style="font-size:10px;color:#7dd3fc;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:3px;">${ed.name}${testBadge}</div>
                      <div style="font-weight:800;font-size:17px;color:var(--text);line-height:1.2;">${ed.boardHeadline}</div>
                      <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;line-height:1.4;">${ed.boardIntro}</div>
                    </div>
                    <div style="background:rgba(125,211,252,0.15);color:#7dd3fc;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap;flex-shrink:0;">${daysLeft}d left</div>
                  </div>

                  <!-- Prize -->
                  <div style="margin-bottom:14px;">
                    <div style="background:linear-gradient(135deg,rgba(56,189,248,0.12),rgba(2,132,199,0.07));border:1px solid rgba(56,189,248,0.3);border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">
                      <div>
                        <div style="font-size:12px;font-weight:700;color:#7dd3fc;">${ed.boardPrize}</div>
                        <div style="font-size:11px;color:#38bdf8;margin-top:2px;">${ed.boardPrizeSub}</div>
                      </div>
                      <div style="font-size:11px;font-weight:700;color:#7dd3fc;white-space:nowrap;margin-left:12px;">1 winner</div>
                    </div>
                  </div>

                  <div style="display:flex;align-items:center;gap:6px;font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.7px;margin-bottom:8px;">
                    <i data-lucide="ticket" style="width:12px;height:12px;color:#7dd3fc;"></i>The Draw
                  </div>
                  <div style="background:rgba(15,23,42,0.5);border-radius:10px;padding:12px;">
                    ${jcRenderLeaderboard(sorted)}
                  </div>

                  <!-- How to earn (collapsible) -->
                  <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-top:12px;">
                    <div onclick="const b=this.nextElementSibling;b.style.display=b.style.display==='block'?'none':'block';this.querySelector('i').style.transform=b.style.display==='block'?'rotate(180deg)':'';"
                         style="cursor:pointer;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;background:rgba(15,23,42,0.4);">
                      <div style="font-size:13px;font-weight:700;color:var(--text);">${ed.rulesTitle}</div>
                      <i data-lucide="chevron-down" style="width:15px;height:15px;color:var(--text-secondary);transition:transform 0.2s;"></i>
                    </div>
                    <div style="display:none;padding:12px 14px;background:rgba(15,23,42,0.3);border-top:1px solid var(--border);">
                      ${!ed.showPoints ? '' : Object.entries(JC_ACTION_LABELS).map(([k, label]) => `
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                          <span style="font-size:13px;color:var(--text);">${label}</span>
                          <span style="font-size:13px;font-weight:700;color:var(--ocean-light);white-space:nowrap;margin-left:12px;">+${JC_POINTS[k]}</span>
                        </div>`).join('')}
                      <div style="margin-top:10px;font-size:11px;color:var(--text-secondary);line-height:1.6;">
                        ${ed.rulesHtml}
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
                el.innerHTML = `<div style="text-align:center;color:var(--text-secondary);padding:16px;">Could not load ${ed.name}</div>`;
            }
        }

        // ── Leaderboard renderer ─────────────────────────────────────────────────────
        // Accepts array from get_challenge_leaders (objects) or old sorted array

        // The prize is a random DRAW, not a top-scorer race — so this view shows the
        // swimmer's own progress, the size of the draw pool, and who's in (as an avatar
        // wall), never a competitive ranking. Nobody should look at it and feel they've
        // already lost. (sorted = get_challenge_leaders rows.)
        function jcRenderDrawView(sorted) {
            const ed      = jcEd();
            const rows    = sorted || [];
            const inDraw  = rows.filter(r => r.qualified_for_draw && !r.disqualified);
            const tickets = inDraw.reduce((s, r) => s + (r.draw_entries || 0), 0);
            const me      = currentUser ? rows.find(r => r.user_id === currentUser.id) : null;
            const myLogs  = me?.temp_logs_rewarded || 0;
            const myTix   = me?.draw_entries || 0;
            const iAmIn   = !!(me && me.qualified_for_draw && !me.disqualified);
            const myScore = { logs: myLogs, christmas: !!me?.christmas_swim, newYear: !!me?.new_year_swim };

            // 1. Your own status — the reachable personal goal
            let mine = '';
            if (iAmIn) {
                mine = `<div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);border-radius:12px;padding:14px 16px;margin-bottom:14px;">
                  <div style="font-size:15px;font-weight:800;color:#10b981;display:flex;align-items:center;gap:5px;"><i data-lucide="check-circle" style="width:15px;height:15px;"></i>${ed.inDrawTitle}</div>
                  <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;line-height:1.5;">${ed.inDrawDetail(myTix)}</div>
                </div>`;
            } else if (currentUser) {
                const toGo = Math.max(0, ed.target - myLogs);
                const pct  = Math.min(100, Math.round(myLogs * 100 / ed.target));
                mine = `<div style="background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.28);border-radius:12px;padding:14px 16px;margin-bottom:14px;">
                  <div style="font-size:14px;font-weight:800;color:var(--text);">${myLogs}/${ed.target} ${ed.unit(ed.target)} to enter the draw</div>
                  ${ed.tracker ? '<div style="height:8px;"></div>' : `<div style="height:7px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;margin:8px 0 6px;"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#0284c7,#38bdf8);border-radius:4px;"></div></div>`}
                  <div style="font-size:12px;color:#38bdf8;font-weight:600;">${toGo > 0 ? toGo + ' more ' + ed.unit(toGo) + " and you're in. Everyone in the draw has a real shot" : "You're in!"}</div>
                </div>`;
            }

            // 2. The pool — belonging, not hierarchy
            const pool = `<div style="text-align:center;padding:2px 0 12px;">
              <div style="font-size:13px;color:var(--text);">${ed.poolLine(inDraw.length, tickets)}</div>
              <div style="font-size:11px;color:var(--text-secondary);margin-top:4px;line-height:1.5;">${ed.poolNote}</div>
            </div>`;

            // 3. Who's in — avatar wall, no ranking
            let wall;
            if (inDraw.length) {
                const avatars = inDraw.slice(0, 40).map(r => {
                    const c    = jcFeedAvatarColor(r.user_id);
                    const isMe = currentUser && r.user_id === currentUser.id;
                    return `<div title="${(r.display_name || 'Swimmer').replace(/"/g, '')}" style="width:36px;height:36px;border-radius:50%;background:rgba(${c},0.16);border:${isMe ? '2px solid #38bdf8' : '1px solid rgba(' + c + ',0.3)'};display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:rgb(${c});">${jcInitials(r.display_name).toUpperCase()}</div>`;
                }).join('');
                wall = `<div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.7px;margin:4px 0 10px;">In the draw</div>
                  <div style="display:flex;flex-wrap:wrap;gap:7px;">${avatars}</div>`;
            } else {
                wall = `<div style="padding:20px 16px;text-align:center;font-size:13px;color:var(--text-secondary);line-height:1.6;">${ed.emptyWall}</div>`;
            }

            const tracker = ed.tracker && currentUser ? ed.tracker(myScore) : '';

            return mine + tracker + pool + wall;
        }

        // Kept name for existing call sites — now renders the draw view, not a ranking.
        function jcRenderLeaderboard(sorted) { return jcRenderDrawView(sorted); }

        // ── Overlay ──────────────────────────────────────────────────────────────────

        function jcOpenOverlay() {
            const overlay = document.getElementById('jcOverlay');
            if (!overlay) return;
            jcStampOverlayHeader();
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
                    supabaseClient.rpc(jcEd().rpc),
                    supabaseClient
                        .from('june_challenge_events')
                        .select('user_id, display_name, action_type, points, spot_name, created_at')
                        .gte('created_at', start.toISOString())
                        .lte('created_at', end.toISOString())
                        .order('created_at', { ascending: false })
                        .limit(60),
                ]);

                const leaders = lbResult.data || [];

                lbEl.innerHTML   = jcRenderLeaderboard(leaders);
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
                const [feedRes, leadersRes, flagsRes, anomRes, tempRes] = await Promise.all([
                    supabaseClient
                        .from('june_challenge_events')
                        .select('action_type, points, user_id, display_name, created_at, spot_name')
                        .gte('created_at', start.toISOString())
                        .lte('created_at', end.toISOString())
                        .order('created_at', { ascending: false })
                        .limit(200),
                    supabaseClient.rpc(jcEd().rpc),
                    supabaseClient
                        .from('challenge_admin_flags')
                        .select('*')
                        .eq('challenge_id', 1)
                        .order('created_at', { ascending: false }),
                    supabaseClient.rpc('get_challenge_anomalies'),
                    supabaseClient.rpc('get_challenge_temp_outliers'),
                ]);

                const data      = feedRes.data || [];
                const leaders   = leadersRes.data || [];
                const flags     = flagsRes.data || [];
                const anomalies = anomRes.data || [];
                const tempOut   = tempRes.data || [];
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

                ${anomalies.length > 0 ? `
                <div style="margin-bottom:12px;">
                  <div style="font-size:11px;font-weight:700;color:#ef4444;text-transform:uppercase;margin-bottom:6px;">Travel anomalies to review (${anomalies.length})</div>
                  ${anomalies.map(a => {
                    const t = new Date(a.logged_at).toLocaleString('en-ZA', { timeZone:'Africa/Johannesburg', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
                    return `<div style="padding:8px 10px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:8px;margin-bottom:4px;font-size:12px;">
                      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        <span style="color:var(--text);font-weight:600;">${a.display_name || '?'} · ${a.spot} · ${a.temp_c}°C</span>
                        <button onclick="jcVoidLog('${a.log_id}', '${(a.spot || '').replace(/'/g,'')}', '${containerId || 'jcAdminDebug'}')" style="flex-shrink:0;padding:4px 12px;border-radius:6px;border:1px solid rgba(239,68,68,0.35);background:rgba(239,68,68,0.12);color:#ef4444;font-size:11px;font-weight:700;cursor:pointer;">Void</button>
                      </div>
                      <div style="color:var(--text-secondary);margin-top:3px;">${a.prev_spot} → <strong style="color:var(--text);">${a.spot}</strong> · ${Math.round(a.km_from_prev)}km in ${Math.round(a.mins_gap)} min <span style="color:#ef4444;">(${Math.round(a.implied_kmh).toLocaleString()} km/h)</span> · ${t}</div>
                    </div>`;
                  }).join('')}
                  <div style="font-size:10px;color:var(--text-secondary);margin-top:2px;">Impossible travel between consecutive logs. Void removes that log's challenge points/entry (keeps the log).</div>
                </div>` : ''}

                ${tempOut.length > 0 ? `
                <div style="margin-bottom:12px;">
                  <div style="font-size:11px;font-weight:700;color:#f59e0b;text-transform:uppercase;margin-bottom:6px;">Temperature outliers to review (${tempOut.length})</div>
                  ${tempOut.map(o => {
                    const t = new Date(o.logged_at).toLocaleString('en-ZA', { timeZone:'Africa/Johannesburg', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
                    const dev = Number(o.deviation);
                    return `<div style="padding:8px 10px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2);border-radius:8px;margin-bottom:4px;font-size:12px;">
                      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        <span style="color:var(--text);font-weight:600;">${o.display_name || '?'} · ${o.spot}</span>
                        <button onclick="jcVoidLog('${o.log_id}', '${(o.spot || '').replace(/'/g,'')}', '${containerId || 'jcAdminDebug'}')" style="flex-shrink:0;padding:4px 12px;border-radius:6px;border:1px solid rgba(245,158,11,0.4);background:rgba(245,158,11,0.12);color:#f59e0b;font-size:11px;font-weight:700;cursor:pointer;">Void</button>
                      </div>
                      <div style="color:var(--text-secondary);margin-top:3px;">Logged <strong style="color:var(--text);">${o.temp_c}°C</strong> · spot usually ~${o.spot_median}°C <span style="color:#f59e0b;">(${dev > 0 ? '+' : ''}${dev}°)</span> · ${o.baseline_logs} readings · ${t}</div>
                    </div>`;
                  }).join('')}
                  <div style="font-size:10px;color:var(--text-secondary);margin-top:2px;">Reading far off the spot's recent norm. It could be a wrong spot or a typo. Check before voiding (some spots genuinely vary).</div>
                </div>` : ''}

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
                    <span style="flex:1;color:${r.disqualified ? '#ef4444' : 'var(--text)'};">${r.display_name || '?'}${r.disqualified ? ' [DQ]' : ''}${r.qualified_for_draw ? ' [in]' : ''}</span>
                    <span style="color:var(--ocean-light);font-weight:700;">${r.total_points}</span>
                    <span style="color:rgba(100,116,139,0.7);">${r.draw_entries}e</span>
                    ${r.suspicious_flags > 0 ? `<span style="color:#f59e0b;">${r.suspicious_flags} flag</span>` : ''}
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

        // Void one anomalous log's challenge points/entry (keeps the temp_log itself)
        async function jcVoidLog(logId, spotName, containerId) {
            if (!confirm(`Void the challenge points for this log${spotName ? ' at ' + spotName : ''}?\n\nThe log stays, but it stops counting toward points and draw entries.`)) return;
            try {
                const { data, error } = await supabaseClient.rpc('void_challenge_log', { p_log_id: logId });
                if (error) throw error;
                showToast(data > 0 ? 'Log voided, points removed' : 'Nothing to void (already cleared)', 'success');
                jcLoadAdminDebug(containerId);
            } catch (e) {
                showToast('Could not void: ' + e.message, 'error');
            }
        }
