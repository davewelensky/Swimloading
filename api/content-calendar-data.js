// GET /api/content-calendar-data
// Returns the internal social content calendar — only to a signed-in user who
// exists in growth_founders (the same role table growth-hub.html already
// uses). Content lives only in this server-only file, never in the HTML
// content-calendar.html serves, so an unauthenticated request — curl, view-
// source, or otherwise — gets nothing back but a 401.
//
// SECURITY_REGISTER.md §3 flagged content-calendar.html as having no auth at
// all; this closes that specific finding by reusing the existing role
// mechanism instead of inventing a new hardcoded allow-list.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

async function getAuthedEmail(authHeader) {
    const token = (authHeader || '').replace('Bearer ', '').trim();
    if (!token) return null;
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { 'Authorization': `Bearer ${token}`, 'apikey': SERVICE_KEY },
    });
    if (!res.ok) return null;
    const { email } = await res.json();
    return email || null;
}

async function isGrowthFounder(email) {
    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/growth_founders?email=eq.${encodeURIComponent(email)}&select=email`,
        { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
    );
    if (!res.ok) return false;
    const rows = await res.json();
    return rows.length > 0;
}

// Migrated verbatim from the static HTML this replaces (content-calendar.html,
// July 2026 plan) — same weeks, same posts, same copy. Update here going
// forward instead of editing content-calendar.html directly.
const WEEKS = [
    { label: 'Week 1 — 30 Jun / 1–4 Jul', theme: 'Launch week · Set the tone', posts: [
        { date: 'Mon 30 Jun', pillar: 'Conditions', assignee: 'Dave', title: 'Winter water temp roundup — Cape Town + UK',
          desc: 'Weekly graphic: SA spots vs UK spots side by side. "False Bay: 14°C vs Serpentine: 18°C — where are you swimming this week?" Poll sticker in Stories.',
          tags: ['Graphic', 'Poll in Stories', 'Tag locations'] },
        { date: 'Wed 2 Jul', pillar: 'Community', assignee: 'Bella', title: 'Platform milestone — 603 swimmers, 12 countries',
          desc: '"A year ago SwimLoading was a Cape Town temperature checker. Today: 603 swimmers across 12 countries." Carousel — 5 slides of community stats and swimmer photos.',
          tags: ['Carousel (5 slides)', 'High effort'] },
        { date: 'Fri 4 Jul', pillar: 'Education', assignee: 'Dave', title: 'What water temperature actually means for your swim',
          desc: '"14°C — how long can you safely swim without a wetsuit?" Carousel: temp ranges mapped to wetsuit/no wetsuit, acclimatisation time, cold shock signs. Save-bait evergreen content.',
          tags: ['Carousel (6 slides)', 'Save-bait', 'Evergreen'] },
    ]},
    { label: 'Week 2 — 7–11 Jul', theme: 'Carina week · Amplification play', posts: [
        { date: 'Mon 7 Jul', pillar: 'Conditions', assignee: 'Dave', title: 'Weekly temp drop — False Bay hits winter low',
          desc: '"Cape Town\'s coldest week of 2026 — False Bay logged at [X]°C. The brave ones are still out there. Who swam this week?" Tag swimmers from the app. Stories: screenshot of the coldest log.',
          tags: ['Graphic + photo', 'Tag community'] },
        { date: 'Wed 9 Jul', pillar: 'Community', assignee: 'Bella', title: 'Carina Bruwer — 20th anniversary False Bay crossing',
          desc: 'Carina swam False Bay in April 2026 on her 20th anniversary of the crossing — 9h53 in tough conditions. She logs every swim on SwimLoading. Tag @carinabruwer — she reposts to 15K followers.',
          tags: ['Reel or carousel', 'Tag @carinabruwer', 'Amplification play'] },
        { date: 'Fri 11 Jul', pillar: 'Sponsor', assignee: 'Dave', pending: true, title: 'Trihard partnership — announcement post',
          desc: 'Trihard skin and hair care built for swimmers. Partnership verbally agreed — details confirmed this week. Launch post to go live once brief is finalised. Tag @trihard.',
          tags: ['Partnership launch', 'Tag @trihard', 'Stories swipe-up'] },
    ]},
    { label: 'Week 3 — 14–18 Jul', theme: 'Education + Ryan week', posts: [
        { date: 'Mon 14 Jul', pillar: 'Conditions', assignee: 'Dave', title: 'Weekly conditions — mid-winter check',
          desc: 'Graphic: this week\'s logged temps across top SA and UK spots. "Mid-winter and [X] swims logged this week. Who\'s keeping the streak alive?" Stories poll: "Did you swim this week?"',
          tags: ['Graphic', 'Stories poll'] },
        { date: 'Wed 16 Jul', pillar: 'Education', assignee: 'Bella', title: 'How to read open water conditions before you swim',
          desc: '"Before you get in — what to check. Swell, wind, current, temperature, visibility. SwimLoading tells you 3 of these in 30 seconds." Reel: 45-second walkthrough of the conditions page.',
          tags: ['Reel (45 sec)', 'App demo', 'CTA: download'] },
        { date: 'Fri 18 Jul', pillar: 'Community', assignee: 'Bella', title: 'Ryan Stramrood — swimmer spotlight',
          desc: '146 Robben Island crossings. First around Cape Horn. World records. Ryan Stramrood is on SwimLoading. Tag @ryanstramrood — his followers see the platform.',
          tags: ['Carousel', 'Tag @ryanstramrood', 'Amplification play'] },
    ]},
    { label: 'Week 4 — 21–25 Jul', theme: 'Club spotlight + challenge mid-point', posts: [
        { date: 'Mon 21 Jul', pillar: 'Conditions', assignee: 'Dave', title: 'Weekly temps — any sign of spring yet?',
          desc: '"Week 4 of July — any sign of spring? This week\'s temps across your favourite spots." Running comparison vs same time last year if data is available. Stories quiz: "Guess this week\'s False Bay temp."',
          tags: ['Graphic', 'Stories quiz'] },
        { date: 'Wed 23 Jul', pillar: 'Community', assignee: 'Bella', title: 'Club spotlight — DUC or Aquasharks',
          desc: '"Meet [Club Name] — one of the first clubs on SwimLoading. [X] members, [location], in the water every [day] together." Contact the club beforehand — they will repost to their own followers.',
          tags: ['Carousel', 'Club to repost', 'Tag members'] },
        { date: 'Fri 25 Jul', pillar: 'Sponsor', assignee: 'Dave', pending: true, title: 'Trihard challenge — mid-month progress update',
          desc: '"Halfway through July — [X] swimmers in. You\'ve got 2 weeks left." Stories: leaderboard screenshot. Tag @trihard. FOMO mechanic to push late entries.',
          tags: ['Progress update', 'Tag @trihard', 'FOMO mechanic'] },
    ]},
    { label: 'Week 5 — 28–31 Jul', theme: 'Month close · Sarah + winner reveal', posts: [
        { date: 'Mon 28 Jul', pillar: 'Community', assignee: 'Bella', title: 'Sarah Ferguson — swimmer spotlight',
          desc: 'First African woman across the Ka\'iwi Channel. First around Easter Island. Founder of Breathe Conservation. Sarah Ferguson is on SwimLoading. Tag Sarah — her followers see the platform.',
          tags: ['Carousel', 'Tag Sarah', 'Amplification play'] },
        { date: 'Wed 30 Jul', pillar: 'Education', assignee: 'Dave', title: 'Post-swim recovery — what actually works',
          desc: '"You just got out of 14°C water. Here\'s what your body needs in the next 30 minutes." Carousel: warm up, nutrition (Maurten / SiS angle), skin care (Trihard angle — organic integration). Save-bait that works for sponsors without feeling like an ad.',
          tags: ['Carousel (6 slides)', 'Organic sponsor mention', 'Save-bait'] },
        { date: 'Fri 1 Aug', pillar: 'Sponsor', assignee: 'Dave', pending: true, title: 'Trihard challenge — winner reveal',
          desc: '"July is done. Our Trihard Post-Swim Recovery Challenge winner is [name, city]. [X] swims in 31 days. Your kit is on its way." Tag @trihard and the winner. Stories: winner DM screenshot (with permission).',
          tags: ['Winner reveal', 'Tag @trihard + winner', 'Community celebration'] },
    ]},
];

const HASHTAG_SETS = [
    { label: 'Set A — Conditions', color: '#38bdf8', tags: '#openwater #coldwaterswimming #swimloading #falsebay #winterswimming', note: 'Use on weekly temp graphics and conditions posts.' },
    { label: 'Set B — Community', color: 'var(--green)', tags: '#swimloading #openwaterswimmer #southafricanswimming #swimcommunity #openwaterchallenge', note: 'Use on swimmer spotlights and milestone posts.' },
    { label: 'Set C — Education', color: 'var(--purple)', tags: '#coldwaterimmersion #swimsafety #openwatertraining #swimloading #coldwatertherapy', note: 'Use on tip carousels and safety content. High save-rate tags.' },
    { label: 'Set D — Sponsor / Challenge', color: 'var(--amber)', tags: '#swimchallenge #swimloading #openwaterchallenge #swimcommunity #giveaway', note: 'Use on partner and challenge posts. Keep giveaway only when there is an actual prize.' },
];

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const email = await getAuthedEmail(req.headers['authorization']);
        if (!email) return res.status(401).json({ error: 'not_authenticated' });

        const authorized = await isGrowthFounder(email);
        if (!authorized) return res.status(403).json({ error: 'not_authorized' });

        res.status(200).json({ weeks: WEEKS, hashtagSets: HASHTAG_SETS });
    } catch (err) {
        console.error('[content-calendar-data] unhandled exception:', err);
        res.status(500).json({ error: 'unhandled_exception', message: err.message });
    }
}
