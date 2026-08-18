// Auto-approval framework for station↔spot matches — DRY RUN ONLY.
//
// Manual approval is the right default while the system is young, but it
// should not stay manual forever: "buoy 1 km off the beach, reporting every
// half hour, spot has no other source" is not a judgement call. This module
// decides which matches are that obvious.
//
// THE RULES THAT MATTER MOST, both structural:
//
//   1. A HUMAN DECISION ALWAYS WINS. An approved match is never re-decided,
//      a rejected match is never resurrected, a manually chosen primary is
//      never displaced. Those are checked first and are absolute.
//   2. UNKNOWN IS NOT PERMISSION. Every missing field (depth, water body,
//      station type) counts against auto-approval, never for it. A match
//      auto-approves because it is proven safe, not because nothing proved
//      it unsafe.
//
// Nothing here writes to the database. `evaluateAutoApproval` reports what
// WOULD happen; enabling it is a separate, later decision.

export const AUTO_APPROVE_CONFIG = {
  maxDistanceKm: 3,
  minScore: 85,
  maxSensorDepthM: 5,
  maxObservationAgeHours: 6,        // must be LIVE, not merely recent
  acceptedStationTypes: ['fixed', 'lido_sensor', 'buoy'],
  // Providers whose station metadata has been checked by hand. A new
  // provider starts untrusted and earns this after review.
  trustedProviders: ['ndbc', 'cmems_insitu', 'ireland_mi', 'mywaterlive'],
  // If a rival station is within this score of the winner, the choice is a
  // judgement between two plausible sources — exactly what a human is for.
  competingScoreMargin: 10,
};

/**
 * @param {object} match
 * @param {object} match.spot          { id, name, water_type }
 * @param {object} match.station       { externalId, providerCode, stationType, sensorDepthM, waterBody, latestTempAt, latestTempC, active }
 * @param {number} match.distanceKm
 * @param {number} match.suitabilityScore
 * @param {Array}  match.existingLinks links for THIS spot (any station): [{station_external_id, status, is_primary, reviewed_by}]
 * @param {Array}  match.competingScores scores of other candidate stations for the same spot
 * @param {{now?:Date, config?:object}} [opts]
 * @returns {{autoApprovable:boolean, blockers:string[], passed:string[]}}
 */
