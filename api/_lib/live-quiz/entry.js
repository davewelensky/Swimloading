// Entry decision for /live/:slug — shared by live.html (inlined copy) and
// the tests. Unauthenticated visitors go to the normal /app login and come
// back via the existing `_pendingJoin` localStorage hand-off (join.html set
// the pattern; app.js honours it after login/onboarding).
export function isSafeReturnUrl(url, origin) {
  try {
    const u = new URL(url, origin);
    return u.origin === origin && u.pathname.startsWith('/live/');
  } catch { return false; }
}

export function resolveLiveEntry({ session, href, now = Date.now() }) {
  if (session && session.user) return { action: 'play' };
  return { action: 'login', redirect: '/app', pendingJoin: { url: href, ts: now } };
}
