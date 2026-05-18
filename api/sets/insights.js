export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { club_id, gala_squad_ids } = req.body || {};
  if (!club_id) return res.status(400).json({ error: 'club_id required' });

  const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://szgkzuswelntnevobnoh.supabase.co';
  const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!SERVICE_KEY)   return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not set' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  async function sb(path) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' },
      });
      if (!r.ok) { console.error(`Supabase ${path}: ${r.status} ${await r.text()}`); return []; }
      return r.json();
    } catch (e) { console.error(`Supabase fetch error ${path}:`, e.message); return []; }
  }

  try {

  const today        = new Date().toISOString().slice(0, 10);
  const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const eightWeeksOn = new Date(Date.now() + 56 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Fetch all context in parallel
  const [squads, assignments, galas, roster, pbTimes, galaTimes, standards] = await Promise.all([
    sb(`club_squads?club_id=eq.${club_id}&is_active=eq.true&select=id,name,sort_order&order=sort_order`),
    sb(`club_set_assignments?club_id=eq.${club_id}&session_date=gte.${fourWeeksAgo}&session_date=lte.${today}&select=squad_id,session_date,club_swim_sets(focus,name,total_distance)`),
    sb(`club_events?club_id=eq.${club_id}&event_date=gte.${today}&event_date=lte.${eightWeeksOn}&is_active=eq.true&select=title,event_date&order=event_date`),
    sb(`club_roster?club_id=eq.${club_id}&is_active=eq.true&select=id,display_name,squad_id,gender,date_of_birth`),
    sb(`club_swimmer_times?club_id=eq.${club_id}&is_pb=eq.true&select=roster_id,event,course,time_seconds,time_text`),
    sb(`club_gala_results?club_id=eq.${club_id}&is_pb=eq.true&select=roster_id,stroke,distance,course,time_seconds,time_text`),
    sb(`ssa_qualifying_times?select=gender,age_group,course,level,event,time_seconds,time_text&order=level,time_seconds`),
  ]);

  // SA championship age-up: age on 1 October of current season
  function champAge(dob) {
    if (!dob) return null;
    const d = new Date(dob);
    const seasonYear = new Date().getMonth() >= 9 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    const age = seasonYear - d.getFullYear();
    if (age <= 10) return '10U';
    if (age >= 17) return null; // no senior standards in table
    return String(age);
  }

  // Filter to selected gala squads when provided
  const activeSquads = gala_squad_ids?.length
    ? (squads || []).filter(s => gala_squad_ids.includes(s.id))
    : (squads || []);

  // Build per-squad focus breakdown
  const squadMap = {};
  activeSquads.forEach(s => { squadMap[s.id] = { name: s.name, sets: [] }; });
  (assignments || []).forEach(a => {
    if (squadMap[a.squad_id] && a.club_swim_sets?.focus) {
      squadMap[a.squad_id].sets.push({ focus: a.club_swim_sets.focus, name: a.club_swim_sets.name, date: a.session_date });
    }
  });

  // Merge PBs from both tables
  const allPBs = {};
  (pbTimes || []).forEach(t => {
    const key = `${t.roster_id}|${t.event}|${t.course}`;
    if (!allPBs[key] || t.time_seconds < allPBs[key].time_seconds)
      allPBs[key] = { roster_id: t.roster_id, event: t.event, course: t.course, time_seconds: t.time_seconds, time_text: t.time_text };
  });
  (galaTimes || []).forEach(t => {
    // normalise gala_results event name: e.g. stroke=FR distance=100 → "100m FR"
    const event = `${t.distance}m ${t.stroke}`;
    const key = `${t.roster_id}|${event}|${t.course}`;
    if (!allPBs[key] || t.time_seconds < allPBs[key].time_seconds)
      allPBs[key] = { roster_id: t.roster_id, event, course: t.course, time_seconds: t.time_seconds, time_text: t.time_text };
  });

  // Find swimmers within 5s of next qualifying level
  const levelOrder = ['L3', 'L2', 'L1', 'SANJ'];
  const nearQualifiers = [];

  const activeRoster = gala_squad_ids?.length
    ? (roster || []).filter(r => gala_squad_ids.includes(r.squad_id))
    : (roster || []);

  activeRoster.forEach(swimmer => {
    const ageGroup = champAge(swimmer.date_of_birth);
    if (!ageGroup) return;
    const swimmerPBs = Object.values(allPBs).filter(p => p.roster_id === swimmer.id);
    swimmerPBs.forEach(pb => {
      // standards this swimmer hasn't hit yet, same event/course/gender/ageGroup
      const relevant = (standards || [])
        .filter(s =>
          s.gender === swimmer.gender &&
          s.age_group === ageGroup &&
          s.event === pb.event &&
          s.course === pb.course &&
          s.time_seconds < pb.time_seconds // standard is faster = not yet achieved
        )
        .sort((a, b) => b.time_seconds - a.time_seconds); // slowest standard first = next level

      if (!relevant.length) return;
      const next = relevant[0];
      const gap  = pb.time_seconds - next.time_seconds;
      if (gap <= 5) {
        nearQualifiers.push({
          swimmer:     swimmer.display_name,
          squad:       squadMap[swimmer.squad_id]?.name || 'Unknown',
          event:       pb.event,
          course:      pb.course,
          currentTime: pb.time_text,
          nextLevel:   next.level,
          standard:    next.time_text,
          gapSeconds:  gap.toFixed(1),
        });
      }
    });
  });

  // Build gala summary
  const galaLines = (galas || []).map(g => {
    const weeks = Math.round((new Date(g.event_date) - new Date()) / (7 * 24 * 60 * 60 * 1000));
    return `${g.title} — ${g.event_date} (${weeks} week${weeks === 1 ? '' : 's'} away)`;
  });

  // Build squad training summary
  const squadLines = Object.values(squadMap).map(sq => {
    const counts = {};
    sq.sets.forEach(s => { counts[s.focus] = (counts[s.focus] || 0) + 1; });
    const breakdown = Object.keys(counts).length
      ? Object.entries(counts).map(([f, c]) => `${f}:${c}`).join(', ')
      : 'no sets assigned yet';
    return `${sq.name}: ${breakdown} (${sq.sets.length} sessions last 4 weeks)`;
  });

  const context = `Today: ${today}

SQUAD TRAINING HISTORY — last 4 weeks (focus breakdown):
${squadLines.join('\n') || 'No squads found'}

UPCOMING GALAS — next 8 weeks:
${galaLines.join('\n') || 'None scheduled'}

SQUADS SELECTED FOR ANALYSIS:
${activeSquads.map(s => s.name).join(', ') || 'All squads'}

SWIMMERS WITHIN 5 SECONDS OF NEXT QUALIFYING LEVEL:
${nearQualifiers.slice(0, 30).map(n =>
  `${n.swimmer} (${n.squad}): ${n.event} ${n.course} — current ${n.currentTime}, needs ${n.standard} for ${n.nextLevel}, gap ${n.gapSeconds}s`
).join('\n') || 'None currently within 5s of next level'}`;

  // Call Claude
  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: `You are an expert competitive swimming coach analyst. Analyse squad training data and return ONLY valid JSON — no markdown, no extra text.

Return this exact structure:
{
  "weekly_summary": "1-2 sentence overview of the club's training state",
  "gala_notes": "tapering/preparation notes based on upcoming galas, or null if none",
  "squads": [
    {
      "name": "Squad name",
      "balance_note": "brief note on focus distribution (e.g. heavy on speed, lacking endurance)",
      "priority_focus": "aerobic|speed|endurance|drills|kick|mixed",
      "recommendation": "specific actionable recommendation for next 1-2 sessions",
      "suggested_prompt": "description Britt can paste into the AI set generator (mention distance, focus, key elements)",
      "urgency": "high|medium|low"
    }
  ],
  "near_qualifiers": [
    {
      "swimmer": "name",
      "squad": "squad name",
      "event": "100m FR SCM",
      "gap": "1.2s from L3",
      "training_tip": "specific set type or approach to close the gap"
    }
  ]
}`,
      messages: [{ role: 'user', content: `Analyse this club's training data:\n\n${context}` }],
    }),
  });

  if (!aiRes.ok) {
    const detail = await aiRes.text();
    return res.status(500).json({ error: 'AI request failed', detail });
  }

  const aiData = await aiRes.json();
  const text   = aiData.content?.[0]?.text || '{}';

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    try { result = JSON.parse(match?.[0] || '{}'); } catch { result = { error: 'Could not parse AI response', raw: text }; }
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ...result, _meta: { squadsAnalysed: squads?.length || 0, nearQualifiers: nearQualifiers.length, galas: galas?.length || 0 } });

  } catch (err) {
    console.error('Insights error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