export function isAutoApprovableStationMatch(match, opts = {}) {
  const cfg = opts.config || AUTO_APPROVE_CONFIG;
  const now = opts.now || new Date();
  const blockers = [];
  const passed = [];
  const st = match.station || {};
  const links = match.existingLinks || [];

  // ── 1. Human decisions are absolute ──────────────────────────────────
  const thisPair = links.find((l) => l.station_external_id === st.externalId);
  if (thisPair?.status === 'rejected') {
    blockers.push('this pairing was manually REJECTED — never resurrect');
  }
  if (thisPair?.status === 'approved') {
    blockers.push('this pairing is already approved — nothing to do');
  }
  const manualPrimary = links.find((l) => l.is_primary && l.status === 'approved'
    && l.station_external_id !== st.externalId);
  if (manualPrimary) {
    blockers.push(`spot already has an approved primary (${manualPrimary.station_external_id}) — never displace`);
  }
  if (blockers.length) return { autoApprovable: false, blockers, passed };
  passed.push('no conflicting human decision');

  // ── 2. The observation must be live right now ────────────────────────
  if (st.active === false) blockers.push('station inactive');
  if (st.latestTempC == null || !st.latestTempAt) {
    blockers.push('no stored temperature observation');
  } else {
    const ageH = (now.getTime() - new Date(st.latestTempAt).getTime()) / 3_600_000;
    if (!Number.isFinite(ageH) || ageH < 0) blockers.push('unusable observation timestamp');
    else if (ageH > cfg.maxObservationAgeHours) {
      blockers.push(`observation ${Math.round(ageH)}h old (needs ≤${cfg.maxObservationAgeHours}h)`);
    } else passed.push(`observation ${Math.round(ageH * 10) / 10}h old`);
  }

  // ── 3. Proximity and score ───────────────────────────────────────────
  if (!(match.distanceKm <= cfg.maxDistanceKm)) {
    blockers.push(`${match.distanceKm} km exceeds the ${cfg.maxDistanceKm} km auto radius`);
  } else passed.push(`${match.distanceKm} km`);

  if (!(match.suitabilityScore >= cfg.minScore)) {
    blockers.push(`score ${match.suitabilityScore} below ${cfg.minScore}`);
  } else passed.push(`score ${match.suitabilityScore}`);

  // ── 4. Metadata sufficiency — unknown counts against ─────────────────
  const type = (st.stationType || '').toLowerCase();
  if (!type) blockers.push('station type unknown');
  else if (!cfg.acceptedStationTypes.includes(type)) blockers.push(`station type '${type}' not accepted`);
  else passed.push(`station type '${type}'`);

  if (st.sensorDepthM == null) {
    // Depth is unknown for most buoys. It does not make the match wrong —
    // it makes it unproven, which is precisely when a human should look.
    blockers.push('sensor depth unknown (cannot prove a near-surface reading)');
  } else if (st.sensorDepthM > cfg.maxSensorDepthM) {
    blockers.push(`sensor depth ${st.sensorDepthM} m below the ${cfg.maxSensorDepthM} m surface layer`);
  } else passed.push(`sensor depth ${st.sensorDepthM} m`);

  if (!cfg.trustedProviders.includes(st.providerCode)) {
    blockers.push(`provider '${st.providerCode}' not on the trusted list`);
  } else passed.push(`provider '${st.providerCode}'`);

  // ── 5. Water body agreement ──────────────────────────────────────────
  // Only a POSITIVE match counts. Silence from the provider is not
  // agreement — this is the lake-vs-ocean rule applied to automation.
  const wb = (st.waterBody || '').toLowerCase();
  if (!wb) blockers.push('station water body unknown — cannot confirm same body of water');
  else if (['lake', 'pool', 'river', 'dam'].includes(wb)) blockers.push(`station water body '${wb}' is not coastal`);
  else passed.push(`water body '${wb}'`);

  // ── 6. No close rival ────────────────────────────────────────────────
  const rivals = (match.competingScores || []).filter((s) => s >= match.suitabilityScore - cfg.competingScoreMargin);
  if (rivals.length) {
    blockers.push(`${rivals.length} competing station(s) within ${cfg.competingScoreMargin} points — human choice`);
  } else passed.push('no competing station of similar quality');

  // ── 7. Geographical barrier — HONEST LIMITATION ──────────────────────
  // We hold no coastline or landmass data, so "is there a headland between
  // this buoy and that beach?" cannot be answered here. False Bay vs the
  // Atlantic seaboard is ~10 km apart across a peninsula and ~5 °C apart in
  // the water. The 3 km radius above makes such a crossing unlikely but
  // does not disprove it, so this is recorded as a residual risk rather
  // than a passed check, and it is one reason auto-approval stays off.
  passed.push('note: barrier check not possible — mitigated by the 3 km radius only');

  return { autoApprovable: blockers.length === 0, blockers, passed };
}

/**
 * Dry run over many matches. Returns what WOULD be auto-approved plus the
 * comparison against decisions humans have already made — the only real
 * evidence of whether the rules are calibrated.
 */
export function dryRunAutoApproval(matches, opts = {}) {
  const would = [];
  const wouldNot = [];
  for (const m of matches) {
    const verdict = isAutoApprovableStationMatch(m, opts);
    (verdict.autoApprovable ? would : wouldNot).push({ match: m, verdict });
  }

  // Agreement check: run the same rules over pairings a human already
  // decided. Any human REJECTION that the rules would have approved is a
  // calibration failure and must block ever enabling this.
  const humanApproved = [];
  const humanRejected = [];
  for (const m of matches) {
    const link = (m.existingLinks || []).find((l) => l.station_external_id === m.station.externalId);
    if (!link) continue;
    const bare = { ...m, existingLinks: (m.existingLinks || []).filter((l) => l.station_external_id !== m.station.externalId) };
    const verdict = isAutoApprovableStationMatch(bare, opts);
    if (link.status === 'approved') humanApproved.push({ match: m, verdict });
    if (link.status === 'rejected') humanRejected.push({ match: m, verdict });
  }

  return {
    would,
    wouldNot,
    agreement: {
      humanApprovedCount: humanApproved.length,
      humanApprovedThatRulesAgree: humanApproved.filter((h) => h.verdict.autoApprovable).length,
      humanRejectedCount: humanRejected.length,
      // MUST be 0. Anything else means the rules would have overridden a
      // human "no".
      humanRejectedThatRulesWouldApprove: humanRejected.filter((h) => h.verdict.autoApprovable).length,
      humanApproved,
      humanRejected,
    },
  };
}
