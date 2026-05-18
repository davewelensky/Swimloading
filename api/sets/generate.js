export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { description, total_distance, focus, pool_type, squad_level, duration_mins } = req.body || {};
  if (!description) return res.status(400).json({ error: 'Description required' });

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured in Vercel env vars' });

  const dur = parseInt(duration_mins) || 60;
  const dist = parseInt(total_distance) || 3000;

  const system = `You are an expert swim coach with 20+ years experience writing squad training sets.
Write sets in clean plain-text notation — no markdown, no asterisks, no emojis.

Format rules:
- One block per line
- Repetitions: "8x50m FR @0:55 — descend 1-4, 5-8"
- Single swim: "400m WARMUP — easy choice, focus on feel"
- Stroke codes: FR=freestyle BK=backstroke BR=breaststroke FLY=butterfly IM=individual medley
- Drill codes: DR=drill SW=swim KICK=kick PULL=pull UW=underwater
- Interval: use @ (e.g. @1:45 means send every 1:45)
- Always have a labelled WARMUP block, MAIN SET block(s), and COOLDOWN
- End the set with exactly this line format: "Total: Xm | ~Ymins"
- Keep efforts realistic and achievable for the squad level
- HARD RULE: The total session time in the final line MUST be ${dur} minutes or less. Do not exceed this. Adjust rest intervals and distances to fit.`;

  const prompt = `Write a swim training set with these parameters:
Description: ${description}
Session duration: EXACTLY ${dur} minutes — this is a hard limit, the set must fit within this time
Target total distance: ~${dist}m (adjust if needed to stay within ${dur} mins)
Pool: ${pool_type === 'LCM' ? '50m long course (LCM)' : '25m short course (SCM)'}
Training focus: ${focus || 'mixed'}
Squad level: ${squad_level || 'Masters'}

Generate the complete set now. The final "Total:" line must show ${dur} mins or less.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(500).json({ error: 'AI request failed', detail });
    }

    const data = await r.json();
    const set_content = data.content?.[0]?.text || '';
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ set_content });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
