// The measured-conditions card for a spot page.
//
// Language contract (tested in test/observations-conditions.test.js):
//   LIVE          → "Live measurement"
//   RECENT        → "Recent measurement"    — never "live/current/today"
//   LAST_READING  → "Last reading"          — never "live/current/today"
//   STALE / null  → renders NOTHING (empty string)
// Only fields that exist are shown — no dashes, no empty placeholders.
// A nearby buoy is described as "Nearby measured water temperature",
// never as the temperature AT the beach.

import { escapeHtml } from '../../seo-utils.js';

const STATE_LABEL = {
  LIVE: 'Live measurement',
  RECENT: 'Recent measurement',
  LAST_READING: 'Last reading',
};

const STATE_COLOR = {
  LIVE: '#10b981',
  RECENT: '#38bdf8',
  LAST_READING: '#94a3b8',
};

export function formatAge(ageMinutes) {
  if (!Number.isFinite(ageMinutes) || ageMinutes < 0) return '';
  if (ageMinutes < 60) return `${Math.max(1, Math.round(ageMinutes))} minutes ago`;
  const hours = ageMinutes / 60;
  if (hours < 48) {
    const h = Math.round(hours);
    return h === 1 ? '1 hour ago' : `${h} hours ago`;
  }
  const d = Math.round(hours / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function windDirectionLabel(deg) {
  if (!Number.isFinite(deg)) return null;
  return DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/**
 * @param {ReturnType<import('./conditions.js').getSpotConditions> extends Promise<infer T> ? T : never} conditions
 * @returns {string} HTML, or '' when there is nothing honest to show
 */
export function renderConditionsCard(conditions) {
  if (!conditions) return '';
  if (conditions.status === 'STALE') return '';
  if (conditions.temperatureC == null) return '';
  const label = STATE_LABEL[conditions.status];
  if (!label) return '';

  const color = STATE_COLOR[conditions.status];
  const age = formatAge(conditions.ageMinutes);
  const st = conditions.station || {};

  const sourceLine = [
    st.name ? escapeHtml(st.name) : null,
    st.distanceKm != null ? `${st.distanceKm.toFixed(1)} km away` : null,
  ].filter(Boolean).join(' · ');

  const detailChips = [];
  if (conditions.waveHeightM != null) {
    detailChips.push(`Swell ${conditions.waveHeightM.toFixed(1)} m`);
  }
  if (conditions.wavePeriodS != null) {
    detailChips.push(`Period ${Math.round(conditions.wavePeriodS)} sec`);
  }
  if (conditions.windSpeedMs != null) {
    const dir = windDirectionLabel(conditions.windDirectionDeg);
    detailChips.push(`Wind ${conditions.windSpeedMs.toFixed(1)} m/s${dir ? ` ${dir}` : ''}`);
  }
  const chipsHtml = detailChips.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;">${detailChips.map((c) =>
        `<span style="font-size:13px;color:#cbd5e1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:4px 12px;">${escapeHtml(c)}</span>`
      ).join('')}</div>`
    : '';

  const heading = conditions.sourceType === 'on_site_measurement'
    ? 'Measured water temperature'
    : 'Nearby measured water temperature';

  return `
      <section class="observed-conditions" style="margin:26px 0;">
        <h2>Water Conditions</h2>
        <div style="background:rgba(56,189,248,0.05);border:1px solid rgba(56,189,248,0.18);border-radius:14px;padding:20px 22px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${color};margin-bottom:6px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;"></span>${escapeHtml(label)}
          </div>
          <div style="font-size:40px;font-weight:800;color:#f1f5f9;line-height:1;">${conditions.temperatureC.toFixed(1)}&deg;C</div>
          <div style="font-size:13px;color:#94a3b8;margin-top:8px;">${escapeHtml(heading)}${age ? ` &middot; measured ${escapeHtml(age)}` : ''}</div>
          ${sourceLine ? `<div style="font-size:13px;color:#94a3b8;margin-top:3px;">${sourceLine}</div>` : ''}
          ${chipsHtml}
          ${st.attribution ? `<div style="font-size:11.5px;color:#64748b;margin-top:14px;">${escapeHtml(st.attribution)}</div>` : ''}
        </div>
      </section>`;
}
