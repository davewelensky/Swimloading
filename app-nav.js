        function showAuthTab(tab) {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));

            if (typeof event !== 'undefined' && event.target) {
                event.target.classList.add('active');
            } else {
                // Fallback: find tab by text
                const tabs = Array.from(document.querySelectorAll('.auth-tab'));
                const target = tabs.find(t => t.innerText.toLowerCase().includes(tab));
                if (target) target.classList.add('active');
            }
            document.getElementById(tab + 'Form').classList.add('active');
        }

        function showPage(page) {
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

            document.getElementById(page).classList.add('active');
            if (typeof event !== 'undefined' && event.target) {
                event.target.classList.add('active');
            } else {
                // Fallback: find nav-tab by its onclick attribute
                const tabs = Array.from(document.querySelectorAll('.nav-tab'));
                const target = tabs.find(t => t.getAttribute('onclick') && t.getAttribute('onclick').includes(`showPage('${page}')`));
                if (target) target.classList.add('active');
            }

            // Load data for specific pages
            if (page === 'dashboard') {
                loadDashboard();
            } else if (page === 'history') {
                currentWaterFilter = 'ocean'; // Reset to default
                updateWaterFilterUI();
                loadTrends(); // Updated to new function
                analytics.track('trends_viewed');
            } else if (page === 'events') {
                loadEvents();
                analytics.track('events_viewed');
            } else if (page === 'leaderboard') {
                loadLeaderboard();
                analytics.track('leaderboard_viewed');
            } else if (page === 'safety') {
                populateSafetyRegionSelect();
                loadHazards();
                renderSafetyRegionalContent();
                analytics.track('safety_viewed');
            } else if (page === 'logTemp') {
                if (typeof checkStravaLogEntry === 'function') checkStravaLogEntry();
                // Reset form to open-water mode; pool mode applies when a spot is selected
                if (typeof applyPoolFormMode === 'function') applyPoolFormMode(null);
            } else if (page === 'club') {
                if (typeof renderClubPage === 'function') renderClubPage();
            }

            // Initialize icons after page switch
            initIcons();
        }

        // Load leaderboard data
        // ─── Monthly Challenge helpers ──────────────────────────────────────────
        function getMonthWindow() {
            const now        = new Date();
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            const daysLeft   = Math.ceil((monthEnd - now) / 86400000);
            const monthName  = now.toLocaleString('en-ZA', { month: 'long', year: 'numeric' });
            const isLive     = now >= new Date(2026, 2, 1); // challenge launches 1 March 2026
            const daysToLaunch = Math.ceil((new Date(2026, 2, 1) - now) / 86400000);
            return { now, monthStart, monthEnd, daysLeft, monthName, isLive, daysToLaunch };
        }

        async function loadMonthlyChallenge() {
            const el = document.getElementById('monthlyChallenge');
            if (!el) return;
            const { now, monthStart, monthEnd, daysLeft, monthName, isLive, daysToLaunch } = getMonthWindow();

            // Reusable SwimBETTER explainer section (collapsible)
            const swimbetterSection = `
            <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-top:12px;">
                <div onclick="const b=this.nextElementSibling;b.style.display=b.style.display==='block'?'none':'block';this.querySelector('.sw-chev').style.transform=b.style.display==='block'?'rotate(180deg)':'rotate(0)'" style="cursor:pointer;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;background:rgba(15,23,42,0.4);">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div>
                            <div style="font-size:13px;font-weight:700;color:var(--text);">What is eo SwimBETTER?</div>
                            <div style="font-size:11px;color:var(--text-secondary);">by EOLabs · elite coaching tech</div>
                        </div>
                    </div>
                    <i class="sw-chev" data-lucide="chevron-down" style="width:16px;height:16px;color:var(--text-secondary);transition:transform 0.2s;flex-shrink:0;"></i>
                </div>
                <div style="display:none;padding:16px;background:rgba(15,23,42,0.3);border-top:1px solid var(--border);">
                    <div style="font-size:13px;color:var(--text-secondary);line-height:1.7;margin-bottom:14px;">
                        <strong style="color:var(--text);">eo SwimBETTER</strong> is a small handset you wear on your hand while swimming. It captures your stroke data in real time and gives you — and your coach — a level of insight that was previously only available to Olympic-level athletes.
                    </div>
                    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
                        <div style="background:rgba(56,189,248,0.06);border-radius:8px;padding:10px 12px;">
                            <div style="font-size:12px;font-weight:700;color:var(--ocean-light);margin-bottom:3px;">Swim Power in Watts</div>
                            <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">Like a power meter on a bike — but for swimming. See exactly how hard you're working, not just how fast you're going.</div>
                        </div>
                        <div style="background:rgba(56,189,248,0.06);border-radius:8px;padding:10px 12px;">
                            <div style="font-size:12px;font-weight:700;color:var(--ocean-light);margin-bottom:3px;">Stroke Efficiency</div>
                            <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">Distance per stroke, stroke rate, and where your propulsion drops off — the data coaches use to diagnose what's actually slowing you down.</div>
                        </div>
                        <div style="background:rgba(56,189,248,0.06);border-radius:8px;padding:10px 12px;">
                            <div style="font-size:12px;font-weight:700;color:var(--ocean-light);margin-bottom:3px;">Fatigue Tracking</div>
                            <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">Watch your technique break down in real time. Knowing <em>when</em> your stroke falls apart is the first step to fixing it.</div>
                        </div>
                        <div style="background:rgba(16,185,129,0.06);border-radius:8px;padding:10px 12px;">
                            <div style="font-size:12px;font-weight:700;color:#10b981;margin-bottom:3px;">eoi AI Report</div>
                            <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">After the session, EOLabs' AI generates a personalised report — not generic tips, but specific drills matched to <strong style="color:var(--text);">your</strong> data and your weaknesses.</div>
                        </div>
                    </div>
                    <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;border-top:1px solid var(--border);padding-top:12px;">
                        AquaSharks use SwimBETTER handsets with their competitive squad in Cape Town. This prize is a private one-on-one session — the same analysis they give to elite swimmers, now available to the SwimLoading community.
                    </div>
                </div>
            </div>`;

            // Coming-soon state (before March 1)
            if (!isLive) {
                el.innerHTML = `
                <div style="background:linear-gradient(135deg,rgba(16,185,129,0.1),rgba(2,132,199,0.1));border:1px solid rgba(16,185,129,0.25);border-radius:14px;padding:20px;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                        <div>
                            <div style="font-weight:700;font-size:16px;color:var(--text);">March Temperature Challenge</div>
                            <div style="background:rgba(16,185,129,0.2);color:#10b981;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;display:inline-block;margin-top:4px;">Starts in ${daysToLaunch} day${daysToLaunch !== 1 ? 's' : ''}</div>
                        </div>
                    </div>
                    <div style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:14px;">
                        Starting <strong style="color:var(--text);">1 March</strong>, the swimmer who logs the most water temperatures wins a private stroke analysis session using <strong style="color:var(--text);">eo SwimBETTER</strong> by EOLabs — you'll swim with a power meter on your hand and walk away with a personalised report showing exactly how to go faster. Conducted by <strong style="color:var(--text);">AquaSharks</strong> in Cape Town.
                    </div>
                    <div style="background:rgba(56,189,248,0.08);border-radius:8px;padding:10px 12px;display:flex;gap:8px;align-items:flex-start;">
                        <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;"><strong style="color:var(--text);">Open to everyone.</strong> Session held in Cape Town — winner arranges their own travel. Worth the trip.</div>
                    </div>
                    ${swimbetterSection}
                </div>`;
                initIcons();
                return;
            }

            // Active challenge — fetch leaderboard
            el.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text-secondary);font-size:13px;">Loading challenge…</div>`;
            try {
                const { data, error } = await supabaseClient.rpc('get_monthly_temp_leaders', {
                    p_month_start: monthStart.toISOString(),
                    p_month_end:   monthEnd.toISOString()
                });

                // Filter out community data contributor from prize race
                const CONTRIBUTOR_ID = '2f6666a5-e042-44a5-a08d-558d5791c5bd';
                const eligible = (data || []).filter(r => r.user_id !== CONTRIBUTOR_ID);

                // Current user's own pool log count (fallback for users outside top 20)
                let myCount = 0, myRank = null, myPoints = null;
                if (currentUser) {
                    const { count } = await supabaseClient
                        .from('temp_logs')
                        .select('id, spots!inner(water_type)', { count: 'exact', head: true })
                        .eq('user_id', currentUser.id)
                        .eq('spots.water_type', 'POOL')
                        .gte('created_at', monthStart.toISOString())
                        .lt('created_at',  monthEnd.toISOString());
                    myCount = count || 0;
                    if (eligible) {
                        const idx = eligible.findIndex(r => r.user_id === currentUser.id);
                        if (idx >= 0) {
                            myRank   = idx + 1;
                            myPoints = eligible[idx].total_points;
                        }
                    }
                }

                const MEDAL_COLORS = ['#fbbf24','#94a3b8','#cd7c2f'];
                const MEDAL_BG     = ['rgba(251,191,36,0.12)','rgba(148,163,184,0.10)','rgba(205,124,47,0.10)'];
                const MEDAL_BORDER = ['rgba(251,191,36,0.35)','rgba(148,163,184,0.25)','rgba(205,124,47,0.25)'];
                const rows = eligible.map((row, i) => {
                    const isMe   = currentUser && row.user_id === currentUser.id;
                    const isTop3 = i < 3;
                    const iconEl = i === 0
                        ? `<i data-lucide="crown"  style="width:16px;height:16px;color:${MEDAL_COLORS[0]};flex-shrink:0;"></i>`
                        : isTop3
                        ? `<i data-lucide="medal"  style="width:16px;height:16px;color:${MEDAL_COLORS[i]};flex-shrink:0;"></i>`
                        : `<span style="font-size:11px;font-weight:700;width:16px;text-align:center;color:var(--text-secondary);">${i+1}</span>`;
                    const bg     = isTop3 ? MEDAL_BG[i]     : isMe ? 'rgba(56,189,248,0.08)' : 'transparent';
                    const border = isTop3 ? MEDAL_BORDER[i] : isMe ? 'rgba(56,189,248,0.25)' : 'transparent';
                    const pts_color = isTop3 ? MEDAL_COLORS[i] : 'var(--ocean-light)';
                    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:${isTop3?'12px 14px':'9px 12px'};background:${bg};border:1px solid ${border};border-radius:10px;margin-bottom:6px;">
                        <div style="display:flex;align-items:center;gap:10px;">
                            ${iconEl}
                            <span style="color:var(--text);font-weight:${isTop3?'700':isMe?'600':'400'};font-size:${isTop3?'14px':'13px'};">${row.display_name || 'Anonymous'}${isMe?' <span style="font-size:11px;color:var(--ocean-light);font-weight:600;">(you)</span>':''}</span>
                        </div>
                        <div style="text-align:right;">
                            <div style="color:${pts_color};font-weight:700;font-size:${isTop3?'14px':'13px'};">${row.total_points} pts</div>
                            <div style="color:var(--text-secondary);font-size:10px;margin-top:1px;">${row.log_count} log${row.log_count !== 1 ? 's' : ''}</div>
                        </div>
                    </div>`;
                }).join('');

                const emptyState = eligible.length === 0
                    ? `<div style="text-align:center;color:var(--text-secondary);padding:16px;font-size:13px;">No logs yet this month — be the first!</div>`
                    : '';

                // "Your position" callout — shown when user is in the top 20
                let myPositionCard = '';
                if (currentUser && myRank !== null && myPoints !== null) {
                    const personAbove = myRank > 1 ? eligible[myRank - 2] : null;
                    const gapLine = personAbove
                        ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:3px;">${personAbove.total_points - myPoints} pts behind ${personAbove.display_name} (#${myRank - 1})</div>`
                        : `<div style="font-size:11px;color:#10b981;margin-top:3px;">You're leading — hold on!</div>`;
                    myPositionCard = `
                    <div style="background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);border-radius:10px;padding:12px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="font-size:13px;font-weight:700;color:var(--text);">You're #${myRank} · ${myPoints} pts</div>
                            ${gapLine}
                        </div>
                        <div style="font-size:13px;font-weight:800;color:${myRank<=3?'#fbbf24':'var(--text-secondary)'};">#${myRank}</div>
                    </div>`;
                }

                // Fallback for users outside top 20
                const myRankLine = currentUser && myRank === null && myCount > 0
                    ? `<div style="text-align:center;color:var(--text-secondary);font-size:12px;margin-top:8px;">You have ${myCount} log${myCount!==1?'s':''} this month — keep going!</div>`
                    : currentUser && myRank === null && myCount === 0
                    ? `<div style="text-align:center;color:var(--text-secondary);font-size:12px;margin-top:8px;">You haven't logged yet this month — every log counts!</div>`
                    : '';

                el.innerHTML = `
                <div style="background:linear-gradient(135deg,rgba(14,116,144,0.1),rgba(125,211,252,0.06));border:1px solid rgba(125,211,252,0.3);border-radius:14px;padding:20px;margin-bottom:4px;">
                    <!-- Header -->
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <i data-lucide="waves" style="width:24px;height:24px;color:#7dd3fc;"></i>
                            <div>
                                <div style="font-size:11px;color:#7dd3fc;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:2px;">May Winter Challenge</div>
                                <div style="font-weight:700;font-size:18px;color:var(--text);">Log a pool temp. Win Maurten.</div>
                            </div>
                        </div>
                        <div style="background:rgba(125,211,252,0.15);color:#7dd3fc;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap;">${daysLeft}d left</div>
                    </div>

                    <!-- Prize -->
                    <div style="background:rgba(0,0,0,0.25);border-radius:12px;padding:16px;margin-bottom:14px;">
                        <div style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:14px;">
                            It's winter. The ocean is cold. The pools are heated. Log a pool temperature — indoor (Virgin Active, gym pools) or outdoor — and you stand a chance to win a <strong style="color:var(--text);">Maurten prize pack</strong>. Every log is an entry.
                        </div>
                        <div style="background:rgba(125,211,252,0.08);border:1px solid rgba(125,211,252,0.2);border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;">
                            <div>
                                <div style="font-size:10px;color:#7dd3fc;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:3px;">Prize</div>
                                <div style="font-size:14px;font-weight:800;color:#7dd3fc;">Maurten Prize Pack</div>
                                <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">Ships anywhere in South Africa</div>
                            </div>
                            <div style="text-align:right;">
                                <i data-lucide="waves" style="width:22px;height:22px;color:#7dd3fc;"></i>
                                <div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">Any pool counts</div>
                            </div>
                        </div>
                    </div>

                    <!-- How points work -->
                    <div style="margin-bottom:16px;">
                        <div style="font-size:10px;font-weight:700;color:#7dd3fc;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:10px;">How it works</div>
                        <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:10px;">Log any pool temperature — every log earns points and enters you into the draw.</div>
                        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;">
                            <div style="background:rgba(125,211,252,0.06);border-radius:8px;padding:10px 12px;display:flex;gap:12px;align-items:center;">
                                <div style="background:rgba(125,211,252,0.15);border-radius:6px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#7dd3fc;flex-shrink:0;">10</div>
                                <div><div style="font-size:12px;font-weight:700;color:var(--text);">10 points for every pool temp log</div><div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">Log the water temp at any pool — heated indoor or outdoor — and earn 10 points per log.</div></div>
                            </div>
                            <div style="background:rgba(125,211,252,0.06);border-radius:8px;padding:10px 12px;display:flex;gap:12px;align-items:center;">
                                <div style="background:rgba(125,211,252,0.15);border-radius:6px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#7dd3fc;flex-shrink:0;">+10</div>
                                <div><div style="font-size:12px;font-weight:700;color:var(--text);">+10 bonus for the first log at each spot each day</div><div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">Log the same pool daily? You get the +10 bonus once per day. Log <em>two different pools</em> in one day — you earn it twice.</div></div>
                            </div>
                            <div style="background:rgba(125,211,252,0.06);border:1px solid rgba(125,211,252,0.15);border-radius:8px;padding:10px 12px;display:flex;gap:12px;align-items:center;">
                                <div style="background:rgba(125,211,252,0.15);border-radius:6px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i data-lucide="waves" style="width:16px;height:16px;color:#7dd3fc;"></i></div>
                                <div><div style="font-size:12px;font-weight:700;color:var(--text);">Any pool counts — indoor or outdoor</div><div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">Virgin Active, gym pool, public pool, outdoor heated pool. If it's a pool and you're in it, log it.</div></div>
                            </div>
                        </div>

                        <!-- Quick example -->
                        <div style="background:rgba(15,23,42,0.6);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">
                            <div style="font-size:10px;color:#7dd3fc;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">Quick Example</div>
                            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
                                <div style="font-size:12px;color:var(--text);">Log your gym pool on Monday + Wednesday + Friday</div>
                                <div style="font-size:13px;font-weight:800;color:#10b981;">60 pts</div>
                            </div>
                            <div style="font-size:11px;color:var(--text-secondary);margin-bottom:10px;">(3 logs × 10 pts) + (3 first-of-day bonuses × 10 pts) = 60 pts</div>
                            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
                                <div style="font-size:12px;color:var(--text);">Log the same pool twice in one day</div>
                                <div style="font-size:13px;font-weight:800;color:var(--text-secondary);">20 pts</div>
                            </div>
                            <div style="font-size:11px;color:var(--text-secondary);">(2 logs × 10 pts) + (only 1 first-of-day bonus) = 20 pts</div>
                        </div>
                    </div>

                    <!-- Your position callout (only shown when user is in top 20) -->
                    ${myPositionCard}

                    <!-- Leaderboard -->
                    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
                        <div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;"><i data-lucide="trophy" style="width:13px;height:13px;color:#7dd3fc;"></i>May Pool Leaderboard</div>
                        <div style="font-size:10px;color:var(--text-secondary);opacity:0.7;">10 pts/log · +10 per pool/day</div>
                    </div>
                    <div style="background:rgba(15,23,42,0.5);border-radius:10px;padding:12px;">
                        ${emptyState}${rows}${myRankLine}
                    </div>
                </div>`;
                initIcons();
            } catch (err) {
                console.error('Monthly challenge error:', err);
                el.innerHTML = `<div style="text-align:center;color:var(--text-secondary);padding:16px;font-size:13px;">Could not load challenge data</div>`;
            }
        }

        async function loadClubCard() {
            if (!currentUser) return;
            const el = document.getElementById('dashClubCard');
            if (!el) return;
            try {
                const { data: membership } = await supabaseClient
                    .from('club_members')
                    .select('member_number, role, club_categories(name), clubs(name, slug, code)')
                    .eq('user_id', currentUser.id)
                    .eq('is_active', true)
                    .limit(1)
                    .single();
                if (!membership || !membership.clubs) return;

                const club = membership.clubs;
                const cat  = membership.club_categories?.name || '';
                const num  = membership.member_number || '';
                const catColors = { Guppies:'#34d399', Sailfish:'#38bdf8', Makos:'#f59e0b', Walrus:'#a78bfa', Coelacanths:'#fb923c' };
                const catCol = catColors[cat] || '#38bdf8';

                el.innerHTML = `
                    <a href="/clubs/${club.slug}" style="display:block;text-decoration:none;
                        background:linear-gradient(135deg,rgba(56,189,248,0.07),rgba(56,189,248,0.02));
                        border:1px solid rgba(56,189,248,0.18); border-radius:16px; padding:16px 18px;">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                            <div>
                                <div style="font-size:10px;font-weight:700;color:var(--ocean-light);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:6px;">
                                    ${club.name}
                                </div>
                                <div style="display:flex;align-items:baseline;gap:10px;">
                                    <div style="font-size:28px;font-weight:800;color:var(--ocean-light);line-height:1;font-family:'DM Sans',sans-serif;letter-spacing:-0.5px;">
                                        ${num}
                                    </div>
                                    ${cat ? `<div style="font-size:12px;font-weight:700;color:${catCol};background:${catCol}1a;border:1px solid ${catCol}40;border-radius:20px;padding:2px 10px;">${cat}</div>` : ''}
                                </div>
                            </div>
                            <div style="display:flex;align-items:center;gap:6px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.18);border-radius:10px;padding:10px 14px;flex-shrink:0;">
                                <i data-lucide="trophy" style="width:14px;height:14px;color:var(--ocean-light);"></i>
                                <span style="font-size:12px;font-weight:700;color:var(--ocean-light);">Standings</span>
                            </div>
                        </div>
                    </a>`;
                lucide.createIcons();
            } catch (e) { /* not a club member — card stays hidden */ }
        }

        async function loadSpotlightBanner() {
            try {
                const { data: spotRows } = await supabaseClient
                    .from('spotlights')
                    .select('*, spotlight_updates(*)')
                    .eq('active', true)
                    .in('status', ['upcoming', 'live', 'completed'])
                    .order('created_at', { ascending: false })
                    .limit(10);

                const banner = document.getElementById('spotlightBanner');
                if (!spotRows?.length || !banner) return;

                // Live first, then completed (celebration stays visible), then upcoming
                const sorted = [
                    ...spotRows.filter(r => r.status === 'live'),
                    ...spotRows.filter(r => r.status === 'completed'),
                    ...spotRows.filter(r => r.status === 'upcoming'),
                ];

                banner.style.display = 'block';
                banner.innerHTML = sorted.map((data, idx) => {
                    const isLive = data.status === 'live';
                    const statusColor = isLive ? '#22c55e' : '#f59e0b';
                    const statusLabel = isLive ? 'LIVE' : 'UPCOMING';
                    const routePart = data.route_description ? ` · ${data.route_description}` : '';
                    const distPart = data.distance_km ? ` · ${data.distance_km}km` : '';

                    const updates = (data.spotlight_updates || [])
                        .sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at));
                    const latest = updates[0];
                    const latestHtml = latest
                        ? `<div style="font-size:12px;color:rgba(255,255,255,0.6);margin-bottom:10px;line-height:1.5;">${latest.notes}${latest.temp_c != null ? ' · ' + latest.temp_c + '°C' : ''}${latest.km_completed != null ? ' · ' + latest.km_completed + 'km done' : ''}</div>`
                        : '';
                    const startTimePart = data.start_time
                        ? `<div style="font-size:12px;color:rgba(255,255,255,0.55);margin-bottom:8px;">Starts: ${new Date(data.start_time).toLocaleString('en-ZA',{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})} SA time</div>`
                        : '';
                    const descPart = data.description
                        ? `<div style="font-size:13px;color:rgba(255,255,255,0.6);margin-bottom:10px;line-height:1.5;">${data.description}</div>`
                        : '';
                    const trackBtn = [
                        data.tracking_url   ? `<a href="${data.tracking_url}"   target="_blank" rel="noopener" style="display:inline-block;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.25);color:#fff;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;margin-right:6px;margin-bottom:6px;">Track Live</a>` : '',
                        data.tracking_url_2 ? `<a href="${data.tracking_url_2}" target="_blank" rel="noopener" style="display:inline-block;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.25);color:#fff;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;margin-right:6px;margin-bottom:6px;">Track Boat 2</a>` : '',
                        data.whatsapp_url   ? `<a href="${data.whatsapp_url}"   target="_blank" rel="noopener" style="display:inline-block;background:rgba(37,211,102,0.2);border:1px solid rgba(37,211,102,0.45);color:#25d366;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;margin-right:6px;margin-bottom:6px;">Join WhatsApp</a>` : '',
                        data.facebook_url   ? `<a href="${data.facebook_url}"   target="_blank" rel="noopener" style="display:inline-block;background:rgba(59,89,152,0.25);border:1px solid rgba(59,89,152,0.5);color:#818cf8;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;margin-bottom:6px;">Facebook</a>` : '',
                    ].join('');

                    // Completed: celebration card
                    if (data.status === 'completed') {
                        const result = latest?.notes ? latest.notes : 'Swim completed';
                        return `
                        <div style="background:linear-gradient(135deg,rgba(21,128,61,0.35),rgba(6,78,59,0.35));border:1px solid rgba(34,197,94,0.3);border-radius:14px;padding:14px 16px;margin-bottom:${idx < sorted.length - 1 ? '8' : '18'}px;">
                            <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">
                                <span style="background:#22c55e;color:#000;font-size:10px;font-weight:800;padding:2px 9px;border-radius:20px;letter-spacing:0.3px;">COMPLETED</span>
                                <span style="font-size:11px;color:rgba(255,255,255,0.45);font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">SA Open Water</span>
                            </div>
                            <div style="font-size:15px;font-weight:700;color:#fff;margin-bottom:3px;line-height:1.3;">${data.title}</div>
                            <div style="font-size:13px;color:rgba(255,255,255,0.65);margin-bottom:8px;">${data.swimmer_names}${routePart}${distPart}</div>
                            <div style="font-size:13px;color:#86efac;font-weight:600;margin-bottom:6px;line-height:1.5;">${result}</div>
                            ${data.description ? `<div style="font-size:12px;color:rgba(255,255,255,0.5);line-height:1.5;">${data.description}</div>` : ''}
                        </div>`;
                    }

                    // Live: full card. Upcoming (when a live swim also showing): compact strip.
                    const isCompact = !isLive && sorted.some(r => r.status === 'live');
                    if (isCompact) {
                        return `
                        <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:10px;padding:9px 12px;margin-bottom:10px;display:flex;align-items:center;gap:10px;">
                            <span style="background:${statusColor};color:#000;font-size:9px;font-weight:800;padding:2px 7px;border-radius:20px;letter-spacing:0.3px;flex-shrink:0;">${statusLabel}</span>
                            <span style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.85);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${data.title}</span>
                            <span style="font-size:11px;color:rgba(255,255,255,0.45);flex-shrink:0;">${data.swimmer_names}${distPart}</span>
                        </div>`;
                    }
                    return `
                    <div style="background:linear-gradient(135deg,rgba(30,64,175,0.35),rgba(6,95,70,0.35));border:1px solid rgba(255,255,255,0.14);border-radius:14px;padding:14px 16px;margin-bottom:${idx < sorted.length - 1 ? '8' : '18'}px;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">
                            <span style="background:${statusColor};color:#000;font-size:10px;font-weight:800;padding:2px 9px;border-radius:20px;letter-spacing:0.3px;">${statusLabel}</span>
                            <span style="font-size:11px;color:rgba(255,255,255,0.45);font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">SA Open Water</span>
                        </div>
                        <div style="font-size:15px;font-weight:700;color:#fff;margin-bottom:3px;line-height:1.3;">${data.title}</div>
                        <div style="font-size:13px;color:rgba(255,255,255,0.65);margin-bottom:8px;">${data.swimmer_names}${routePart}${distPart}</div>
                        ${startTimePart}
                        ${descPart}
                        ${latestHtml}
                        ${trackBtn}
                    </div>`;
                }).join('');
            } catch (err) {
                // Spotlight is optional — silently ignore errors
                console.warn('Spotlight load error:', err);
            }
        }

        async function loadMonthlyChallengeSummary() {
            const el = document.getElementById('dashMonthlyChallenge');
            if (!el) return;
            const { now, monthStart, monthEnd, daysLeft, monthName, isLive, daysToLaunch } = getMonthWindow();

            if (!isLive) {
                el.innerHTML = `
                <div onclick="showPage('leaderboard')" style="cursor:pointer;background:linear-gradient(135deg,rgba(251,191,36,0.1) 0%,rgba(2,132,199,0.1) 100%);border:1px solid rgba(251,191,36,0.3);border-radius:16px;padding:20px;position:relative;overflow:hidden;">
                    <div style="position:absolute;top:-20px;right:-20px;width:80px;height:80px;background:radial-gradient(circle,rgba(251,191,36,0.15),transparent 70%);border-radius:50%;pointer-events:none;"></div>
                    <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;">
                        <div>
                            <div style="font-size:11px;color:#fbbf24;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:3px;">April Challenge · Art of Endurance</div>
                            <div style="font-size:15px;font-weight:800;color:var(--text);">April Explorer Challenge</div>
                            <div style="background:rgba(251,191,36,0.2);color:#fbbf24;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;display:inline-block;margin-top:4px;">Starts in ${daysToLaunch} day${daysToLaunch!==1?'s':''}</div>
                        </div>
                    </div>
                    <div style="font-size:13px;color:var(--text-secondary);line-height:1.55;margin-bottom:14px;">
                        Log from outside Cape Town and earn <strong style="color:#fbbf24;">double points</strong> all April. Top the leaderboard and win a full box of <strong style="color:var(--text);">Maurten Gel 100s</strong>.
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div style="font-size:11px;color:var(--text-secondary);">Art of Endurance × Maurten · ships nationally</div>
                        <div style="font-size:12px;color:#fbbf24;font-weight:700;display:flex;align-items:center;gap:3px;">See details <i data-lucide="chevron-right" style="width:13px;height:13px;"></i></div>
                    </div>
                </div>`;
                initIcons();
                return;
            }

            try {
                const [{ data }, countRes] = await Promise.all([
                    supabaseClient.rpc('get_monthly_temp_leaders', {
                        p_month_start: monthStart.toISOString(),
                        p_month_end:   monthEnd.toISOString()
                    }),
                    currentUser ? supabaseClient
                        .from('temp_logs')
                        .select('id, spots!inner(water_type)', { count: 'exact', head: true })
                        .eq('user_id', currentUser.id)
                        .eq('spots.water_type', 'POOL')
                        .gte('created_at', monthStart.toISOString())
                        .lt('created_at',  monthEnd.toISOString())
                        : Promise.resolve({ count: 0 })
                ]);

                // Exclude data contributor from prize race
                const CONTRIBUTOR_ID = '2f6666a5-e042-44a5-a08d-558d5791c5bd';
                const eligible = (data || []).filter(r => r.user_id !== CONTRIBUTOR_ID);
                const leader = eligible[0] || null;
                const myCount = countRes?.count || 0;
                const myRankIdx = eligible.findIndex(r => r.user_id === currentUser?.id);
                const myRank = myRankIdx >= 0 ? myRankIdx + 1 : null;

                const leaderLine = leader
                    ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">Leader: ${leader.display_name} · ${leader.total_points} pts</div>`
                    : `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">No logs yet — be first!</div>`;

                const myLine = myCount > 0
                    ? `<div style="font-size:11px;color:var(--ocean-light);font-weight:600;">${myRank ? `#${myRank}` : 'Unranked'} · ${myCount} log${myCount!==1?'s':''} this month</div>`
                    : `<div style="font-size:11px;color:var(--text-secondary);">Log a temp to enter!</div>`;

                // Gap calculation: each log = 10 pts
                const leaderLogs = leader ? Math.round(leader.total_points / 10) : 0;
                const gapLogs = leader && leader.user_id !== currentUser?.id
                    ? Math.max(0, leaderLogs - myCount)
                    : 0;
                const gapLine = gapLogs > 0
                    ? `<div style="font-size:12px;color:var(--warning);font-weight:600;margin-top:6px;">${gapLogs} more log${gapLogs!==1?'s':''} to catch ${leader.display_name}</div>`
                    : myRank === 1 && myCount > 0
                        ? `<div style="font-size:12px;color:#10b981;font-weight:600;margin-top:6px;">You're in the lead — keep going!</div>`
                        : '';

                const challengeTitle = 'May Pool Challenge';
                const challengeSubtitle = 'Log any pool temp · Win Maurten';
                const myPoints = myRankIdx >= 0 ? eligible[myRankIdx].total_points : 0;
                const ptGap = leader && leader.user_id !== currentUser?.id && myPoints < leader.total_points
                    ? leader.total_points - myPoints : 0;
                const ptGapLine = ptGap > 0
                    ? `<div style="font-size:12px;color:var(--warning);font-weight:600;margin-top:6px;">${ptGap} more pts to catch ${leader.display_name}</div>`
                    : myRank === 1 && myCount > 0
                        ? `<div style="font-size:12px;color:#10b981;font-weight:600;margin-top:6px;">You're leading — hold on!</div>`
                        : '';

                // Build top-3 mini leaderboard (eligible swimmers only)
                const MC = ['#7dd3fc','#94a3b8','#67e8f9'];
                const top3 = eligible.slice(0, 3);
                const top3html = top3.length > 0 ? top3.map((r, i) => {
                    const isMe = currentUser && r.user_id === currentUser.id;
                    const icon = i === 0
                        ? `<i data-lucide="crown" style="width:13px;height:13px;color:${MC[i]};flex-shrink:0;"></i>`
                        : `<i data-lucide="medal" style="width:13px;height:13px;color:${MC[i]};flex-shrink:0;"></i>`;
                    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;${i < top3.length-1 ? 'border-bottom:1px solid rgba(255,255,255,0.06);' : ''}">
                        <div style="display:flex;align-items:center;gap:7px;">
                            ${icon}
                            <span style="font-size:12px;font-weight:${isMe?'700':'500'};color:${isMe?MC[0]:'var(--text)'};">${r.display_name}${isMe?' (you)':''}</span>
                        </div>
                        <span style="font-size:12px;font-weight:700;color:${MC[i]};">${r.total_points} pts</span>
                    </div>`;
                }).join('') : `<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:8px 0;">No logs yet — be the first!</div>`;

                // State-specific CTA
                let ctaBlock = '';
                if (!currentUser || myPoints === 0) {
                    ctaBlock = `<div style="background:linear-gradient(135deg,rgba(125,211,252,0.12),rgba(125,211,252,0.04));border:1px solid rgba(125,211,252,0.3);border-radius:10px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="font-size:12px;font-weight:700;color:#7dd3fc;">Log a pool temp to enter</div>
                            <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">Indoor or outdoor · every log counts</div>
                        </div>
                    </div>`;
                } else if (myRank === 1) {
                    ctaBlock = `<div style="background:linear-gradient(135deg,rgba(125,211,252,0.18),rgba(125,211,252,0.05));border:1px solid rgba(125,211,252,0.4);border-radius:10px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="font-size:12px;font-weight:700;color:#7dd3fc;">You're leading! Keep logging.</div>
                            <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${myPoints} pts · ${daysLeft} days to hold on</div>
                        </div>
                    </div>`;
                } else if (ptGap > 0) {
                    ctaBlock = `<div style="background:rgba(15,23,42,0.6);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="font-size:12px;font-weight:700;color:var(--warning);">${ptGap} pts behind ${leader.display_name}</div>
                            <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">You're #${myRank} · ${myPoints} pts</div>
                        </div>
                    </div>`;
                }

                el.innerHTML = `
                <div onclick="showPage('leaderboard')" style="cursor:pointer;border-radius:18px;overflow:hidden;border:1px solid rgba(125,211,252,0.3);box-shadow:0 4px 24px rgba(125,211,252,0.06);">
                    <!-- Icy blue header band -->
                    <div style="background:linear-gradient(135deg,#0c4a6e,#0369a1,#0284c7);padding:14px 16px;display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="font-size:10px;color:rgba(186,230,253,0.85);font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">May Winter Challenge</div>
                            <div style="font-size:17px;font-weight:800;color:#bae6fd;margin-top:2px;line-height:1.2;">Log a pool temp · Win Maurten</div>
                        </div>
                        <div style="text-align:right;flex-shrink:0;">
                            <div style="font-size:22px;font-weight:900;color:#7dd3fc;line-height:1;">${daysLeft}</div>
                            <div style="font-size:10px;color:rgba(186,230,253,0.65);text-transform:uppercase;letter-spacing:0.5px;">days left</div>
                        </div>
                    </div>
                    <!-- Body -->
                    <div style="background:rgba(12,20,40,0.97);padding:14px 16px;">
                        <!-- Badges -->
                        <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;">
                            <div style="background:rgba(125,211,252,0.1);border:1px solid rgba(125,211,252,0.25);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;color:#7dd3fc;">any pool</div>
                            <div style="background:rgba(125,211,252,0.1);border:1px solid rgba(125,211,252,0.25);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;color:#7dd3fc;">indoor or outdoor</div>
                            <div style="background:rgba(125,211,252,0.08);border:1px solid rgba(125,211,252,0.15);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:600;color:#93c5fd;">10 pts/log</div>
                        </div>
                        <!-- Mini leaderboard -->
                        <div style="margin-bottom:10px;">${top3html}</div>
                        <!-- CTA -->
                        ${ctaBlock}
                        <!-- Footer link -->
                        <div style="margin-top:10px;font-size:11px;color:rgba(125,211,252,0.7);font-weight:600;display:flex;align-items:center;gap:3px;">Full leaderboard &amp; details <i data-lucide="chevron-right" style="width:11px;height:11px;"></i></div>
                    </div>
                </div>`;
                initIcons();
            } catch (err) {
                console.error('Challenge summary error:', err);
                el.innerHTML = `
                <div onclick="showPage('leaderboard')" style="cursor:pointer;background:rgba(12,74,110,0.3);border:1px solid rgba(125,211,252,0.3);border-radius:16px;padding:16px 18px;">
                    <div style="font-size:11px;color:#7dd3fc;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">May 2026 · Pool Challenge</div>
                    <div style="font-size:16px;font-weight:800;color:var(--text-primary);">May Pool Challenge</div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">Log any pool temp · Win Maurten</div>
                    <div style="margin-top:10px;font-size:12px;color:#7dd3fc;font-weight:600;">View leaderboard →</div>
                </div>`;
                initIcons();
            }
        }
        // ─── End Monthly Challenge ──────────────────────────────────────────────

        async function loadLeaderboard() {
            loadMonthlyChallenge(); // non-blocking — renders monthly challenge section
            const listEl = document.getElementById('leaderboardList');

            try {
                // Fetch top swimmers by points
                const { data, error } = await supabaseClient
                    .from('user_stats')
                    .select('user_id, points, profiles(display_name)')
                    .gt('points', 0)
                    .order('points', { ascending: false })
                    .limit(10);

                if (error) {
                    console.error('Leaderboard error:', error);
                    listEl.innerHTML = `<div style="text-align: center; color: var(--danger); padding: 20px;">
                        Could not load leaderboard<br>
                        <small style="color: var(--text-secondary);">${error.message}</small>
                    </div>`;
                } else if (!data || data.length === 0) {
                    listEl.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">No swimmers on the leaderboard yet. Log a temperature to earn points!</div>';
                } else {
                    listEl.innerHTML = renderLeaderboardList(data, 'points');
                    initIcons();
                }

            } catch (err) {
                console.error('Leaderboard error:', err);
                listEl.innerHTML = '<div style="text-align: center; color: var(--danger); padding: 20px;">Error loading leaderboard</div>';
            }
        }

        function renderLeaderboardList(data, pointsField) {
            const CONTRIBUTOR_ID = '2f6666a5-e042-44a5-a08d-558d5791c5bd';
            const contributor = data.find(r => r.user_id === CONTRIBUTOR_ID);
            const eligible    = data.filter(r => r.user_id !== CONTRIBUTOR_ID);
            const medals = ['1st', '2nd', '3rd'];
            let html = '';

            // Data contributor card — shown at top, outside the race
            if (contributor) {
                const name   = contributor.profiles?.display_name || 'Anonymous Swimmer';
                const points = contributor[pointsField] || 0;
                html += `<div style="background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.15);border-radius:10px;padding:12px 14px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <i data-lucide="radio-tower" style="width:18px;height:18px;"></i>
                        <div>
                            <div style="font-size:13px;font-weight:700;color:var(--text-primary);">${name}</div>
                            <div style="font-size:11px;color:var(--ocean-light);margin-top:1px;">Community Data Contributor · not competing for prize</div>
                        </div>
                    </div>
                    <span style="font-size:13px;font-weight:700;color:var(--text-secondary);">${points.toLocaleString()} pts</span>
                </div>`;
            }

            // Prize race — ranked list of eligible swimmers
            if (eligible.length === 0) {
                html += `<div style="text-align:center;color:var(--text-secondary);padding:16px 0;font-size:13px;">No eligible swimmers yet — log a temp to enter!</div>`;
            } else {
                const LB_MEDAL_COLORS = ['#fbbf24','#94a3b8','#cd7c2f'];
                const LB_MEDAL_BG     = ['rgba(251,191,36,0.12)','rgba(148,163,184,0.10)','rgba(205,124,47,0.10)'];
                const LB_MEDAL_BORDER = ['rgba(251,191,36,0.35)','rgba(148,163,184,0.25)','rgba(205,124,47,0.25)'];
                html += eligible.map((row, i) => {
                    const name   = row.profiles?.display_name || 'Anonymous Swimmer';
                    const points = row[pointsField] || 0;
                    const isTop3 = i < 3;
                    const isMe   = currentUser && row.user_id === currentUser.id;
                    const iconEl = i === 0
                        ? `<i data-lucide="crown" style="width:18px;height:18px;color:${LB_MEDAL_COLORS[0]};flex-shrink:0;"></i>`
                        : isTop3
                        ? `<i data-lucide="medal" style="width:18px;height:18px;color:${LB_MEDAL_COLORS[i]};flex-shrink:0;"></i>`
                        : `<span style="font-size:12px;font-weight:700;width:18px;text-align:center;color:var(--text-secondary);">${i+1}</span>`;
                    const bg     = isTop3 ? LB_MEDAL_BG[i]     : isMe ? 'rgba(56,189,248,0.08)' : 'transparent';
                    const border = isTop3 ? LB_MEDAL_BORDER[i] : isMe ? 'rgba(56,189,248,0.25)' : 'transparent';
                    const pts_color = isTop3 ? LB_MEDAL_COLORS[i] : 'var(--ocean-light)';
                    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:${isTop3?'14px':'11px'} 14px;background:${bg};border:1px solid ${border};border-radius:10px;margin-bottom:8px;">
                        <div style="display:flex;align-items:center;gap:12px;">
                            ${iconEl}
                            <span style="color:var(--text-primary);font-weight:${isTop3?'700':isMe?'600':'400'};font-size:${isTop3?'15px':'13px'};">${name}${isMe ? ' <span style="font-size:11px;color:var(--ocean-light);font-weight:600;">(you)</span>' : ''}</span>
                        </div>
                        <span style="color:${pts_color};font-weight:700;font-size:${isTop3?'15px':'13px'};">${points.toLocaleString()} pts</span>
                    </div>`;
                }).join('');
            }
            return html;
        }

        // Helper to send a notification
        async function notify(recipientUserId, swimEventId, type, title, message, payloadObj = {}) {
            // Don't notify yourself
            if (currentUser && recipientUserId === currentUser.id) return;

            try {
                const { data: insertedNotif, error } = await supabaseClient
                    .from('notifications')
                    .insert({
                        recipient_user_id: recipientUserId,
                        swim_event_id: swimEventId,
                        type: type,
                        title: title,
                        message: message,
                        payload: payloadObj,
                        created_at: new Date().toISOString()
                    })
                    .select()
                    .single();

                if (error) {
                    console.error('Supabase Notification Error:', error);
                    throw error;
                }

                // Invoke Edge Function directly to deliver push (CORS now handled in function)
                if (insertedNotif) {
                    supabaseClient.functions.invoke('send-push', { body: { record: insertedNotif } })
                        .catch(e => console.warn('Push invoke warning:', e));
                }
            } catch (err) {
                console.error('Notification failed:', err);
                // We don't necessarily want to toast the sender if a background notification fails, 
                // but for debugging it might be useful.
                // showToast(`Failed to send notification`, 'error'); 
            }
        }

        // Initialize polling when app loads
        function startNotificationPolling() {
            updateUnreadCount();
            setInterval(updateUnreadCount, 30000); // Poll every 30s
        }

        // ============================================
        // WEB PUSH NOTIFICATIONS
        // ============================================

        // Convert VAPID key from base64 to Uint8Array (required by PushManager)
        function urlBase64ToUint8Array(base64String) {
            const padding = '='.repeat((4 - base64String.length % 4) % 4);
            const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
            const rawData = window.atob(base64);
            const outputArray = new Uint8Array(rawData.length);
            for (let i = 0; i < rawData.length; ++i) {
                outputArray[i] = rawData.charCodeAt(i);
            }
            return outputArray;
        }

        // Tracks whether push is currently subscribed (used by toggleNotifRegion)
        let _notifSubscribed = false;
        // In-memory copy of preferred_locations — avoids race conditions from concurrent read-modify-write
        let _activeNotifLocs = [];

        // Subscribe to push notifications
        // locations: array of domain codes to subscribe to (defaults to home_domain)
        async function subscribeToPush(locations) {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
                console.log('Push notifications not supported');
                return false;
            }
            if (VAPID_PUBLIC_KEY === 'REPLACE_WITH_YOUR_VAPID_PUBLIC_KEY') {
                console.log('VAPID key not configured yet');
                return false;
            }

            try {
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    console.log('Notification permission denied');
                    return false;
                }

                const registration = await navigator.serviceWorker.ready;
                let subscription = await registration.pushManager.getSubscription();
                if (!subscription) {
                    subscription = await registration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
                    });
                }

                // Resolve locations array — default to home_domain
                const locs = (locations && locations.length)
                    ? locations
                    : (currentUserProfile?.home_domain ? [currentUserProfile.home_domain] : []);

                const subJson = subscription.toJSON();
                const { error } = await supabaseClient
                    .from('push_subscriptions')
                    .upsert({
                        user_id: currentUser.id,
                        endpoint: subJson.endpoint,
                        p256dh: subJson.keys.p256dh,
                        auth: subJson.keys.auth,
                        user_agent: navigator.userAgent,
                        preferred_locations: locs,
                    }, { onConflict: 'user_id,endpoint' });

                if (error) {
                    console.error('Error saving push subscription:', error);
                    return false;
                }
                return true;
            } catch (err) {
                console.error('Push subscription failed:', err);
                return false;
            }
        }

        // Broadcast push — type: 'temp' | 'swim' | 'new_member' (fire-and-forget)
        function broadcastPush(location, type, title, body) {
            if (!currentUser) return;
            if (type !== 'new_member' && !location) return;
            supabaseClient.functions.invoke('send-push', { body: { location, type, title, body } })
                .catch(e => console.warn('broadcastPush warn:', e));
        }

        // Update a scalar pref (notify_on_temp / notify_on_swim / notify_on_new_member)
        async function updatePushPref(key, value) {
            if (!currentUser) return;
            const registration = await navigator.serviceWorker.ready.catch(() => null);
            if (!registration) return;
            const sub = await registration.pushManager.getSubscription().catch(() => null);
            if (!sub) return;
            await supabaseClient.from('push_subscriptions')
                .update({ [key]: value })
                .eq('user_id', currentUser.id)
                .eq('endpoint', sub.endpoint);
        }

        // Write _activeNotifLocs directly to DB — no read, no race condition
        async function saveNotifLocs() {
            if (!currentUser) return;
            await supabaseClient.from('push_subscriptions')
                .update({ preferred_locations: _activeNotifLocs })
                .eq('user_id', currentUser.id);
        }

        // Unsubscribe from push notifications
        async function unsubscribeFromPush() {
            try {
                const registration = await navigator.serviceWorker.ready;
                const subscription = await registration.pushManager.getSubscription();

                if (subscription) {
                    await supabaseClient
                        .from('push_subscriptions')
                        .delete()
                        .eq('user_id', currentUser.id)
                        .eq('endpoint', subscription.endpoint);

                    await subscription.unsubscribe();
                }
                return true;
            } catch (err) {
                console.error('Unsubscribe failed:', err);
                return false;
            }
        }

        // Check if user is subscribed to push
        async function isPushSubscribed() {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
            try {
                const registration = await navigator.serviceWorker.ready;
                const subscription = await registration.pushManager.getSubscription();
                return !!subscription;
            } catch {
                return false;
            }
        }

        // Toggle push notifications from profile settings
        async function togglePushNotifications(enabled) {
            const track = document.getElementById('pushToggleTrack');
            const thumb = document.getElementById('pushToggleThumb');

            if (enabled) {
                const success = await subscribeToPush();
                if (!success) {
                    document.getElementById('pushToggle').checked = false;
                    if (track) track.style.background = 'rgba(255,255,255,0.15)';
                    if (thumb) thumb.style.transform = 'translateX(0)';
                    showToast('Could not enable notifications. Check browser settings.', 'error');
                } else {
                    if (track) track.style.background = 'var(--success)';
                    if (thumb) thumb.style.transform = 'translateX(22px)';
                    showToast('Push notifications enabled!', 'success');
                }
            } else {
                await unsubscribeFromPush();
                if (track) track.style.background = 'rgba(255,255,255,0.15)';
                if (thumb) thumb.style.transform = 'translateX(0)';
                showToast('Push notifications disabled', 'info');
            }
        }

        // Toggle new swim alerts opt-in preference
        async function toggleNewSwimAlerts(enabled) {
            if (!currentUser) return;
            const track = document.getElementById('newSwimAlertsTrack');
            const thumb = document.getElementById('newSwimAlertsThumb');
            try {
                await supabaseClient
                    .from('profiles')
                    .update({ notify_new_swims: enabled })
                    .eq('id', currentUser.id);
                if (track) track.style.background = enabled ? 'var(--success)' : 'rgba(255,255,255,0.15)';
                if (thumb) thumb.style.transform = enabled ? 'translateX(22px)' : 'translateX(0)';
                showToast(enabled ? 'New swim alerts on' : 'New swim alerts off', 'success');
            } catch (err) {
                console.error('Error saving new swim alerts preference:', err);
                showToast('Could not save preference', 'error');
            }
        }

        // ── Contextual notification opt-in card (shown on dashboard) ────────────
        async function renderNotifOptIn() {
            const el = document.getElementById('notifOptIn');
            if (!el) return;
            if (!('PushManager' in window) || !('Notification' in window)) return;
            if (VAPID_PUBLIC_KEY === 'REPLACE_WITH_YOUR_VAPID_PUBLIC_KEY') return;

            const subscribed = await isPushSubscribed();
            const denied     = Notification.permission === 'denied';

            if (denied) {
                el.style.display = 'block';
                el.innerHTML = `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:10px;">
                    <i data-lucide="bell-off" style="width:18px;height:18px;color:var(--text-secondary);flex-shrink:0;"></i>
                    <div style="font-size:12px;color:var(--text-secondary);flex:1;">Notifications blocked. Enable them in your browser or app settings to receive swim alerts.</div>
                </div>`;
                if (typeof lucide !== 'undefined') lucide.createIcons();
                return;
            }

            // Fetch current prefs from DB
            let activeLocs = currentUserProfile?.home_domain ? [currentUserProfile.home_domain] : [];
            let notifyTemp = true, notifySwim = true, notifyMember = false;
            if (subscribed) {
                // Query by user_id only — endpoint can change when subscriptions renew
                const { data } = await supabaseClient.from('push_subscriptions')
                    .select('preferred_locations, notify_on_temp, notify_on_swim, notify_on_new_member')
                    .eq('user_id', currentUser.id)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                if (data) {
                    activeLocs    = data.preferred_locations || activeLocs;
                    notifyTemp    = data.notify_on_temp   ?? true;
                    notifySwim    = data.notify_on_swim   ?? true;
                    notifyMember  = data.notify_on_new_member ?? false;
                }
            }

            // Store subscribed state so toggleNotifRegion() knows what to do
            _notifSubscribed = subscribed;
            // Seed in-memory array so toggleNotifRegion() can write without reading
            _activeNotifLocs = [...activeLocs];

            const mkToggle = (id, checked, onchange) => {
                const bg = checked ? 'var(--ocean-light)' : 'rgba(255,255,255,0.2)';
                const tx = checked ? '20px' : '0px';
                return `<label style="position:relative;display:inline-block;width:46px;height:26px;flex-shrink:0;cursor:pointer;">
                    <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} onchange="${onchange}" style="opacity:0;width:0;height:0;position:absolute;">
                    <span style="position:absolute;inset:0;border-radius:26px;transition:background 0.25s;background:${bg};"></span>
                    <span style="position:absolute;height:20px;width:20px;left:3px;bottom:3px;background:white;border-radius:50%;transition:transform 0.25s;transform:translateX(${tx});box-shadow:0 1px 3px rgba(0,0,0,0.3);"></span>
                </label>`;
            };

            const regionChips = domains.map(d => {
                const active = activeLocs.includes(d.code);
                return `<button type="button" onclick="toggleNotifRegion('${d.code}')"
                    data-region="${d.code}" data-active="${active}"
                    style="padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;
                           background:${active ? 'var(--ocean-blue)' : 'rgba(255,255,255,0.05)'};
                           border:1px solid ${active ? 'var(--ocean-blue)' : 'rgba(255,255,255,0.12)'};
                           color:${active ? '#fff' : 'var(--text-secondary)'};">
                    ${d.display_name}
                </button>`;
            }).join('');

            el.style.display = 'block';
            el.innerHTML = `
                <div style="background:linear-gradient(135deg,rgba(2,132,199,0.08),rgba(34,211,238,0.04));border:1px solid rgba(56,189,248,0.18);border-radius:16px;padding:16px 18px;">

                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
                        <div style="width:32px;height:32px;background:rgba(56,189,248,0.15);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                            <i data-lucide="bell" style="width:16px;height:16px;color:var(--ocean-light);"></i>
                        </div>
                        <div>
                            <div style="font-size:14px;font-weight:700;color:var(--text-primary);">Swim Alerts</div>
                            <div style="font-size:11px;color:var(--text-secondary);margin-top:1px;">${subscribed ? 'Tap regions to add or remove' : 'Choose your regions, then enable'}</div>
                        </div>
                    </div>

                    <div style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Regions</div>
                    <div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:16px;">${regionChips}</div>

                    <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:12px;display:flex;flex-direction:column;gap:10px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <div>
                                <div style="font-size:13px;font-weight:500;color:var(--text-primary);">New swim posts</div>
                                <div style="font-size:11px;color:var(--text-secondary);margin-top:1px;">When a swim is posted in your regions</div>
                            </div>
                            ${subscribed
                                ? mkToggle('notifSwimToggle', notifySwim, `updatePushPref('notify_on_swim',this.checked)`)
                                : mkToggle('_pendingSwim', true, '')}
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <div>
                                <div style="font-size:13px;font-weight:500;color:var(--text-primary);">Water temp logs</div>
                                <div style="font-size:11px;color:var(--text-secondary);margin-top:1px;">When someone logs a temp at your spots</div>
                            </div>
                            ${subscribed
                                ? mkToggle('notifTempToggle', notifyTemp, `updatePushPref('notify_on_temp',this.checked)`)
                                : mkToggle('_pendingTemp', true, '')}
                        </div>
                        ${currentUserProfile?.is_admin ? `
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <div>
                                <div style="font-size:13px;font-weight:500;color:var(--text-primary);">New members</div>
                                <div style="font-size:11px;color:var(--text-secondary);margin-top:1px;">When a new swimmer joins</div>
                            </div>
                            ${subscribed
                                ? mkToggle('notifMemberToggle', notifyMember, `updatePushPref('notify_on_new_member',this.checked)`)
                                : mkToggle('_pendingMember', false, '')}
                        </div>` : ''}
                    </div>

                    ${!subscribed ? `
                    <button onclick="enableNotifFromCard()"
                        style="width:100%;margin-top:14px;background:linear-gradient(135deg,var(--ocean-blue),var(--ocean-light));color:#fff;border:none;padding:11px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:0.3px;">
                        Enable Notifications
                    </button>` : ''}
                </div>`;

            // Re-init lucide icons inside the new card
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        // Toggle a notification region chip (works for both subscribed + pre-subscribe)
        function toggleNotifRegion(region) {
            const btn = document.querySelector(`#notifOptIn [data-region="${region}"]`);
            if (!btn) return;
            const active = btn.dataset.active === 'true';
            const newActive = !active;
            btn.dataset.active = String(newActive);
            btn.style.background  = newActive ? 'var(--ocean-blue)' : 'rgba(255,255,255,0.05)';
            btn.style.borderColor = newActive ? 'var(--ocean-blue)' : 'rgba(255,255,255,0.12)';
            btn.style.color       = newActive ? '#fff' : 'var(--text-secondary)';
            // Update in-memory array (no DB read — eliminates race condition)
            if (newActive) { if (!_activeNotifLocs.includes(region)) _activeNotifLocs.push(region); }
            else { _activeNotifLocs = _activeNotifLocs.filter(r => r !== region); }
            // If already subscribed, persist to DB immediately
            if (_notifSubscribed) saveNotifLocs();
        }

        async function enableNotifFromCard() {
            // Collect selected regions from chips
            const chips = document.querySelectorAll('#notifOptIn [data-region]');
            const selectedLocs = Array.from(chips)
                .filter(c => c.dataset.active === 'true')
                .map(c => c.dataset.region);

            const ok = await subscribeToPush(selectedLocs.length ? selectedLocs : null);
            if (ok) {
                // Save any pre-selected toggle prefs
                const notifySwim   = document.getElementById('_pendingSwim')?.checked   ?? true;
                const notifyTemp   = document.getElementById('_pendingTemp')?.checked   ?? true;
                const notifyMember = document.getElementById('_pendingMember')?.checked ?? false;
                await updatePushPref('notify_on_swim', notifySwim);
                await updatePushPref('notify_on_temp', notifyTemp);
                await updatePushPref('notify_on_new_member', notifyMember);
                showToast('Swim alerts enabled!', 'success');
                renderNotifOptIn();
            } else if (Notification.permission === 'denied') {
                renderNotifOptIn();
            }
        }

        // Show push notification opt-in prompt (non-blocking banner)
        async function promptPushNotifications() {
            // Don't prompt if not supported or VAPID key not set
            if (!('PushManager' in window) || !('Notification' in window)) return;
            if (VAPID_PUBLIC_KEY === 'REPLACE_WITH_YOUR_VAPID_PUBLIC_KEY') return;

            // Don't prompt if already subscribed or denied
            if (await isPushSubscribed()) return;
            if (Notification.permission === 'denied') return;

            // 7-day cooldown if user dismissed the prompt
            const dismissed = localStorage.getItem('pushPromptDismissed');
            if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000) return;

            const banner = document.createElement('div');
            banner.id = 'pushPromptBanner';
            banner.innerHTML = `
                <div style="background: linear-gradient(135deg, var(--ocean-blue), var(--ocean-dark)); padding: 16px 20px; border-radius: 12px; margin: 16px; display: flex; align-items: center; gap: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
                    <i data-lucide="bell" style="width:22px;height:22px;color:white;flex-shrink:0;"></i>
                    <div style="flex: 1;">
                        <div style="font-weight: 700; color: white; font-size: 14px;">Get notified when swims change</div>
                        <div style="color: rgba(255,255,255,0.7); font-size: 12px; margin-top: 2px;">Know instantly if a swim is cancelled or moved</div>
                    </div>
                    <button onclick="enablePushFromPrompt()" style="background: white; color: var(--ocean-blue); border: none; padding: 8px 16px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; white-space: nowrap;">Enable</button>
                    <button onclick="dismissPushPrompt()" style="background: none; border: none; color: rgba(255,255,255,0.5); font-size: 20px; cursor: pointer; padding: 4px; line-height: 1;">&times;</button>
                </div>
            `;
            if (typeof lucide !== 'undefined') lucide.createIcons();

            const mainApp = document.getElementById('mainApp');
            if (mainApp) {
                mainApp.insertBefore(banner, mainApp.firstChild);
            }
        }

        async function enablePushFromPrompt() {
            const banner = document.getElementById('pushPromptBanner');
            if (banner) banner.remove();

            const success = await subscribeToPush();
            if (success) {
                showToast('Push notifications enabled!', 'success');
            } else {
                showToast('Could not enable notifications. Check browser settings.', 'error');
            }
        }

        function dismissPushPrompt() {
            const banner = document.getElementById('pushPromptBanner');
            if (banner) banner.remove();
            localStorage.setItem('pushPromptDismissed', Date.now().toString());
        }

        // New swim alerts one-time banner
        async function promptNewSwimAlerts() {
            if (!currentUser) return;

            // Don't show if already dismissed permanently
            if (localStorage.getItem('newSwimAlertsDismissed')) return;

            // Don't show if already opted in
            const { data: profile } = await supabaseClient
                .from('profiles')
                .select('notify_new_swims')
                .eq('id', currentUser.id)
                .single();
            if (profile && profile.notify_new_swims) return;

            // Don't show if push banner is visible (avoid two banners at once)
            if (document.getElementById('pushPromptBanner')) return;

            const banner = document.createElement('div');
            banner.id = 'newSwimAlertsBanner';
            banner.innerHTML = `
                <div style="background: linear-gradient(135deg, rgba(16,185,129,0.9), rgba(5,150,105,0.9)); padding: 16px 20px; border-radius: 12px; margin: 16px; display: flex; align-items: center; gap: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
                    <div style="flex: 1;">
                        <div style="font-weight: 700; color: white; font-size: 14px;">Get notified about new swims</div>
                        <div style="color: rgba(255,255,255,0.8); font-size: 12px; margin-top: 2px;">Know when swimmers post new group swims</div>
                    </div>
                    <button onclick="enableNewSwimAlertsFromPrompt()" style="background: white; color: #059669; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; white-space: nowrap;">Enable</button>
                    <button onclick="dismissNewSwimAlertsPrompt()" style="background: none; border: none; color: rgba(255,255,255,0.6); font-size: 20px; cursor: pointer; padding: 4px; line-height: 1;">&times;</button>
                </div>
            `;

            const mainApp = document.getElementById('mainApp');
            if (mainApp) mainApp.insertBefore(banner, mainApp.firstChild);
        }

        async function enableNewSwimAlertsFromPrompt() {
            const banner = document.getElementById('newSwimAlertsBanner');
            if (banner) banner.remove();
            localStorage.setItem('newSwimAlertsDismissed', '1');
            try {
                await supabaseClient
                    .from('profiles')
                    .update({ notify_new_swims: true })
                    .eq('id', currentUser.id);
                showToast('New swim alerts enabled!', 'success');
            } catch (err) {
                console.error('Error enabling new swim alerts:', err);
            }
        }

        function dismissNewSwimAlertsPrompt() {
            const banner = document.getElementById('newSwimAlertsBanner');
            if (banner) banner.remove();
            localStorage.setItem('newSwimAlertsDismissed', '1');
        }

        async function updateUnreadCount() {
            if (!currentUser) return;
            try {
                const { count, error } = await supabaseClient
                    .from('notifications')
                    .select('*', { count: 'exact', head: true })
                    .eq('recipient_user_id', currentUser.id)
                    .is('read_at', null);

                if (error) throw error;

                const badge = document.getElementById('notifBadge');
                const bellIcon = document.getElementById('bellIcon');
                const prevCount = parseInt(badge.dataset.count || '0');
                if (count > 0) {
                    badge.style.display = 'flex';
                    badge.style.alignItems = 'center';
                    badge.style.justifyContent = 'center';
                    badge.innerText = count > 9 ? '9+' : count;
                    badge.dataset.count = count;
                    if (bellIcon) bellIcon.classList.add('bell-has-notifs');
                    // Ring the bell when new notifications arrive
                    if (count > prevCount && bellIcon) {
                        bellIcon.classList.remove('bell-ringing');
                        void bellIcon.offsetWidth; // force reflow
                        bellIcon.classList.add('bell-ringing');
                    }
                } else {
                    badge.style.display = 'none';
                    badge.innerText = '';
                    badge.dataset.count = '0';
                    if (bellIcon) {
                        bellIcon.classList.remove('bell-has-notifs');
                        bellIcon.classList.remove('bell-ringing');
                    }
                }
            } catch (err) {
                console.error('Error polling notifications:', err);
            }
        }

        async function loadNotifications() {
            const modal = document.getElementById('notifModal');
            const list = document.getElementById('notifList');

            if (!currentUser) return;

            try {
                const { data, error } = await supabaseClient
                    .from('notifications')
                    .select('*')
                    .eq('recipient_user_id', currentUser.id)
                    .order('created_at', { ascending: false })
                    .limit(50); // Get latest 50

                if (error) throw error;

                if (!data || data.length === 0) {
                    list.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);">No notifications yet</div>';
                } else {
                    list.innerHTML = data.map(n => {
                        const isRead = n.read_at !== null;
                        return `
                        <div onclick="markNotifRead('${n.id}')" style="cursor: pointer; padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.05); background: ${isRead ? 'transparent' : 'rgba(56, 189, 248, 0.05)'}; position: relative;">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
                                <div style="font-weight: 700; color: ${isRead ? 'var(--text-secondary)' : 'var(--ocean-light)'}; font-size: 14px;">${n.title}</div>
                                <div style="font-size: 11px; color: var(--text-secondary); white-space: nowrap; margin-left: 8px;">${getTimeAgo(new Date(n.created_at))}</div>
                            </div>
                            ${n.message ? `<div style="font-size: 13px; color: ${isRead ? 'var(--text-secondary)' : 'var(--text-primary)'}; margin-top: 4px;">${n.message}</div>` : ''}
                            ${!isRead ? `<div style="width: 8px; height: 8px; background: var(--ocean-light); border-radius: 50%; position: absolute; top: 20px; right: 10px;"></div>` : ''}
                    `}).join('');
                }

                // Update badge immediately
                updateUnreadCount();

            } catch (err) {
                console.error('Error loading notifications:', err);
                list.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--danger);">Error loading notifications</div>';
            }
        }

        async function showNotifications() {
            const list = document.getElementById('notifList');
            const modal = document.getElementById('notifModal');

            modal.style.display = 'flex';
            list.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-secondary);">Loading...</div>';

            await loadNotifications();
        }



        async function markNotifRead(id) {
            try {
                await supabaseClient.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
                await loadNotifications();
            } catch (err) {
                console.error('Error marking as read:', err);
                showToast('Failed to mark notification as read', 'error');
            }
        }

        async function markAllNotifsRead() {
            try {
                await supabaseClient.from('notifications')
                    .update({ read_at: new Date().toISOString() })
                    .eq('recipient_user_id', currentUser.id)
                    .is('read_at', null);
                await loadNotifications();
            } catch (err) {
                console.error('Error marking all as read:', err);
                showToast('Failed to mark all notifications as read', 'error');
            }
        }

        function closeNotifModal() {
            document.getElementById('notifModal').style.display = 'none';
        }

        // ── Home Region Prompt ────────────────────────────────────────────────────
        function showHomeDomainPrompt() {
            if (sessionStorage.getItem('homeDomainDismissed')) return;
            const modal = document.getElementById('homeDomainPrompt');
            if (!modal) return;
            const sel = document.getElementById('homeDomainSelect');
            sel.innerHTML = '<option value="">Select your region...</option>'
                + domains.map(d => `<option value="${d.code}">${d.display_name}</option>`).join('');
            modal.style.display = 'flex';
        }

        async function saveHomeDomain() {
            const val = document.getElementById('homeDomainSelect').value;
            if (!val) { showToast('Please select a region', 'error'); return; }
            const { error } = await supabaseClient
                .from('profiles').update({ home_domain: val }).eq('id', currentUser.id);
            if (error) { showToast('Error saving — try again', 'error'); return; }
            currentUserProfile = { ...currentUserProfile, home_domain: val };
            document.getElementById('homeDomainPrompt').style.display = 'none';
            // Update profile select in settings if open
            const hds = document.getElementById('profileHomeDomain');
            if (hds) hds.value = val;
            showToast('Home region set! Refreshing your feed...', 'success');
            loadDashboard();
        }

        function dismissHomeDomainPrompt() {
            sessionStorage.setItem('homeDomainDismissed', '1');
            document.getElementById('homeDomainPrompt').style.display = 'none';
        }

        // Returns getTempColor() for open water; neutral for pools (their temps are unrelated to ocean scale)
        function getDisplayTempColor(temp, waterType) {
            if (waterType === 'POOL') return 'var(--ocean-light)';
            return getTempColor(temp);
        }

        function getTempColor(temp) {
            if (temp < 10) return '#6366f1';  // Indigo - Ice cold
            if (temp < 12) return '#3b82f6';  // Blue - Very cold
            if (temp < 14) return '#0ea5e9';  // Sky blue - Cold
            if (temp < 16) return '#06b6d4';  // Cyan - Cool
            if (temp < 18) return '#14b8a6';  // Teal - Refreshing
            if (temp < 20) return '#10b981';  // Emerald - Nice
            if (temp < 22) return '#84cc16';  // Lime - Warm
            if (temp < 24) return '#f59e0b';  // Amber - Quite warm
            if (temp < 26) return '#f97316';  // Orange - Hot
            if (temp < 28) return '#ef4444';  // Red - Very hot
            if (temp < 30) return '#dc2626';  // Dark red - Scorching
            return '#b91c1c';                  // Deep red - Extreme
        }

        function getTempLabel(temp) {
            if (temp < 10) return 'Ice Cold';
            if (temp < 12) return 'Very Cold';
            if (temp < 14) return 'Cold';
            if (temp < 16) return 'Cool';
            if (temp < 18) return 'Refreshing';
            if (temp < 20) return 'Nice';
            if (temp < 22) return 'Warm';
            if (temp < 24) return 'Quite Warm';
            if (temp < 26) return 'Hot';
            if (temp < 28) return 'Very Hot';
            if (temp < 30) return 'Scorching';
            return 'Too Hot!';
        }

        function updateTempSlider(val) {
            const temp = parseFloat(val);
            const color = getTempColor(temp);
            const label = getTempLabel(temp);
            const display = document.getElementById('tempValue');
            display.textContent = val + '°C';
            display.style.color = color;
            display.style.textShadow = `0 0 30px ${color}40, 0 0 60px ${color}20`;

            // Update or create temp label
            let labelEl = document.getElementById('tempLabel');
            if (!labelEl) {
                labelEl = document.createElement('div');
                labelEl.id = 'tempLabel';
                labelEl.style.cssText = 'text-align: center; font-size: 13px; font-weight: 600; margin-top: -8px; margin-bottom: 12px; transition: all 0.3s ease; letter-spacing: 0.5px;';
                display.parentNode.insertBefore(labelEl, display.nextSibling);
            }
            labelEl.textContent = label;
            labelEl.style.color = color;
        }

        function toggleSingle(el) {
            // Colour config per condition — selected state is unmistakably different from unselected
            const COND_STYLE = {
                'Calm':    { border:'#10b981', bg:'rgba(16,185,129,0.22)',  color:'#10b981',  shadow:'rgba(16,185,129,0.35)' },
                'Choppy':  { border:'#f59e0b', bg:'rgba(245,158,11,0.22)', color:'#f59e0b',  shadow:'rgba(245,158,11,0.35)' },
                'Rough':   { border:'#f97316', bg:'rgba(249,115,22,0.22)', color:'#f97316',  shadow:'rgba(249,115,22,0.35)' },
                'Extreme': { border:'#ef4444', bg:'rgba(239,68,68,0.22)',  color:'#ef4444',  shadow:'rgba(239,68,68,0.35)'  },
            };
            // Reset all to clearly inactive (muted, no glow)
            el.parentElement.querySelectorAll('.toggle-btn').forEach(b => {
                b.classList.remove('active');
                b.style.border      = '2px solid rgba(255,255,255,0.1)';
                b.style.background  = 'rgba(255,255,255,0.04)';
                b.style.color       = 'var(--text-secondary)';
                b.style.boxShadow   = 'none';
            });
            // Apply clearly active state to selected button
            el.classList.add('active');
            const cfg = COND_STYLE[el.textContent.trim()] || COND_STYLE['Calm'];
            el.style.border     = `2px solid ${cfg.border}`;
            el.style.background = cfg.bg;
            el.style.color      = cfg.color;
            el.style.boxShadow  = `0 0 14px ${cfg.shadow}`;
        }

        // ─── Club Membership ──────────────────────────────────────────────────

        async function loadClubMembership() {
            const section = document.getElementById('clubMembershipSection');
            const card    = document.getElementById('clubMembershipCard');
            if (!section || !card || !currentUser) return;

            // Fetch all clubs this user belongs to
            const { data: memberships, error } = await supabaseClient
                .from('club_members')
                .select('member_number, role, joined_at, club_categories(name), clubs(id, name, slug, code, country, tagline, logo_url)')
                .eq('user_id', currentUser.id)
                .eq('is_active', true);

            if (error || !memberships || memberships.length === 0) {
                section.style.display = 'none';
                return;
            }

            section.style.display = 'block';

            const CAT_COLORS = {
                Guppies:     { color: '#34d399', bg: 'rgba(52,211,153,0.1)',  border: 'rgba(52,211,153,0.25)' },
                Sailfish:    { color: '#38bdf8', bg: 'rgba(56,189,248,0.1)',  border: 'rgba(56,189,248,0.25)' },
                Makos:       { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.25)' },
                Walrus:      { color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)' },
                Coelacanths: { color: '#fb923c', bg: 'rgba(251,146,60,0.1)',  border: 'rgba(251,146,60,0.25)' },
            };

            card.innerHTML = memberships.map(m => {
                const club   = m.clubs;
                if (!club) return '';
                const cat    = m.club_categories?.name || null;
                const catCfg = cat ? (CAT_COLORS[cat] || { color: '#38bdf8', bg: 'rgba(56,189,248,0.1)', border: 'rgba(56,189,248,0.25)' }) : null;
                const isAdmin = m.role === 'admin' || m.role === 'organiser';
                const joinDate = new Date(m.joined_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });

                return `
                <div style="background:rgba(56,189,248,0.04);border:1px solid rgba(56,189,248,0.15);border-radius:14px;padding:16px;margin-bottom:10px;">
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
                        ${club.logo_url
                            ? `<img src="${club.logo_url}" alt="" style="height:36px;width:36px;object-fit:contain;border-radius:6px;background:rgba(255,255,255,0.05);padding:3px;flex-shrink:0;">`
                            : `<div style="height:36px;width:36px;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.2);border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i data-lucide="waves" style="width:16px;height:16px;color:var(--ocean-light);"></i></div>`
                        }
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:14px;font-weight:700;color:var(--text-primary);line-height:1.2;">${club.name}</div>
                            ${club.tagline ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${club.tagline}</div>` : ''}
                        </div>
                        ${isAdmin ? `<span style="font-size:10px;font-weight:700;background:rgba(245,158,11,0.12);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);padding:2px 8px;border-radius:6px;white-space:nowrap;">ADMIN</span>` : ''}
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
                        <div style="background:rgba(0,0,0,0.25);border-radius:8px;padding:8px 12px;text-align:center;min-width:64px;">
                            <div style="font-size:18px;font-weight:800;color:var(--ocean-light);font-family:monospace;line-height:1;">${m.member_number}</div>
                            <div style="font-size:10px;color:var(--text-secondary);margin-top:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Race #</div>
                        </div>
                        ${catCfg ? `
                        <div style="background:${catCfg.bg};border:1px solid ${catCfg.border};border-radius:8px;padding:8px 12px;text-align:center;min-width:64px;">
                            <div style="font-size:13px;font-weight:700;color:${catCfg.color};line-height:1;">${cat}</div>
                            <div style="font-size:10px;color:var(--text-secondary);margin-top:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Category</div>
                        </div>` : ''}
                        <div style="background:rgba(0,0,0,0.25);border-radius:8px;padding:8px 12px;text-align:center;">
                            <div style="font-size:12px;font-weight:600;color:var(--text-primary);line-height:1;">${joinDate}</div>
                            <div style="font-size:10px;color:var(--text-secondary);margin-top:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Joined</div>
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <a href="/clubs/${club.slug}" target="_blank"
                           style="flex:1;min-width:120px;display:flex;align-items:center;justify-content:center;gap:6px;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.2);border-radius:8px;padding:9px 14px;font-size:12px;font-weight:700;color:var(--ocean-light);text-decoration:none;">
                            <i data-lucide="trophy" style="width:13px;height:13px;"></i>Club page &amp; leaderboard
                        </a>
                        ${isAdmin ? `
                        <a href="/club-admin/${club.slug}" target="_blank"
                           style="display:flex;align-items:center;justify-content:center;gap:6px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:9px 14px;font-size:12px;font-weight:700;color:#f59e0b;text-decoration:none;">
                            <i data-lucide="settings" style="width:13px;height:13px;"></i>Admin
                        </a>` : ''}
                    </div>
                </div>`;
            }).join('');

            initIcons();
        }

        // ─── Strava Integration ───────────────────────────────────────────────

        async function initStravaSection() {
            const card = document.getElementById('stravaConnectionCard');
            if (!card || !currentUser) return;

            card.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;">Checking Strava…</div>`;

            try {
                const { data } = await supabaseClient
                    .from('strava_connections')
                    .select('strava_athlete_id, updated_at')
                    .eq('user_id', currentUser.id)
                    .maybeSingle();

                if (data) {
                    renderStravaConnected(card, data);
                } else {
                    renderStravaDisconnected(card);
                }
            } catch (err) {
                console.error('[strava] initStravaSection error:', err);
                renderStravaDisconnected(card);
            }
        }

        function renderStravaDisconnected(card) {
            card.innerHTML = `
                <div style="background:rgba(252,76,2,0.05);border:1px solid rgba(252,76,2,0.2);border-radius:12px;padding:14px 16px;">
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
                        <div style="width:36px;height:36px;background:#fc4c02;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>
                        </div>
                        <div>
                            <div style="font-weight:700;font-size:14px;color:var(--text-primary);">Strava</div>
                            <div style="font-size:12px;color:var(--text-secondary);margin-top:1px;">Import your swims. Add water conditions here.</div>
                        </div>
                    </div>
                    <button onclick="connectStrava()" style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:#fc4c02;color:white;border:none;border-radius:8px;padding:11px 16px;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:0.2px;transition:opacity 0.2s;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>
                        Connect with Strava
                    </button>
                </div>`;
        }

        function renderStravaConnected(card, data) {
            const connectedDate = new Date(data.updated_at || data.created_at).toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' });
            card.innerHTML = `
                <div style="background:rgba(252,76,2,0.06);border:1px solid rgba(252,76,2,0.25);border-radius:12px;padding:14px 16px;">
                    <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px;">
                        <div style="width:36px;height:36px;background:#fc4c02;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>
                        </div>
                        <div style="flex:1;">
                            <div style="font-weight:600;font-size:14px;color:var(--text-primary);">Strava <span style="font-size:11px;color:#fc4c02;background:rgba(252,76,2,0.12);padding:2px 7px;border-radius:10px;margin-left:4px;">Connected</span></div>
                            <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">Since ${connectedDate}</div>
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button onclick="openStravaImportModal()"
                            style="flex:1;background:#fc4c02;color:white;border:none;border-radius:8px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;">
                            View &amp; import swims
                        </button>
                        <button onclick="disconnectStrava()"
                            style="background:rgba(15,23,42,0.6);color:var(--text-secondary);border:1.5px solid rgba(56,189,248,0.15);border-radius:8px;padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:all 0.2s;">
                            Disconnect
                        </button>
                    </div>
                </div>`;
        }

        async function connectStrava() {
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
                console.error('[strava] connectStrava error:', err);
                showToast('Could not connect to Strava. Please try again.', 'error');
                btn.textContent = 'Connect';
                btn.disabled = false;
            }
        }

        async function disconnectStrava() {
            if (!currentUser) return;
            if (!confirm('Disconnect Strava? Your existing SwimLoading logs will not be affected.')) return;

            try {
                await supabaseClient
                    .from('strava_connections')
                    .delete()
                    .eq('user_id', currentUser.id);

                const card = document.getElementById('stravaConnectionCard');
                if (card) renderStravaDisconnected(card);
                showToast('Strava disconnected.', 'info');
            } catch (err) {
                console.error('[strava] disconnectStrava error:', err);
                showToast('Could not disconnect Strava. Please try again.', 'error');
            }
        }
