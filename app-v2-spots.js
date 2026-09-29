// SwimLoading v2 — Spots (the v1 Trends page, #history). Inert unless <html class="ui-v2">.
//
// v1 already has the right structure: regions -> a region's spots -> one spot (chart + swim score),
// plus search, water-type filters, the international "Explore" link and back-button handling
// (trendsStepBack, deep links, goToSpotTrend). All of that is left alone. v2 changes presentation:
//   - regions become plain rows (one card, no per-region tiles or 56px arrows); spot rows are restyled
//   - active hazards show as a flag on every region and spot row
//   - a spot page gets its hazards and two actions at the top: log the water here, report a hazard
//   - "1 spots" copy fixed, an empty state added, filters and toggles get 44px targets
//
// It replaces renderRegionalGrid by name and wraps openRegionDetail, renderTrendSpotList and
// openSpotDetail. Both callers (loadTrends, setWaterFilter, region/search flows) resolve them at
// call time, so no v1 code changes. The data is exactly what v1 already loads: trendsData,
// conditionsCache, swimEventsCache, todayForecast, activeHazardsBySpot.
(function () {
    'use strict';
    if (!(window.V2 && window.V2.enabled)) return;

    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function icons() { if (typeof initIcons === 'function') initIcons(); else if (window.lucide) window.lucide.createIcons(); }
    function cap(s) { s = String(s || '').replace(/_/g, ' ').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); }

    // ── Hazards (v1 already keeps activeHazardsBySpot: spot_id -> [{severity,title,active_until}]) ──
    function hazardsAt(spotId) {
        var all = (typeof activeHazardsBySpot !== 'undefined' && activeHazardsBySpot && activeHazardsBySpot[spotId]) || [];
        var now = Date.now();
        return all.filter(function (h) { return !h.active_until || new Date(h.active_until).getTime() > now; });
    }
    function isFlagged(spotId) {
        return hazardsAt(spotId).some(function (h) { return h.severity === 'danger' || h.severity === 'caution'; });
    }
    function flagHtml(n) {
        return '<span class="v2-flag"><i data-lucide="triangle-alert"></i>' + (n > 1 ? n + ' hazards' : 'Hazard') + '</span>';
    }

    // ── Regions ─────────────────────────────────────────────────────────────
    window.renderRegionalGrid = function () {
        var loadingEl = $('trendsLoading'), gridEl = $('regionGrid');
        if (!gridEl) return;
        if (loadingEl) loadingEl.style.display = 'none';
        gridEl.style.display = 'block';
        gridEl.style.gridTemplateColumns = '';
        gridEl.innerHTML = '';

        // Same ordering and staleness rules as v1
        var domainOrder = domains.map(function (d) { return d.code; });
        var active = Object.keys(trendsData).sort(function (a, b) {
            var ai = domainOrder.indexOf(a), bi = domainOrder.indexOf(b);
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });
        var isIntlGrid = currentWaterFilter === 'international';
        var staleThreshold = Date.now() - getStaleDays(isIntlGrid) * 86400000;

        var rows = [], meta = [];
        active.forEach(function (domain) {
            var data = trendsData[domain];
            if (!(data && data.spots && data.spots.length > 0)) return;
            if (new Date(data.lastUpdated).getTime() < staleThreshold) return;

            var n = data.spots.length;
            var hz = data.spots.reduce(function (c, s) { return c + (isFlagged(s.spot_id) ? 1 : 0); }, 0);

            // Regional trend, same rule as v1: average change across spots with two readings
            var deltas = [];
            data.spots.forEach(function (s) {
                var logs = conditionsCache[s.spot_id] || [];
                var t0 = logs[0] && logs[0].temp_c != null ? parseFloat(logs[0].temp_c) : null;
                var t1 = logs[1] && logs[1].temp_c != null ? parseFloat(logs[1].temp_c) : null;
                if (t0 != null && t1 != null) deltas.push(t0 - t1);
            });
            var arrow = '';
            if (deltas.length) {
                var avg = deltas.reduce(function (a, b) { return a + b; }, 0) / deltas.length;
                arrow = avg > 0.3 ? '<span class="v2-trend up" title="Warming">&uarr;</span>' : avg < -0.3 ? '<span class="v2-trend down" title="Cooling">&darr;</span>' : '';
            }

            var isIntl = INTERNATIONAL_DOMAINS.has(domain) || spots.some(function (s) { return s.domain === domain && internationalSpotIds.has(s.id); });
            var country = (spots.find(function (s) { return s.domain === domain && s.country_code; }) || {}).country_code || null;

            rows.push(
                '<div class="v2-row v2-row-multi" role="button" tabindex="0" data-domain="' + esc(domain) + '">' +
                    '<span class="v2-row-text">' +
                        '<span class="v2-row-title">' + (isIntl ? '<i data-lucide="globe" class="v2-inline-icon"></i>' : '') + esc(formatDomain(domain)) + '</span><br>' +
                        '<span class="v2-cap">' + n + (n === 1 ? ' spot' : ' spots') + ' · updated ' + esc(getTimeAgo(new Date(data.lastUpdated))) + '</span>' +
                        (hz ? '<br>' + flagHtml(hz) : '') +
                        (isIntl ? '<br><button type="button" class="v2-link v2-explore" data-domain="' + esc(domain) + '">Explore swims here <i data-lucide="arrow-right" class="v2-inline-icon"></i></button>' : '') +
                    '</span>' +
                    arrow +
                    '<span class="v2-rowtemp" style="color:' + getTempColor(Number(data.avgTemp)) + '">' + data.avgTemp + '°</span>' +
                    '<i data-lucide="chevron-right" class="v2-chev"></i>' +
                '</div>'
            );
            meta.push({ domain: domain, country: country });
        });

        if (!rows.length) {
            gridEl.innerHTML = '<div class="v2-empty"><i data-lucide="waves"></i><div><b>No recent reports here yet</b><br><span class="v2-sub">Try another water type, or be the first to log the water.</span></div></div>';
            icons();
            return;
        }
        gridEl.innerHTML = '<div class="v2-card v2-list">' + rows.join('') + '</div>';
        gridEl.querySelectorAll('.v2-row').forEach(function (el, i) {
            el.addEventListener('click', function () { openRegionDetail(meta[i].domain); });
        });
        gridEl.querySelectorAll('.v2-explore').forEach(function (b, i) {
            var m = meta.filter(function (x) { return x.domain === b.getAttribute('data-domain'); })[0];
            b.addEventListener('click', function (ev) {
                ev.stopPropagation();
                openExplore('trends_region', { country: (m && m.country) || undefined, place_label: formatDomain(b.getAttribute('data-domain')) });
            });
        });
        icons();
    };

    // ── A region's spots ────────────────────────────────────────────────────
    // v1 builds these rows inline (openRegionDetail, incl. a live-sensor variant with its own fetch;
    // renderTrendSpotList for the refresh path). Both are left alone and restyled in v2.css
    // (.spot-list-item). v2 only adds the hazard flag, mapping rows back to spots in the same order v1 uses.
    function decorate(items, list) {
        items.forEach(function (item, i) {
            var s = list[i];
            if (!s || !item) return;
            var n = hazardsAt(s.spot_id).filter(function (h) { return h.severity === 'danger' || h.severity === 'caution'; }).length;
            var first = item.firstElementChild;
            if (n && first) first.insertAdjacentHTML('beforeend', '<div style="margin-top:4px">' + flagHtml(n) + '</div>');
        });
        icons();
    }

    var _region = window.openRegionDetail;
    if (typeof _region === 'function') {
        window.openRegionDetail = function (domain) {
            var r = _region.apply(this, arguments);
            try {
                var data = trendsData[domain];
                var isIntl = spots.some(function (s) { return s.domain === domain && internationalSpotIds.has(s.id); });
                var stale = getStaleDays(isIntl) * 86400000;
                var sorted = (!data || !data.spots) ? [] : data.spots.slice()
                    .filter(function (s) { return new Date(s.updated_at).getTime() >= Date.now() - stale; })
                    .sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });
                decorate([].slice.call($('regionSpotList').children), sorted);
            } catch (e) { console.warn('Region hazards:', e); }
            return r;
        };
    }
    var _list = window.renderTrendSpotList;
    if (typeof _list === 'function') {
        window.renderTrendSpotList = function (title, list) {
            var r = _list.apply(this, arguments);
            try { decorate([].slice.call(document.querySelectorAll('#regionGrid .spot-list-item')), list); } catch (e) { console.warn('List hazards:', e); }
            return r;
        };
    }

    // ── One spot: hazards + the two things a swimmer does here ─────────────────
    function spotExtras(spotId, spotName) {
        var detail = $('trendsSpotDetail');
        if (!detail) return;
        var box = $('v2SpotExtras');
        if (!box) {
            box = document.createElement('div');
            box.id = 'v2SpotExtras';
            var header = detail.querySelector('.view-header');
            if (header && header.parentNode) header.parentNode.insertBefore(box, header.nextSibling); else detail.insertBefore(box, detail.firstChild);
        }
        var hz = hazardsAt(spotId).sort(function (a, b) { var r = { danger: 3, caution: 2, info: 1 }; return (r[b.severity] || 0) - (r[a.severity] || 0); });
        var banners = hz.map(function (h) {
            var cls = h.severity === 'danger' ? 'v2-hazard-danger' : h.severity === 'caution' ? 'v2-hazard-caution' : 'v2-hazard-info';
            var label = h.severity === 'danger' ? 'DANGER' : h.severity === 'caution' ? 'CAUTION' : 'NOTE';
            var until = h.active_until ? ' Active until ' + new Date(h.active_until).toLocaleString('en-ZA', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + '.' : '';
            return '<button type="button" class="v2-hazard ' + cls + '" onclick="showPage(\'safety\')">' +
                '<i data-lucide="triangle-alert"></i><span><b><span class="v2-tag">' + label + '</span>' + esc(h.title || cap(h.hazard_type || 'Hazard')) + '</b>' +
                '<span class="v2-sub">' + esc(until.trim()) + ' Tap for details.</span></span></button>';
        }).join('');
        box.innerHTML = banners +
            '<button type="button" class="v2-btn v2-btn-primary" id="v2SpotLog"><i data-lucide="plus"></i>' + esc((window.V2.COPY || {}).action || 'Log the water') + ' here</button>' +
            '<button type="button" class="v2-btn v2-btn-ghost" id="v2SpotHazard" style="margin-top:10px"><i data-lucide="flag"></i>Report a hazard</button>';
        icons();

        $('v2SpotLog').addEventListener('click', function () {
            showPage('logTemp');                                // opens the Log sheet over this page
            // An explicit choice from this spot's own page: same effect as picking it in the picker
            try { selectSpotFromPicker(spotId, spotName); } catch (e) { console.warn('Log here:', e); }
        });
        $('v2SpotHazard').addEventListener('click', function () {
            showHazardReport();
            var sp = (spots || []).find(function (s) { return s.id === spotId; });
            try {
                var reg = $('hazardRegion');
                if (sp && sp.domain && reg) {
                    reg.value = sp.domain;
                    if (typeof updateHazardSpotsByRegion === 'function') updateHazardSpotsByRegion();
                    var sel = $('hazardSpot'); if (sel) sel.value = spotId;
                }
            } catch (e) { /* the form still works with manual selection */ }
        });
    }

    var _open = window.openSpotDetail;
    if (typeof _open === 'function') {
        window.openSpotDetail = function (spotId, spotName) {
            try { spotExtras(spotId, spotName); } catch (e) { console.warn('Spot extras:', e); }
            return _open.apply(this, arguments);
        };
    }

    // ── Page chrome: title, keyboard access for the div-based controls ──────────
    function mount() {
        var title = document.querySelector('#trendsOverview > .card-title');
        if (title) title.textContent = 'Spots';
        var ctl = document.querySelectorAll('#history .trends-filter-group .toggle-btn, #trendsSpotDetail .toggle-btn');
        ctl.forEach(function (el) { el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); });
        var hist = $('history');
        if (hist) hist.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            var t = e.target.closest('[role="button"]');
            if (t && t !== e.target.closest('button')) { e.preventDefault(); t.click(); }
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
