        // ==========================================
        // TRENDS REDESIGN LOGIC
        // ==========================================

        let trendsData = {}; // Cache for Region Overview
        // Note: conditionsCache and swimEventsCache are declared as var in Block 1 (global)
        let currentRegionDomain = null;
        let currentSpotId = null;
        let currentSpotName = '';   // used by sensor banner
        let currentChartSource = 'community'; // 'community' | 'my'
        let currentChartWindow = '30d'; // '7d' | '30d' | '90d' | 'all'
        let currentWaterFilter = 'ocean'; // 'ocean' | 'lagoons' | 'pools' | 'inland' | 'international'

        // Water type group mappings
        const WATER_TYPE_GROUPS = {
            ocean: ['OCEAN'],
            lagoons: ['LAGOON'],
            pools: ['POOL', 'TIDAL_POOL'],
            inland: ['DAM', 'LAKE', 'RIVER']
        };

        let spotChartInstance = null;

        // Dynamic staleness window — widens in SA winter (May–Aug) so colder months
        // don't produce blank screens when logging activity naturally drops.
        function getStaleDays(international = false) {
            const month = new Date().getMonth(); // 0 = Jan
            const isWinter = month >= 4 && month <= 7; // May–Aug (SA winter)
            if (international) return isWinter ? 45 : 30; // intl spots logged less often
            return isWinter ? 21 : 10;
        }

        function formatDomain(d) {
            const found = domains.find(x => x.code === d);
            if (found) return found.display_name;
            return d.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        }

        // calculateSwimScore() and swimScoreBadgeHtml() are defined in Block 1 (global var scope)

        function getTimeAgo(date) {
            const seconds = Math.floor((new Date() - date) / 1000);
            let interval = seconds / 31536000;
            if (interval > 1) return Math.floor(interval) + " years ago";
            interval = seconds / 2592000;
            if (interval > 1) return Math.floor(interval) + " months ago";
            interval = seconds / 86400;
            if (interval > 1) return Math.floor(interval) + " days ago";
            interval = seconds / 3600;
            if (interval > 1) return Math.floor(interval) + " hours ago";
            interval = seconds / 60;
            if (interval > 1) return Math.floor(interval) + " minutes ago";
            return Math.floor(seconds) + " seconds ago";
        }

        async function loadTrends() {
            // Reset views
            document.getElementById('trendsOverview').style.display = 'block';
            document.getElementById('trendsRegionDetail').style.display = 'none';
            document.getElementById('trendsSpotDetail').style.display = 'none';

            const loadingEl = document.getElementById('trendsLoading');
            const gridEl = document.getElementById('regionGrid');

            loadingEl.style.display = 'block';
            gridEl.style.display = 'none';

            try {
                // Fetch ALL latest spot temps
                const { data, error } = await supabaseClient
                    .from('latest_spot_temps')
                    .select('*');

                if (error) {
                    console.error('Error loading trends data:', error);
                    throw error;
                }

                // Build domestic filteredData (used by ocean/lagoons/pools/inland branches).
                // International has its own filter below — skip early return for that tab.
                const allowedTypes = WATER_TYPE_GROUPS[currentWaterFilter] || [];
                const staleMs = getStaleDays(false) * 24 * 60 * 60 * 1000;
                const staleISO = new Date(Date.now() - staleMs).toISOString();
                const filteredData = (currentWaterFilter === 'international') ? [] :
                    (data ? data.filter(row =>
                        allowedTypes.includes(row.water_type) &&
                        row.updated_at >= staleISO &&
                        !internationalSpotIds.has(row.spot_id) &&
                        !INTERNATIONAL_DOMAINS.has(row.domain)
                    ) : []);

                // Empty state for domestic tabs only
                if (currentWaterFilter !== 'international' && filteredData.length === 0) {
                    loadingEl.style.display = 'none';
                    gridEl.style.display = 'block';
                    gridEl.innerHTML = `
                        <div style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
                            <div style="font-size: 18px; font-weight: 500;">No recent updates.</div>
                        </div>
                    `;
                    return;
                }

                // Render based on filter type
                if (currentWaterFilter === 'international') {
                    // Show all spots where countries.is_domestic = false, any water type.
                    // International spots use a wider staleness window.
                    const intlStaleISO = new Date(Date.now() - getStaleDays(true) * 24 * 60 * 60 * 1000).toISOString();
                    const intlData = data ? data.filter(row =>
                        (internationalSpotIds.has(row.spot_id) || INTERNATIONAL_DOMAINS.has(row.domain)) &&
                        row.updated_at >= intlStaleISO
                    ) : [];

                    if (intlData.length === 0) {
                        loadingEl.style.display = 'none';
                        gridEl.style.display = 'block';
                        gridEl.innerHTML = `
                            <div style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
                                <div style="font-size: 18px; font-weight: 500;">No recent international updates.</div>
                            </div>
                        `;
                        return;
                    }

                    const { data: spotsData } = await supabaseClient.from('spots').select('code, area');
                    const spotAreaMap = {};
                    if (spotsData) spotsData.forEach(s => spotAreaMap[s.code] = s.area);

                    const grouped = {};
                    intlData.forEach(row => {
                        if (!grouped[row.domain]) {
                            grouped[row.domain] = { domain: row.domain, spots: [], avgTemp: 0, maxTemp: -100, warmestSpotName: '', lastUpdated: null };
                        }
                        const group = grouped[row.domain];
                        group.spots.push({ ...row, area: spotAreaMap[row.spot_code] });
                        if (row.temp_c > group.maxTemp) { group.maxTemp = row.temp_c; group.warmestSpotName = row.spot_name; }
                        const rowDate = new Date(row.updated_at);
                        if (!group.lastUpdated || rowDate > new Date(group.lastUpdated)) group.lastUpdated = row.updated_at;
                    });
                    Object.keys(grouped).forEach(d => {
                        const g = grouped[d];
                        const sum = g.spots.reduce((acc, s) => acc + s.temp_c, 0);
                        g.avgTemp = (sum / g.spots.length).toFixed(1);
                    });

                    trendsData = grouped;

                    const since96h = new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString();
                    const [condRes, evtRes] = await Promise.all([
                        supabaseClient.from('temp_logs').select('spot_id, conditions, hazards, created_at, temp_c').gte('created_at', since96h).order('created_at', { ascending: false }).limit(200),
                        supabaseClient.from('swim_events').select('location_name, start_at, status').eq('status', 'active').gte('start_at', new Date().toISOString()).limit(50)
                    ]);
                    conditionsCache = {};
                    (condRes.data || []).forEach(log => {
                        if (!conditionsCache[log.spot_id]) conditionsCache[log.spot_id] = [];
                        conditionsCache[log.spot_id].push(log);
                    });
                    swimEventsCache = evtRes.data || [];

                    renderRegionalGrid();
                } else if (currentWaterFilter === 'ocean' || currentWaterFilter === 'lagoons') {
                    // Fetch spots metadata for area mapping
                    const { data: spotsData } = await supabaseClient
                        .from('spots')
                        .select('code, area');

                    const spotAreaMap = {};
                    if (spotsData) {
                        spotsData.forEach(s => spotAreaMap[s.code] = s.area);
                    }

                    // Group by domain (only regions that actually have data)
                    const grouped = {};
                    filteredData.forEach(row => {
                        if (!grouped[row.domain]) {
                            grouped[row.domain] = {
                                domain: row.domain,
                                spots: [],
                                avgTemp: 0,
                                maxTemp: -100,
                                warmestSpotName: '',
                                lastUpdated: null
                            };
                        }
                        const group = grouped[row.domain];
                        group.spots.push({
                            ...row,
                            area: spotAreaMap[row.spot_code]
                        });

                        if (row.temp_c > group.maxTemp) {
                            group.maxTemp = row.temp_c;
                            group.warmestSpotName = row.spot_name;
                        }

                        const rowDate = new Date(row.updated_at);
                        if (!group.lastUpdated || rowDate > new Date(group.lastUpdated)) {
                            group.lastUpdated = row.updated_at;
                        }
                    });

                    // Calculate averages
                    Object.keys(grouped).forEach(d => {
                        const g = grouped[d];
                        const sum = g.spots.reduce((acc, s) => acc + s.temp_c, 0);
                        g.avgTemp = (sum / g.spots.length).toFixed(1);
                    });

                    trendsData = grouped;

                    // Fetch conditions cache for swim scores (runs in parallel with render)
                    const since96h = new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString();
                    const [condRes, evtRes] = await Promise.all([
                        supabaseClient
                            .from('temp_logs')
                            .select('spot_id, conditions, hazards, created_at, temp_c')
                            .gte('created_at', since96h)
                            .order('created_at', { ascending: false })
                            .limit(200),
                        supabaseClient
                            .from('swim_events')
                            .select('location_name, start_at, status')
                            .eq('status', 'active')
                            .gte('start_at', new Date().toISOString())
                            .limit(50)
                    ]);
                    conditionsCache = {};
                    (condRes.data || []).forEach(log => {
                        if (!conditionsCache[log.spot_id]) conditionsCache[log.spot_id] = [];
                        conditionsCache[log.spot_id].push(log);
                    });
                    swimEventsCache = evtRes.data || [];

                    renderRegionalGrid();
                } else {
                    // For Pools and Inland: show spot list
                    const sorted = filteredData.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
                    const title = currentWaterFilter === 'pools' ? 'Pools' : 'Inland Spots';

                    // Fetch conditions cache for swim scores
                    const since96h = new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString();
                    const [condRes2, evtRes2] = await Promise.all([
                        supabaseClient
                            .from('temp_logs')
                            .select('spot_id, conditions, hazards, created_at, temp_c')
                            .gte('created_at', since96h)
                            .order('created_at', { ascending: false })
                            .limit(200),
                        supabaseClient
                            .from('swim_events')
                            .select('location_name, start_at, status')
                            .eq('status', 'active')
                            .gte('start_at', new Date().toISOString())
                            .limit(50)
                    ]);
                    conditionsCache = {};
                    (condRes2.data || []).forEach(log => {
                        if (!conditionsCache[log.spot_id]) conditionsCache[log.spot_id] = [];
                        conditionsCache[log.spot_id].push(log);
                    });
                    swimEventsCache = evtRes2.data || [];

                    renderTrendSpotList(title, sorted);
                }

            } catch (err) {
                console.error('Error loading trends:', err);
                loadingEl.innerText = 'Error loading data.';
            }
        }

        function renderRegionalGrid() {
            const loadingEl = document.getElementById('trendsLoading');
            const gridEl = document.getElementById('regionGrid');

            loadingEl.style.display = 'none';
            gridEl.style.display = 'grid';
            gridEl.style.gridTemplateColumns = ''; // Reset to default grid
            gridEl.innerHTML = '';

            // Get regions with data, sorted by DB sort_order
            const domainOrder = domains.map(d => d.code);
            const activeRegions = Object.keys(trendsData).sort((a, b) => {
                const ai = domainOrder.indexOf(a);
                const bi = domainOrder.indexOf(b);
                return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
            });

            const isIntlGrid = currentWaterFilter === 'international';
            const staleMs = getStaleDays(isIntlGrid) * 24 * 60 * 60 * 1000;
            const staleThreshold = Date.now() - staleMs;

            activeRegions.forEach(domain => {
                const data = trendsData[domain];
                const hasData = data && data.spots && data.spots.length > 0;
                if (!hasData) return; // Hide empty regions
                if (new Date(data.lastUpdated).getTime() < staleThreshold) return; // Hide stale regions

                let subtext = `${data.spots.length} spots`;
                let warmestText = data.maxTemp !== null ? `Warmest: ${data.warmestSpotName} (${data.maxTemp}°C)` : '';
                let updatedText = `Updated ${getTimeAgo(new Date(data.lastUpdated))}`;

                // Colour scale — matches dashboard temp cards
                const t = data.avgTemp;
                const tempColor = t < 10 ? '#6366f1' : t < 12 ? '#3b82f6' : t < 16 ? '#06b6d4'
                    : t < 20 ? '#10b981' : t < 24 ? '#f59e0b' : t < 28 ? '#f97316' : '#ef4444';

                // Regional trend — average delta across spots that have ≥2 readings in conditionsCache
                const deltas = [];
                (data.spots || []).forEach(spot => {
                    const logs = conditionsCache[spot.spot_id] || [];
                    const t0 = logs[0]?.temp_c != null ? parseFloat(logs[0].temp_c) : null;
                    const t1 = logs[1]?.temp_c != null ? parseFloat(logs[1].temp_c) : null;
                    if (t0 != null && t1 != null) deltas.push(t0 - t1);
                });
                let trendArrow = '';
                let trendColor = 'var(--text-secondary)';
                if (deltas.length > 0) {
                    const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
                    if (avgDelta > 0.3)       { trendArrow = '↑'; trendColor = '#10b981'; }
                    else if (avgDelta < -0.3) { trendArrow = '↓'; trendColor = '#38bdf8'; }
                    else                      { trendArrow = '→'; trendColor = 'var(--text-secondary)'; }
                }

                const isIntl = INTERNATIONAL_DOMAINS.has(domain) || spots.some(s => s.domain === domain && internationalSpotIds.has(s.id));
                const card = document.createElement('div');
                card.className = 'region-card';
                if (isIntl) card.style.cssText += 'border-color:#fbbf24;border-width:1.5px;';
                card.onclick = () => openRegionDetail(domain);
                card.innerHTML = `
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                        <div style="flex:1;min-width:0;">
                            <div class="region-name" style="font-weight:700;font-size:16px;">${isIntl ? '<i data-lucide="globe" style="width:13px;height:13px;color:#fbbf24;vertical-align:middle;margin-right:4px;display:inline-block;"></i>' : ''}${formatDomain(domain)}</div>
                            <div class="region-temp" style="font-size:32px;font-weight:800;color:${tempColor};margin:4px 0;line-height:1;">${data.avgTemp}°C</div>
                            <div class="region-stat" style="font-size:13px;font-weight:600;">${subtext}</div>
                            <div class="region-stat" style="font-size:11px;opacity:0.8;">${updatedText}</div>
                            ${warmestText ? `<div class="region-warmest" style="font-size:12px;font-weight:600;margin-top:10px;padding:7px 9px;background:rgba(255,255,255,0.05);border-radius:8px;">${warmestText}</div>` : ''}
                        </div>
                        ${trendArrow ? `<div style="font-size:56px;font-weight:900;color:${trendColor};line-height:1;flex-shrink:0;opacity:0.92;">${trendArrow}</div>` : ''}
                    </div>
                `;
                gridEl.appendChild(card);
            });
        }

        function renderTrendSpotList(titleText, spots) {
            const loadingEl = document.getElementById('trendsLoading');
            const gridEl = document.getElementById('regionGrid');

            loadingEl.style.display = 'none';
            gridEl.style.display = 'block';
            gridEl.style.gridTemplateColumns = '1fr';
            gridEl.innerHTML = '';

            // Section Header
            const header = document.createElement('div');
            header.style.cssText = 'font-size: 18px; font-weight: 800; color: var(--text-primary); padding: 20px 0 12px 0; letter-spacing: 0.5px;';
            header.innerText = titleText;
            gridEl.appendChild(header);

            spots.forEach(spot => {
                const item = document.createElement('div');
                item.className = 'spot-list-item';
                item.onclick = () => openSpotDetail(spot.spot_id, spot.spot_name, spot.spot_code);

                // Water type badge
                const waterType = spot.water_type || '';
                let badgeHtml = '';
                if (waterType) {
                    const badgeColors = {
                        'OCEAN': 'rgba(59, 130, 246, 0.2)',
                        'LAGOON': 'rgba(34, 197, 94, 0.2)',
                        'POOL': 'rgba(168, 85, 247, 0.2)',
                        'DAM': 'rgba(234, 179, 8, 0.2)',
                        'LAKE': 'rgba(14, 165, 233, 0.2)',
                        'RIVER': 'rgba(6, 182, 212, 0.2)',
                        'TIDAL_POOL': 'rgba(20, 184, 166, 0.2)'
                    };
                    const badgeBorders = {
                        'OCEAN': 'rgba(59, 130, 246, 0.5)',
                        'LAGOON': 'rgba(34, 197, 94, 0.5)',
                        'POOL': 'rgba(168, 85, 247, 0.5)',
                        'DAM': 'rgba(234, 179, 8, 0.5)',
                        'LAKE': 'rgba(14, 165, 233, 0.5)',
                        'RIVER': 'rgba(6, 182, 212, 0.5)',
                        'TIDAL_POOL': 'rgba(20, 184, 166, 0.5)'
                    };
                    const bgColor = badgeColors[waterType] || 'rgba(100, 100, 100, 0.2)';
                    const borderColor = badgeBorders[waterType] || 'rgba(100, 100, 100, 0.3)';

                    badgeHtml = `<span style="display: inline-block; padding: 2px 8px; margin-left: 8px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; border-radius: 6px; background: ${bgColor}; border: 1px solid ${borderColor}; color: var(--text-primary); vertical-align: middle;">${waterType}</span>`;
                }

                const swimScore = calculateSwimScore(spot, conditionsCache[spot.spot_id] || [], swimEventsCache, todayForecast);
                item.innerHTML = `
                    <div style="flex: 1;">
                        <div style="font-weight: 700; color: var(--text-primary); font-size: 16px; margin-bottom: 2px;">${spot.spot_name}${badgeHtml}</div>
                        <div style="font-size: 12px; color: var(--text-secondary); font-weight: 500;">${getTimeAgo(new Date(spot.updated_at))}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size: 24px; font-weight: 800; color: ${getDisplayTempColor(spot.temp_c, spot.water_type)};">${spot.temp_c}°C</div>
                        ${swimScoreBadgeHtml(swimScore)}
                    </div>
                `;
                gridEl.appendChild(item);
            });
        }

        function openRegionDetail(domain) {
            currentRegionDomain = domain;
            const data = trendsData[domain];

            document.getElementById('trendsOverview').style.display = 'none';
            document.getElementById('trendsRegionDetail').style.display = 'block';
            document.getElementById('regionDetailTitle').innerText = formatDomain(domain);

            const listEl = document.getElementById('regionSpotList');
            listEl.innerHTML = '';

            // Filter using dynamic staleness window (wider for international and SA winter)
            const isIntlDomain = spots.some(s => s.domain === domain && internationalSpotIds.has(s.id));
            const detailStaleMs = getStaleDays(isIntlDomain) * 24 * 60 * 60 * 1000;
            const sortedSpots = (!data || !data.spots) ? [] : [...data.spots]
                .filter(s => new Date(s.updated_at).getTime() >= Date.now() - detailStaleMs)
                .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

            if (sortedSpots.length === 0) {
                listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No recent updates for this region.</div>';
                return;
            }

            sortedSpots.forEach(s => {
                const spotId = s.spot_id;
                const spotName = s.spot_name;
                const spotCode = s.spot_code;
                const waterType = s.water_type || '';

                // Water type badge
                let badgeHtml = '';
                if (waterType) {
                    const badgeColors = {
                        'OCEAN': 'rgba(59, 130, 246, 0.2)',
                        'LAGOON': 'rgba(34, 197, 94, 0.2)',
                        'POOL': 'rgba(168, 85, 247, 0.2)',
                        'DAM': 'rgba(234, 179, 8, 0.2)',
                        'LAKE': 'rgba(14, 165, 233, 0.2)',
                        'RIVER': 'rgba(6, 182, 212, 0.2)',
                        'TIDAL_POOL': 'rgba(20, 184, 166, 0.2)'
                    };
                    const badgeBorders = {
                        'OCEAN': 'rgba(59, 130, 246, 0.5)',
                        'LAGOON': 'rgba(34, 197, 94, 0.5)',
                        'POOL': 'rgba(168, 85, 247, 0.5)',
                        'DAM': 'rgba(234, 179, 8, 0.5)',
                        'LAKE': 'rgba(14, 165, 233, 0.5)',
                        'RIVER': 'rgba(6, 182, 212, 0.5)',
                        'TIDAL_POOL': 'rgba(20, 184, 166, 0.5)'
                    };
                    const bgColor = badgeColors[waterType] || 'rgba(100, 100, 100, 0.2)';
                    const borderColor = badgeBorders[waterType] || 'rgba(100, 100, 100, 0.3)';

                    badgeHtml = `<span style="display: inline-block; padding: 2px 8px; margin-left: 8px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; border-radius: 6px; background: ${bgColor}; border: 1px solid ${borderColor}; color: var(--text-primary); vertical-align: middle;">${waterType}</span>`;
                }

                const swimScore = calculateSwimScore(s, conditionsCache[spotId] || [], swimEventsCache, todayForecast);
                const item = document.createElement('div');
                item.className = 'spot-list-item';
                item.onclick = () => openSpotDetail(spotId, spotName, spotCode);

                // If this spot has a live sensor, show sensor badge + fetch live temp
                const mwlVenueForSpot = (window.MYWATERLIVE_VENUES || {})[spotName];
                if (mwlVenueForSpot) {
                    const tempId = 'mwl-list-temp-' + spotId;
                    const ageId  = 'mwl-list-age-'  + spotId;
                    item.innerHTML = `
                        <div style="flex:1;">
                            <div style="font-weight:700;color:var(--text-primary);font-size:16px;margin-bottom:2px;">${spotName}${badgeHtml}</div>
                            <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:#22c55e;font-weight:600;">
                                <span style="width:6px;height:6px;background:#22c55e;border-radius:50%;display:inline-block;flex-shrink:0;"></span>
                                Live sensor · my-water.live
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <div id="${tempId}" style="font-size:24px;font-weight:800;color:#38bdf8;">…</div>
                        </div>`;
                    listEl.appendChild(item);
                    fetch('/api/mywaterlive?slug=' + encodeURIComponent(mwlVenueForSpot.slug))
                        .then(function(r) { return r.ok ? r.json() : null; })
                        .then(function(d) {
                            const el = document.getElementById(tempId);
                            if (!el) return;
                            el.textContent = (d && d.temperature != null) ? parseFloat(d.temperature).toFixed(1) + '°C' : (s.temp_c + '°C');
                        })
                        .catch(function() {
                            const el = document.getElementById(tempId);
                            if (el) el.textContent = s.temp_c + '°C';
                        });
                } else {
                    item.innerHTML = `
                        <div style="flex: 1;">
                            <div style="font-weight: 700; color: var(--text-primary); font-size: 16px; margin-bottom: 2px;">${spotName}${badgeHtml}</div>
                            <div style="font-size: 12px; color: var(--text-secondary); font-weight: 500;">${getTimeAgo(new Date(s.updated_at))}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size: 24px; font-weight: 800; color: ${getDisplayTempColor(s.temp_c, s.water_type)};">${s.temp_c}°C</div>
                            ${swimScoreBadgeHtml(swimScore)}
                        </div>
                    `;
                    listEl.appendChild(item);
                }
            });

            // ── Add sensor spots that have no community logs ────────────────
            // These won't appear in latest_spot_temps, so inject them from the global spots array.
            const mwlVenues = window.MYWATERLIVE_VENUES || {};
            const alreadyShown = new Set(sortedSpots.map(s => s.spot_name));
            const sensorSpotsInRegion = (spots || []).filter(s =>
                s.domain === domain && mwlVenues[s.name] && !alreadyShown.has(s.name)
            );
            sensorSpotsInRegion.forEach(function(s) {
                const mwlV = mwlVenues[s.name];
                const item = document.createElement('div');
                item.className = 'spot-list-item';
                item.onclick = function() { openSpotDetail(s.id, s.name, s.code); };
                const tempId = 'mwl-list-temp-' + s.id;
                item.innerHTML = `
                    <div style="flex:1;">
                        <div style="font-weight:700;color:var(--text-primary);font-size:16px;margin-bottom:2px;">
                            ${s.name}
                            <span style="display:inline-block;padding:2px 8px;margin-left:8px;font-size:10px;font-weight:700;letter-spacing:0.5px;border-radius:6px;background:rgba(168,85,247,0.2);border:1px solid rgba(168,85,247,0.5);color:var(--text-primary);vertical-align:middle;">${s.water_type}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:#22c55e;font-weight:600;">
                            <span style="width:6px;height:6px;background:#22c55e;border-radius:50%;display:inline-block;flex-shrink:0;"></span>
                            Live sensor · my-water.live
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <div id="${tempId}" style="font-size:24px;font-weight:800;color:#38bdf8;">…</div>
                    </div>`;
                listEl.appendChild(item);
                // Fetch live temp for the card
                fetch('/api/mywaterlive?slug=' + encodeURIComponent(mwlV.slug))
                    .then(function(r) { return r.ok ? r.json() : null; })
                    .then(function(d) {
                        const el = document.getElementById(tempId);
                        if (!el) return;
                        el.textContent = (d && d.temperature != null) ? parseFloat(d.temperature).toFixed(1) + '°C' : '—';
                    })
                    .catch(function() {
                        const el = document.getElementById(tempId);
                        if (el) el.textContent = '—';
                    });
            });

            initIcons();
        }

        function showTrendsOverview() {
            document.getElementById('trendsRegionDetail').style.display = 'none';
            document.getElementById('trendsOverview').style.display = 'block';
        }

        function showLastRegionDetail() {
            document.getElementById('trendsSpotDetail').style.display = 'none';
            document.getElementById('trendsRegionDetail').style.display = 'block';
        }

        async function openSpotDetail(spotId, spotName, spotCode) {
            // Debug logging
            console.log('Spot open', { spot_id: spotId, spot_name: spotName, spot_code: spotCode });

            // Find spot's water_type from cached data or spots array
            let spotWaterType = null;
            for (const domain in trendsData) {
                const spot = trendsData[domain].spots.find(s => s.spot_id === spotId);
                if (spot) {
                    spotWaterType = spot.water_type;
                    break;
                }
            }
            // Fallback: look up from spots array (for dashboard drill-through)
            if (!spotWaterType) {
                const spotInfo = spots.find(s => s.id === spotId);
                if (spotInfo) spotWaterType = spotInfo.water_type;
            }

            // No validation - allow spot drilldown regardless of filter
            // (spot drilldown is driven by spot_id and temp_logs)

            currentSpotId = spotId;
            currentSpotName = spotName;
            document.getElementById('trendsOverview').style.display = 'none';
            document.getElementById('trendsRegionDetail').style.display = 'none';
            document.getElementById('trendsSpotDetail').style.display = 'block';

            // Hide sensor banner while data loads (will be repopulated by loadSpotChartData)
            const mwlBanner = document.getElementById('mwlSensorBanner');
            if (mwlBanner) mwlBanner.style.display = 'none';

            // Update header with water type
            let waterLabel = '';
            if (spotWaterType === 'POOL') waterLabel = 'Pool';
            else if (spotWaterType === 'OCEAN') waterLabel = 'Ocean';
            else if (spotWaterType === 'LAGOON') waterLabel = 'Lagoon';
            else if (spotWaterType === 'DAM') waterLabel = 'Dam';

            document.getElementById('spotDetailTitle').innerText =
                waterLabel ? `${spotName} • ${waterLabel}` : spotName;

            // Reset to defaults
            currentChartSource = 'community';
            currentChartWindow = '30d';
            updateToggleUI();
            updateWindowUI();

            await loadSpotChartData();
        }

        function setChartWindow(window) {
            if (currentChartWindow === window) return;
            currentChartWindow = window;
            updateWindowUI();
            loadSpotChartData();
        }

        function updateWindowUI() {
            ['7d', '30d', '90d', 'all'].forEach(w => {
                const el = document.getElementById('window' + w);
                if (el) {
                    el.className = currentChartWindow === w ? 'toggle-btn active' : 'toggle-btn';
                }
            });
        }

        function setWaterFilter(filter) {
            if (currentWaterFilter === filter) return;
            console.log('Switching water filter:', { from: currentWaterFilter, to: filter });
            currentWaterFilter = filter;
            updateWaterFilterUI();
            loadTrends();
        }

        function updateWaterFilterUI() {
            const oceanEl = document.getElementById('filterOcean');
            const lagoonsEl = document.getElementById('filterLagoons');
            const poolsEl = document.getElementById('filterPools');
            const inlandEl = document.getElementById('filterInland');
            const intlEl = document.getElementById('filterInternational');
            if (oceanEl) oceanEl.className = currentWaterFilter === 'ocean' ? 'toggle-btn active' : 'toggle-btn';
            if (lagoonsEl) lagoonsEl.className = currentWaterFilter === 'lagoons' ? 'toggle-btn active' : 'toggle-btn';
            if (poolsEl) poolsEl.className = currentWaterFilter === 'pools' ? 'toggle-btn active' : 'toggle-btn';
            if (inlandEl) inlandEl.className = currentWaterFilter === 'inland' ? 'toggle-btn active' : 'toggle-btn';
            if (intlEl) intlEl.className = currentWaterFilter === 'international' ? 'toggle-btn active' : 'toggle-btn';
        }

        function toggleChartSource(source) {
            if (currentChartSource === source) return;
            currentChartSource = source;
            updateToggleUI();
            loadSpotChartData();
        }

        function updateToggleUI() {
            const communityEl = document.getElementById('toggleCommunity');
            const myLogsEl = document.getElementById('toggleMyLogs');
            if (communityEl) communityEl.className = currentChartSource === 'community' ? 'toggle-btn active' : 'toggle-btn';
            if (myLogsEl) myLogsEl.className = currentChartSource === 'my' ? 'toggle-btn active' : 'toggle-btn';
        }

        async function loadSpotChartData() {
            const listEl = document.getElementById('spotRecentLogs');

            // Debug logging
            console.log('Spot drilldown: currentSpotId=', currentSpotId, 'window=', currentChartWindow, 'source=', currentChartSource);
            if (!currentSpotId) {
                showToast('No spot selected', 'error');
                listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No spot selected.</div>';
                return;
            }

            // Clear existing chart
            if (spotChartInstance) {
                spotChartInstance.destroy();
                spotChartInstance = null;
            }
            // Clear canvas
            const canvas = document.getElementById('spotTrendChart');
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            listEl.innerHTML = '<div style="padding: 20px; text-align: center;">Loading...</div>';

            try {
                // ===== CHART DATA QUERY =====
                // Calculate time filter based on window
                let timeFilter = null;
                if (currentChartWindow === '7d') {
                    timeFilter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
                } else if (currentChartWindow === '30d') {
                    timeFilter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
                } else if (currentChartWindow === '90d') {
                    timeFilter = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
                }

                // Build chart query (DESC for 'All' case, then reverse)
                let chartQuery = supabaseClient
                    .from('temp_logs')
                    .select('id,user_id,spot_id,temp_c,created_at,logged_at')
                    .eq('spot_id', currentSpotId)
                    .order('created_at', { ascending: false });

                if (currentChartSource === 'my') {
                    chartQuery = chartQuery.eq('user_id', currentUser.id);
                }

                if (currentChartWindow === 'all') {
                    chartQuery = chartQuery.limit(500);
                } else {
                    chartQuery = chartQuery.gte('created_at', timeFilter);
                }

                const { data: chartData, error: chartError } = await chartQuery;
                if (chartError) {
                    console.error('Chart data load error:', chartError);
                    throw chartError;
                }

                // Reverse for chronological order (chart needs ascending)
                if (chartData) chartData.reverse();

                // ===== RECENT LOGS QUERY (always latest 15) =====
                let logsQuery = supabaseClient
                    .from('temp_logs')
                    .select('id,user_id,temp_c,conditions,hazards,notes,created_at,logged_at')
                    .eq('spot_id', currentSpotId)
                    .order('created_at', { ascending: false })
                    .limit(15);

                if (currentChartSource === 'my') {
                    logsQuery = logsQuery.eq('user_id', currentUser.id);
                }

                const { data: recentLogs, error: logsError } = await logsQuery;
                if (logsError) {
                    console.error('Recent logs load error:', logsError);
                    throw logsError;
                }

                // ===== FETCH USER PROFILES =====
                const allUserIds = new Set();
                if (chartData) chartData.forEach(l => allUserIds.add(l.user_id));
                if (recentLogs) recentLogs.forEach(l => allUserIds.add(l.user_id));

                const userIds = [...allUserIds];
                const { data: profiles } = await supabaseClient
                    .from('public_profiles')
                    .select('id, display_name')
                    .in('id', userIds);

                // Map profiles
                const profileMap = {};
                if (profiles) {
                    profiles.forEach(p => profileMap[p.id] = p.display_name);
                }

                // ===== RENDER CHART =====
                if (!chartData || chartData.length === 0) {
                    renderSpotChart([], []);
                } else {
                    const labels = chartData.map(d => new Date(d.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
                    const temps = chartData.map(d => d.temp_c);
                    renderSpotChart(labels, temps);
                }

                // ===== RENDER SWIM SCORE BANNER =====
                const scoreBannerEl = document.getElementById('spotScoreBanner');
                if (scoreBannerEl) {
                    // Find spot row from trendsData cache
                    let spotRow = null;
                    for (const domain in trendsData) {
                        const found = (trendsData[domain].spots || []).find(s => s.spot_id === currentSpotId);
                        if (found) { spotRow = found; break; }
                    }
                    if (spotRow && recentLogs && recentLogs.length > 0) {
                        // Use top 5 recent logs for scoring (with hazards from conditionsCache)
                        const logsForScore = (conditionsCache[currentSpotId] || []).slice(0, 5);
                        // Fallback: merge in recentLogs conditions if cache is empty
                        const scoreInput = logsForScore.length > 0 ? logsForScore : recentLogs.slice(0, 5);
                        const swimScore = calculateSwimScore(spotRow, scoreInput, swimEventsCache);
                        const { score, label, emoji, color } = swimScore;
                        scoreBannerEl.innerHTML = `
                            <div style="display:flex;align-items:center;justify-content:space-between;
                                        background:rgba(15,23,42,0.6);border-radius:12px;padding:12px 16px;
                                        border:1px solid ${color}30;">
                                <div>
                                    <div style="font-size:10px;color:var(--text-secondary);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Swim Score</div>
                                    <div style="font-size:22px;font-weight:800;color:${color};margin-top:3px;">${emoji} ${label}</div>
                                </div>
                                <div style="text-align:right;">
                                    <div style="font-size:40px;font-weight:800;color:${color};line-height:1;">${score}</div>
                                    <div style="font-size:10px;color:var(--text-secondary);margin-top:2px;">out of 100</div>
                                </div>
                            </div>
                        `;
                        scoreBannerEl.style.display = 'block';
                    } else {
                        scoreBannerEl.style.display = 'none';
                    }
                }

                // ===== LIVE SENSOR BANNER (my-water.live venues) =====
                const mwlBanner = document.getElementById('mwlSensorBanner');
                if (mwlBanner) {
                    const mwlVenue = (window.MYWATERLIVE_VENUES || {})[currentSpotName];
                    if (mwlVenue) {
                        mwlBanner.style.display = 'block';
                        mwlBanner.innerHTML = `
                          <div style="background:linear-gradient(135deg,rgba(2,132,199,0.15),rgba(2,132,199,0.05));border:1px solid rgba(56,189,248,0.4);border-radius:14px;padding:16px 18px;">
                            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                              <span style="width:7px;height:7px;background:#22c55e;border-radius:50%;flex-shrink:0;display:inline-block;"></span>
                              <span style="font-size:11px;font-weight:700;color:#38bdf8;text-transform:uppercase;letter-spacing:0.08em;">Live sensor · my-water.live</span>
                            </div>
                            <div id="mwlTempVal" style="font-size:48px;font-weight:900;color:#38bdf8;line-height:1;">…</div>
                            <div id="mwlTempWhen" style="font-size:12px;color:var(--text-secondary);margin-top:4px;margin-bottom:12px;">Fetching live reading…</div>
                            <a href="${mwlVenue.url}" target="_blank" rel="noopener noreferrer"
                               style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#38bdf8;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.25);border-radius:8px;padding:7px 14px;text-decoration:none;">
                              Full conditions at my-water.live &#8594;
                            </a>
                          </div>`;
                        // Fetch live temp
                        fetch('/api/mywaterlive?slug=' + encodeURIComponent(mwlVenue.slug))
                            .then(function(r) { return r.ok ? r.json() : null; })
                            .then(function(d) {
                                const tEl = document.getElementById('mwlTempVal');
                                const wEl = document.getElementById('mwlTempWhen');
                                if (!d || d.unavailable) {
                                    if (tEl) tEl.textContent = '—';
                                    if (wEl) wEl.textContent = 'Sensor data unavailable';
                                    return;
                                }
                                if (tEl) tEl.textContent = d.temperature != null ? parseFloat(d.temperature).toFixed(1) + '°C' : '—';
                                if (wEl && d.timestamp) {
                                    try {
                                        var t = new Date(d.timestamp).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                                        wEl.textContent = 'Sensor updated ' + t + (d.stale ? ' (cached)' : '');
                                    } catch(e) { if (wEl) wEl.textContent = ''; }
                                }
                            })
                            .catch(function() {
                                const tEl = document.getElementById('mwlTempVal');
                                if (tEl) tEl.textContent = '—';
                            });
                    } else {
                        mwlBanner.style.display = 'none';
                    }
                }

                // ===== RENDER RECENT LOGS LIST =====
                if (!recentLogs || recentLogs.length === 0) {
                    const mwlVenueForLogs = (window.MYWATERLIVE_VENUES || {})[currentSpotName];
                    listEl.innerHTML = mwlVenueForLogs
                        ? '<div style="padding:16px 0;font-size:13px;color:var(--text-secondary);">No community logs yet — water temperature is provided by the live sensor above. Log your own swim after your session to add community data.</div>'
                        : '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No logs found.</div>';
                } else {
                    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
                    listEl.innerHTML = recentLogs.map(log => {
                        const isOwn = currentUser && log.user_id === currentUser.id;
                        const isRecent = new Date(log.created_at).getTime() > twoHoursAgo;
                        const canEdit = isOwn && isRecent;
                        // Conditions + sightings display
                        const logHazards = Array.isArray(log.hazards) ? log.hazards : [];
                        const SIGHTING_ICONS = { jellyfish: 'Jellyfish', seals: 'Seals', shark: 'Shark', sewage: 'Sewage' };
                        const SERIOUS = ['shark', 'sewage'];
                        const seriousHazards = logHazards.filter(h => SERIOUS.includes(h));
                        const KNOWN_SIGHTINGS = ['jellyfish', 'seals'];
                        const sightings = logHazards.filter(h => KNOWN_SIGHTINGS.includes(h));
                        const condColor = log.conditions === 'extreme' ? '#ef4444' : log.conditions === 'rough' ? '#f97316' : log.conditions === 'choppy' ? '#f59e0b' : 'var(--text-secondary)';
                        const condBadge = log.conditions
                            ? `<span style="font-size:10px;font-weight:700;color:${condColor};margin-right:6px;">${log.conditions.toUpperCase()}</span>`
                            : '';
                        const sightingBadge = sightings.length > 0
                            ? `<span style="font-size:10px;font-weight:600;color:var(--text-secondary);">${sightings.map(h => SIGHTING_ICONS[h] || h).join(' · ')}</span>`
                            : '';
                        const dangerBadge = seriousHazards.length > 0
                            ? `<span style="font-size:11px;font-weight:700;color:#ef4444;">${seriousHazards.join(', ')}</span>`
                            : '';
                        const condLine = (condBadge || sightingBadge || dangerBadge)
                            ? `<div style="margin-top:3px;">${condBadge}${sightingBadge}${dangerBadge}</div>`
                            : '';
                        const notesLine = log.notes
                            ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:3px;font-style:italic;">${log.notes}</div>`
                            : '';

                        return `
                         <div id="templog-${log.id}" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                            <div style="flex: 1;">
                                <span style="font-weight: 600; font-size: 13px;">${profileMap[log.user_id] || 'Anonymous'}</span>
                                <div style="font-size: 11px; color: var(--text-secondary);">${new Date(log.logged_at || log.created_at).toLocaleString()}</div>
                                ${log.logged_at && Math.abs(new Date(log.logged_at) - new Date(log.created_at)) > 300000 ? '<span style="font-size: 9px; background: rgba(245,158,11,0.15); color: var(--warning); padding: 1px 5px; border-radius: 4px;">backdated</span>' : ''}
                                ${condLine}
                                ${notesLine}
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <div style="font-weight: 700; color: ${getTempColor(log.temp_c)};">${log.temp_c}°C</div>
                                ${canEdit ? `
                                    <button onclick="editTempLog('${log.id}', ${log.temp_c}, '${(log.conditions || '').replace(/'/g, "\\'")}', '${(log.notes || '').replace(/'/g, "\\'").replace(/\n/g, "\\n")}')" style="background: transparent; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 4px 6px; cursor: pointer; color: var(--text-secondary); font-size: 11px;" title="Edit">Edit</button>
                                    <button onclick="deleteTempLog('${log.id}')" style="background: transparent; border: 1px solid rgba(239,68,68,0.2); border-radius: 6px; padding: 4px 6px; cursor: pointer; color: var(--danger); font-size: 11px;" title="Delete">Del</button>
                                ` : ''}
                            </div>
                         </div>`;
                    }).join('');
                }

            } catch (err) {
                console.error('Spot drilldown load error:', err);
                showToast('Error loading data: ' + err.message, 'error');
                listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--danger);">Error loading data. Check console for details.</div>';
            }
        }

        // Edit a temp log inline
        function editTempLog(logId, currentTemp, currentConditions, currentNotes) {
            const row = document.getElementById(`templog-${logId}`);
            if (!row) return;
            row.innerHTML = `
                <div style="width: 100%; padding: 4px 0;">
                    <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
                        <label style="font-size: 12px; color: var(--text-secondary); width: 50px; flex-shrink:0;">Temp:</label>
                        <input type="number" id="editTemp-${logId}" value="${currentTemp}" step="0.5" min="8" max="32" class="form-control-sm" style="flex:1;">
                        <span style="color: var(--text-secondary); flex-shrink:0;">°C</span>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
                        <label style="font-size: 12px; color: var(--text-secondary); width: 50px; flex-shrink:0;">Cond:</label>
                        <select id="editCond-${logId}" class="form-control-sm" style="flex:1;">
                            <option value="calm" ${currentConditions === 'calm' ? 'selected' : ''}>Calm</option>
                            <option value="choppy" ${currentConditions === 'choppy' ? 'selected' : ''}>Choppy</option>
                            <option value="rough" ${currentConditions === 'rough' ? 'selected' : ''}>Rough</option>
                            <option value="extreme" ${currentConditions === 'extreme' ? 'selected' : ''}>Extreme</option>
                        </select>
                    </div>
                    <div style="margin-bottom: 8px;">
                        <textarea id="editNotes-${logId}" placeholder="Notes..." class="form-control-sm" style="resize:none;height:50px;font-size:12px;">${currentNotes || ''}</textarea>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="saveTempLogEdit('${logId}')" class="btn btn-success" style="flex:1;padding:8px;font-size:12px;">Save</button>
                        <button onclick="loadSpotChartData()" class="btn-secondary" style="flex:1;padding:8px;font-size:12px;">Cancel</button>
                    </div>
                </div>
            `;
        }

        async function saveTempLogEdit(logId) {
            const temp = parseFloat(document.getElementById(`editTemp-${logId}`).value);
            const conditions = document.getElementById(`editCond-${logId}`).value;
            const notes = document.getElementById(`editNotes-${logId}`).value;

            if (isNaN(temp) || temp < 8 || temp > 32) {
                showToast('Temperature must be between 8°C and 32°C', 'error');
                return;
            }

            try {
                const { error } = await supabaseClient
                    .from('temp_logs')
                    .update({ temp_c: temp, conditions: conditions, notes: notes })
                    .eq('id', logId)
                    .eq('user_id', currentUser.id);

                if (error) throw error;
                showToast('Temp log updated!', 'success');
                await loadSpotChartData();
            } catch (err) {
                console.error('Error updating temp log:', err);
                showToast('Error updating: ' + err.message, 'error');
            }
        }

        async function deleteTempLog(logId) {
            if (!confirm('Delete this temp log? You can re-log immediately after.')) return;

            try {
                const { error } = await supabaseClient
                    .from('temp_logs')
                    .delete()
                    .eq('id', logId)
                    .eq('user_id', currentUser.id);

                if (error) throw error;
                showToast('Temp log deleted — you can re-log now', 'success');
                await loadSpotChartData();
            } catch (err) {
                console.error('Error deleting temp log:', err);
                showToast('Error deleting: ' + err.message, 'error');
            }
        }

        function renderSpotChart(labels, dataPoints) {
            const ctx = document.getElementById('spotTrendChart').getContext('2d');

            spotChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Temperature (°C)',
                        data: dataPoints,
                        borderColor: '#38bdf8',
                        backgroundColor: 'rgba(56, 189, 248, 0.1)',
                        borderWidth: 2,
                        tension: 0.4,
                        pointRadius: 3,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        y: {
                            grid: { color: 'rgba(255, 255, 255, 0.1)' },
                            ticks: { color: '#94a3b8' }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: '#94a3b8', maxTicksLimit: 6 }
                        }
                    }
                }
            });
        }
