// Turns a Strava activity's per-second streams into an hour-by-hour picture of a
// long swim: distance, pace, heart rate, stroke rate, watch temperature and stops.
//
// Only this summary is stored, never the raw streams or GPS track. Every number
// carries the limits of a wrist watch in water: GPS is speed over ground (tide
// and current included), wrist heart rate is less reliable in water, and the
// watch temperature reads body heat as well as water.

const STOP_MIN_SECONDS = 15;   // a pause shorter than this is a turn or a sighting, not a stop
const GAP_IS_STOP_SECONDS = 30; // a hole in the recording longer than this counts as stopped
const SLOW_MS = 0.15;           // below this speed, with no moving stream, treat as stopped

const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const round = (v, d = 1) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const median = a => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function analyseSwimStreams(streams) {
    const time = streams?.time?.data;
    if (!Array.isArray(time) || time.length < 10) return null;
    const n = time.length;
    const pick = k => (Array.isArray(streams[k]?.data) && streams[k].data.length === n ? streams[k].data : null);
    const dist = pick('distance'), hr = pick('heartrate'), cad = pick('cadence');
    const vel = pick('velocity_smooth'), temp = pick('temp'), movingStream = pick('moving');

    // Moving flag per sample: Strava's own if present, otherwise speed.
    const moving = time.map((t, i) => {
        const gap = i > 0 ? t - time[i - 1] : 0;
        if (gap > GAP_IS_STOP_SECONDS) return false;
        if (movingStream) return Boolean(movingStream[i]);
        if (vel) return vel[i] >= SLOW_MS;
        return true;
    });
    const dt = time.map((t, i) => (i === 0 ? 0 : Math.min(t - time[i - 1], GAP_IS_STOP_SECONDS)));
    const gapSec = time.map((t, i) => (i === 0 ? 0 : Math.max(0, t - time[i - 1] - GAP_IS_STOP_SECONDS)));

    // Stops: runs of not-moving samples plus recording gaps.
    const stops = [];
    let start = null;
    for (let i = 0; i < n; i++) {
        if (!moving[i] && start === null) start = i > 0 ? i - 1 : i;
        if ((moving[i] || i === n - 1) && start !== null) {
            const end = moving[i] ? i : n - 1;
            const secs = time[end] - time[start];
            if (secs >= STOP_MIN_SECONDS) stops.push({ at_min: round(time[start] / 60, 0), seconds: secs });
            start = null;
        }
    }

    const totalSec = time[n - 1] - time[0];
    const hours = [];
    for (let h = 0; h * 3600 < totalSec; h++) {
        const idx = [];
        for (let i = 0; i < n; i++) if (time[i] - time[0] >= h * 3600 && time[i] - time[0] < (h + 1) * 3600) idx.push(i);
        if (idx.length < 2) continue;
        const first = idx[0], last = idx[idx.length - 1];
        const covered = time[last] - time[first];
        const movingSec = idx.reduce((s, i) => s + (moving[i] ? dt[i] : 0), 0);
        const km = dist ? (dist[last] - dist[first]) / 1000 : null;
        const movingIdx = idx.filter(i => moving[i]);
        hours.push({
            hour: h + 1,
            minutes_covered: round(covered / 60, 0),
            km: round(km, 2),
            pace_per_100m_s: km > 0 && movingSec > 0 ? round(movingSec / (km * 10), 0) : null,
            heart_rate: hr ? round(mean(movingIdx.map(i => hr[i]).filter(v => v > 40)), 0) : null,
            stroke_rate: cad ? round(mean(movingIdx.map(i => cad[i]).filter(v => v > 0)), 1) : null,
            watch_temp_c: temp ? round(mean(idx.map(i => temp[i]).filter(v => v != null)), 1) : null,
            stopped_min: round((covered - movingSec + idx.reduce((s, i) => s + gapSec[i], 0)) / 60, 1),
        });
    }

    const full = hours.filter(h => h.minutes_covered >= 50);
    const a = full[0], b = full[full.length - 1];
    const pct = (x, y) => (x && y ? round((y - x) / x * 100, 1) : null);
    const fade = full.length >= 2 ? {
        compared: `hour ${a.hour} to hour ${b.hour}`,
        pace_change_pct: pct(a.pace_per_100m_s, b.pace_per_100m_s),
        heart_rate_change_bpm: a.heart_rate != null && b.heart_rate != null ? b.heart_rate - a.heart_rate : null,
        stroke_rate_change_pct: pct(a.stroke_rate, b.stroke_rate),
    } : null;

    const stopSecs = stops.map(s => s.seconds);
    return {
        total_minutes: round(totalSec / 60, 0),
        km: dist ? round((dist[n - 1] - dist[0]) / 1000, 2) : null,
        streams: ['distance', 'heartrate', 'cadence', 'velocity_smooth', 'temp', 'moving'].filter(k => pick(k)),
        hours,
        fade,
        stops: {
            count: stops.length,
            total_min: round(stopSecs.reduce((s, v) => s + v, 0) / 60, 1),
            median_seconds: median(stopSecs),
            longest_seconds: stopSecs.length ? Math.max(...stopSecs) : null,
            at_minutes: stops.map(s => s.at_min),
        },
    };
}
