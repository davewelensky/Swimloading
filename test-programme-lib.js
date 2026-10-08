// SwimLoading product-testing engine — pure logic, no DOM, no network.
// Loaded as a plain global script by the programme page (and imported by test/test-programme-lib.test.js).
// The engine is partner-neutral: nothing in here names a partner or a brand. Category questionnaires, evidence stages and
// report rules live here so the database never needs a migration to add a question.
//
// RULE: every number this file produces is computed from logged rows. Nothing is estimated, defaulted or
// invented, and "not enough evidence" is a first-class result (see EVIDENCE_THRESHOLDS).
(function (root) {
  'use strict';

  // ── Provisional thresholds ────────────────────────────────────
  // These decide when the UI starts showing averages / calling something a finding. They are product
  // decisions, not facts, so they live in ONE place and are surfaced to Dave for confirmation.
  var EVIDENCE_THRESHOLDS = {
    minSessionsForAverage: 3,      // below this a rating is shown as individual scores, not an average
    consistentRange: 1,            // max-min across sessions that still reads "consistent"
    positiveAvg: 4.0,              // average at/above this (with enough sessions) is reported as a positive
    concernAvg: 3.0,               // average at/below this is reported as an observation to address
    confidenceModerate: 3,         // sessions with ratings for a product
    confidenceSubstantial: 10,
    costumeMilestones: [1, 10, 25, 50],   // uses: "how does it feel after 1 / 10 / 25 / 50 swims?"
    wetsuitDistanceSwimKm: 5,      // a swim this long counts as the "distance" stage for a wetsuit
    raceIntensityRpe: 8,
    likeForLikeTempC: 1.5,         // comparison sessions further apart than this are flagged
    likeForLikeDistancePct: 10
  };

  // ── Category questionnaires ───────────────────────────────────
  // rating: 1-5, 5 is ALWAYS the good end; low/high are the endpoint labels shown on the control.
  // core: asked every time. Everything else sits behind "More detail".
  // only: restrict to an environment ('pool' | 'open') where the question makes no sense otherwise.
  function R(key, label, low, high, core, only) { return { key: key, label: label, low: low, high: high, core: !!core, only: only || null }; }
  function I(key, label) { return { key: key, label: label }; }

  var CATEGORIES = {
    wetsuit: {
      label: 'Open-water wetsuit',
      ratings: [
        R('fit', 'Fit', 'Poor fit', 'Excellent fit', true),
        R('shoulder_freedom', 'Shoulder freedom', 'Restricted', 'Completely free', true),
        R('chest_comfort', 'Chest comfort', 'Tight / restrictive', 'Comfortable', false),
        R('neck_comfort', 'Neck comfort', 'Irritating', 'Comfortable', false),
        R('flexibility', 'Flexibility', 'Stiff', 'Moves with me', false),
        R('rotation', 'Rotation', 'Held back', 'Free', false),
        R('body_position', 'Hip and leg position', 'Hips and legs low', 'High and level', true),
        R('warmth', 'Warmth', 'Cold', 'Just right', true),
        R('ease_on', 'Ease of putting on', 'Struggle', 'Easy', false),
        R('zip_closure', 'Zip and closure', 'Problematic', 'Secure and easy', false),
        R('ease_off', 'Ease of removal', 'Struggle', 'Easy', false),
        R('durability', 'Wear and durability', 'Visible wear', 'As new', false),
        R('overall', 'Overall experience', 'Poor', 'Excellent', true)
      ],
      issues: [I('neck_chafing', 'Neck chafing'), I('underarm_chafing', 'Underarm chafing'), I('wrist_discomfort', 'Wrist discomfort'),
               I('ankle_discomfort', 'Ankle discomfort'), I('chest_restriction', 'Chest restriction'), I('shoulder_restriction', 'Shoulder restriction'),
               I('water_ingress', 'Water ingress'), I('zip_issue', 'Zip issue'), I('overheating', 'Overheating'), I('cold', 'Cold')],
      chafingKeys: ['neck_chafing', 'underarm_chafing'],
      stages: ['First impression', 'Familiarisation', 'Distance', 'Controlled comparison', 'Field verdict']
    },
    training_swimwear: {
      label: 'Training swimwear',
      ratings: [
        R('fit', 'Fit', 'Poor fit', 'Excellent fit', true),
        R('comfort', 'Comfort', 'Uncomfortable', 'Very comfortable', true),
        R('shoulder_freedom', 'Freedom through the shoulders', 'Restricted', 'Completely free', false),
        R('support', 'Compression and support', 'Too loose or too tight', 'Just right', false),
        R('strap_comfort', 'Strap comfort', 'Digs in', 'Unnoticeable', false),
        R('movement', 'Movement and slippage', 'Rides up or slips', 'Stays put', false),
        R('water_feel', 'Water feel', 'Drags', 'Slick', false),
        R('fabric_feel', 'Fabric feel', 'Unpleasant', 'Pleasant', false),
        R('drying', 'Drying', 'Stays wet a long time', 'Dries quickly', false),
        R('fabric_condition', 'Colour and fabric condition', 'Visibly deteriorated', 'As new', true),
        R('shape_retention', 'Shape retention', 'Stretched or sagging', 'Holds its shape', true),
        R('durability', 'Durability', 'Wearing out', 'Holding up well', false),
        R('overall', 'Overall experience', 'Poor', 'Excellent', true)
      ],
      issues: [I('rubbing', 'Rubbing'), I('strap_digging', 'Strap digging in'), I('slipping', 'Slipping or riding up'), I('sagging', 'Sagging'),
               I('fading', 'Colour fading'), I('fabric_thinning', 'Fabric thinning')],
      chafingKeys: ['rubbing'],
      stages: ['1 use', '10 uses', '25 uses', '50 uses']
    },
    goggles: {
      label: 'Goggles',
      ratings: [
        R('fit', 'Fit', 'Poor fit', 'Excellent fit', true),
        R('seal', 'Seal', 'No seal', 'Perfect seal', true),
        R('comfort', 'Comfort', 'Uncomfortable', 'Very comfortable', true),
        R('visibility', 'Visibility', 'Poor', 'Clear', true),
        R('fogging', 'Fogging', 'Fogged badly', 'Never fogged', false),
        R('leakage', 'Leakage', 'Leaked a lot', 'Stayed dry', false),
        R('eye_pressure', 'Pressure around the eyes', 'Painful', 'None', false),
        R('strap_adjustment', 'Strap adjustment', 'Fiddly', 'Easy', false),
        R('ow_visibility', 'Open-water visibility', 'Poor', 'Clear', false, 'open'),
        R('pool_visibility', 'Pool visibility', 'Poor', 'Clear', false, 'pool'),
        R('durability', 'Durability', 'Wearing out', 'Holding up well', false),
        R('overall', 'Overall experience', 'Poor', 'Excellent', true)
      ],
      issues: [I('leaking', 'Leaking'), I('fogging', 'Fogging'), I('eye_pressure_marks', 'Marks around the eyes'), I('strap_slipping', 'Strap slipping'), I('scratched_lens', 'Scratched lens')],
      chafingKeys: [],
      stages: ['First impression', 'Familiarisation', 'Long-term use']
    },
    cap: {
      label: 'Swim cap',
      ratings: [
        R('fit', 'Fit', 'Poor fit', 'Excellent fit', true),
        R('comfort', 'Comfort', 'Uncomfortable', 'Very comfortable', true),
        R('stability', 'Stability', 'Rides up or shifts', 'Stays put', true),
        R('durability', 'Durability', 'Wearing out', 'Holding up well', false),
        R('visibility', 'Visibility', 'Hard to see', 'Easy to see', false)
      ],
      issues: [I('slipping', 'Slipping'), I('too_tight', 'Too tight'), I('tearing', 'Tearing'), I('hair_pulling', 'Hair pulling')],
      chafingKeys: [],
      stages: ['First impression', 'Familiarisation', 'Long-term use']
    },
    racing_swimwear: {
      label: 'Racing swimwear',
      noPerformanceClaims: true,    // race times carry too many variables to say anything about a suit
      ratings: [
        R('fit', 'Fit', 'Poor fit', 'Excellent fit', true),
        R('compression', 'Compression', 'Wrong', 'Just right', true),
        R('freedom', 'Freedom of movement', 'Restricted', 'Completely free', true),
        R('water_feel', 'Water feel', 'Drags', 'Slick', false),
        R('start_feel', 'Start and dive feel', 'Poor', 'Excellent', false),
        R('turn_feel', 'Turn feel', 'Poor', 'Excellent', false),
        R('stroke_freedom', 'Stroke freedom', 'Restricted', 'Completely free', false),
        R('comfort', 'Comfort', 'Uncomfortable', 'Very comfortable', true),
        R('race_practicality', 'Race practicality', 'Impractical', 'Practical', false),
        R('ease_on', 'Ease of putting on', 'Struggle', 'Easy', false),
        R('post_race_condition', 'Post-race condition', 'Marked or damaged', 'Unchanged', false),
        R('overall', 'Overall experience', 'Poor', 'Excellent', true)
      ],
      issues: [I('tight_to_put_on', 'Hard to put on'), I('restricted', 'Restricted'), I('rubbing', 'Rubbing')],
      chafingKeys: ['rubbing'],
      stages: ['First impression', 'Familiarisation', 'Race use']
    },
    other: { label: 'Other', ratings: [R('overall', 'Overall experience', 'Poor', 'Excellent', true)], issues: [], chafingKeys: [], stages: ['First impression'] }
  };

  var STATUS = {
    not_started: 'NOT STARTED', available: 'AVAILABLE FOR TESTING', early_testing: 'EARLY TESTING', active_testing: 'ACTIVE TESTING',
    long_term_testing: 'LONG-TERM TESTING', test_complete: 'TEST COMPLETE', awaiting_product: 'AWAITING PRODUCT'
  };
  var CONDITIONS = { flat: 'Flat', light_chop: 'Light chop', choppy: 'Choppy', rough: 'Rough' };
  var WIND = { none: 'None', light: 'Light', moderate: 'Moderate', strong: 'Strong' };
  var ENVIRONMENTS = { sea: 'Sea', lake: 'Lake', pool: 'Pool' };
  var SESSION_KINDS = { training: 'Training', event: 'Event', controlled_test: 'Controlled test' };
  var SIGNALS = {
    page_views: 'Page views', product_enquiry: 'Product enquiries', direct_question: 'Direct questions', where_to_buy: 'Where can I buy it?',
    sizing_question: 'Sizing questions', interest_registration: 'Interest registrations', club_enquiry: 'Club enquiries'
  };

  // ── Small helpers ─────────────────────────────────────────────
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function num(v) { if (v === null || v === undefined || v === '') return null; var n = Number(v); return isFinite(n) ? n : null; }
  function round(n, dp) { var f = Math.pow(10, dp == null ? 1 : dp); return Math.round(n * f) / f; }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  function avg(a) { return a.length ? sum(a) / a.length : null; }
  function isOpenWater(env) { return env === 'sea' || env === 'lake'; }

  function fmtPace(sec) { if (!isNum(sec)) return null; var m = Math.floor(sec / 60), s = Math.round(sec - m * 60); if (s === 60) { m++; s = 0; } return m + ':' + (s < 10 ? '0' : '') + s; }
  function fmtDuration(sec) {
    if (!isNum(sec)) return null;
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h > 0 ? h + 'h ' + (m < 10 ? '0' : '') + m + 'm' : m + 'm';
  }
  function fmtHours(sec) { return isNum(sec) ? round(sec / 3600, 1) : null; }
  function parseDuration(text) {   // "1:05:30", "45:10", "45" (minutes) -> seconds, or null
    if (text === null || text === undefined) return null;
    var t = String(text).trim(); if (!t) return null;
    var parts = t.split(':').map(Number);
    if (parts.some(function (p) { return !isFinite(p) || p < 0; })) return null;
    if (parts.length === 1) return Math.round(parts[0] * 60);
    if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1]);
    if (parts.length === 3) return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
    return null;
  }
  function parsePace(text) {   // "1:45" per 100 m -> 105
    var t = String(text == null ? '' : text).trim(); if (!t) return null;
    var p = t.split(':').map(Number); if (p.length !== 2 || p.some(function (x) { return !isFinite(x) || x < 0; })) return null;
    return Math.round(p[0] * 60 + p[1]);
  }

  // ── Issue toggles: "None" is exclusive ────────────────────────
  function toggleIssue(selected, key) {
    var s = (selected || []).slice(), i = s.indexOf(key);
    if (key === 'none') return i >= 0 ? [] : ['none'];
    s = s.filter(function (k) { return k !== 'none'; });
    i = s.indexOf(key);
    if (i >= 0) s.splice(i, 1); else s.push(key);
    return s;
  }

  // ── Validation ────────────────────────────────────────────────
  // Returns {ok, errors[], warnings[]}. A session may be saved "partial" (only what is known); it is never padded.
  function validateSession(s) {
    var errors = [], warnings = [];
    function range(v, lo, hi, label) { if (v !== null && v !== undefined && (!isNum(v) || v < lo || v > hi)) errors.push(label + ' must be between ' + lo + ' and ' + hi); }
    s = s || {};
    range(s.distance_km, 0, 200, 'Distance');
    range(s.duration_seconds, 1, 172800, 'Duration');
    range(s.water_temp_c, -2, 40, 'Water temperature');
    range(s.air_temp_c, -20, 55, 'Air temperature');
    range(s.avg_pace_sec_per_100m, 30, 600, 'Pace');
    range(s.avg_hr, 30, 230, 'Heart rate');
    range(s.avg_stroke_rate, 10, 150, 'Stroke rate');
    range(s.rpe, 1, 10, 'Effort');
    if (s.athlete_note && s.athlete_note.length > 2000) errors.push('Note is too long');
    if (!Array.isArray(s.products) || !s.products.length) errors.push('Choose at least one product');
    (s.products || []).forEach(function (p) {
      (p.ratings || []).forEach(function (r) { if (!isNum(r.score) || r.score < 1 || r.score > 5 || Math.floor(r.score) !== r.score) errors.push('Ratings must be whole numbers 1 to 5'); });
    });
    var missing = [];
    if (!s.session_date) missing.push('date');
    if (s.distance_km == null) missing.push('distance');
    if (s.water_temp_c == null && s.environment !== 'pool') missing.push('water temperature');
    if (!s.environment) missing.push('where you swam');
    if (missing.length) warnings.push('Saved as partial. Still to add: ' + missing.join(', ') + '.');
    return { ok: errors.length === 0, errors: errors, warnings: warnings, dataStatus: missing.length ? 'partial' : 'complete' };
  }

  // ── Data shaping ──────────────────────────────────────────────
  // Everything below takes plain arrays as loaded from the tables:
  //   products[{id,name,group_label,category,status,is_reference,received_on,model_name}]
  //   sessions[{id,session_date,environment,distance_km,duration_seconds,water_temp_c,conditions,wind,rpe,...}]
  //   sessionProducts[{session_id,product_id,report_mode,usage_km,usage_seconds}]
  //   observations[{session_id,product_id,kind,criterion,score,note,visibility}]
  function indexBy(arr, key) { var m = {}; (arr || []).forEach(function (x) { m[x[key]] = x; }); return m; }

  function productUsage(productId, d) {
    var sById = indexBy(d.sessions, 'id');
    var rows = (d.sessionProducts || []).filter(function (sp) { return sp.product_id === productId && sById[sp.session_id]; });
    var km = 0, secs = 0, kmKnown = 0, secKnown = 0, pool = 0, open = 0, longest = null, temps = [], last = null, hrs = 0;
    var chlorine = 0, sea = 0;
    rows.forEach(function (sp) {
      var s = sById[sp.session_id];
      var k = num(sp.usage_km != null ? sp.usage_km : s.distance_km);
      var t = num(sp.usage_seconds != null ? sp.usage_seconds : s.duration_seconds);
      if (k !== null) { km += k; kmKnown++; if (longest === null || k > longest) longest = k; }
      if (t !== null) { secs += t; secKnown++; }
      if (s.environment === 'pool') { pool++; chlorine++; } else if (isOpenWater(s.environment)) { open++; if (s.environment === 'sea') sea++; }
      var w = num(s.water_temp_c); if (w !== null) temps.push(w);
      if (s.session_date && (!last || s.session_date > last)) last = s.session_date;
    });
    return {
      uses: rows.length, km: round(km, 1), seconds: secs, hours: fmtHours(secs),
      kmKnownOn: kmKnown, secondsKnownOn: secKnown,         // how many uses the km / hours totals are really based on
      pool: pool, openWater: open, chlorineExposures: chlorine, seaExposures: sea,
      longestKm: longest, tempMin: temps.length ? Math.min.apply(null, temps) : null, tempMax: temps.length ? Math.max.apply(null, temps) : null,
      lastUsed: last
    };
  }

  function ratingSummary(productId, d, opts) {
    opts = opts || {};
    var by = {};
    (d.observations || []).forEach(function (o) {
      if (o.product_id !== productId || o.kind !== 'rating') return;
      if (opts.publishableOnly && o.visibility !== 'publishable') return;
      (by[o.criterion] = by[o.criterion] || []).push(o.score);
    });
    var out = {};
    Object.keys(by).forEach(function (k) {
      var v = by[k], a = avg(v), n = v.length, range = Math.max.apply(null, v) - Math.min.apply(null, v);
      out[k] = {
        n: n, avg: n >= EVIDENCE_THRESHOLDS.minSessionsForAverage ? round(a, 1) : null,   // no average below the minimum
        scores: v.slice(), min: Math.min.apply(null, v), max: Math.max.apply(null, v),
        consistent: n >= EVIDENCE_THRESHOLDS.minSessionsForAverage && range <= EVIDENCE_THRESHOLDS.consistentRange
      };
    });
    return out;
  }

  // Issues are measured against the sessions where the athlete actually answered the issue question
  // (a "None" row or any issue row). An unanswered session is not counted as "no issues".
  function issueIncidence(productId, d, opts) {
    opts = opts || {};
    var answered = {}, counts = {}, kmAnswered = 0, sById = indexBy(d.sessions, 'id'), spBy = {};
    (d.sessionProducts || []).forEach(function (sp) { if (sp.product_id === productId) spBy[sp.session_id] = sp; });
    (d.observations || []).forEach(function (o) {
      if (o.product_id !== productId || o.kind !== 'issue') return;
      if (opts.publishableOnly && o.visibility !== 'publishable') return;
      answered[o.session_id] = true;
      if (o.criterion !== 'none') counts[o.criterion] = (counts[o.criterion] || 0) + 1;
    });
    Object.keys(answered).forEach(function (sid) {
      var sp = spBy[sid], s = sById[sid]; if (!sp || !s) return;
      var k = num(sp.usage_km != null ? sp.usage_km : s.distance_km); if (k !== null) kmAnswered += k;
    });
    return { sessionsAnswered: Object.keys(answered).length, counts: counts, kmAnswered: round(kmAnswered, 1) };
  }

  function productNotes(productId, d, opts) {
    opts = opts || {};
    var sById = indexBy(d.sessions, 'id');
    return (d.observations || []).filter(function (o) {
      return o.product_id === productId && o.kind === 'note' && o.note && (!opts.publishableOnly || o.visibility === 'publishable');
    }).map(function (o) { var s = sById[o.session_id] || {}; return { date: s.session_date || null, note: o.note, visibility: o.visibility, session_id: o.session_id }; })
      .sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
  }

  // Where is this product in its testing journey? Returns {index, label, stages, reasons}.
  function evidenceStage(product, usage, hasComparison) {
    var cat = CATEGORIES[product.category] || CATEGORIES.other, T = EVIDENCE_THRESHOLDS, st = cat.stages, i = 0;
    if (usage.uses === 0) return { index: -1, label: 'Not yet tested', stages: st };
    if (product.category === 'training_swimwear') {
      i = usage.uses >= T.costumeMilestones[3] ? 3 : usage.uses >= T.costumeMilestones[2] ? 2 : usage.uses >= T.costumeMilestones[1] ? 1 : 0;
    } else if (product.category === 'wetsuit') {
      i = 0;
      if (usage.uses >= 3) i = 1;
      if (usage.uses >= 6 && usage.longestKm !== null && usage.longestKm >= T.wetsuitDistanceSwimKm) i = 2;
      if (i === 2 && hasComparison) i = 3;
    } else {
      i = usage.uses >= 10 ? 2 : usage.uses >= 3 ? 1 : 0;
      i = Math.min(i, st.length - 1);
    }
    return { index: i, label: st[i], stages: st };
  }

  function testingConfidence(sessionsWithRatings) {
    var T = EVIDENCE_THRESHOLDS;
    if (sessionsWithRatings >= T.confidenceSubstantial) return 'Substantial';
    if (sessionsWithRatings >= T.confidenceModerate) return 'Moderate';
    return 'Low';
  }

  function sessionsWithRatings(productId, d) {
    var seen = {};
    (d.observations || []).forEach(function (o) { if (o.product_id === productId && o.kind === 'rating') seen[o.session_id] = true; });
    return Object.keys(seen).length;
  }

  // The full evidence profile for one product (or one garage group of products).
  function productProfile(product, d, opts) {
    opts = opts || {};
    var ids = Array.isArray(product.ids) ? product.ids : [product.id];
    var cat = CATEGORIES[product.category] || CATEGORIES.other;
    // merge per-id usage / ratings for grouped products (the five costumes share one garage card)
    var usages = ids.map(function (id) { return productUsage(id, d); });
    var usage = usages.length === 1 ? usages[0] : mergeUsage(usages);
    var merged = { sessions: d.sessions, sessionProducts: d.sessionProducts, observations: (d.observations || []).map(function (o) { return ids.indexOf(o.product_id) >= 0 ? Object.assign({}, o, { product_id: ids[0] }) : o; }) };
    var ratings = ratingSummary(ids[0], merged, opts);
    var issues = issueIncidence(ids[0], Object.assign({}, merged, { sessionProducts: (d.sessionProducts || []).map(function (sp) { return ids.indexOf(sp.product_id) >= 0 ? Object.assign({}, sp, { product_id: ids[0] }) : sp; }) }), opts);
    var notes = productNotes(ids[0], merged, opts);
    var ratedSessions = sessionsWithRatings(ids[0], merged);
    var hasComparison = (d.sessions || []).some(function (s) { return s.comparison_group_id; });
    return {
      product: product, usage: usage, ratings: ratings, issues: issues, notes: notes, ratedSessions: ratedSessions,
      stage: evidenceStage(product, usage, hasComparison), confidence: testingConfidence(ratedSessions),
      latestNote: notes.length ? notes[0] : null
    };
  }
  function mergeUsage(list) {
    var u = { uses: 0, km: 0, seconds: 0, kmKnownOn: 0, secondsKnownOn: 0, pool: 0, openWater: 0, chlorineExposures: 0, seaExposures: 0, longestKm: null, tempMin: null, tempMax: null, lastUsed: null };
    list.forEach(function (x) {
      u.uses += x.uses; u.km += x.km; u.seconds += x.seconds; u.kmKnownOn += x.kmKnownOn; u.secondsKnownOn += x.secondsKnownOn;
      u.pool += x.pool; u.openWater += x.openWater; u.chlorineExposures += x.chlorineExposures; u.seaExposures += x.seaExposures;
      if (x.longestKm !== null && (u.longestKm === null || x.longestKm > u.longestKm)) u.longestKm = x.longestKm;
      if (x.tempMin !== null && (u.tempMin === null || x.tempMin < u.tempMin)) u.tempMin = x.tempMin;
      if (x.tempMax !== null && (u.tempMax === null || x.tempMax > u.tempMax)) u.tempMax = x.tempMax;
      if (x.lastUsed && (!u.lastUsed || x.lastUsed > u.lastUsed)) u.lastUsed = x.lastUsed;
    });
    u.km = round(u.km, 1); u.hours = fmtHours(u.seconds);
    return u;
  }

  // Garage = the products, with grouped products (same group_label) collapsed to one card. Reference products are excluded.
  function garage(products) {
    var out = [], groups = {};
    (products || []).filter(function (p) { return !p.is_reference; }).sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); }).forEach(function (p) {
      if (p.group_label) {
        if (!groups[p.group_label]) {
          groups[p.group_label] = { id: p.id, ids: [], name: p.group_label, category: p.category, status: p.status, received_on: p.received_on, members: [], isGroup: true };
          out.push(groups[p.group_label]);
        }
        var g = groups[p.group_label]; g.ids.push(p.id); g.members.push(p);
      } else out.push(Object.assign({}, p, { ids: [p.id], members: [p] }));
    });
    return out;
  }

  // ── Programme overview ────────────────────────────────────────
  function programmeSummary(products, d) {
    var real = (products || []).filter(function (p) { return !p.is_reference; });
    var usedIds = {};
    (d.sessionProducts || []).forEach(function (sp) { usedIds[sp.product_id] = true; });
    var sessions = (d.sessions || []), km = 0, secs = 0, temps = [], longest = null, pool = 0, open = 0, conds = {}, winds = {};
    sessions.forEach(function (s) {
      var k = num(s.distance_km), t = num(s.duration_seconds), w = num(s.water_temp_c);
      if (k !== null) { km += k; if (longest === null || k > longest) longest = k; }
      if (t !== null) secs += t;
      if (w !== null) temps.push(w);
      if (s.environment === 'pool') pool++; else if (isOpenWater(s.environment)) open++;
      if (s.conditions) conds[s.conditions] = (conds[s.conditions] || 0) + 1;
      if (s.wind) winds[s.wind] = (winds[s.wind] || 0) + 1;
    });
    var inTest = real.filter(function (p) { return usedIds[p.id] || ['early_testing', 'active_testing', 'long_term_testing'].indexOf(p.status) >= 0; });
    var groups = {}; inTest.forEach(function (p) { groups[p.group_label || p.id] = true; });
    return {
      productsInTest: Object.keys(groups).length, sessions: sessions.length, km: round(km, 1), hours: fmtHours(secs),
      kmKnownOn: sessions.filter(function (s) { return num(s.distance_km) !== null; }).length,
      pool: pool, openWater: open, tempMin: temps.length ? Math.min.apply(null, temps) : null, tempMax: temps.length ? Math.max.apply(null, temps) : null,
      longestKm: longest, conditions: conds, wind: winds,
      partialSessions: sessions.filter(function (s) { return s.data_status === 'partial'; }).length
    };
  }

  // ── Findings: restrained, only from logged records ────────────
  function findings(profile) {
    var T = EVIDENCE_THRESHOLDS, cat = CATEGORIES[profile.product.category] || CATEGORIES.other, labels = {};
    cat.ratings.forEach(function (r) { labels[r.key] = r.label; });
    cat.issues.forEach(function (r) { labels[r.key] = r.label; });
    labels.damage_or_wear = 'Damage or wear noticed';
    var positives = [], observations = [], u = profile.usage;
    if (profile.ratedSessions < T.minSessionsForAverage) {
      return { enough: false, positives: [], observations: [], statement: 'Not enough evidence yet. ' + profile.ratedSessions + ' rated ' + (profile.ratedSessions === 1 ? 'session' : 'sessions') + '; findings start at ' + T.minSessionsForAverage + '.' };
    }
    Object.keys(profile.ratings).forEach(function (k) {
      var r = profile.ratings[k]; if (r.avg === null) return;
      var line = labels[k] + ' averages ' + r.avg.toFixed(1) + ' / 5 across ' + r.n + ' ' + (r.n === 1 ? 'swim' : 'swims') + (r.consistent ? ' (consistent)' : '');
      if (r.avg >= T.positiveAvg) positives.push({ key: k, text: line, avg: r.avg, n: r.n });
      else if (r.avg <= T.concernAvg) observations.push({ key: k, text: line + ' — below the midpoint', avg: r.avg, n: r.n });
    });
    Object.keys(profile.issues.counts).forEach(function (k) {
      var c = profile.issues.counts[k];
      observations.push({ key: k, text: (labels[k] || k) + ' reported in ' + c + ' of ' + profile.issues.sessionsAnswered + ' ' + (profile.issues.sessionsAnswered === 1 ? 'session' : 'sessions'), count: c });
    });
    positives.sort(function (a, b) { return b.avg - a.avg; });
    observations.sort(function (a, b) { return (a.avg || 99) - (b.avg || 99); });
    return { enough: true, positives: positives, observations: observations, statement: null };
  }

  function incidenceLine(profile, keys, noun) {   // "0 chafing incidents across 31.4 km" — only when the question was actually answered
    var inc = profile.issues; if (!inc.sessionsAnswered) return null;
    var n = keys.reduce(function (t, k) { return t + (inc.counts[k] || 0); }, 0);
    return n + ' ' + noun + (n === 1 ? ' incident' : ' incidents') + ' across ' + inc.sessionsAnswered + ' answered ' + (inc.sessionsAnswered === 1 ? 'session' : 'sessions') + (inc.kmAnswered ? ' (' + inc.kmAnswered + ' km)' : '');
  }

  function nextPriorities(profile, d) {
    var T = EVIDENCE_THRESHOLDS, p = profile.product, u = profile.usage, out = [];
    if (p.status === 'awaiting_product') return ['Awaiting product. Testing starts when it is received.'];
    if (u.uses === 0) return ['No use logged yet. Log a first session.'];
    if (p.category === 'training_swimwear') {
      var next = T.costumeMilestones.filter(function (m) { return m > u.uses; })[0];
      if (next) out.push((next - u.uses) + ' more ' + (next - u.uses === 1 ? 'use' : 'uses') + ' to reach the ' + next + '-use check');
      if (u.seaExposures === 0) out.push('No sea exposure logged yet');
      if (u.chlorineExposures === 0) out.push('No chlorine exposure logged yet');
      return out;
    }
    if (p.category === 'wetsuit') {
      if (u.longestKm === null || u.longestKm < T.wetsuitDistanceSwimKm) out.push('A longer swim' + (u.longestKm !== null ? ' than ' + u.longestKm + ' km' : ''));
      if (u.tempMin !== null) out.push('Colder water than ' + u.tempMin + '°C'); else out.push('Water temperature on the next swim');
      var maxRpe = Math.max.apply(null, [0].concat((d.sessions || []).map(function (s) { return num(s.rpe) || 0; })));
      if (maxRpe < T.raceIntensityRpe) out.push('A race-intensity effort (no effort ' + T.raceIntensityRpe + ' or above logged)');
      if (!(d.sessions || []).some(function (s) { return s.comparison_group_id; })) out.push('A controlled comparison against another suit');
      return out;
    }
    if (u.uses < 10) out.push((10 - u.uses) + ' more uses before drawing conclusions');
    if (u.openWater === 0 && p.category === 'goggles') out.push('No open-water use logged yet');
    if (u.pool === 0 && p.category === 'goggles') out.push('No pool use logged yet');
    return out;
  }

  // ── Report: two audiences, one source ─────────────────────────
  // mode 'private'     : everything logged (what Carina and SwimLoading share with the partner candidly)
  // mode 'publishable' : only observations an admin has explicitly marked publishable; nothing else leaks in
  function buildReport(products, d, mode) {
    var pub = mode === 'publishable';
    var data = d;
    if (pub) {   // sessions' free-text notes are private by default and never appear in the publishable report
      data = { sessions: (d.sessions || []).map(function (s) { return Object.assign({}, s, { athlete_note: null, partner_note: null }); }), sessionProducts: d.sessionProducts, observations: d.observations };
    }
    var sections = garage(products).map(function (g) {
      var prof = productProfile(g, data, { publishableOnly: pub });
      var f = findings(prof);
      return {
        key: g.id, name: g.name, category: g.category, status: g.status, profile: prof, findings: f,
        evidenceVolume: prof.usage.uses + (prof.usage.uses === 1 ? ' use' : ' uses') + (prof.usage.kmKnownOn ? ' · ' + prof.usage.km + ' km' : '') + (prof.usage.hours ? ' · ' + prof.usage.hours + ' h' : ''),
        confidence: prof.confidence, nextPriorities: nextPriorities(prof, data)
      };
    });
    return { mode: mode, programme: programmeSummary(products, d), sections: sections };
  }

  // ── Controlled comparison ─────────────────────────────────────
  // Observed data (what was measured) and athlete perception (what was felt) are returned as separate blocks.
  function compareGroup(groupId, products, d) {
    var sessions = (d.sessions || []).filter(function (s) { return s.comparison_group_id === groupId; });
    var pBy = indexBy(products, 'id'), warnings = [];
    var arms = sessions.map(function (s) {
      var sp = (d.sessionProducts || []).filter(function (x) { return x.session_id === s.id; });
      var names = sp.map(function (x) { return (pBy[x.product_id] || {}).name; }).filter(Boolean);
      var ratings = {}; (d.observations || []).forEach(function (o) { if (o.session_id === s.id && o.kind === 'rating') (ratings[o.product_id] = ratings[o.product_id] || {})[o.criterion] = o.score; });
      return {
        session_id: s.id, suits: names,
        observed: { date: s.session_date, location: s.location, distance_km: num(s.distance_km), water_temp_c: num(s.water_temp_c), conditions: s.conditions || null,
                    pace_sec_per_100m: num(s.avg_pace_sec_per_100m), avg_hr: num(s.avg_hr), stroke_rate: num(s.avg_stroke_rate), rpe: num(s.rpe) },
        perception: { ratings: ratings, vs_expectation: s.vs_expectation || null, confidence: s.confidence || null, note: s.athlete_note || null }
      };
    });
    if (arms.length < 2) warnings.push('A comparison needs at least two sessions.');
    else {
      var a = arms[0].observed, T = EVIDENCE_THRESHOLDS;
      arms.slice(1).forEach(function (arm) {
        var b = arm.observed;
        if (a.water_temp_c !== null && b.water_temp_c !== null && Math.abs(a.water_temp_c - b.water_temp_c) > T.likeForLikeTempC) warnings.push('Water temperature differs by ' + round(Math.abs(a.water_temp_c - b.water_temp_c), 1) + '°C');
        if (a.distance_km && b.distance_km && Math.abs(a.distance_km - b.distance_km) / a.distance_km * 100 > T.likeForLikeDistancePct) warnings.push('Distance differs by more than ' + T.likeForLikeDistancePct + '%');
        if (a.conditions && b.conditions && a.conditions !== b.conditions) warnings.push('Sea conditions differ (' + CONDITIONS[a.conditions] + ' vs ' + CONDITIONS[b.conditions] + ')');
        if (a.location && b.location && a.location.trim().toLowerCase() !== b.location.trim().toLowerCase()) warnings.push('Location differs');
        ['water_temp_c', 'distance_km', 'pace_sec_per_100m', 'avg_hr'].forEach(function (k) { if ((a[k] === null) !== (b[k] === null)) warnings.push('Not every session has ' + k.replace(/_/g, ' ')); });
      });
    }
    var unique = warnings.filter(function (w, i) { return warnings.indexOf(w) === i; });
    return { groupId: groupId, arms: arms, likeForLike: arms.length >= 2 && unique.length === 0, warnings: unique,
             caution: 'Pace differences in a single pair of swims are not evidence that one suit is faster.' };
  }

  // ── Market evidence: its own stream ───────────────────────────
  function marketSummary(signals) {
    var byType = {}, total = 0;
    Object.keys(SIGNALS).forEach(function (k) { byType[k] = 0; });
    (signals || []).forEach(function (m) { byType[m.signal_type] = (byType[m.signal_type] || 0) + (m.count || 0); total += (m.count || 0); });
    return { byType: byType, total: total, entries: (signals || []).length };
  }

  // ── Strava → session draft ────────────────────────────────────
  // Re-uses the athlete's existing imported activity so nothing is retyped. Never sets water temperature
  // (Strava's temperature is a device reading, not the water) and never guesses pool vs open water without a matched spot.
  function stravaToDraft(row, spot) {
    if (!row) return null;
    var distM = num(row.distance_m), moving = num(row.moving_time_seconds), draft = {
      strava_import_id: row.id,
      session_date: row.start_date_local ? String(row.start_date_local).slice(0, 10) : null,   // local date: never toISOString() (SAST shifts a day)
      distance_km: distM !== null ? round(distM / 1000, 2) : null,
      duration_seconds: moving !== null ? moving : num(row.elapsed_time_seconds),
      avg_hr: num(row.average_heartrate) !== null ? Math.round(num(row.average_heartrate)) : null,
      location: spot && spot.name ? spot.name : null
    };
    if (distM && moving) draft.avg_pace_sec_per_100m = Math.round(moving / (distM / 100));
    if (spot && spot.type) {
      var t = String(spot.type).toLowerCase();
      draft.environment = t.indexOf('pool') >= 0 ? 'pool' : (t.indexOf('lake') >= 0 || t.indexOf('dam') >= 0 || t.indexOf('river') >= 0 || t.indexOf('inland') >= 0) ? 'lake' : (t.indexOf('ocean') >= 0 || t.indexOf('lagoon') >= 0 || t.indexOf('sea') >= 0) ? 'sea' : undefined;
      if (draft.environment === undefined) delete draft.environment;
    }
    return draft;
  }

  var api = {
    EVIDENCE_THRESHOLDS: EVIDENCE_THRESHOLDS, CATEGORIES: CATEGORIES, STATUS: STATUS, CONDITIONS: CONDITIONS, WIND: WIND,
    ENVIRONMENTS: ENVIRONMENTS, SESSION_KINDS: SESSION_KINDS, SIGNALS: SIGNALS,
    fmtPace: fmtPace, fmtDuration: fmtDuration, fmtHours: fmtHours, parseDuration: parseDuration, parsePace: parsePace,
    toggleIssue: toggleIssue, validateSession: validateSession,
    productUsage: productUsage, ratingSummary: ratingSummary, issueIncidence: issueIncidence, productNotes: productNotes,
    evidenceStage: evidenceStage, testingConfidence: testingConfidence, productProfile: productProfile, garage: garage,
    programmeSummary: programmeSummary, findings: findings, incidenceLine: incidenceLine, nextPriorities: nextPriorities,
    buildReport: buildReport, compareGroup: compareGroup, marketSummary: marketSummary, stravaToDraft: stravaToDraft
  };
  root.TestProgramme = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
