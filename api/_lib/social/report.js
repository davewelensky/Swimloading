// Weekly delivery report (emailed every Monday by the generator cron): what went out, what failed, what is queued, so
// "is it delivering?" never depends on someone remembering to look at the Page. Pure over the rows it is handed.
const SAST = (iso) => new Date(new Date(iso).getTime() + 2 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) + ' SAST';
const line = (r) => `${SAST(r.scheduled_for)}  ${String(r.status).padEnd(10)}  ${r.source_key}`;

/** @param rows social_posts rows (source_key, status, scheduled_for, fb_result, is_reserve) @returns { subject, text, problems } */
export function weeklyReport(rows, now = new Date(), { reserveMin = 6, slotsAhead = 6 } = {}) {
  const t = now.getTime(), DAY = 86400e3;
  const slotted = rows.filter((r) => r.scheduled_for && !r.is_reserve);
  const past = slotted.filter((r) => t - new Date(r.scheduled_for) > 0 && t - new Date(r.scheduled_for) <= 7 * DAY).sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
  const next = slotted.filter((r) => new Date(r.scheduled_for) > t && new Date(r.scheduled_for) - t <= 10 * DAY && ['SCHEDULED', 'APPROVED'].includes(r.status)).sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
  const reserves = rows.filter((r) => r.is_reserve && r.status === 'APPROVED').length;
  const published = past.filter((r) => r.status === 'PUBLISHED');
  const problems = [];
  for (const r of past) if (r.status !== 'PUBLISHED') problems.push(`${line(r)}  NOT POSTED${r.fb_result?.error ? `: ${r.fb_result.error}` : ''}`);
  if (reserves < reserveMin) problems.push(`Reserve queue is ${reserves} of ${reserveMin}.`);
  if (next.length < 3) problems.push(`Only ${next.length} post(s) are queued for the next 10 days (3 slots a week).`);
  const text = [
    `Published in the last 7 days: ${published.length} of ${past.length} slotted.`,
    ...past.map(line), '',
    problems.length ? 'NEEDS ATTENTION:' : 'Nothing needs attention.', ...problems.map((p) => `  - ${p}`), '',
    `Queued for the next 10 days (${next.length}):`, ...next.slice(0, slotsAhead).map(line), '',
    `Reserve posts ready: ${reserves}.`,
  ].join('\n');
  return { subject: `Weekly social report: ${published.length} published${problems.length ? `, ${problems.length} need attention` : ', all on track'}`, text, problems };
}
