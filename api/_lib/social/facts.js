// A fact is a claim plus where it came from. Captions and images may use ONLY facts.
// `source.quote` (when set) must appear verbatim in `source.file`: the traceability
// test enforces it, so a page edit that removes the claim breaks the build.

export function fact(key, text, source, opts = {}) {
  if (!key || !text) throw new Error('fact needs key and text');
  if (!source || !(source.table || source.file)) throw new Error(`fact ${key} has no source`);
  return {
    key, text: String(text), source,
    kind: opts.kind || 'evergreen',            // 'evergreen' | 'time_sensitive'
    observedAt: opts.observedAt || null,       // required for time_sensitive
    ...(opts.value !== undefined ? { value: opts.value } : {}),
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 'YYYY-MM-DD' to 'Sun 18 Oct'. Parsed as UTC parts, never toISOString (SAST shifts a day back). */
export function fmtDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function fmtUtc(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}
