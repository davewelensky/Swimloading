// app-pace.js — "Pace by water temperature": a personal, read-only card on the
// profile for swimmers who import swims from Strava.
//
// PRIVACY: this reads ONLY the signed-in swimmer's own rows (strava_imports has
// own-row RLS; temp_logs is filtered by user_id here). It never writes pace or
// any Strava-derived value anywhere. temp_logs is readable by other members, so
// pace must never be copied into it.
//
// The maths lives in SLPaceCalc (pure, no DOM, no Supabase) so it is unit-tested
// in Node: test/pace-by-temp.test.js. The rendering below is browser-only.

const SLPaceCalc = (function () {
    const MIN_DISTANCE_M = 800;   // shorter swims make GPS-based pace unreliable
    const PACE_MIN = 50;          // seconds per 100m; faster is a bad GPS/watch read
    const PACE_MAX = 240;         // seconds per 100m; slower is a stop-start or drift read
    const BAND_C = 3;             // width of a temperature band, in degrees C
    const MIN_SWIMS = 5;          // swims needed (after filtering) before showing anything
    const MIN_BAND_SWIMS = 2;     // swims a band needs before its median is shown
    const MIN_BANDS = 2;          // bands needed to make a comparison at all

    function paceSecPer100(distanceM, movingSeconds) {
        const d = Number(distanceM), t = Number(movingSeconds);
        if (!(d > 0) || !(t > 0)) return null;
        return t / (d / 100);
    }

    function isPoolType(waterType) {
        return String(waterType || '').toUpperCase().indexOf('POOL') !== -1;
    }

    function median(values) {
        if (!values.length) return null;
        const s = values.slice().sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }

    function fmtPace(sec) {
        if (sec == null || !isFinite(sec)) return '–';
        const r = Math.round(sec);
        const m = Math.floor(r / 60), s = r % 60;
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function bandOf(temp) {
        const lo = Math.floor(temp / BAND_C) * BAND_C;
        return { lo: lo, hi: lo + BAND_C, label: lo + '–' + (lo + BAND_C) + '°C' };
    }

    // imports: strava_imports rows; logs: the swimmer's own temp_logs rows;
    // waterTypeOf: spotId -> spots.water_type (undefined when the spot is unknown).
    // Returns only swims that are genuinely comparable: open water, long enough,
    // sane pace, with a logged temperature.
    function buildSwims(imports, logs, waterTypeOf) {
        const byId = new Map();
        (logs || []).forEach(function (l) { byId.set(l.id, l); });
        const out = [];
        (imports || []).forEach(function (imp) {
            const log = byId.get(imp.imported_to_log_id);
            if (!log) return;
            const temp = Number(log.temp_c);
            if (!isFinite(temp)) return;
            if (!(Number(imp.distance_m) >= MIN_DISTANCE_M)) return;
            const pace = paceSecPer100(imp.distance_m, imp.moving_time_seconds);
            if (pace == null || pace < PACE_MIN || pace > PACE_MAX) return;
            const wt = waterTypeOf(log.spot_id);
            if (wt == null || isPoolType(wt)) return;   // unknown spot or pool: not comparable
            out.push({
                pace: pace,
                temp: temp,
                wetsuit: log.wetsuit === true ? true : log.wetsuit === false ? false : null,
                at: new Date(imp.start_date_local || log.logged_at || log.created_at).getTime(),
                spotId: log.spot_id,
                distanceM: Number(imp.distance_m),
            });
        });
        return out;
    }

    function filterGear(swims, gear) {
        if (gear === 'wetsuit') return swims.filter(function (s) { return s.wetsuit === true; });
        if (gear === 'skins')   return swims.filter(function (s) { return s.wetsuit === false; });
        return swims;
    }

    function gearCounts(swims) {
        const c = { all: swims.length, wetsuit: 0, skins: 0, untagged: 0 };
        swims.forEach(function (s) {
            if (s.wetsuit === true) c.wetsuit++;
            else if (s.wetsuit === false) c.skins++;
            else c.untagged++;
        });
        return c;
    }

    // gear: 'all' | 'wetsuit' | 'skins'
    function summarise(allSwims, gear) {
        const swims = filterGear(allSwims, gear || 'all');
        const total = swims.length;
        if (total < MIN_SWIMS) {
            return { status: 'need_more', total: total, needed: MIN_SWIMS - total };
        }

        const groups = new Map();
        swims.forEach(function (s) {
            const b = bandOf(s.temp);
            if (!groups.has(b.lo)) groups.set(b.lo, { band: b, swims: [] });
            groups.get(b.lo).swims.push(s);
        });
        const bands = Array.from(groups.values())
            .filter(function (g) { return g.swims.length >= MIN_BAND_SWIMS; })
            .sort(function (a, b) { return a.band.lo - b.band.lo; })
            .map(function (g) {
                return {
                    lo: g.band.lo, hi: g.band.hi, label: g.band.label,
                    n: g.swims.length,
                    medianPace: median(g.swims.map(function (s) { return s.pace; })),
                };
            });
        if (bands.length < MIN_BANDS) {
            return { status: 'need_spread', total: total, bands: bands };
        }

        // Headline: coldest band vs warmest band, in seconds per 100m (positive = colder is slower).
        const coldest = bands[0], warmest = bands[bands.length - 1];
        const diff = coldest.medianPace - warmest.medianPace;

        // Latest swim vs the swimmer's usual in the same band (needs 2+ other swims there).
        const latest = swims.reduce(function (a, b) { return b.at > a.at ? b : a; });
        const latestBand = bandOf(latest.temp);
        const others = swims.filter(function (s) { return s !== latest && bandOf(s.temp).lo === latestBand.lo; });
        const compare = others.length >= MIN_BAND_SWIMS
            ? { label: latestBand.label, n: others.length, medianPace: median(others.map(function (s) { return s.pace; })) }
            : null;

        return {
            status: 'ready', total: total, bands: bands,
            coldest: coldest, warmest: warmest, diff: diff,
            latest: latest, compare: compare,
        };
    }

    return {
        MIN_DISTANCE_M: MIN_DISTANCE_M, MIN_SWIMS: MIN_SWIMS, MIN_BAND_SWIMS: MIN_BAND_SWIMS, BAND_C: BAND_C,
        paceSecPer100: paceSecPer100, isPoolType: isPoolType, median: median, fmtPace: fmtPace,
        bandOf: bandOf, buildSwims: buildSwims, filterGear: filterGear, gearCounts: gearCounts, summarise: summarise,
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SLPaceCalc;

// ─── Browser rendering ───────────────────────────────────────────────────────

const SLPace = (function () {
    let _swims = [];
    let _gear = 'all';
    let _containerId = null;

    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function spotWaterType(spotId) {
        const list = (typeof spots !== 'undefined' && Array.isArray(spots)) ? spots : [];
        const s = list.find(function (x) { return String(x.id) === String(spotId); });
        return s ? (s.water_type || '') : undefined;
    }

    function spotName(spotId) {
        const list = (typeof spots !== 'undefined' && Array.isArray(spots)) ? spots : [];
        const s = list.find(function (x) { return String(x.id) === String(spotId); });
        return s ? s.name : '';
    }

    async function load() {
        const uid = currentUser && currentUser.id;
        if (!uid) return [];
        const [imp, logs] = await Promise.all([
            supabaseClient.from('strava_imports')
                .select('imported_to_log_id, distance_m, moving_time_seconds, start_date_local')
                .eq('user_id', uid).not('imported_to_log_id', 'is', null).limit(1000),
            supabaseClient.from('temp_logs')
                .select('id, temp_c, spot_id, wetsuit, logged_at, created_at')
                .eq('user_id', uid).limit(1000),
        ]);
        if (imp.error || logs.error) {
            console.warn('[pace] load failed:', (imp.error || logs.error).message);
            return [];
        }
        return SLPaceCalc.buildSwims(imp.data || [], logs.data || [], spotWaterType);
    }

    function gearPills(counts) {
        if (counts.wetsuit === 0 && counts.skins === 0) return '';
        const opts = [['all', 'All', counts.all], ['wetsuit', 'Wetsuit', counts.wetsuit], ['skins', 'No wetsuit', counts.skins]];
        return '<div class="pace-pills">' + opts.filter(function (o) { return o[0] === 'all' || o[2] > 0; }).map(function (o) {
            return '<button type="button" class="pace-pill' + (_gear === o[0] ? ' active' : '') + '" onclick="SLPace.setGear(\'' + o[0] + '\')">' +
                o[1] + ' <span class="pace-pill-n">' + o[2] + '</span></button>';
        }).join('') + '</div>';
    }

    function bodyHtml(sum, counts) {
        if (sum.status === 'need_more' && _gear !== 'all') {
            // Filtered view: the gap is tags, not imports
            return '<div class="pace-msg">Only ' + sum.total + ' of your swims ' + (sum.total === 1 ? 'is' : 'are') + ' tagged &ldquo;' +
                (_gear === 'wetsuit' ? 'Wetsuit' : 'No wetsuit') + '&rdquo;. Tag at least ' + SLPaceCalc.MIN_SWIMS + ' to compare them.</div>';
        }
        if (sum.status === 'need_more') {
            return '<div class="pace-msg">Import ' + sum.needed + ' more open-water swim' + (sum.needed === 1 ? '' : 's') +
                ' from Strava to see how your pace changes with water temperature. You have ' + sum.total + ' of ' + SLPaceCalc.MIN_SWIMS + '.</div>';
        }
        if (sum.status === 'need_spread') {
            return '<div class="pace-msg">You have ' + sum.total + ' swims, but not enough at different temperatures yet. ' +
                'The comparison unlocks once you have at least ' + SLPaceCalc.MIN_BAND_SWIMS + ' swims in two different ' + SLPaceCalc.BAND_C + '°C bands.</div>';
        }
        const rows = sum.bands.map(function (b) {
            return '<div class="pace-row"><span class="pace-band">' + esc(b.label) + '</span>' +
                '<span class="pace-val">' + SLPaceCalc.fmtPace(b.medianPace) + '<span class="pace-unit"> /100m</span></span>' +
                '<span class="pace-n">' + b.n + ' swims</span></div>';
        }).join('');

        const d = Math.round(sum.diff);
        const headline = Math.abs(d) < 2
            ? 'Your ' + esc(sum.coldest.label) + ' and ' + esc(sum.warmest.label) + ' swims are about the same pace.'
            : 'Your ' + esc(sum.coldest.label) + ' swims are ' + Math.abs(d) + ' s/100m ' + (d > 0 ? 'slower' : 'faster') +
              ' than your ' + esc(sum.warmest.label) + ' swims.';

        let latest = '';
        if (sum.latest) {
            const when = new Date(sum.latest.at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
            const where = spotName(sum.latest.spotId);
            latest = '<div class="pace-latest">Latest: ' + esc(when) + (where ? ', ' + esc(where) : '') + ' &middot; ' +
                SLPaceCalc.fmtPace(sum.latest.pace) + ' /100m at ' + sum.latest.temp.toFixed(1) + '°C' +
                (sum.compare ? ' (your usual at ' + esc(sum.compare.label) + ': ' + SLPaceCalc.fmtPace(sum.compare.medianPace) +
                    ', from ' + sum.compare.n + ' other swims)' : '') + '</div>';
        }

        const untagged = (_gear === 'all' && counts.untagged >= 3)
            ? '<div class="pace-hint">' + counts.untagged + ' of your swims have no wetsuit tag. Open a log under My recent logs and tap it to add one; cold swims are often wetsuit swims, which changes pace.</div>'
            : '';

        return '<div class="pace-headline">' + headline + '</div>' + rows + latest + untagged;
    }

    function paint() {
        const el = document.getElementById(_containerId);
        if (!el) return;
        if (!_swims.length) { el.innerHTML = ''; return; }   // nothing comparable: show nothing, not an empty card
        const counts = SLPaceCalc.gearCounts(_swims);
        const sum = SLPaceCalc.summarise(_swims, _gear);
        el.innerHTML =
            '<div class="pace-card">' +
                '<div class="pace-title"><i data-lucide="thermometer" style="width:15px;height:15px;"></i>Pace by water temperature</div>' +
                '<div class="pace-sub">Your open-water swims imported from Strava. Median pace per band.</div>' +
                gearPills(counts) + bodyHtml(sum, counts) +
                '<div class="pace-foot">Pace is moving time per 100m. It also depends on effort, wetsuit and conditions, so read it as a pattern in your own swims, not a rule.</div>' +
            '</div>';
        if (typeof initIcons === 'function') initIcons();
    }

    return {
        calc: SLPaceCalc,
        async render(containerId) {
            _containerId = containerId;
            const el = document.getElementById(containerId);
            if (!el) return;
            try {
                _swims = await load();
            } catch (err) {
                console.warn('[pace] render error:', err);
                _swims = [];
            }
            paint();
        },
        setGear(g) { _gear = g; paint(); },
    };
})();
