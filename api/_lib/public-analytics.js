// Analytics for the public SSR pages (crossings today, spots next).
//
// WHY THIS EXISTS. Increment 4 is meant to be measured, not guessed at:
// Google already ranks these pages, and until we can see what an organic
// visitor does after landing we are optimising blind. This emits the
// smallest thing that answers "did they arrive, did they go deeper, did
// they sign up".
//
// ONE PLATFORM, NOT TWO. These pages already carry GA4 (gtag) — the same
// tag the spot handler and /crossings use. The app, behind login, uses
// Supabase `analytics_events` because it has a user_id to attach. This
// file deliberately does NOT add a third thing: it sends GA4 events, and
// leaves a small attribution crumb that the app can pick up at signup so
// the two halves can be joined later (see ATTRIBUTION below).
//
// FAILURE IS NEVER FATAL. Every call is wrapped: if gtag is blocked (ad
// blockers are common), if localStorage throws (Safari private mode), or
// if anything else goes wrong, the page still renders and every link
// still navigates. Analytics must never cost a visitor the page.
//
// ATTRIBUTION. `Google → crossing → signup → swimmer` needs the crossing
// context to survive the hop into /app, which is a different document. We
// store one small JSON blob under a single key, first-touch-wins so a
// visitor who browses three crossings is still credited to the page that
// actually brought them in from search. The app reads it at signup and
// records it against the new user_id. That is the whole mechanism — no
// attribution platform, no cookies, no third party.

/** The one localStorage key. The app must read the same name. */
export const ATTRIBUTION_KEY = 'sl_public_attribution';

/** GA4 event names, in one place so the handler and the tests agree. */
export const CROSSING_EVENTS = {
  pageView: 'crossing_page_view',
  exploreClick: 'crossing_explore_click',
  signupClick: 'crossing_signup_click',
  loginClick: 'crossing_login_click',
};

/** The same four events for spot pages. Same shape, same machinery. */
export const SPOT_EVENTS = {
  pageView: 'spot_page_view',
  exploreClick: 'spot_explore_click',
  signupClick: 'spot_signup_click',
  loginClick: 'spot_login_click',
};

/**
 * The `spot_page_view` payload.
 *
 * `temperature_freshness_state` is the point of this one. It lets us ask
 * the question this increment exists to answer: do pages showing a stale
 * reading convert worse than pages showing a live one? Without it we would
 * be guessing at the cost of the defect we just fixed.
 */
export function spotEventPayload(spot, extra = {}) {
  const payload = {
    spot_id: spot?.id,
    slug: spot?.slug,
    spot_name: spot?.name,
    country: spot?.country_code,
    region: spot?.region || spot?.domain,
    water_type: spot?.water_type,
    temperature_freshness_state: spot?.freshness_state,
  };
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null && v !== '') payload[k] = v;
  }
  return Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
}

/**
 * The `crossing_page_view` payload. Pure and exported so tests can assert
 * the shape without rendering a page or running a browser.
 *
 * Values that are not known are OMITTED rather than sent as null or "" —
 * an empty string in a GA4 dimension is indistinguishable from a real
 * value later, and these rows are the evidence for the next increment.
 */
export function crossingEventPayload(crossing, extra = {}) {
  const payload = {
    crossing_id: crossing?.id,
    slug: crossing?.slug,
    crossing_name: crossing?.name,
  };
  // `connects` is the human-validated phrasing ("Spain ↔ Morocco") and is
  // the closest thing a crossing has to a region — country_code alone
  // cannot express Gibraltar (ES→ES) or Cook Strait (NZ→NZ).
  if (crossing?.connects) payload.region = crossing.connects;
  if (crossing?.country_code) payload.country = crossing.country_code;
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null && v !== '') payload[k] = v;
  }
  return Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
}

/**
 * The inline <script> for a crossing page.
 *
 * Clicks are handled by DELEGATION on [data-sl-event] rather than inline
 * onclick per link: one listener, nothing to forget when a CTA moves, and
 * one place where the try/catch lives. The listener never calls
 * preventDefault, so a thrown analytics error cannot swallow a click.
 */
export function crossingAnalyticsScript(crossing) {
  return publicPageAnalyticsScript({
    payload: crossingEventPayload(crossing),
    events: CROSSING_EVENTS,
    source: 'crossing',
    slug: crossing?.slug,
    entityId: crossing?.id,
  });
}

/**
 * The same script for a spot page. Spots and crossings deliberately share
 * one implementation: two copies would drift, and the first thing to drift
 * would be the attribution key, silently breaking the join at signup.
 */
export function spotAnalyticsScript(spot) {
  return publicPageAnalyticsScript({
    payload: spotEventPayload(spot),
    events: SPOT_EVENTS,
    source: 'spot',
    slug: spot?.slug,
    entityId: spot?.id,
  });
}

function publicPageAnalyticsScript({ payload, events, source, slug, entityId }) {
  const base = JSON.stringify(payload);
  const keys = JSON.stringify({ key: ATTRIBUTION_KEY, ev: events, src: source, slug: slug || null, eid: entityId || null });

  return `<script>
(function(){
  var CFG = ${keys}, BASE = ${base};
  function send(name, props){
    try {
      if (typeof gtag === 'function') gtag('event', name, props || {});
    } catch (e) { /* analytics must never break the page */ }
  }
  function merged(extra){
    var out = {};
    try {
      for (var k in BASE) out[k] = BASE[k];
      if (extra) for (var j in extra) if (extra[j] !== undefined && extra[j] !== null && extra[j] !== '') out[j] = extra[j];
    } catch (e) {}
    return out;
  }
  // Exposed so page code (and future sections) can send consistent events.
  window.slPublicTrack = function(name, extra){ send(name, merged(extra)); };
  // Kept for the crossing pages shipped in increment 4.
  window.slCrossingTrack = window.slPublicTrack;

  // ── page view ──────────────────────────────────────────────────────────
  try {
    send(CFG.ev.pageView, merged({
      referrer: document.referrer || undefined,
      landing_page: location.pathname + (location.search || '')
    }));
  } catch (e) {}

  // ── first-touch attribution crumb for the app's signup event ───────────
  // First touch wins: the page that brought them from search is the one
  // that earned the signup, not the last one they happened to read.
  try {
    if (!localStorage.getItem(CFG.key)) {
      localStorage.setItem(CFG.key, JSON.stringify({
        source: CFG.src,
        slug: CFG.slug,
        entity_id: CFG.eid,
        landing_page: location.pathname,
        referrer: document.referrer || null,
        at: new Date().toISOString()
      }));
    }
  } catch (e) { /* private mode: attribution is optional, the page is not */ }

  // ── delegated CTA clicks ───────────────────────────────────────────────
  document.addEventListener('click', function(e){
    try {
      var el = e.target && e.target.closest ? e.target.closest('[data-sl-event]') : null;
      if (!el) return;
      send(el.getAttribute('data-sl-event'), merged({
        cta_location: el.getAttribute('data-sl-cta') || undefined,
        destination_url: el.getAttribute('href') || undefined
      }));
    } catch (err) { /* never block the click */ }
  }, true);
})();
<\/script>`;
}
