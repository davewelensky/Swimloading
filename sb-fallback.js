/* sb-fallback.js — keeps the app working on networks that block *.supabase.co (e.g. school Wi-Fi).
 *
 * Pass window.slSupabaseFetch to supabase.createClient as { global: { fetch: window.slSupabaseFetch } }.
 * Normal networks: requests go straight to Supabase exactly as before.
 * Blocked networks: a direct request that fails at the network level (TypeError "Failed to fetch") is retried
 * once through swimloading.com/sb/* (a Vercel proxy to Supabase, see vercel.json). If that works, the browser
 * remembers and goes through the proxy first from then on. The client URL is left unchanged on purpose so the
 * saved login session (keyed on the Supabase URL) is not lost.
 */
(function () {
  var ORIGIN = 'https://szgkzuswelntnevobnoh.supabase.co';
  var FLAG = 'sl_sb_via_proxy';
  var proxyFirst = false;
  try { proxyFirst = localStorage.getItem(FLAG) === '1'; } catch (e) {}

  function remember(on) {
    proxyFirst = on;
    try { if (on) localStorage.setItem(FLAG, '1'); else localStorage.removeItem(FLAG); } catch (e) {}
  }

  function toProxy(url) { return location.origin + '/sb' + url.slice(ORIGIN.length); }

  function urlOf(input) { return typeof input === 'string' ? input : (input && input.url) || String(input); }

  function swap(input, newUrl) {
    // Request objects are rebuilt (method, headers, body carry over); strings are just replaced.
    return typeof input === 'string' ? newUrl : new Request(newUrl, input);
  }

  window.slSupabaseFetch = function (input, init) {
    var url = urlOf(input);
    if (url.indexOf(ORIGIN) !== 0) return fetch(input, init);

    var first = proxyFirst ? toProxy(url) : url;
    var second = proxyFirst ? url : toProxy(url);

    // A request body can only be sent once if it is a stream; clone Request inputs so the retry has one.
    var retryInput = typeof input === 'string' ? input : input.clone();

    return fetch(swap(input, first), init).catch(function (err) {
      // Only retry real network failures; an aborted request (user navigated, timeout) should stay aborted.
      if (!(err instanceof TypeError)) throw err;
      return fetch(swap(retryInput, second), init).then(function (res) {
        remember(!proxyFirst);
        return res;
      });
    });
  };
})();
