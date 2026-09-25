// Backfill welcome email — HTML + plain-text builders.
//
// Sent once to people who completed onboarding but never received the normal
// welcome email, because RESEND_API_KEY was absent from Vercel from the day the
// feature shipped (29 Jul 2026) until 23 Sep 2026.
//
// Deliberately NOT the standard welcome copy. These people joined weeks ago and
// have been using the app, so "Welcome, your account is ready" would read as
// broken automation. This owns the gap, then asks how they are finding it.
//
// LAYOUT RULES, same as cldsa-intro-template.js and for the same reason. The
// first version put the dark background on a <div> styled from a <style>
// block; clients that strip it rendered near-white text on white. So:
//
//   - every structural background is a <table> with BOTH bgcolor and an inline
//     background-color, never a class or a div
//   - every block of text carries its own colour inline
//   - the <style> block is for the mobile media query only, and the email must
//     be fully readable if it is thrown away
//   - no web fonts: they do not load in most clients

const INSTALL_URL = 'https://www.swimloading.com/install?src=backfill_email';
const APP_URL     = 'https://www.swimloading.com/app?src=backfill_email';
const SHOT_URL    = 'https://www.swimloading.com/icons/home-screen.png';

const BG    = '#080f1a';
const CARD  = '#0f2036';
const EDGE  = '#1e3a5f';
const TEXT  = '#ffffff';
const MUTED = '#a9b8cc';
const CYAN  = '#38bdf8';

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export function buildBackfillHtml(firstName) {
  const name = escapeHtml(firstName || 'there');
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>How are you finding SwimLoading?</title>
<style type="text/css">
  body { margin:0 !important; padding:0 !important; background-color:${BG} !important; }
  table { border-collapse:collapse; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { color:${CYAN}; }
  @media only screen and (max-width:520px) {
    .sp { padding-left:22px !important; padding-right:22px !important; }
    .h1 { font-size:26px !important; }
  }
</style>
</head>
<body bgcolor="${BG}" style="margin:0;padding:0;background-color:${BG};">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}" style="background-color:${BG};">
<tr><td align="center" bgcolor="${BG}" style="background-color:${BG};padding:0;">

<table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}" style="width:520px;max-width:520px;background-color:${BG};">

  <tr><td bgcolor="#050c18" style="background-color:#050c18;padding:20px 32px;border-bottom:1px solid ${EDGE};" class="sp">
    <span style="font-family:${SANS};font-size:15px;font-weight:bold;letter-spacing:3px;color:${CYAN};">SWIMLOADING</span>
  </td></tr>

  <tr><td bgcolor="${BG}" style="background-color:${BG};padding:38px 32px 0;" class="sp">
    <div class="h1" style="font-family:${SANS};font-size:30px;line-height:1.25;font-weight:bold;color:${TEXT};margin:0 0 18px;">
      Hi ${name}, how are you finding it?
    </div>
    <div style="font-family:${SANS};font-size:16px;line-height:1.75;color:${MUTED};margin:0 0 18px;">
      You joined SwimLoading a few weeks ago and should have had a note from me
      then. You did not. A setting on our side quietly stopped those emails going
      out, and you were one of the people it affected. Sorry about that.
    </div>
    <div style="font-family:${SANS};font-size:16px;line-height:1.75;color:${MUTED};margin:0 0 26px;">
      Since you have been using it for a while now, the more useful question is
      the one in the subject line. What is working, what is annoying, what is
      missing? Just hit reply. It comes straight to me and I read every one.
    </div>
  </td></tr>

  <tr><td bgcolor="${BG}" style="background-color:${BG};padding:0 32px;" class="sp">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD}" style="background-color:${CARD};border:1px solid ${EDGE};border-radius:14px;">
      <tr><td bgcolor="${CARD}" style="background-color:${CARD};padding:24px;">
        <div style="font-family:${SANS};font-size:11px;font-weight:bold;letter-spacing:2px;color:${CYAN};margin:0 0 14px;">ONE THING WORTH DOING</div>
        <div style="font-family:${SANS};font-size:16px;line-height:1.7;color:${TEXT};margin:0 0 6px;">
          Put SwimLoading on your home screen. It is not in the app store and
          does not need to be: added this way it has its own icon and opens full
          screen, no browser bar. Ten seconds, nothing to download.
        </div>
      </td></tr>
    </table>
  </td></tr>

  <tr><td align="center" bgcolor="${BG}" style="background-color:${BG};padding:22px 32px 4px;" class="sp">
    <img src="${SHOT_URL}" width="190" alt="The SwimLoading icon on a phone home screen" style="width:190px;max-width:58%;height:auto;display:block;" />
  </td></tr>

  <tr><td bgcolor="${BG}" style="background-color:${BG};padding:14px 32px 0;" class="sp">
    <div style="font-family:${SANS};font-size:15px;line-height:1.9;color:${MUTED};margin:0 0 10px;">
      <b style="color:${TEXT};">iPhone:</b> open swimloading.com in Safari, tap
      <b style="color:${TEXT};">Share</b> (the square with an arrow coming out of
      it), then <b style="color:${TEXT};">Add to Home Screen</b>, then
      <b style="color:${TEXT};">Add</b>.
    </div>
    <div style="font-family:${SANS};font-size:15px;line-height:1.9;color:${MUTED};margin:0 0 22px;">
      <b style="color:${TEXT};">Android:</b> open swimloading.com in Chrome, tap
      the <b style="color:${TEXT};">&#8942;</b> menu, then
      <b style="color:${TEXT};">Install app</b>.
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td bgcolor="${CYAN}" style="background-color:${CYAN};border-radius:40px;">
        <a href="${INSTALL_URL}" style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:16px;font-weight:bold;color:#06111f;text-decoration:none;">Show me on my phone</a>
      </td></tr>
    </table>
  </td></tr>

  <tr><td bgcolor="${BG}" style="background-color:${BG};padding:28px 32px 40px;" class="sp">
    <div style="font-family:${SANS};font-size:15px;line-height:1.75;color:${MUTED};margin:0 0 20px;">
      Or just <a href="${APP_URL}" style="color:${CYAN};">open the app</a> and log
      your next swim.
    </div>
    <div style="font-family:${SANS};font-size:15px;line-height:1.75;color:${MUTED};margin:0;">
      Thanks for being an early one.<br />Dave
    </div>
  </td></tr>

  <tr><td bgcolor="#050c18" style="background-color:#050c18;padding:20px 32px;border-top:1px solid ${EDGE};" class="sp">
    <div style="font-family:${SANS};font-size:12px;line-height:1.6;color:#6b7f99;">
      SwimLoading, Cape Town<br />
      You are getting this because you created a SwimLoading account.
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

export function buildBackfillText(firstName) {
  const name = firstName || 'there';
  return `Hi ${name}, how are you finding it?

You joined SwimLoading a few weeks ago and should have had a note from me then.
You did not. A setting on our side quietly stopped those emails going out, and
you were one of the people it affected. Sorry about that.

Since you have been using it for a while now, the more useful question is the
one in the subject line. What is working, what is annoying, what is missing?
Just hit reply. It comes straight to me and I read every one.

ONE THING WORTH DOING
Put SwimLoading on your home screen. It is not in the app store and does not
need to be: added this way it has its own icon and opens full screen, no browser
bar. Ten seconds, nothing to download.

iPhone: open swimloading.com in Safari, tap Share (the square with an arrow
coming out of it), then Add to Home Screen, then Add.

Android: open swimloading.com in Chrome, tap the three-dot menu, then
Install app.

Show me on my phone: ${INSTALL_URL}

Or just open the app and log your next swim: ${APP_URL}

Thanks for being an early one.
Dave

SwimLoading, Cape Town
You are getting this because you created a SwimLoading account.`;
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
