/**
 * SwimLoading — SITE CONFIG (single source of truth)
 * ==================================================
 * Cross-page facts that used to be copy-pasted across ~10 static pages and
 * drift out of sync at every month rollover / country add. Edit HERE ONLY.
 *
 * `site-sync.js` reads this and stamps the values into any page that loads it.
 * All dates are SAST (Africa/Johannesburg, UTC+2).
 *
 * ── HOW TO USE ON A PAGE ─────────────────────────────────────────────────
 *   <script src="/site-config.js"></script>
 *   <script src="/site-sync.js"></script>
 *
 * Then tag elements — site-sync fills their textContent:
 *   <span data-sync="countries"></span>     → total country count (auto = list + 1)
 *   <span data-sync="spots"></span>          → 140
 *   <span data-sync="swimmers"></span>       → 600
 *   <span data-sync="tempsLogged"></span>    → 2400
 *   <span data-sync="challenge.title"></span>   → current month's challenge title
 *   <span data-sync="challenge.sponsor"></span> → current month's sponsor
 *   <span data-sync="challenge.prize"></span>   → current month's prize
 *
 * Sponsor challenge box on a partner page (auto shown / hidden / recapped):
 *   <div data-challenge="magic5"> …states inside… </div>   (see site-sync.js)
 *
 * ── WHAT TO EDIT, WHEN ───────────────────────────────────────────────────
 *   Add a country .......... add one object to `countries` below. Done — the
 *                            count updates everywhere automatically.
 *   New monthly challenge .. add a `challenges['YYYY-MM']` entry. It goes live
 *                            on the 1st of that month automatically (SAST).
 *   Announce a winner ...... set `winner` on that month's challenge entry.
 *   New spot/swimmer totals  bump `spots` / `swimmers` / `tempsLogged`.
 */

