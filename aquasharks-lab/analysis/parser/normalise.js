// @ts-check
/** Text -> numbers. Pure helpers shared by every extractor. Nothing here guesses: unparseable input returns null. */

/** "29.53str/min" -> {value: 29.53, unit: 'str/min'}; "200 metres" -> {200,'metres'}; "35.16%" -> {35.16,'%'} */
export function numUnit(s) {
  const m = /(-?\d+(?:\.\d+)?)\s*([A-Za-z%/]*)/.exec(String(s || ''));
  return m ? { value: +m[1], unit: m[2] || '' } : null;
}
/** "3 mins 15.4 seconds" | "15.4 seconds" -> seconds */
export function parseDuration(s) {
  const m = /(?:(\d+)\s*mins?)?\s*(\d+(?:\.\d+)?)\s*sec/i.exec(String(s || ''));
  return m ? (m[1] ? +m[1] * 60 : 0) + +m[2] : null;
}
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** "June 03, 2025 at 05:15:00 PM" -> { date: '2025-06-03', time: '05:15:00 PM' }. Time zone is not stated, so none is applied. */
export function parseSwimDateTime(s) {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})(?:\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?))?/i.exec(String(s || ''));
  if (!m) return null; const mi = MONTHS.indexOf(m[1].toLowerCase()); if (mi < 0) return null;
  return { date: `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`, time: m[4] ? m[4].trim() : null };
}
/** EO reference cell: "<4%" -> {lo:null,hi:4}; "70-75%" -> {70,75}; "0%" -> {0,0}; ">10%" -> {10,null} */
export function parseReference(cell) {
  const t = String(cell || '').replace(/\s/g, '');
  let m;
  if ((m = /^<(\d+(?:\.\d+)?)%?$/.exec(t))) return { text: t, lo: null, hi: +m[1] };
  if ((m = /^>(\d+(?:\.\d+)?)%?$/.exec(t))) return { text: t, lo: +m[1], hi: null };
  if ((m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)%?$/.exec(t))) return { text: t, lo: +m[1], hi: +m[2] };
  if ((m = /^(\d+(?:\.\d+)?)%?$/.exec(t))) return { text: t, lo: +m[1], hi: +m[1] };
  return null;
}
/** Sentence split that does not break on decimals ("34.67%") or common abbreviations. */
export function splitSentences(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"'“])/).map((s) => s.trim()).filter(Boolean);
}
/** Tidy text from a PDF text layer: " :" -> ":", collapse spaces. */
export const tidy = (s) => String(s || '').replace(/\s+:/g, ':').replace(/\s+/g, ' ').trim();
