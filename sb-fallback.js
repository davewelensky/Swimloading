/* sb-fallback.js — keeps the app working on networks that block *.supabase.co (e.g. school Wi-Fi).
 *
 * Pass window.slSupabaseFetch to supabase.createClient as { global: { fetch: window.slSupabaseFetch } }.
 * Normal networks: requests go straight to Supabase exactly as before.
 * Blocked networks: a direct request that fails at the network level (TypeError "Failed to fetch") is retried
 * once through swimloading.com/sb/* (a Vercel proxy to Supabase, see vercel.json). Some filters drop packets
 * instead of refusing, so a direct request can hang for the browser's full connection timeout (20-60 s):
 * for read requests (GET/HEAD) and sign-in / session refresh the proxy request is therefore started in parallel once the direct one has been
 * silent for SLOW_MS, and whichever answers first wins. Data writes are never raced (a duplicate could double-write);
 * they are only retried after a hard failure. When the proxy wins, the browser remembers for 24 h and goes
 * through the proxy first, then probes direct again. The client URL is left unchanged on purpose so the saved
 * login session (keyed on the Supabase URL) is not lost.
 */
(function () {
  var ORIGIN = 'https://szgkzuswelntnevobnoh.supabase.co';
  var FLAG = 'sl_sb_via_proxy';
  var TTL_MS = 24 * 60 * 60 * 1000;
  var proxyFirst = false;
  try { var saved = Number(localStorage.getItem(FLAG)); proxyFirst = saved > 1 && Date.now() - saved < TTL_MS; } catch (e) {}

  function remember(on) {
    proxyFirst = on;
    try { if (on) localStorage.setItem(FLAG, String(Date.now())); else localStorage.removeItem(FLAG); } catch (e) {}
  }

  function toProxy(url) { return location.origin + '/sb' + url.slice(ORIGIN.length); }
  function urlOf(input) { return typeof input === 'string' ? input : (input && input.url) || String(input); }
  // Request objects are rebuilt (method, headers, body carry over); strings are just replaced.
  function swap(input, newUrl) { return typeof input === 'string' ? newUrl : new Request(newUrl, input); }
  function methodOf(input, init) { return String((init && init.method) || (typeof input !== 'string' && input && input.method) || 'GET').toUpperCase(); }
  function slowMs() { var v = Number(window.SL_SB_SLOW_MS); return v > 0 ? v : 5000; }

  window.slSupabaseFetch = function (input, init) {
    var url = urlOf(input);
    if (url.indexOf(ORIGIN) !== 0) return fetch(input, init);

    var method = methodOf(input, init);
    // Reads, plus sign-in and session refresh (a duplicate of either is harmless). Data writes are never duplicated.
    var safe = method === 'GET' || method === 'HEAD' || (method === 'POST' && url.indexOf(ORIGIN + '/auth/v1/token') === 0);
    var directIn = input, proxyIn = swap(typeof input === 'string' ? input : input.clone(), toProxy(url));
    var firstIn = proxyFirst ? proxyIn : directIn, secondIn = proxyFirst ? directIn : proxyIn;
    var secondIsProxy = !proxyFirst;

    // Hard failures (the connection is refused or reset): retry once the other way. An abort stays an abort.
    if (!safe) {
      return fetch(firstIn, init).catch(function (err) {
        if (!(err instanceof TypeError)) throw err;
        return fetch(secondIn, init).then(function (res) { remember(secondIsProxy); return res; });
      });
    }

    // Reads: start the other route after SLOW_MS of silence (or at once on a hard failure); first answer wins.
    return new Promise(function (resolve, reject) {
      var settled = false, firstErr = null, secondErr = null, secondStarted = false, timer = null;
      function fail() { if (!settled && firstErr && secondErr) { settled = true; reject(firstErr); } }
      function startSecond() {
        if (secondStarted || settled) return;
        secondStarted = true;
        fetch(secondIn, init).then(function (res) { if (settled) return; settled = true; clearTimeout(timer); remember(secondIsProxy); resolve(res); }, function (e) { secondErr = e; fail(); });
      }
      timer = setTimeout(startSecond, slowMs());
      fetch(firstIn, init).then(function (res) { if (settled) return; settled = true; clearTimeout(timer); resolve(res); }, function (e) {
        firstErr = e; clearTimeout(timer);
        if (!(e instanceof TypeError)) { if (!settled) { settled = true; reject(e); } return; }   // an abort stays an abort
        if (!secondStarted) startSecond();
        fail();
      });
    });
  };
})();
