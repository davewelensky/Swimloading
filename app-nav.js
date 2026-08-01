        function showAuthTab(tab) {
            // Clear the "you already have an account" nudge on any manual
            // tab switch so it never lingers into an unrelated view.
            var _ln = document.getElementById('loginNotice');
            if (_ln) _ln.style.display = 'none';
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
        async function loadMonthlyChallenge() {
            const el = document.getElementById('monthlyChallenge');
            if (!el) return;

            // Delegate to June Challenge engine
            await jcInit();
            if (jcIsActive()) {
                jcLoadBoardSection();
                return;
            }
        }

        async function loadClubCard() {
            if (!currentUser) return;
            const el = document.getElementById('dashClubCard');
            if (!el) return;
            try {
                // Check swimmer membership first
                const { data: membership } = await supabaseClient
                    .from('club_members')
                    .select('member_number, role, club_categories(name), clubs(name, slug, code)')
                    .eq('user_id', currentUser.id)
                    .eq('is_active', true)
                    .limit(1)
                    .single();

                if (membership?.clubs) {
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
                    return;
                }

                // Not a swimmer — check for approved parent links
                const { data: parentLinks } = await supabaseClient
                    .from('parent_roster_links')
                    .select('relationship, status, club_roster(display_name, category), clubs(name, slug)')
                    .eq('parent_user_id', currentUser.id)
                    .in('status', ['approved', 'pending'])
                    .order('status'); // approved first

                if (parentLinks?.length) {
                    const approved = parentLinks.filter(l => l.status === 'approved');
                    const pending  = parentLinks.filter(l => l.status === 'pending');
                    const club     = (approved[0] || pending[0])?.clubs;
                    if (club) {
                        const swimmerList = approved.length
                            ? approved.map(l => `<span style="font-weight:700;color:var(--text);">${l.club_roster?.display_name || '—'}</span>`).join(', ')
                            : `<span style="color:var(--amber);">Pending approval</span>`;
                        el.innerHTML = `
                            <a href="/clubs/${club.slug}" style="display:block;text-decoration:none;
                                background:linear-gradient(135deg,rgba(167,139,250,0.07),rgba(167,139,250,0.02));
                                border:1px solid rgba(167,139,250,0.2); border-radius:16px; padding:16px 18px;">
                                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                                    <div style="min-width:0;">
                                        <div style="font-size:10px;font-weight:700;color:#a78bfa;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:5px;">
                                            ${club.name}
                                        </div>
                                        <div style="font-size:11px;color:var(--text-sec);margin-bottom:4px;">Following</div>
                                        <div style="font-size:14px;line-height:1.4;">${swimmerList}</div>
                                        ${pending.length && !approved.length ? `<div style="font-size:11px;color:var(--amber);margin-top:4px;">Access pending admin approval</div>` : ''}
                                    </div>
                                    <div style="display:flex;align-items:center;gap:6px;background:rgba(167,139,250,0.08);border:1px solid rgba(167,139,250,0.2);border-radius:10px;padding:10px 14px;flex-shrink:0;">
                                        <i data-lucide="users" style="width:14px;height:14px;color:#a78bfa;"></i>
                                        <span style="font-size:12px;font-weight:700;color:#a78bfa;">Club</span>
                                    </div>
                                </div>
                            </a>`;
                        lucide.createIcons();
                        return;
                    }
                }

                // Check club admin access — show all clubs this user administers
                const { data: adminClubs } = await supabaseClient
                    .from('club_admins')
                    .select('role, clubs(name, slug, code)')
                    .eq('user_id', currentUser.id);

                if (!adminClubs?.length) return;

                const clubs = adminClubs.map(a => a.clubs).filter(Boolean);
                if (!clubs.length) return;

                el.innerHTML = `
                    <div style="background:linear-gradient(135deg,rgba(56,189,248,0.07),rgba(56,189,248,0.02));
                        border:1px solid rgba(56,189,248,0.18); border-radius:16px; padding:16px 18px;">
                        <div style="font-size:10px;font-weight:700;color:var(--ocean-light);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:10px;">
                            Club Admin
                        </div>
                        <div style="display:flex;flex-direction:column;gap:8px;">
                            ${clubs.map(c => `
                                <a href="/clubs/${c.slug}" style="display:flex;align-items:center;justify-content:space-between;background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.15);border-radius:10px;padding:10px 14px;text-decoration:none;">
                                    <div>
                                        <div style="font-size:13px;font-weight:700;color:var(--text);">${c.name}</div>
                                        <div style="font-size:11px;color:var(--text-sec);margin-top:1px;">${c.code}</div>
                                    </div>
                                    <i data-lucide="arrow-right" style="width:14px;height:14px;color:var(--ocean-light);flex-shrink:0;"></i>
                                </a>`).join('')}
                        </div>
                    </div>`;
                lucide.createIcons();
            } catch (e) { /* not a member, parent, or admin — card stays hidden */ }
        }

        async function loadClubAdminBanner() {
            try {
                const banner = document.getElementById('clubAdminBanner');
                if (!banner || !currentUser) return;

                // Fetch admin and coach roles in parallel
                const [adminRes, coachRes] = await Promise.all([
                    supabaseClient
                        .from('club_admins')
                        .select('role, clubs(name, slug)')
                        .eq('user_id', currentUser.id)
                        .eq('role', 'admin'),
                    supabaseClient
                        .from('club_admins')
                        .select('role, clubs(name, slug, features)')
                        .eq('user_id', currentUser.id)
                        .eq('role', 'coach'),
                ]);

                const adminClubs = (adminRes.data || []).map(a => a.clubs).filter(Boolean);
                const coachClubs = (coachRes.data || []).map(a => a.clubs).filter(Boolean);
                // Coaches also get a Sets Planner link for clubs with the sets feature (hasSquads)
                const coachSetsClubs = coachClubs.filter(c => c.features?.hasSquads);

                if (!adminClubs.length && !coachClubs.length) return;

                banner.style.display = 'block';
                banner.innerHTML = [
                    ...adminClubs.map(c => `
                    <a href="/club-admin/${c.slug}"
                       style="display:flex;align-items:center;justify-content:space-between;gap:12px;
                              background:linear-gradient(135deg,rgba(245,158,11,0.1),rgba(245,158,11,0.04));
                              border:1px solid rgba(245,158,11,0.25);border-radius:14px;
                              padding:13px 16px;text-decoration:none;margin-bottom:8px;">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <div style="width:36px;height:36px;border-radius:10px;background:rgba(245,158,11,0.15);
                                        display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                                <i data-lucide="shield" style="width:18px;height:18px;color:#f59e0b;"></i>
                            </div>
                            <div>
                                <div style="font-size:13px;font-weight:700;color:var(--text-primary);">${c.name}</div>
                                <div style="font-size:11px;color:#f59e0b;margin-top:1px;font-weight:600;">Club Admin Dashboard</div>
                            </div>
                        </div>
                        <i data-lucide="arrow-right" style="width:16px;height:16px;color:#f59e0b;flex-shrink:0;"></i>
                    </a>`),
                    ...coachClubs.map(c => `
                    <a href="/coach/${c.slug}"
                       style="display:flex;align-items:center;justify-content:space-between;gap:12px;
                              background:linear-gradient(135deg,rgba(56,189,248,0.1),rgba(56,189,248,0.04));
                              border:1px solid rgba(56,189,248,0.25);border-radius:14px;
                              padding:13px 16px;text-decoration:none;margin-bottom:8px;">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <div style="width:36px;height:36px;border-radius:10px;background:rgba(56,189,248,0.15);
                                        display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                                <i data-lucide="clipboard-list" style="width:18px;height:18px;color:#38bdf8;"></i>
                            </div>
                            <div>
                                <div style="font-size:13px;font-weight:700;color:var(--text-primary);">${c.name}</div>
                                <div style="font-size:11px;color:#38bdf8;margin-top:1px;font-weight:600;">Coach Portal</div>
                            </div>
                        </div>
                        <i data-lucide="arrow-right" style="width:16px;height:16px;color:#38bdf8;flex-shrink:0;"></i>
                    </a>`),
                    ...coachSetsClubs.map(c => `
                    <a href="/sets/${c.slug}"
                       style="display:flex;align-items:center;justify-content:space-between;gap:12px;
                              background:linear-gradient(135deg,rgba(168,85,247,0.1),rgba(168,85,247,0.04));
                              border:1px solid rgba(168,85,247,0.25);border-radius:14px;
                              padding:13px 16px;text-decoration:none;margin-bottom:8px;">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <div style="width:36px;height:36px;border-radius:10px;background:rgba(168,85,247,0.15);
                                        display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                                <i data-lucide="calendar-days" style="width:18px;height:18px;color:#a855f7;"></i>
                            </div>
                            <div>
                                <div style="font-size:13px;font-weight:700;color:var(--text-primary);">${c.name}</div>
                                <div style="font-size:11px;color:#a855f7;margin-top:1px;font-weight:600;">Sets Planner</div>
                            </div>
                        </div>
                        <i data-lucide="arrow-right" style="width:16px;height:16px;color:#a855f7;flex-shrink:0;"></i>
                    </a>`),
                ].join('');
                initIcons();
            } catch (e) { /* not a club admin or coach */ }
        }

        // Personal race-day banners — one entry per swimmer with a gala link.
        // Each entry: { userIds:[], emails:[], page, swimmer, gala_date_iso, show_from_iso, hide_after_iso }
        async function loadRaceDayBanner() {
            try {
                const ITALIA_ID = '6d9abd10-612d-4179-a325-e5c9470a8e0c';
                const ITALIA_EMAIL = 'italia@lollis.co.za';
                const PARENT_EMAIL = 'milenapugliese2008@outlook.com'; // mum (Milena)

                const RACE_PAGES = [
                    {
                        ids: [ITALIA_ID],
                        emails: [ITALIA_EMAIL, PARENT_EMAIL],
                        page: '/italia',
                        swimmer: 'Italia',
                        gala_label: 'Saturday gala',
                        gala_date_iso: '2026-06-13',
                        // Show from Friday onwards
                        show_from_iso: '2026-06-12T00:00:00+02:00',
                        hide_after_iso: '2026-06-13T23:59:59+02:00',
                    },
                ];

                const banner = document.getElementById('raceDayBanner');
                if (!banner) return;
                if (!currentUser) return;

                const userId = currentUser?.id;
                const userEmail = (currentUserProfile?.email || currentUser?.email || '').toLowerCase();
                const now = new Date();

                const match = RACE_PAGES.find(r => {
                    const idMatch = r.ids.includes(userId);
                    const emailMatch = r.emails.map(e => e.toLowerCase()).includes(userEmail);
                    if (!idMatch && !emailMatch) return false;
                    const showFrom = new Date(r.show_from_iso);
                    const hideAfter = new Date(r.hide_after_iso);
                    return now >= showFrom && now <= hideAfter;
                });

                if (!match) { banner.style.display = 'none'; return; }

                const gala = new Date(match.gala_date_iso + 'T09:00:00+02:00');
                const diffMs = gala - now;
                const diffH = Math.round(diffMs / 3600000);
                let countdown;
                if (diffMs < 0) countdown = 'today';
                else if (diffH < 24) countdown = `in ${diffH} hour${diffH === 1 ? '' : 's'}`;
                else countdown = 'tomorrow';

                banner.style.display = 'block';
                banner.innerHTML = `
                    <a href="${match.page}" style="display:block;text-decoration:none;background:linear-gradient(135deg,rgba(125,211,252,0.16),rgba(56,189,248,0.06));border:1px solid rgba(125,211,252,0.35);border-radius:14px;padding:14px 16px;color:#fff;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">
                            <span style="background:#7dd3fc;color:#0a0f1e;font-size:10px;font-weight:800;padding:2px 9px;border-radius:20px;letter-spacing:0.3px;">RACE DAY</span>
                            <span style="font-size:11px;color:rgba(255,255,255,0.6);font-weight:600;letter-spacing:0.4px;text-transform:uppercase;">${match.gala_label} ${countdown}</span>
                        </div>
                        <div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:3px;line-height:1.3;">${match.swimmer}&apos;s race day plan</div>
                        <div style="font-size:13px;color:rgba(255,255,255,0.65);margin-bottom:10px;">4 events · timeline · nutrition · between-race protocol</div>
                        <div style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#7dd3fc;">Open the plan
                            <span style="font-size:14px;">&rarr;</span>
                        </div>
                    </a>`;
            } catch (e) {
                console.error('loadRaceDayBanner failed', e);
            }
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

            // Delegate to June Challenge when it's active
            await jcInit();
            if (jcIsActive()) {
                jcLoadDashboardCard();
                return;
            }
        }
        // ─── End Monthly Challenge ──────────────────────────────────────────────

        async function loadLeaderboard() {
            loadDUCChallenge();
            loadMonthlyChallenge();
            if (typeof eoLoadBoardSection === 'function') eoLoadBoardSection(); // non-blocking, independent 3-month campaign
            // Past winners panel — admin only (prize verification)
            if (currentUserProfile?.is_admin) loadPastWinners();
        }

        // ─── DUC Member Challenge ───────────────────────────────────────────────────
        const DUC_CLUB_ID = 'f72cf810-0019-40f8-a57f-476bea8a8f55';
        let _ducMemberChecked = false;
        let _isDUCMember = false;

        async function checkIsDUCMember() {
            if (_ducMemberChecked) return _isDUCMember;
            _ducMemberChecked = true;
            if (!currentUser) return false;
            const { count } = await supabaseClient
                .from('club_roster')
                .select('id', { count: 'exact', head: true })
                .eq('club_id', DUC_CLUB_ID)
                .eq('user_id', currentUser.id)
                .eq('is_active', true);
            _isDUCMember = (count || 0) > 0;
            return _isDUCMember;
        }

        async function loadDUCChallenge() {
            const el = document.getElementById('ducChallenge');
            if (!el) return;

            const isMember = await checkIsDUCMember();
            if (!isMember) return;

            el.style.display = '';
            el.innerHTML = `<div style="text-align:center;padding:14px;color:var(--text-secondary);font-size:13px;">Loading DUC Challenge…</div>`;

            try {
                const now = new Date();
                const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
                const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
                const daysLeft   = Math.ceil((new Date(now.getFullYear(), now.getMonth() + 1, 1) - now) / 86400000);
                const monthName  = now.toLocaleString('en-ZA', { month: 'long', year: 'numeric' });

                const { data: leaders, error } = await supabaseClient.rpc('get_duc_june_leaders', {
                    p_month_start: monthStart,
                    p_month_end:   monthEnd
                });
                if (error) throw error;

                const rows = (leaders || []);
                const myRow  = rows.find(r => r.user_id === currentUser?.id);
                const myIdx  = rows.findIndex(r => r.user_id === currentUser?.id);

                const PRIZES = [
                    { label: '1st', prize: 'Maurten Pack',  color: '#fbbf24', bg: 'rgba(251,191,36,0.12)',   border: 'rgba(251,191,36,0.3)' },
                    { label: '2nd', prize: 'Maurten Pack',  color: '#94a3b8', bg: 'rgba(148,163,184,0.10)',  border: 'rgba(148,163,184,0.25)' },
                    { label: '3rd', prize: 'SiS Pack',      color: '#cd7c2f', bg: 'rgba(205,124,47,0.10)',   border: 'rgba(205,124,47,0.25)' },
                ];

                const prizeRow = PRIZES.map((p, i) => {
                    const leader = rows[i];
                    return `<div style="flex:1;min-width:90px;background:${p.bg};border:1px solid ${p.border};border-radius:10px;padding:10px 12px;">
                        <div style="font-size:10px;font-weight:700;color:${p.color};text-transform:uppercase;letter-spacing:0.05em;">${p.label} · ${p.prize}</div>
                        <div style="font-size:13px;font-weight:700;color:var(--text);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${leader ? leader.display_name : '—'}</div>
                        <div style="font-size:11px;color:var(--text-secondary);margin-top:1px;">${leader ? leader.log_count + ' log' + (leader.log_count !== 1 ? 's' : '') + ' · ' + leader.total_points + ' pts' : 'No logs yet'}</div>
                    </div>`;
                }).join('');

                const myCard = myRow && myRow.log_count > 0 ? `
                    <div style="background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);border-radius:10px;padding:11px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="font-size:13px;font-weight:700;color:var(--text);">You're #${myIdx+1} · ${myRow.total_points} pts</div>
                            <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${myRow.log_count} log${myRow.log_count !== 1 ? 's' : ''} this month${myIdx > 0 ? ' · ' + (rows[myIdx-1].total_points - myRow.total_points) + ' pts behind ' + rows[myIdx-1].display_name : ' · You\'re leading!'}</div>
                        </div>
                        <div style="font-size:15px;font-weight:800;color:${myIdx < 3 ? '#fbbf24' : 'var(--text-secondary)'};">#${myIdx+1}</div>
                    </div>` : '';

                const MEDAL = ['#fbbf24', '#94a3b8', '#cd7c2f'];
                const listRows = rows.slice(0, 15).map((r, i) => {
                    const isMe = r.user_id === currentUser?.id;
                    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;background:${isMe ? 'rgba(56,189,248,0.07)' : 'transparent'};">
                        <div style="font-size:13px;font-weight:800;color:${i < 3 ? MEDAL[i] : 'var(--text-secondary)'};width:22px;text-align:center;">${i+1}</div>
                        <div style="flex:1;font-size:13px;font-weight:${isMe ? '700' : '500'};color:${isMe ? 'var(--text)' : 'var(--text)'}">${r.display_name}${isMe ? ' <span style="font-size:10px;color:var(--cyan);">you</span>' : ''}</div>
                        <div style="font-size:11px;color:var(--text-secondary);">${r.log_count} log${r.log_count !== 1 ? 's' : ''}</div>
                        <div style="font-size:13px;font-weight:700;color:var(--cyan);min-width:44px;text-align:right;">${r.total_points}</div>
                    </div>`;
                }).join('');

                el.innerHTML = `
                <div style="background:linear-gradient(135deg,rgba(14,116,144,0.08),rgba(251,191,36,0.04));border:1px solid rgba(251,191,36,0.25);border-radius:14px;padding:18px;margin-bottom:4px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
                        <div>
                            <div style="font-size:10px;color:#fbbf24;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:3px;">DUC Members Only</div>
                            <div style="font-weight:800;font-size:17px;color:var(--text);line-height:1.2;">${monthName} Temperature Challenge</div>
                            <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">Log the most temps. Log anywhere. 20 pts per log.</div>
                        </div>
                        <div style="background:rgba(251,191,36,0.15);color:#fbbf24;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap;flex-shrink:0;">${daysLeft}d left</div>
                    </div>

                    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">${prizeRow}</div>

                    ${myCard}

                    <div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.7px;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                        <i data-lucide="trophy" style="width:12px;height:12px;color:#fbbf24;"></i>Standings
                    </div>
                    <div style="background:rgba(15,23,42,0.5);border-radius:10px;padding:8px 6px;">
                        ${rows.length ? listRows : '<div style="text-align:center;color:var(--text-secondary);padding:16px;font-size:13px;">No logs yet this month — be first!</div>'}
                    </div>
                </div>`;

                initIcons();
            } catch (e) {
                console.warn('loadDUCChallenge error:', e);
                el.style.display = 'none';
            }
        }

        // ─── Monthly Challenge History ──────────────────────────────────────────────
        // Shows every month from April 2026 onwards.
        // Completed months → winner. Current month → live leader (in progress).
        // Excludes community data contributor from prize eligibility.

        const CONTRIBUTOR_ID = '2f6666a5-e042-44a5-a08d-558d5791c5bd';
        const CHALLENGE_START = { year: 2026, month: 3 }; // 0-indexed: 3 = April

        async function loadPastWinners() {
            const el = document.getElementById('pastWinners');
            if (!el) return;

            const now = new Date();
            const currentYear  = now.getFullYear();
            const currentMonth = now.getMonth(); // 0-indexed

            // Build all months from April 2026 to current month (inclusive)
            const months = [];
            let y = CHALLENGE_START.year;
            let m = CHALLENGE_START.month;
            while (y < currentYear || (y === currentYear && m <= currentMonth)) {
                const start   = new Date(y, m, 1);
                const endDate = new Date(y, m + 1, 0, 23, 59, 59);
                const isCurrent = (y === currentYear && m === currentMonth);
                months.push({
                    label:     start.toLocaleString('default', { month: 'long', year: 'numeric' }),
                    start:     start.toISOString(),
                    end:       endDate.toISOString(),
                    isCurrent,
                });
                m++;
                if (m > 11) { m = 0; y++; }
            }

            // Render skeleton
            el.innerHTML = `
              <div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.1em;margin:20px 0 10px;">
                Monthly Challenge Results
              </div>
              <div id="pastWinnersCards"></div>`;

            const cards = document.getElementById('pastWinnersCards');

            // Fetch all months in parallel
            const results = await Promise.all(months.map(async mo => {
                const { data } = await supabaseClient.rpc('get_monthly_temp_leaders', {
                    p_month_start: mo.start,
                    p_month_end:   mo.end,
                });
                return { mo, data: data || [] };
            }));

            // Render newest first
            results.reverse().forEach(({ mo, data }) => {
                const eligible = data.filter(r => r.user_id !== CONTRIBUTOR_ID);
                const winner   = eligible[0];
                const total    = eligible.length;

                const medal   = mo.isCurrent ? '🔴' : '🥇';
                const label   = mo.isCurrent
                    ? `<span style="font-size:10px;color:#38bdf8;font-weight:700;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.2);padding:2px 7px;border-radius:10px;margin-left:6px;">LIVE</span>`
                    : '';
                const subline = mo.isCurrent
                    ? `${mo.label} · leading with ${winner?.log_count || 0} logs · ${winner?.total_points || 0} pts`
                    : `${mo.label} · ${winner?.log_count || 0} logs · ${winner?.total_points || 0} pts`;

                const topThree = eligible.slice(0, 3).map((r, i) => {
                    const icons = ['🥇','🥈','🥉'];
                    return `<span style="font-size:11px;color:var(--text-secondary);">${icons[i]} ${r.display_name} ${r.total_points}pts</span>`;
                }).join('  ');

                cards.innerHTML += `
                <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,${mo.isCurrent?'0.12':'0.07'});border-radius:12px;margin-bottom:8px;overflow:hidden;">
                  <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;cursor:pointer;"
                       onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
                    <div style="display:flex;align-items:center;gap:10px;">
                      <span style="font-size:18px;">${medal}</span>
                      <div>
                        <div style="display:flex;align-items:center;gap:4px;">
                          <span style="font-size:14px;font-weight:700;color:var(--text);">${winner ? winner.display_name : 'No entries yet'}</span>
                          ${label}
                        </div>
                        <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${subline}</div>
                      </div>
                    </div>
                    <div style="text-align:right;flex-shrink:0;">
                      <div style="font-size:11px;color:var(--text-secondary);">${total} swimmer${total!==1?'s':''}</div>
                    </div>
                  </div>
                  <div style="display:none;padding:0 14px 12px;border-top:1px solid rgba(255,255,255,0.06);">
                    <div style="display:flex;flex-direction:column;gap:6px;padding-top:10px;">
                      ${eligible.slice(0, 5).map((r, i) => {
                          const medals2 = ['🥇','🥈','🥉','4','5'];
                          return `<div style="display:flex;align-items:center;justify-content:space-between;">
                            <div style="display:flex;align-items:center;gap:8px;">
                              <span style="font-size:13px;min-width:20px;">${medals2[i]}</span>
                              <span style="font-size:13px;color:var(--text);">${r.display_name}</span>
                            </div>
                            <span style="font-size:12px;color:var(--text-secondary);">${r.log_count} logs · ${r.total_points} pts</span>
                          </div>`;
                      }).join('')}
                      ${total === 0 ? '<div style="font-size:13px;color:var(--text-secondary);">No logs yet this month.</div>' : ''}
                    </div>
                  </div>
                </div>`;
            });
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

            // Fetch active challenges for this user's clubs and compute their points
            const _clIds = memberships.map(m => m.clubs?.id).filter(Boolean);
            const _today = new Date().toISOString().slice(0, 10);
            const { data: _challenges } = await supabaseClient
                .from('club_challenges')
                .select('id, club_id, title, end_date, start_date, scoring_actions, winner_type')
                .in('club_id', _clIds)
                .eq('status', 'active')
                .gte('end_date', _today);

            const _ucp = {}; // challenge_id → user's computed points
            if (_challenges && _challenges.length > 0) {
                for (const _c of _challenges) {
                    let _pts = 0;
                    const _acts = Array.isArray(_c.scoring_actions) ? _c.scoring_actions : [];

                    // temp_log points
                    const _ta = _acts.find(a => a.type === 'temp_log' && a.enabled && a.auto);
                    if (_ta) {
                        const { count: _tc } = await supabaseClient.from('temp_logs')
                            .select('*', { count: 'exact', head: true })
                            .eq('user_id', currentUser.id)
                            .gte('logged_at', _c.start_date)
                            .lte('logged_at', _c.end_date + 'T23:59:59Z');
                        _pts += (_tc || 0) * _ta.points;
                    }

                    // join_swim points (two-step: get event IDs then participant count)
                    const _ja = _acts.find(a => a.type === 'join_swim' && a.enabled && a.auto);
                    if (_ja) {
                        const { data: _eids } = await supabaseClient.from('swim_events')
                            .select('id').gte('date', _c.start_date).lte('date', _c.end_date);
                        if (_eids && _eids.length > 0) {
                            // RSVP intent lives in the `rsvp` column (going/maybe); `status` is
                            // requested/approved/left. Count swims they're going to and haven't left.
                            const { count: _jc } = await supabaseClient.from('swim_participants')
                                .select('*', { count: 'exact', head: true })
                                .eq('user_id', currentUser.id)
                                .in('swim_event_id', _eids.map(e => e.id))
                                .eq('rsvp', 'going')
                                .neq('status', 'left');
                            _pts += (_jc || 0) * _ja.points;
                        }
                    }

                    // create_swim points
                    const _sa = _acts.find(a => a.type === 'create_swim' && a.enabled && a.auto);
                    if (_sa) {
                        const { count: _sc } = await supabaseClient.from('swim_events')
                            .select('*', { count: 'exact', head: true })
                            .eq('created_by', currentUser.id)
                            .gte('date', _c.start_date).lte('date', _c.end_date);
                        _pts += (_sc || 0) * _sa.points;
                    }

                    // manual / custom action points
                    const { data: _mp } = await supabaseClient.from('club_challenge_points')
                        .select('points').eq('challenge_id', _c.id).eq('user_id', currentUser.id);
                    if (_mp) _pts += _mp.reduce((s, r) => s + r.points, 0);

                    _ucp[_c.id] = _pts;
                }
            }
            // Build club_id → challenges[] map for fast render lookup
            const _cbc = {};
            (_challenges || []).forEach(_c => {
                if (!_cbc[_c.club_id]) _cbc[_c.club_id] = [];
                _cbc[_c.club_id].push({ ..._c, _userPts: _ucp[_c.id] || 0 });
            });

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

                // Active challenge cards for this club
                const _clChallenges = _cbc[club.id] || [];
                const _challengeHtml = _clChallenges.map(_ch => {
                    const _dl = Math.max(0, Math.ceil((new Date(_ch.end_date) - new Date()) / 86400000));
                    const _wl = _ch.winner_type === 'draw_entries' ? 'entries' : 'pts';
                    return `<div style="margin-top:10px;background:rgba(250,204,21,0.05);border:1px solid rgba(250,204,21,0.2);border-radius:10px;padding:12px 14px;">
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                            <div style="display:flex;align-items:center;gap:6px;">
                                <i data-lucide="zap" style="width:13px;height:13px;color:#facc15;flex-shrink:0;"></i>
                                <span style="font-size:13px;font-weight:700;color:#facc15;">${_ch.title}</span>
                            </div>
                            <span style="font-size:10px;font-weight:700;background:rgba(250,204,21,0.12);color:#facc15;border:1px solid rgba(250,204,21,0.25);padding:2px 8px;border-radius:6px;white-space:nowrap;">${_dl > 0 ? _dl + 'd left' : 'Ends today'}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;">
                            <div style="background:rgba(0,0,0,0.3);border-radius:8px;padding:8px 14px;text-align:center;min-width:56px;">
                                <div style="font-size:22px;font-weight:800;color:#facc15;font-family:monospace;line-height:1;">${_ch._userPts}</div>
                                <div style="font-size:9px;color:var(--text-secondary);margin-top:2px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">${_wl}</div>
                            </div>
                            <div style="flex:1;font-size:11px;color:var(--text-secondary);line-height:1.5;">Log water temps &amp; join swims to earn points</div>
                        </div>
                    </div>`;
                }).join('');

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
                    ${_challengeHtml}
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
                    <div style="display:flex;gap:8px;margin-bottom:10px;">
                        <button onclick="openStravaImportModal()"
                            style="flex:1;background:#fc4c02;color:white;border:none;border-radius:8px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;">
                            View &amp; import swims
                        </button>
                        <button onclick="disconnectStrava()"
                            style="background:rgba(15,23,42,0.6);color:var(--text-secondary);border:1.5px solid rgba(56,189,248,0.15);border-radius:8px;padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:all 0.2s;">
                            Disconnect
                        </button>
                    </div>
                    <a href="https://strava.app.link/fIlO1rhHa5b" target="_blank" rel="noopener"
                        style="display:block;text-align:center;font-size:12px;color:#fc4c02;text-decoration:none;padding-top:2px;border-top:1px solid rgba(252,76,2,0.15);">
                        Join the SwimLoading Strava Club →
                    </a>
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