window.SITE_CONFIG = {

  /* ── GLOBAL STATS ──────────────────────────────────────────────────────
   * `countries` is the international list (South Africa is home, counted via
   * +1 by site-sync). It is ALSO the source welcome.html builds its hero pills
   * and country grid from, so adding one object here updates the count AND the
   * homepage visuals in one edit. Keep the shape identical to existing entries.
   */
  /* `slug` = the region slug spots-handler.js resolves at /spots/[slug] and
   * /countries/[slug] (see api/seo-utils.js COUNTRY_SLUGS). Any page linking
   * to a country's page should build the href from THIS field, not guess it
   * from the label — Italy has no dedicated country page yet (falls back to
   * '/spots/europe', its containing region) so slug is null there. */
  countries: [
    { name:'Namibia',        label:'Namibia',        slug:'namibia',        color:'#fb923c', bg:'rgba(251,146,60,0.1)',  border:'rgba(217,119,6,0.5)',  gridBg:'rgba(251,146,60,0.07)',  gridBorder:'rgba(217,119,6,0.4)', spots:'Walvis Bay · Swakopmund',              pillDelay:'1.2s', dotDelay:'0.4s' },
    { name:'United Kingdom', label:'United Kingdom', slug:'united-kingdom', color:'#818cf8', bg:'rgba(129,140,248,0.1)', border:'rgba(217,119,6,0.5)',  gridBg:'rgba(129,140,248,0.07)', gridBorder:'rgba(217,119,6,0.4)', spots:'Canford Cliffs · Heron Lake · Tooting Bec', pillDelay:'1.5s', dotDelay:'0.7s' },
    { name:'Australia',      label:'Australia',      slug:'australia',      color:'#34d399', bg:'rgba(52,211,153,0.1)',  border:'rgba(217,119,6,0.5)',  gridBg:'rgba(52,211,153,0.07)',  gridBorder:'rgba(217,119,6,0.4)', spots:'Cottesloe Beach · Perth',              pillDelay:'1.8s', dotDelay:'1.0s' },
    { name:'Switzerland',    label:'Switzerland',    slug:'switzerland',    color:'#fb7185', bg:'rgba(251,113,133,0.1)', border:'rgba(217,119,6,0.5)',  gridBg:'rgba(251,113,133,0.07)', gridBorder:'rgba(217,119,6,0.4)', spots:'Gland Plage · Promenthoux · Lake Geneva', pillDelay:'2.1s', dotDelay:'1.3s' },
    { name:'Portugal',       label:'Portugal',       slug:'portugal',       color:'#fbbf24', bg:'rgba(251,191,36,0.1)',  border:'rgba(217,119,6,0.5)',  gridBg:'rgba(251,191,36,0.07)',  gridBorder:'rgba(217,119,6,0.4)', spots:'Cascais · Atlantic Coast',             pillDelay:'2.4s', dotDelay:'1.6s' },
    { name:'USA',            label:'USA',            slug:'united-states',  color:'#60a5fa', bg:'rgba(96,165,250,0.1)',  border:'rgba(96,165,250,0.4)',  gridBg:'rgba(96,165,250,0.07)',  gridBorder:'rgba(217,119,6,0.4)', spots:'Aquatic Park · San Francisco Bay',     pillDelay:'2.8s', dotDelay:'1.9s' },
    { name:'Seychelles',     label:'Seychelles',     slug:'seychelles',     color:'#2dd4bf', bg:'rgba(45,212,191,0.1)',  border:'rgba(45,212,191,0.4)',  gridBg:'rgba(45,212,191,0.07)',  gridBorder:'rgba(217,119,6,0.4)', spots:'Mahé · Beau Vallon',                   pillDelay:'3.2s', dotDelay:'2.2s' },
    { name:'Italy',          label:'Italy',          slug:null,             color:'#a3e635', bg:'rgba(163,230,53,0.1)',  border:'rgba(163,230,53,0.4)',  gridBg:'rgba(163,230,53,0.07)',  gridBorder:'rgba(217,119,6,0.4)', spots:"Lago d'Orta",                          pillDelay:'3.6s', dotDelay:'2.5s' },
    { name:'France',         label:'France',         slug:'france',         color:'#f472b6', bg:'rgba(244,114,182,0.1)', border:'rgba(244,114,182,0.4)', gridBg:'rgba(244,114,182,0.07)', gridBorder:'rgba(217,119,6,0.4)', spots:'Promenade des Anglais · Nice',         pillDelay:'4.0s', dotDelay:'2.8s' },
    { name:'Croatia',        label:'Croatia',        slug:'croatia',        color:'#38bdf8', bg:'rgba(56,189,248,0.1)',  border:'rgba(56,189,248,0.4)',  gridBg:'rgba(56,189,248,0.07)',  gridBorder:'rgba(217,119,6,0.4)', spots:'Hvar · Split · Pakleni Islands',       pillDelay:'4.4s', dotDelay:'3.1s' },
    { name:'Spain',          label:'Spain',          slug:'spain',          color:'#fbbf24', bg:'rgba(251,191,36,0.1)',  border:'rgba(217,119,6,0.5)',  gridBg:'rgba(251,191,36,0.07)',  gridBorder:'rgba(217,119,6,0.4)', spots:'Santa Ponsa · Mallorca',               pillDelay:'4.8s', dotDelay:'3.4s' },
    { name:'Thailand',       label:'Thailand',       slug:'thailand',       color:'#fb923c', bg:'rgba(251,146,60,0.1)',  border:'rgba(217,119,6,0.5)',  gridBg:'rgba(251,146,60,0.07)',  gridBorder:'rgba(217,119,6,0.4)', spots:'Phuket',                               pillDelay:'5.2s', dotDelay:'3.7s' },
  ],

  // NOTE: these three are a fast-paint FALLBACK ONLY — site-sync.js fetches the
  // true, currently-climbing counts straight from Supabase on every page load
  // (same numbers /admin shows) and overwrites these before the page settles.
  // No longer worth hand-bumping precisely; keep them roughly current so the
  // brief pre-fetch flash isn't wildly wrong.
  spots:       185,
  swimmers:    642,
  tempsLogged: 1509,
  saSpots:     120,   // South African spots (active, country_code=ZA) — fast-paint fallback; site-sync fetches the live count

  /* ── MONTHLY CHALLENGE CALENDAR ────────────────────────────────────────
   * Keyed 'YYYY-MM'. site-sync auto-selects the entry for the current SAST
   * month, so a new month's challenge goes live at 00:00 SAST on the 1st with
   * no code change — just have its entry ready here.
   *   winner: null  → challenge not yet decided (recap box shows "announced soon")
   *   winner: 'Name'→ recap box shows the winner (ONLY set a VERIFIED name)
   */
  challenges: {
    '2026-06': {
      title:     'June Community Challenge',
      sponsor:   'THEMAGIC5',
      prize:     'Custom-fit THEMAGIC5 Vector goggles',
      startDate: '2026-06-01',
      endDate:   '2026-06-30',
      winner:    'Tunnan The Swede',   // verified by Dave, 2026-07-04
    },
    '2026-07': {
      title:     'July Challenge · Winter Warrior',
      sponsor:   'Blu Smooth',
      prize:     'Blu Smooth MK2 Comp wetsuit (R5,999 value)',
      startDate: '2026-07-01',
      endDate:   '2026-07-31',
      winner:    'Rod Holshausen',   // drawn + approved 1 Aug 2026 — see challenge_draw_results id b68bbbd5-...
    },
    '2026-08': {
      title:     'August Challenge',
      sponsor:   'Maurten',
      prize:     'Box of Maurten Gel 100s',
      startDate: '2026-08-01',
      endDate:   '2026-08-31',
      winner:    null,   // random draw on 1 September — leave null until drawn
    },
  },

  /* ── SPONSOR CHALLENGE BLOCKS (partner pages) ──────────────────────────
   * A partner page's <div data-challenge="<key>"> renders from here.
   * `challengeMonth` links the sponsor to the month they ran. site-sync then:
   *   • shows the ACTIVE state while that month is current,
   *   • shows the RECAP state once it has ended AND a winner is set,
   *   • shows a neutral "complete, winner announced soon" while ended + no winner,
   *   • hides the box entirely if there is no matching challenge.
   */
  sponsorChallenges: {
    magic5:    { challengeMonth: '2026-06' },   // THEMAGIC5 sponsored June
    blusmooth: { challengeMonth: '2026-07' },   // Blu Smooth sponsored July (Winter Warrior)
    maurten:   { challengeMonth: '2026-08' },   // Maurten sponsors August
  },

};
